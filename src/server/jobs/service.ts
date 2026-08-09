import { randomUUID } from "node:crypto";
import { statfs, readFile } from "node:fs/promises";
import { loadavg, totalmem, freemem } from "node:os";

import type { Database } from "../db/client.js";

export type JobStatus =
  | "queued"
  | "waiting_resources"
  | "running"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "stale";

export type JobType =
  | "supervisor_turn"
  | "worker_turn"
  | "verification"
  | "setup"
  | "notification"
  | "project_export";

export type ResourceSnapshot = {
  status: "pass" | "wait";
  waitReason: string | null;
  memory: {
    totalMb: number;
    freeMb: number;
    availableMb: number;
    availablePercent: number;
    requiredFreeMb: number;
    requiredAvailablePercent: number;
  };
  disk: {
    freeMb: number;
    requiredFreeMb: number;
  };
  cpu: {
    usagePercent: number | null;
    maxUsagePercent: number | null;
  };
  load: {
    oneMinute: number;
    maxLoadAverage: number | null;
  };
  nextCheckAt: string | null;
};

export type JobSummary = {
  id: string;
  projectId: string;
  runId: string | null;
  jobType: JobType;
  status: JobStatus;
  priority: number;
  attempts: number;
  maxAttempts: number;
  lockedBy: string | null;
  heartbeatAt: string | null;
  timeoutAt: string | null;
  staleAfter: string | null;
  resourceWaitReason: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  errorSummary: string | null;
  metadata: Record<string, unknown>;
};

export type JobHandlerResult = {
  summary: string;
  metadata?: Record<string, unknown>;
};

export type JobHandler = (job: JobSummary) => Promise<JobHandlerResult>;
export type JobHandlers = Partial<Record<JobType, JobHandler>>;

type JobRow = {
  id: string;
  project_id: string;
  run_id: string | null;
  job_type: JobType;
  status: JobStatus;
  priority: number;
  attempts: number;
  max_attempts: number;
  locked_by: string | null;
  heartbeat_at: Date | null;
  timeout_at: Date | null;
  stale_after: Date | null;
  resource_wait_reason: string | null;
  scheduled_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  error_summary: string | null;
  metadata: Record<string, unknown>;
};

export type JobResourceSettings = {
  min_free_memory_mb: number;
  min_available_memory_percent: number;
  min_free_disk_mb: number;
  max_cpu_usage_percent: number | null;
  max_load_average: string | null;
  resource_recheck_interval_seconds: number;
  stale_heartbeat_seconds: number;
  codex_turn_timeout_seconds: number;
  build_timeout_seconds: number;
  test_timeout_seconds: number;
  export_timeout_seconds: number;
  emulator_timeout_seconds: number;
};

type SettingsRow = JobResourceSettings;

export type ResourceReadings = {
  memory: {
    totalMb: number;
    freeMb: number;
    availableMb: number;
  };
  disk: {
    freeMb: number;
  };
  cpuUsagePercent: number | null;
  oneMinuteLoad: number;
};

export class JobService {
  private readonly runnerId = `app-${process.pid}`;

  constructor(
    private readonly database: Database,
    private readonly projectsDir: string,
    private handlers: JobHandlers = {}
  ) {}

  setHandlers(handlers: JobHandlers): void {
    this.handlers = handlers;
  }

  async enqueue(input: {
    projectId: string;
    jobType: JobType;
    priority?: number;
    maxAttempts?: number;
    metadata?: Record<string, unknown>;
  }): Promise<JobSummary> {
    const id = randomUUID();
    await this.database.pool.query(
      `
        insert into jobs (
          id, project_id, job_type, status, priority, max_attempts, scheduled_at, metadata
        )
        values ($1, $2, $3, 'queued', $4, $5, now(), $6)
      `,
      [
        id,
        input.projectId,
        input.jobType,
        input.priority ?? 0,
        input.maxAttempts ?? 1,
        JSON.stringify(input.metadata ?? {})
      ]
    );
    return (await this.getJob(id))!;
  }

  async getActiveProjectAutomationJob(projectId: string): Promise<JobSummary | null> {
    const result = await this.database.pool.query<JobRow>(
      `
        select *
        from jobs
        where project_id = $1
          and job_type in ('supervisor_turn', 'worker_turn')
          and status in ('queued', 'waiting_resources', 'running')
        order by priority desc, scheduled_at asc
        limit 1
      `,
      [projectId]
    );
    return result.rows[0] ? mapJobRow(result.rows[0]) : null;
  }

