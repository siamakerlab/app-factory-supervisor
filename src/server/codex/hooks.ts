import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

const managedMarker = "APP_FACTORY_SUPERVISOR_MANAGED";
const appVersion = "0.1.0";

type FileOwner = "app" | "user" | "missing";

export type CodexHookStatus = {
  codexHomeDir: string;
  configPath: string;
  hooksPath: string;
  configOwner: FileOwner;
  hooksOwner: FileOwner;
  conflicts: string[];
  appVersion: string;
  codexCliVersion: string | null;
  workerPollIntervalSeconds: number;
  lastStopHookAt: string | null;
  managedHooks: string[];
};

export type StopHookInput = {
  source?: string;
  projectId?: string | null;
  runId?: string | null;
  role?: "supervisor" | "worker" | null;
  event?: string;
  bodyType?: string;
  ipAddress?: string;
};

export class CodexHookService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getStatus(): Promise<CodexHookStatus> {
    const paths = getRuntimePaths(this.config);
    const configPath = join(paths.codexHomeDir, "config.toml");
    const hooksPath = join(paths.codexHomeDir, "hooks.json");
    const [configOwner, hooksOwner, codexCliVersion, settings, lastStopHookAt] = await Promise.all([
      detectOwner(configPath),
      detectOwner(hooksPath),
      readCodexCliVersion(),
      this.getSettings(),
      this.getLastStopHookAt()
    ]);
    const conflicts = [
      ...(configOwner === "user" ? ["config.toml exists without app-managed marker"] : []),
      ...(hooksOwner === "user" ? ["hooks.json exists without app-managed marker"] : [])
    ];
    return {
      codexHomeDir: paths.codexHomeDir,
      configPath,
      hooksPath,
      configOwner,
      hooksOwner,
      conflicts,
      appVersion,
      codexCliVersion,
      workerPollIntervalSeconds: settings.worker_poll_interval_seconds,
      lastStopHookAt,
      managedHooks: ["Stop", "SessionEnd"]
    };
  }

  async installManagedHooks(force = false): Promise<CodexHookStatus> {
    const status = await this.getStatus();
    if (status.conflicts.length > 0 && !force) {
      await this.recordAudit("codex.hooks_install_conflict", "Managed Codex hooks were not installed because user hooks exist.", {
        configPath: status.configPath,
        hooksPath: status.hooksPath,
        conflicts: status.conflicts
      });
      return status;
    }

    await mkdir(status.codexHomeDir, { recursive: true, mode: 0o700 });
    const generatedAt = new Date().toISOString();
    const codexCliVersion = status.codexCliVersion ?? "unknown";
    const configContent = [
      `# ${managedMarker}`,
      "# Owner: App Factory Supervisor",
      "# Purpose: Codex worker runtime defaults and managed hook ownership marker.",
      `# Generated: ${generatedAt}`,
      `# App-Version: ${appVersion}`,
      `# Codex-CLI-Version: ${codexCliVersion}`,
      "# This file is app-managed. Regenerate through the web Settings screen.",
      ""
    ].join("\n");
    const hooks = {
      description: `${managedMarker}: App Factory Supervisor Codex hooks.`,
      metadata: {
        marker: managedMarker,
        owner: "App Factory Supervisor",
        generatedAt,
        appVersion,
        codexCliVersion,
        purpose: "Backend notification and advisory guardrails. Not a security boundary."
      },
      hooks: {
        Stop: [
          {
            hooks: [
              {
                type: "command",
                command: stopHookCommand(),
                timeout: 5
              },
              {
                type: "command",
                command: advisoryGuardrailCommand("Stop")
              }
            ]
          }
        ],
        SessionEnd: [
          {
            hooks: [
              {
                type: "command",
                command: sessionEndCommand(),
                timeout: 5
              }
            ]
          }
        ],
        SessionStart: [
          {
            hooks: [
              {
                type: "command",
                command: setupContextCommand(),
                timeout: 5
              }
            ]
          }
        ]
      }
    };
    await writeFile(status.configPath, configContent, {
      encoding: "utf8",
      mode: 0o600
    });
    await writeFile(status.hooksPath, `${JSON.stringify(hooks, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await this.recordAudit("codex.hooks_installed", "Managed Codex hook configuration was installed.", {
      hooksPath: status.hooksPath,
      generatedAt,
      appVersion,
      codexCliVersion,
      force
    });
    return this.getStatus();
  }

  async recordStopHookCallback(input: StopHookInput): Promise<{ ok: true }> {
    await this.recordAudit("codex.stop_hook_callback", "Codex Stop hook callback accepted.", {
      source: input.source ?? "codex_stop_hook",
      projectId: input.projectId ?? null,
      runId: input.runId ?? null,
      role: input.role ?? null,
      event: input.event ?? "Stop",
      bodyType: input.bodyType ?? null,
      ipAddress: input.ipAddress ?? null
    });

    if (input.runId) {
      await this.database.pool.query(
        `
          insert into process_heartbeats (
            id, job_id, run_id, process_kind, status, last_seen_at, metadata
          )
          values ($1, null, $2, $3, 'hook_callback', now(), $4)
        `,
        [
          randomUUID(),
          input.runId,
          input.role ?? "codex",
          JSON.stringify({
            source: input.source ?? "codex_stop_hook",
            event: input.event ?? "Stop"
          })
        ]
      );
    }

    return { ok: true };
  }

  async pollActiveWorkerState(): Promise<{
    checkedAt: string;
    pollIntervalSeconds: number;
    staleJobs: number;
    activeRuns: number;
    completedRuns: number;
  }> {
    const settings = await this.getSettings();
    const staleJobsResult = await this.database.pool.query(
      `
        update jobs
        set status = 'stale',
            finished_at = now(),
            error_summary = 'Worker poll detected missed completion or stale process state.'
        where status = 'running'
          and (
            (stale_after is not null and stale_after < now())
            or (timeout_at is not null and timeout_at < now())
          )
      `
    );
    const activeRunsResult = await this.database.pool.query<{ count: string }>(
      "select count(*) as count from runs where status = 'running'"
    );
    const completedRunsResult = await this.database.pool.query<{ count: string }>(
      "select count(*) as count from runs where status in ('succeeded', 'failed') and finished_at > now() - interval '10 minutes'"
    );
    await this.recordAudit("codex.worker_state_polled", "Active worker state was polled as Stop hook fallback.", {
      staleJobs: staleJobsResult.rowCount ?? 0,
      activeRuns: Number(activeRunsResult.rows[0]?.count ?? 0),
      completedRuns: Number(completedRunsResult.rows[0]?.count ?? 0)
    });
    return {
      checkedAt: new Date().toISOString(),
      pollIntervalSeconds: settings.worker_poll_interval_seconds,
      staleJobs: staleJobsResult.rowCount ?? 0,
      activeRuns: Number(activeRunsResult.rows[0]?.count ?? 0),
      completedRuns: Number(completedRunsResult.rows[0]?.count ?? 0)
    };
  }

  private async getSettings(): Promise<{
    worker_poll_interval_seconds: number;
  }> {
    const result = await this.database.pool.query<{ worker_poll_interval_seconds: number }>(
      "select worker_poll_interval_seconds from app_settings where id = true"
    );
    return {
      worker_poll_interval_seconds: result.rows[0]?.worker_poll_interval_seconds ?? 300
    };
  }

  private async getLastStopHookAt(): Promise<string | null> {
    const result = await this.database.pool.query<{ created_at: Date }>(
      `
        select created_at
        from app_audit_events
        where event_type = 'codex.stop_hook_callback'
        order by created_at desc
        limit 1
      `
    );
    return result.rows[0]?.created_at.toISOString() ?? null;
  }

  private async recordAudit(
    eventType: string,
    summary: string,
    metadata: Record<string, unknown>
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into app_audit_events (id, event_type, actor_type, summary, metadata, created_at)
        values ($1, $2, 'system', $3, $4, now())
      `,
      [randomUUID(), eventType, summary, metadata]
    );
  }
}