  async getStatus(): Promise<{
    resourceSnapshot: ResourceSnapshot;
    jobs: JobSummary[];
  }> {
    const [settings, jobs] = await Promise.all([this.getSettings(), this.listJobs()]);
    return {
      resourceSnapshot: await this.readResourceSnapshot(settings),
      jobs
    };
  }

  async tick(): Promise<{
    resourceSnapshot: ResourceSnapshot;
    handledJobs: JobSummary[];
  }> {
    await this.recoverStaleJobs();
    const settings = await this.getSettings();
    const snapshot = await this.readResourceSnapshot(settings);
    const candidates = await this.getRunnableCandidates();
    const handledJobs: JobSummary[] = [];
    for (const job of candidates) {
      if (snapshot.status === "wait") {
        await this.recordResourceChecks(job.id, snapshot, settings);
        await this.database.pool.query(
          `
            update jobs
            set status = 'waiting_resources',
                resource_wait_reason = $2,
                heartbeat_at = now()
            where id = $1 and status in ('queued', 'waiting_resources')
          `,
          [job.id, snapshot.waitReason]
        );
        handledJobs.push((await this.getJob(job.id))!);
        continue;
      }
      const jobTimeoutSeconds = timeoutSeconds(job.jobType, settings);
      const locked = await this.acquireProjectLock(job.projectId, job.id, jobTimeoutSeconds);
      if (!locked) {
        continue;
      }
      try {
        await this.startJob(job, jobTimeoutSeconds);
        const handler = this.handlers[job.jobType];
        if (!handler) {
          throw new Error(`job_handler_not_configured:${job.jobType}`);
        }
        const result = await handler(job);
        await this.completeJob(job, result);
      } catch (error) {
        await this.failJob(job, error);
      } finally {
        await this.releaseProjectLock(job.projectId, job.id);
        handledJobs.push((await this.getJob(job.id))!);
      }
    }
    return {
      resourceSnapshot: snapshot,
      handledJobs
    };
  }

  async recoverStaleJobs(): Promise<number> {
    const result = await this.database.pool.query(
      `
        update jobs
        set status = 'stale',
            finished_at = now(),
            error_summary = 'Job heartbeat became stale or timeout deadline passed.'
        where status = 'running'
          and (
            (stale_after is not null and stale_after < now())
            or (timeout_at is not null and timeout_at < now())
          )
      `
    );
    await this.database.pool.query("delete from project_locks where expires_at is not null and expires_at < now()");
    return result.rowCount ?? 0;
  }

  private async startJob(job: JobSummary, jobTimeoutSeconds: number): Promise<void> {
    const now = Date.now();
    const timeoutAt = new Date(now + jobTimeoutSeconds * 1000);
    await this.database.pool.query(
      `
        update jobs
        set status = 'running',
            attempts = attempts + 1,
            locked_by = $2,
            locked_at = now(),
            heartbeat_at = now(),
            timeout_at = $3,
            stale_after = $4,
            started_at = coalesce(started_at, now()),
            resource_wait_reason = null
        where id = $1
      `,
      [
        job.id,
        this.runnerId,
        timeoutAt,
        timeoutAt
      ]
    );
  }

  private async completeJob(job: JobSummary, result: JobHandlerResult): Promise<void> {
    await this.database.pool.query(
      `
        insert into process_heartbeats (
          id, job_id, process_kind, pid, host_id, status, last_seen_at, metadata
        )
        values ($1, $2, $3, $4, $5, 'completed', now(), $6)
      `,
      [
        randomUUID(),
        job.id,
        job.jobType,
        process.pid,
        this.runnerId,
        JSON.stringify({
          summary: result.summary,
          ...(result.metadata ?? {})
        })
      ]
    );
    await this.database.pool.query(
      `
        update jobs
        set status = 'succeeded',
            heartbeat_at = now(),
            finished_at = now(),
            error_summary = null
        where id = $1
      `,
      [job.id]
    );
  }

  private async failJob(job: JobSummary, error: unknown): Promise<void> {
    const nextAttempts = job.attempts + 1;
    const status = failedJobStatus(nextAttempts, job.maxAttempts);
    const errorSummary = error instanceof Error ? error.message.slice(0, 2000) : "unknown job error";
    await this.database.pool.query(
      `
        insert into process_heartbeats (
          id, job_id, process_kind, pid, host_id, status, last_seen_at, metadata
        )
        values ($1, $2, $3, $4, $5, 'failed', now(), $6)
      `,
      [
        randomUUID(),
        job.id,
        job.jobType,
        process.pid,
        this.runnerId,
        JSON.stringify({ errorSummary })
      ]
    );
    await this.database.pool.query(
      `
        update jobs
        set status = $2,
            heartbeat_at = now(),
            finished_at = case when $2 = 'failed' then now() else null end,
            locked_by = null,
            locked_at = null,
            timeout_at = null,
            stale_after = null,
            error_summary = $3
        where id = $1
      `,
      [job.id, status, errorSummary]
    );
  }

  private async getRunnableCandidates(): Promise<JobSummary[]> {
    const result = await this.database.pool.query<JobRow>(
      `
        select *
        from jobs
        where status in ('queued', 'waiting_resources')
          and scheduled_at <= now()
        order by priority desc, scheduled_at asc
        limit 10
      `
    );
    return result.rows.map(mapJobRow);
  }

  private async listJobs(): Promise<JobSummary[]> {
    const result = await this.database.pool.query<JobRow>(
      `
        select *
        from jobs
        order by scheduled_at desc
        limit 50
      `
    );
    return result.rows.map(mapJobRow);
  }

  private async getJob(id: string): Promise<JobSummary | null> {
    const result = await this.database.pool.query<JobRow>("select * from jobs where id = $1", [id]);
    return result.rows[0] ? mapJobRow(result.rows[0]) : null;
  }

  private async acquireProjectLock(
    projectId: string,
    jobId: string,
    jobTimeoutSeconds: number
  ): Promise<boolean> {
    const result = await this.database.pool.query(
      `
        insert into project_locks (project_id, lock_owner, lock_reason, locked_at, expires_at)
        values ($1, $2, $3, now(), $4)
        on conflict (project_id) do nothing
      `,
      [
        projectId,
        this.runnerId,
        `job:${jobId}`,
        new Date(Date.now() + jobTimeoutSeconds * 1000)
      ]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async releaseProjectLock(projectId: string, jobId: string): Promise<void> {
    await this.database.pool.query(
      "delete from project_locks where project_id = $1 and lock_reason = $2",
      [projectId, `job:${jobId}`]
    );
  }

  private async getSettings(): Promise<SettingsRow> {
    const result = await this.database.pool.query<SettingsRow>(
      `
        select min_free_memory_mb, min_available_memory_percent, min_free_disk_mb,
          max_cpu_usage_percent, max_load_average, resource_recheck_interval_seconds,
          stale_heartbeat_seconds, codex_turn_timeout_seconds, build_timeout_seconds,
          test_timeout_seconds, export_timeout_seconds, emulator_timeout_seconds
        from app_settings
        where id = true
      `
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("app_settings singleton row is missing");
    }
    return row;
  }

  private async readResourceSnapshot(settings: SettingsRow): Promise<ResourceSnapshot> {
    const memory = await readMemoryMb();
    const disk = await readDiskFreeMb(this.projectsDir);
    return evaluateResourceSnapshot(
      {
        memory,
        disk,
        cpuUsagePercent: null,
        oneMinuteLoad: loadavg()[0] ?? 0
      },
      settings
    );
  }

  private async recordResourceChecks(
    jobId: string,
    snapshot: ResourceSnapshot,
    settings: SettingsRow
  ): Promise<void> {
    const nextCheckAt = snapshot.nextCheckAt ? new Date(snapshot.nextCheckAt) : null;
    await this.database.pool.query(
      `
        insert into resource_checks (
          id, job_id, check_type, status, available_memory_mb, free_memory_mb,
          total_memory_mb, required_free_memory_mb, required_available_memory_percent,
          checked_at, next_check_at, metadata
        )
        values ($1, $2, 'memory', $3, $4, $5, $6, $7, $8, now(), $9, $10)
      `,
      [
        randomUUID(),
        jobId,
        snapshot.status,
        snapshot.memory.availableMb,
        snapshot.memory.freeMb,
        snapshot.memory.totalMb,
        snapshot.memory.requiredFreeMb,
        snapshot.memory.requiredAvailablePercent,
        nextCheckAt,
        JSON.stringify({ waitReason: snapshot.waitReason })
      ]
    );
    await this.database.pool.query(
      `
        insert into resource_checks (
          id, job_id, check_type, status, free_disk_mb, required_free_disk_mb,
          load_average, max_load_average, checked_at, next_check_at, metadata
        )
        values ($1, $2, 'disk', $3, $4, $5, $6, $7, now(), $8, $9)
      `,
      [
        randomUUID(),
        jobId,
        snapshot.status,
        snapshot.disk.freeMb,
        snapshot.disk.requiredFreeMb,
        snapshot.load.oneMinute,
        settings.max_load_average,
        nextCheckAt,
        JSON.stringify({ waitReason: snapshot.waitReason })
      ]
    );
  }
}

export function evaluateResourceSnapshot(
  readings: ResourceReadings,
  settings: JobResourceSettings,
  now = new Date()
): ResourceSnapshot {
  const waits: string[] = [];
  const availablePercent = Math.floor(
    (readings.memory.availableMb / Math.max(readings.memory.totalMb, 1)) * 100
  );
  const maxLoadAverage =
    settings.max_load_average === null ? null : Number(settings.max_load_average);
  if (readings.memory.freeMb < settings.min_free_memory_mb) {
    waits.push(`free memory ${readings.memory.freeMb}MB below ${settings.min_free_memory_mb}MB`);
  }
  if (availablePercent < settings.min_available_memory_percent) {
    waits.push(
      `available memory ${availablePercent}% below ${settings.min_available_memory_percent}%`
    );
  }
  if (readings.disk.freeMb < settings.min_free_disk_mb) {
    waits.push(`free disk ${readings.disk.freeMb}MB below ${settings.min_free_disk_mb}MB`);
  }
  if (
    readings.cpuUsagePercent !== null &&
    settings.max_cpu_usage_percent !== null &&
    readings.cpuUsagePercent > settings.max_cpu_usage_percent
  ) {
    waits.push(
      `CPU usage ${readings.cpuUsagePercent}% above ${settings.max_cpu_usage_percent}%`
    );
  }
  if (maxLoadAverage !== null && readings.oneMinuteLoad > maxLoadAverage) {
    waits.push(`load average ${readings.oneMinuteLoad.toFixed(2)} above ${maxLoadAverage}`);
  }
  return {
    status: waits.length > 0 ? "wait" : "pass",
    waitReason: waits.length > 0 ? waits.join("; ") : null,
    memory: {
      totalMb: readings.memory.totalMb,
      freeMb: readings.memory.freeMb,
      availableMb: readings.memory.availableMb,
      availablePercent,
      requiredFreeMb: settings.min_free_memory_mb,
      requiredAvailablePercent: settings.min_available_memory_percent
    },
    disk: {
      freeMb: readings.disk.freeMb,
      requiredFreeMb: settings.min_free_disk_mb
    },
    cpu: {
      usagePercent: readings.cpuUsagePercent,
      maxUsagePercent: settings.max_cpu_usage_percent
    },
    load: {
      oneMinute: readings.oneMinuteLoad,
      maxLoadAverage
    },
    nextCheckAt:
      waits.length > 0
        ? new Date(now.getTime() + settings.resource_recheck_interval_seconds * 1000).toISOString()
        : null
  };
}

export function timeoutSeconds(jobType: JobType, settings: JobResourceSettings): number {
  if (jobType === "project_export") {
    return settings.export_timeout_seconds;
  }
  if (jobType === "verification") {
    return settings.test_timeout_seconds;
  }
  if (jobType === "worker_turn" || jobType === "supervisor_turn") {
    return settings.codex_turn_timeout_seconds;
  }
  return settings.build_timeout_seconds;
}

export function failedJobStatus(attemptsAfterFailure: number, maxAttempts: number): JobStatus {
  return attemptsAfterFailure < maxAttempts ? "queued" : "failed";
}

async function readMemoryMb() {
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const total = matchMeminfo(text, "MemTotal") ?? Math.floor(totalmem() / 1024 / 1024);
    const free = matchMeminfo(text, "MemFree") ?? Math.floor(freemem() / 1024 / 1024);
    const available = matchMeminfo(text, "MemAvailable") ?? free;
    return {
      totalMb: total,
      freeMb: free,
      availableMb: available
    };
  } catch {
    return {
      totalMb: Math.floor(totalmem() / 1024 / 1024),
      freeMb: Math.floor(freemem() / 1024 / 1024),
      availableMb: Math.floor(freemem() / 1024 / 1024)
    };
  }
}

function matchMeminfo(text: string, key: string): number | null {
  const match = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
  return match ? Math.floor(Number(match[1]) / 1024) : null;
}

async function readDiskFreeMb(path: string): Promise<{ freeMb: number }> {
  const stats = await statfs(path);
  return {
    freeMb: Math.floor((stats.bavail * stats.bsize) / 1024 / 1024)
  };
}

function mapJobRow(row: JobRow): JobSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    jobType: row.job_type,
    status: row.status,
    priority: row.priority,
    attempts: row.attempts,
    maxAttempts: row.max_attempts,
    lockedBy: row.locked_by,
    heartbeatAt: row.heartbeat_at?.toISOString() ?? null,
    timeoutAt: row.timeout_at?.toISOString() ?? null,
    staleAfter: row.stale_after?.toISOString() ?? null,
    resourceWaitReason: row.resource_wait_reason,
    scheduledAt: row.scheduled_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    errorSummary: row.error_summary,
    metadata: row.metadata ?? {}
  };
}