async function detectOwner(path: string): Promise<FileOwner> {
  try {
    const content = await readFile(path, "utf8");
    return content.includes(managedMarker) ? "app" : "user";
  } catch {
    return "missing";
  }
}

function readCodexCliVersion(): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn("codex", ["--version"], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    const chunks: Buffer[] = [];
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      resolve(null);
    }, 5_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", () => {
      clearTimeout(timeout);
      resolve(null);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      resolve(exitCode === 0 ? Buffer.concat(chunks).toString("utf8").trim() || null : null);
    });
  });
}

function stopHookCommand(): string {
  return [
    "node -e",
    JSON.stringify(
      "const payload={source:'codex-stop-hook',event:'Stop',projectId:process.env.APP_FACTORY_PROJECT_ID||null,runId:process.env.APP_FACTORY_RUN_ID||null,role:process.env.APP_FACTORY_ROLE||null};fetch(process.env.APP_FACTORY_STOP_HOOK_URL||'http://127.0.0.1:3000/api/codex/hooks/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(r=>console.log(JSON.stringify({ok:r.ok,status:r.status}))).catch(e=>console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)})))"
    )
  ].join(" ");
}

function sessionEndCommand(): string {
  return [
    "node -e",
    JSON.stringify(
      "const payload={source:'codex-session-end-hook',event:'SessionEnd',projectId:process.env.APP_FACTORY_PROJECT_ID||null,runId:process.env.APP_FACTORY_RUN_ID||null,role:process.env.APP_FACTORY_ROLE||null};fetch(process.env.APP_FACTORY_SESSION_END_HOOK_URL||process.env.APP_FACTORY_STOP_HOOK_URL||'http://127.0.0.1:3000/api/codex/hooks/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)}).then(r=>console.log(JSON.stringify({ok:r.ok,status:r.status}))).catch(e=>console.log(JSON.stringify({ok:false,error:String(e&&e.message||e)})))"
    )
  ].join(" ");
}

function advisoryGuardrailCommand(event: string): string {
  return [
    "node -e",
    JSON.stringify(
      `console.log(JSON.stringify({ok:true,event:${JSON.stringify(event)},guardrails:['supervisor-no-code','secret-exposure','ignored-sensitive-path'],advisory:true}))`
    )
  ].join(" ");
}

function setupContextCommand(): string {
  return [
    "node -e",
    JSON.stringify(
      "console.log(JSON.stringify({ok:true,context:'App Factory Supervisor managed session. Supervisor chooses prompts only; worker performs implementation and verification.'}))"
    )
  ].join(" ");
}
