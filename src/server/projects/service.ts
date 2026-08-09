import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { evaluateCompletionGate, type CompletionGateResult } from "../supervisor/completionGate.js";
import type { CreateProjectInput } from "./schema.js";
import { updateChecklistItemSchema } from "./schema.js";

type ProjectStatus =
  | "running"
  | "production_ready_user_action_required"
  | "blocked_needs_user"
  | "failed"
  | "budget_exhausted"
  | "cancelled";

export type ProjectSummary = {
  id: string;
  projectName: string;
  appName: string;
  packageName: string;
  projectType: "new" | "existing";
  repositoryUrl: string;
  projectDir: string;
  status: ProjectStatus;
  currentPhase: string;
  maxExecutionHours: number;
  maxWorkerTurns: number;
  remoteReachable: boolean;
  currentVersion: string | null;
  lastCommitSha: string | null;
  lastPushedCommitSha: string | null;
  latestWorkerResponse: string | null;
  createdAt: string;
  updatedAt: string;
};

export type CreatedProject = ProjectSummary & {
  firstSupervisorPrompt: string;
  sshPublicKey: string | null;
  gitStatus: {
    remoteReachable: boolean;
    output: string;
  };
  keystore: {
    created: boolean;
    path: string | null;
  };
};

export type ProjectDetail = ProjectSummary & {
  progress: {
    totalGates: number;
    completedGates: number;
    percent: number;
    gates: ProgressGateSummary[];
  };
  timeline: TimelineEventSummary[];
  latestWorkerResponse: string | null;
  currentSupervisorPrompt: string | null;
  verification: {
    overallStatus: "unknown" | "pass" | "fail" | "mixed";
    latestTier: string | null;
    recent: VerificationSummary[];
  };
  userRequiredItems: UserRequiredItemSummary[];
  supervisorInstructions: SupervisorInstructionSummary[];
  recentArtifacts: ProjectArtifactSummary[];
  recentExports: ProjectExportSummary[];
  finalStatusSummary: string;
};

export type RunHistorySummary = {
  id: string;
  role: "supervisor" | "worker";
  iteration: number;
  status: string;
  codexThreadId: string | null;
  promptArtifactId: string | null;
  jsonlArtifactId: string | null;
  workerFinalResponseArtifactId: string | null;
  exitCode: number | null;
  startedAt: string;
  finishedAt: string | null;
};

export type ProjectCompletionGate = CompletionGateResult & {
  projectId: string;
  applied: boolean;
};

export type SupervisorInstructionSummary = {
  id: string;
  instruction: string;
  attachmentArtifactId: string | null;
  priority: "low" | "normal" | "high";
  applyAfterCurrentWorkerRun: boolean;
  status: "queued" | "considered" | "applied" | "dismissed";
  createdAt: string;
  consideredAt: string | null;
};

export type ProgressGateSummary = {
  key: string;
  label: string;
  phase: string;
  status: "pending" | "pass" | "fail" | "blocked" | "skipped";
  weight: number;
  evidenceArtifactId: string | null;
  updatedAt: string;
};

export type TimelineEventSummary = {
  id: string;
  runId: string | null;
  iteration: number | null;
  eventType: "supervisor_prompt_sent" | "worker_final_response";
  title: string;
  body: string | null;
  artifactId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
};

export type VerificationSummary = {
  id: string;
  runId: string | null;
  checkType: string;
  status: "pass" | "fail" | "skipped";
  verificationTier: string | null;
  rationale: string | null;
  command: string | null;
  summary: string | null;
  artifactId: string | null;
  createdAt: string;
};

export type UserRequiredItemSummary = {
  key: string;
  label: string;
  status: "needed" | "provided" | "pass" | "failed" | "blocked";
  requiredForProduction: boolean;
  canContinueWithoutIt: boolean;
  secret: boolean;
  lastValidation: string | null;
  updatedAt: string;
};

export type ProjectArtifactSummary = {
  id: string;
  runId: string | null;
  artifactType: string;
  path: string;
  sizeBytes: number | null;
  redacted: boolean;
  createdAt: string;
};

export type ProjectExportSummary = {
  id: string;
  status: "queued" | "running" | "ready" | "failed" | "expired" | "deleted";
  artifactId: string | null;
  fileCount: number | null;
  sizeBytes: number | null;
  errorSummary: string | null;
  requestedAt: string;
  finishedAt: string | null;
};

type ProjectRow = {
  id: string;
  project_name: string;
  app_name: string;
  package_name: string;
  project_type: "new" | "existing";
  repository_url: string;
  project_dir: string;
  status: ProjectStatus;
  current_phase: string;
  max_execution_hours: number;
  max_worker_turns: number;
  latest_worker_response: string | null;
  current_version: string | null;
  last_commit_sha: string | null;
  last_pushed_commit_sha: string | null;
  created_at: Date;
  updated_at: Date;
  remote_reachable: boolean | null;
};

type ProgressGateRow = {
  gate_key: string;
  label: string;
  phase: string;
  status: ProgressGateSummary["status"];
  weight: number;
  evidence_artifact_id: string | null;
  updated_at: Date;
};

type TimelineEventRow = {
  id: string;
  run_id: string | null;
  iteration: number | null;
  event_type: TimelineEventSummary["eventType"];
  title: string;
  body: string | null;
  artifact_id: string | null;
  metadata: Record<string, unknown>;
  created_at: Date;
};

type VerificationRow = {
  id: string;
  run_id: string | null;
  check_type: string;
  status: VerificationSummary["status"];
  verification_tier: string | null;
  rationale: string | null;
  command: string | null;
  summary: string | null;
  artifact_id: string | null;
  created_at: Date;
};

type UserRequiredItemRow = {
  id?: string;
  item_key: string;
  label: string;
  status: UserRequiredItemSummary["status"];
  required_for_production: boolean;
  can_continue_without_it: boolean;
  secret: boolean;
  last_validation: string | null;
  secret_id?: string | null;
  updated_at: Date;
};

type ProjectArtifactRow = {
  id: string;
  run_id: string | null;
  artifact_type: string;
  path: string;
  size_bytes: string | number | null;
  redacted: boolean;
  created_at: Date;
};

type ProjectExportRow = {
  id: string;
  status: ProjectExportSummary["status"];
  artifact_id: string | null;
  file_count: number | null;
  size_bytes: string | number | null;
  error_summary: string | null;
  requested_at: Date;
  finished_at: Date | null;
};

type RunHistoryRow = {
  id: string;
  role: "supervisor" | "worker";
  iteration: number;
  status: string;
  codex_thread_id: string | null;
  prompt_artifact_id: string | null;
  jsonl_artifact_id: string | null;
  worker_final_response_artifact_id: string | null;
  exit_code: number | null;
  started_at: Date;
  finished_at: Date | null;
};

type SupervisorInstructionRow = {
  id: string;
  instruction: string;
  attachment_artifact_id: string | null;
  priority: SupervisorInstructionSummary["priority"];
  apply_after_current_worker_run: boolean;
  status: SupervisorInstructionSummary["status"];
  created_at: Date;
  considered_at: Date | null;
};

type SettingsRow = {
  default_max_execution_hours: number;
  default_max_worker_turns: number;
};

type ToolchainSnapshotRow = {
  id: string;
};

const initialGates = [
  ["requirements_clarified", "Requirements clarified", "product definition"],
  ["mvp_drafted", "MVP drafted", "product definition"],
  ["market_review_completed", "Market/competitor review completed", "market review"],
  ["mvp_revised", "MVP revised", "product definition"],
  ["roadmap_drafted", "Roadmap drafted", "roadmap planning"],
  ["roadmap_audit_passes", "Roadmap audit passes", "roadmap planning"],
  ["deferred_items", "Deferred items documented", "roadmap planning"],
  ["frontend_ux_plan", "Frontend/UX plan", "UX planning"],
  ["phone_foldable_tablet_plan", "Phone/foldable/tablet layout plan", "UX planning"],
  ["scaffold_ready", "Scaffold ready", "implementation"],
  ["core_features", "Core features implemented", "implementation"],
  ["ui_states", "UI states implemented", "implementation"],
  ["persistence_networking", "Persistence/networking implemented", "implementation"],
  ["roadmap_code_gap_review", "Roadmap-code gap review", "gap review"],
  ["android_build", "Android build passes", "QA planning"],
  ["tests", "Tests pass", "QA planning"],
  ["qa_scenario_plan", "QA scenario plan", "QA planning"],
  ["emulator_device_tests", "Emulator/device scenario tests", "emulator verification"],
  ["screenshot_review", "Screenshot review", "emulator verification"],
  ["device_matrix_verification", "Phone/foldable/tablet verification", "emulator verification"],
  ["full_code_review", "Full-code review", "code review"],
  ["placeholders_cleared", "Placeholders cleared", "code review"],
  ["permissions_privacy", "Permissions/privacy reviewed", "code review"],
  ["signing_release_packaging", "Signing/release packaging", "production ready"],
  ["docs_runbook", "Docs/runbook ready", "production ready"],
  ["external_user_actions", "External user actions documented", "production ready"]
] as const;

const checklistItems = [
  ["app_name", "App name", false, true],
  ["package_name", "Package name", false, true],
  ["target_audience", "Target audience", false, true],
  ["permissions", "Permissions", false, true],
  ["privacy_policy_url", "Privacy policy URL", false, true],
  ["api_keys", "API keys", true, false],
  ["oauth_setup", "OAuth setup", true, false],
  ["admob_ids", "AdMob IDs", true, false],
  ["play_console_service_account", "Play Console service account", true, false],
  ["production_signing_key", "Production signing key", true, false],
  ["dns_domain", "DNS/domain", false, false],
  ["legal_policy_approval", "Legal/policy approval", false, false]
] as const;

export class ProjectService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async listProjects(): Promise<ProjectSummary[]> {
    const result = await this.database.pool.query<ProjectRow>(
      `
        select p.*, g.remote_reachable, v.current_version, v.last_commit_sha, v.last_pushed_commit_sha,
          (
            select body
            from timeline_events t
            where t.project_id = p.id and t.event_type = 'worker_final_response'
            order by t.created_at desc
            limit 1
          ) as latest_worker_response
        from projects p
        left join project_git_settings g on g.project_id = p.id
        left join project_version_state v on v.project_id = p.id
        order by p.created_at desc
      `
    );
    return result.rows.map(mapProjectRow);
  }

  async createProject(input: CreateProjectInput): Promise<CreatedProject> {
    const settings = await this.getSettings();
    const id = randomUUID();
    const now = new Date();
    const projectDir = join(getRuntimePaths(this.config).projectsDir, `${slugify(input.projectName)}-${id.slice(0, 8)}`);
    const gitHome = join(this.config.APP_DATA_DIR, "git-home");
    await Promise.all([
      mkdir(projectDir, { recursive: true, mode: 0o700 }),
      mkdir(gitHome, { recursive: true, mode: 0o700 })
    ]);
    await this.writeGitConfig(gitHome, input.globalGitUserName, input.globalGitUserEmail);
    const sshPublicKeyPath = await this.ensureSshKey();
    const sshPublicKey = sshPublicKeyPath ? await readFile(sshPublicKeyPath, "utf8") : null;

    const gitStatus =
      input.projectType === "existing"
        ? await this.cloneExisting(input.repositoryUrl, projectDir, gitHome)
        : await this.initializeNewRepository(input.repositoryUrl, projectDir, gitHome);
    await ensureProjectSensitiveGitignore(projectDir);
    if (input.projectType === "new") {
      await writeFile(join(projectDir, "AGENTS.md"), buildAgentsMd(input), "utf8");
    }
    const status: ProjectStatus = gitStatus.remoteReachable ? "running" : "blocked_needs_user";
    const firstSupervisorPrompt = initialSupervisorPrompt(input);
    const keystore =
      input.projectType === "new"
        ? await this.createReleaseKeystore(id, projectDir)
        : { created: false, path: null };

    await this.database.pool.query("begin");
    try {
      await this.database.pool.query(
        `
          insert into projects (
            id, project_name, app_name, package_name, user_app_plan, project_type,
            repository_url, project_dir, status, current_phase, max_execution_hours,
            max_worker_turns, created_at, updated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'product definition', $10, $11, $12, $12)
        `,
        [
          id,
          input.projectName,
          input.appName,
          input.packageName,
          input.userAppPlan,
          input.projectType,
          input.repositoryUrl,
          projectDir,
          status,
          input.maxExecutionHours ?? settings.default_max_execution_hours,
          input.maxWorkerTurns ?? settings.default_max_worker_turns,
          now
        ]
      );
      await this.database.pool.query(
        `
          insert into project_git_settings (
            project_id, global_user_name, global_user_email, ssh_public_key_path,
            remote_reachable, last_verified_at
          )
          values ($1, $2, $3, $4, $5, now())
        `,
        [
          id,
          input.globalGitUserName,
          input.globalGitUserEmail,
          sshPublicKeyPath ?? "",
          gitStatus.remoteReachable
        ]
      );
      await this.createVersionState(id, now);
      await this.assignLatestToolchainSnapshot(id);
      await this.createInitialGates(id, now);
      await this.createChecklist(id, input, now);
      await this.recordFirstPrompt(id, firstSupervisorPrompt, now);
      if (keystore.created && keystore.path) {
        await this.recordKeystoreSecret(id, keystore.path, now);
      }
      await this.database.pool.query("commit");
    } catch (error) {
      await this.database.pool.query("rollback");
      throw error;
    }

    const project = (await this.getProject(id))!;
    return {
      ...project,
      firstSupervisorPrompt,
      sshPublicKey,
      gitStatus,
      keystore
    };
  }

  async getProjectDetail(id: string): Promise<ProjectDetail | null> {
    const project = await this.getProject(id);
    if (!project) {
      return null;
    }
    const [
      gates,
      timeline,
      verification,
      userRequiredItems,
      supervisorInstructions,
      recentArtifacts,
      recentExports
    ] =
      await Promise.all([
        this.getProgressGates(id),
        this.getTimeline(id),
        this.getVerification(id),
        this.getUserRequiredItems(id),
        this.getSupervisorInstructions(id),
        this.getRecentArtifacts(id),
        this.getRecentExports(id)
      ]);
    const completedGates = gates.filter((gate) => gate.status === "pass" || gate.status === "skipped").length;
    const percent = gates.length > 0 ? Math.round((completedGates / gates.length) * 100) : 0;
    const latestWorkerResponse =
      timeline
        .filter((event) => event.eventType === "worker_final_response")
        .at(-1)?.body ?? project.latestWorkerResponse;
    const currentSupervisorPrompt =
      timeline
        .filter((event) => event.eventType === "supervisor_prompt_sent")
        .at(-1)?.body ?? null;
    return {
      ...project,
      progress: {
        totalGates: gates.length,
        completedGates,
        percent,
        gates
      },
      timeline,
      latestWorkerResponse,
      currentSupervisorPrompt,
      verification: {
        overallStatus: verificationStatus(verification),
        latestTier: verification[0]?.verificationTier ?? null,
        recent: verification
      },
      userRequiredItems,
      supervisorInstructions,
      recentArtifacts,
      recentExports,
      finalStatusSummary: finalStatusSummary(project, percent, userRequiredItems, verification)
    };
  }

  async startProjectRun(projectId: string): Promise<ProjectDetail | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    await this.database.pool.query(
      `
        update projects
        set status = 'running',
            started_at = coalesce(started_at, now()),
            completed_at = null,
            updated_at = now()
        where id = $1
      `,
      [projectId]
    );
    return this.getProjectDetail(projectId);
  }

  async recordSupervisorPrompt(
    projectId: string,
    prompt: string,
    metadata: Record<string, unknown> = {}
  ): Promise<void> {
    const iterationResult = await this.database.pool.query<{ iteration: number }>(
      `
        select coalesce(max(iteration), 0) + 1 as iteration
        from timeline_events
        where project_id = $1 and event_type = 'supervisor_prompt_sent'
      `,
      [projectId]
    );
    await this.database.pool.query(
      `
        insert into timeline_events (
          id, project_id, iteration, event_type, title, body, metadata, created_at
        )
        values ($1, $2, $3, 'supervisor_prompt_sent', 'Supervisor prompt sent', $4, $5, now())
      `,
      [
        randomUUID(),
        projectId,
        iterationResult.rows[0]?.iteration ?? 1,
        prompt,
        JSON.stringify(metadata)
      ]
    );
  }

  async updateChecklistItem(
    projectId: string,
    itemKey: string,
    input: unknown
  ): Promise<ProjectDetail | null> {
    const patch = updateChecklistItemSchema.parse(input);
    const existing = await this.getChecklistItem(projectId, itemKey);
    if (!existing) {
      return null;
    }
    let secretId = existing.secret_id ?? null;
    if (existing.secret && ["provided", "pass"].includes(patch.status) && !secretId) {
      secretId = await this.createChecklistSecretMarker(projectId, itemKey);
    }
    await this.database.pool.query(
      `
        update user_required_items
        set status = $3,
            secret_id = $4,
            last_validation = $5,
            updated_at = now()
        where project_id = $1 and item_key = $2
      `,
      [projectId, itemKey, patch.status, secretId, patch.lastValidation ?? null]
    );
    await this.applyChecklistProjectStatus(projectId);
    return this.getProjectDetail(projectId);
  }

  async queueSupervisorInstruction(
    projectId: string,
    input: {
      instruction: string;
      attachmentArtifactId?: string | null;
      priority?: "low" | "normal" | "high";
      applyAfterCurrentWorkerRun?: boolean;
      createdByUserId?: string | null;
    }
  ): Promise<ProjectDetail | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    await this.database.pool.query(
      `
        insert into supervisor_instructions (
          id, project_id, instruction, attachment_artifact_id, priority,
          apply_after_current_worker_run, status, created_by_user_id, created_at
        )
        values ($1, $2, $3, $4, $5, $6, 'queued', $7, now())
      `,
      [
        randomUUID(),
        projectId,
        input.instruction,
        input.attachmentArtifactId ?? null,
        input.priority ?? "normal",
        input.applyAfterCurrentWorkerRun ?? true,
        input.createdByUserId ?? null
      ]
    );
    return this.getProjectDetail(projectId);
  }

  async evaluateAndApplyCompletionGate(projectId: string): Promise<ProjectCompletionGate | null> {
    const project = await this.getProjectDetail(projectId);
    if (!project) {
      return null;
    }
    const [runCounts, jobCounts] = await Promise.all([
      this.getRunCounts(projectId),
      this.getJobCounts(projectId)
    ]);
    const result = evaluateCompletionGate({
      project,
      runCounts,
      jobCounts,
      now: new Date()
    });
    const terminal = result.status !== "running";
    await this.database.pool.query(
      `
        update projects
        set status = $2,
            completed_at = case when $3 = true then coalesce(completed_at, now()) else completed_at end,
            updated_at = now()
        where id = $1
      `,
      [projectId, result.status, terminal]
    );
    return {
      projectId,
      applied: true,
      ...result
    };
  }

  async getProjectTimeline(projectId: string): Promise<TimelineEventSummary[] | null> {
    if (!(await this.getProject(projectId))) {
      return null;
    }
    return this.getTimeline(projectId);
  }

  async getProjectChecklist(projectId: string): Promise<UserRequiredItemSummary[] | null> {
    if (!(await this.getProject(projectId))) {
      return null;
    }
    return this.getUserRequiredItems(projectId);
  }

  async getRunHistory(projectId: string): Promise<RunHistorySummary[] | null> {
    if (!(await this.getProject(projectId))) {
      return null;
    }
    const result = await this.database.pool.query<RunHistoryRow>(
      `
        select id, role, iteration, status, codex_thread_id, prompt_artifact_id,
          jsonl_artifact_id, worker_final_response_artifact_id, exit_code,
          started_at, finished_at
        from runs
        where project_id = $1
        order by started_at desc
        limit 100
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      role: row.role,
      iteration: row.iteration,
      status: row.status,
      codexThreadId: row.codex_thread_id,
      promptArtifactId: row.prompt_artifact_id,
      jsonlArtifactId: row.jsonl_artifact_id,
      workerFinalResponseArtifactId: row.worker_final_response_artifact_id,
      exitCode: row.exit_code,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null
    }));
  }

  async stopProjectRun(projectId: string): Promise<ProjectDetail | null> {
    const project = await this.getProject(projectId);
    if (!project) {
      return null;
    }
    await this.database.pool.query(
      `
        update runs
        set status = 'failed',
            finished_at = coalesce(finished_at, now())
        where project_id = $1 and status = 'running'
      `,
      [projectId]
    );
    await this.database.pool.query(
      `
        update jobs
        set status = 'cancelled',
            finished_at = coalesce(finished_at, now()),
            error_summary = 'Project run stopped by user.'
        where project_id = $1 and status in ('queued', 'waiting_resources', 'running')
      `,
      [projectId]
    );
    await this.database.pool.query(
      `
        update projects
        set status = 'cancelled',
            updated_at = now()
        where id = $1
      `,
      [projectId]
    );
    return this.getProjectDetail(projectId);
  }

  private async getProject(id: string): Promise<ProjectSummary | null> {
    const result = await this.database.pool.query<ProjectRow>(
      `
        select p.*, g.remote_reachable, v.current_version, v.last_commit_sha, v.last_pushed_commit_sha,
          null::text as latest_worker_response
        from projects p
        left join project_git_settings g on g.project_id = p.id
        left join project_version_state v on v.project_id = p.id
        where p.id = $1
      `,
      [id]
    );
    return result.rows[0] ? mapProjectRow(result.rows[0]) : null;
  }

  private async getSettings(): Promise<SettingsRow> {
    const result = await this.database.pool.query<SettingsRow>(
      "select default_max_execution_hours, default_max_worker_turns from app_settings where id = true"
    );
    if (!result.rows[0]) {
      throw new Error("app_settings singleton row is missing");
    }
    return result.rows[0];
  }

  private async getProgressGates(projectId: string): Promise<ProgressGateSummary[]> {
    const result = await this.database.pool.query<ProgressGateRow>(
      `
        select gate_key, label, phase, status, weight, evidence_artifact_id, updated_at
        from progress_gates
        where project_id = $1
        order by updated_at asc, gate_key asc
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      key: row.gate_key,
      label: row.label,
      phase: row.phase,
      status: row.status,
      weight: row.weight,
      evidenceArtifactId: row.evidence_artifact_id,
      updatedAt: row.updated_at.toISOString()
    }));
  }

  private async getTimeline(projectId: string): Promise<TimelineEventSummary[]> {
    const result = await this.database.pool.query<TimelineEventRow>(
      `
        select id, run_id, iteration, event_type, title, body, artifact_id, metadata, created_at
        from timeline_events
        where project_id = $1
          and event_type in ('supervisor_prompt_sent', 'worker_final_response')
        order by created_at asc, iteration asc nulls last
        limit 200
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      iteration: row.iteration,
      eventType: row.event_type,
      title: row.title,
      body: row.body,
      artifactId: row.artifact_id,
      metadata: row.metadata,
      createdAt: row.created_at.toISOString()
    }));
  }

  private async getVerification(projectId: string): Promise<VerificationSummary[]> {
    const result = await this.database.pool.query<VerificationRow>(
      `
        select id, run_id, check_type, status, verification_tier, rationale,
          command, summary, artifact_id, created_at
        from verification_results
        where project_id = $1
        order by created_at desc
        limit 20
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      checkType: row.check_type,
      status: row.status,
      verificationTier: row.verification_tier,
      rationale: row.rationale,
      command: row.command,
      summary: row.summary,
      artifactId: row.artifact_id,
      createdAt: row.created_at.toISOString()
    }));
  }

  private async getUserRequiredItems(projectId: string): Promise<UserRequiredItemSummary[]> {
    const result = await this.database.pool.query<UserRequiredItemRow>(
      `
        select item_key, label, status, required_for_production, can_continue_without_it,
          secret, last_validation, updated_at
        from user_required_items
        where project_id = $1
        order by required_for_production desc, can_continue_without_it asc, item_key asc
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      key: row.item_key,
      label: row.label,
      status: row.status,
      requiredForProduction: row.required_for_production,
      canContinueWithoutIt: row.can_continue_without_it,
      secret: row.secret,
      lastValidation: row.last_validation,
      updatedAt: row.updated_at.toISOString()
    }));
  }

  private async getChecklistItem(
    projectId: string,
    itemKey: string
  ): Promise<UserRequiredItemRow | null> {
    const result = await this.database.pool.query<UserRequiredItemRow>(
      `
        select id, item_key, label, status, required_for_production, can_continue_without_it,
          secret, secret_id, last_validation, updated_at
        from user_required_items
        where project_id = $1 and item_key = $2
      `,
      [projectId, itemKey]
    );
    return result.rows[0] ?? null;
  }

  private async createChecklistSecretMarker(projectId: string, itemKey: string): Promise<string> {
    const secretDir = join(this.config.APP_DATA_DIR, "secrets", "project-checklist", projectId);
    await mkdir(secretDir, { recursive: true, mode: 0o700 });
    const storagePath = join(secretDir, `${slugify(itemKey)}.json`);
    await writeFile(
      storagePath,
      JSON.stringify(
        {
          projectId,
          itemKey,
          note: "Secret value is user-managed and intentionally not stored in prompts, JSONL, logs, or email."
        },
        null,
        2
      ),
      { encoding: "utf8", mode: 0o600 }
    );
    const secretId = randomUUID();
    await this.database.pool.query(
      `
        insert into secrets (id, secret_type, storage_path, description, created_at, updated_at)
        values ($1, 'project_checklist_secret_marker', $2, $3, now(), now())
      `,
      [secretId, storagePath, `Secret marker for ${itemKey}`]
    );
    return secretId;
  }

  private async applyChecklistProjectStatus(projectId: string): Promise<void> {
    const result = await this.database.pool.query<{ count: string }>(
      `
        select count(*) as count
        from user_required_items
        where project_id = $1
          and required_for_production = true
          and can_continue_without_it = false
          and status in ('failed', 'blocked')
      `,
      [projectId]
    );
    const blocked = Number(result.rows[0]?.count ?? 0) > 0;
    await this.database.pool.query(
      `
        update projects
        set status = case
              when $2 = true then 'blocked_needs_user'
              else status
            end,
            updated_at = now()
        where id = $1
      `,
      [projectId, blocked]
    );
  }

  private async getRecentArtifacts(projectId: string): Promise<ProjectArtifactSummary[]> {
    const result = await this.database.pool.query<ProjectArtifactRow>(
      `
        select id, run_id, artifact_type, path, size_bytes, redacted, created_at
        from artifacts
        where project_id = $1 and deleted_at is null
        order by created_at desc
        limit 12
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      runId: row.run_id,
      artifactType: row.artifact_type,
      path: row.path,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      redacted: row.redacted,
      createdAt: row.created_at.toISOString()
    }));
  }

  private async getSupervisorInstructions(projectId: string): Promise<SupervisorInstructionSummary[]> {
    const result = await this.database.pool.query<SupervisorInstructionRow>(
      `
        select id, instruction, attachment_artifact_id, priority,
          apply_after_current_worker_run, status, created_at, considered_at
        from supervisor_instructions
        where project_id = $1
        order by created_at desc
        limit 20
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      instruction: row.instruction,
      attachmentArtifactId: row.attachment_artifact_id,
      priority: row.priority,
      applyAfterCurrentWorkerRun: row.apply_after_current_worker_run,
      status: row.status,
      createdAt: row.created_at.toISOString(),
      consideredAt: row.considered_at?.toISOString() ?? null
    }));
  }

  private async getRecentExports(projectId: string): Promise<ProjectExportSummary[]> {
    const result = await this.database.pool.query<ProjectExportRow>(
      `
        select id, status, artifact_id, file_count, size_bytes, error_summary,
          requested_at, finished_at
        from project_exports
        where project_id = $1
        order by requested_at desc
        limit 8
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      id: row.id,
      status: row.status,
      artifactId: row.artifact_id,
      fileCount: row.file_count,
      sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
      errorSummary: row.error_summary,
      requestedAt: row.requested_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null
    }));
  }

  private async getRunCounts(projectId: string): Promise<{ workerTurns: number; failedRuns: number }> {
    const result = await this.database.pool.query<{ worker_turns: string; failed_runs: string }>(
      `
        select
          count(*) filter (where role = 'worker') as worker_turns,
          count(*) filter (where status = 'failed') as failed_runs
        from runs
        where project_id = $1
      `,
      [projectId]
    );
    return {
      workerTurns: Number(result.rows[0]?.worker_turns ?? 0),
      failedRuns: Number(result.rows[0]?.failed_runs ?? 0)
    };
  }

  private async getJobCounts(projectId: string): Promise<{ failedJobs: number; staleJobs: number }> {
    const result = await this.database.pool.query<{ failed_jobs: string; stale_jobs: string }>(
      `
        select
          count(*) filter (where status = 'failed') as failed_jobs,
          count(*) filter (where status = 'stale') as stale_jobs
        from jobs
        where project_id = $1
      `,
      [projectId]
    );
    return {
      failedJobs: Number(result.rows[0]?.failed_jobs ?? 0),
      staleJobs: Number(result.rows[0]?.stale_jobs ?? 0)
    };
  }

  private async writeGitConfig(gitHome: string, userName: string, userEmail: string): Promise<void> {
    await runCommand("git", ["config", "--global", "user.name", userName], { cwd: gitHome, env: { HOME: gitHome } });
    await runCommand("git", ["config", "--global", "user.email", userEmail], { cwd: gitHome, env: { HOME: gitHome } });
  }

  private async ensureSshKey(): Promise<string | null> {
    const keyDir = join(this.config.APP_DATA_DIR, "secrets", "git_ssh");
    const privateKeyPath = join(keyDir, "id_ed25519");
    const publicKeyPath = `${privateKeyPath}.pub`;
    await mkdir(keyDir, { recursive: true, mode: 0o700 });
    if (!(await fileExists(publicKeyPath))) {
      const result = await runCommand("ssh-keygen", [
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        privateKeyPath,
        "-C",
        "app-factory-supervisor"
      ]);
      if (result.exitCode !== 0) {
        return null;
      }
    }
    return publicKeyPath;
  }

  private async initializeNewRepository(
    repositoryUrl: string,
    projectDir: string,
    gitHome: string
  ): Promise<{ remoteReachable: boolean; output: string }> {
    const commands = [
      await runCommand("git", ["init"], { cwd: projectDir, env: { HOME: gitHome } }),
      await runCommand("git", ["remote", "add", "origin", repositoryUrl], {
        cwd: projectDir,
        env: { HOME: gitHome }
      })
    ];
    await writeFile(
      join(projectDir, ".gitignore"),
      sensitiveGitignoreLines().join("\n"),
      "utf8"
    );
    const reachability = await runCommand("git", ["ls-remote", repositoryUrl], {
      cwd: projectDir,
      env: { HOME: gitHome },
      timeoutMs: 15_000
    });
    return {
      remoteReachable: reachability.exitCode === 0,
      output: commands.concat(reachability).map((result) => result.output).join("\n").slice(0, 4000)
    };
  }

  private async cloneExisting(
    repositoryUrl: string,
    projectDir: string,
    gitHome: string
  ): Promise<{ remoteReachable: boolean; output: string }> {
    const result = await runCommand("git", ["clone", repositoryUrl, projectDir], {
      cwd: getRuntimePaths(this.config).projectsDir,
      env: { HOME: gitHome },
      timeoutMs: 60_000
    });
    if (result.exitCode !== 0) {
      await writeFile(
        join(projectDir, "BLOCKED_GIT_ACCESS.md"),
        [
          "# Git Access Required",
          "",
          "The existing repository could not be cloned.",
          "Register the SSH public key with the Git host, then retry project setup.",
          "",
          "```text",
          result.output.slice(0, 3000),
          "```",
          ""
        ].join("\n"),
        "utf8"
      );
    }
    return {
      remoteReachable: result.exitCode === 0,
      output: result.output.slice(0, 4000)
    };
  }

  private async createReleaseKeystore(
    projectId: string,
    projectDir: string
  ): Promise<{ created: boolean; path: string | null }> {
    const keystoreDir = join(projectDir, "keystores");
    const keystorePath = join(keystoreDir, "release.jks");
    await mkdir(keystoreDir, { recursive: true, mode: 0o700 });
    const storePassword = randomSecret();
    const keyPassword = randomSecret();
    const result = await runCommand("keytool", [
      "-genkeypair",
      "-alias",
      "release",
      "-keyalg",
      "RSA",
      "-keysize",
      "2048",
      "-validity",
      "10000",
      "-keystore",
      keystorePath,
      "-storepass",
      storePassword,
      "-keypass",
      keyPassword,
      "-dname",
      `CN=${projectId},O=App Factory,C=KR`
    ]);
    const secretDir = join(this.config.APP_DATA_DIR, "secrets", "project-keystores", projectId);
    await mkdir(secretDir, { recursive: true, mode: 0o700 });
    await writeFile(
      join(secretDir, "release-keystore.json"),
      JSON.stringify({ storePassword, keyPassword, alias: "release", keystorePath }, null, 2),
      { encoding: "utf8", mode: 0o600 }
    );
    return {
      created: result.exitCode === 0 || (await fileExists(keystorePath)),
      path: keystorePath
    };
  }

  private async createVersionState(projectId: string, now: Date): Promise<void> {
    const suffix = versionSuffix(now);
    await this.database.pool.query(
      `
        insert into project_version_state (
          project_id, major, minor, patch, run_suffix, current_version, updated_at
        )
        values ($1, 0, 1, 0, $2, $3, $4)
      `,
      [projectId, suffix, `0.1.0+${suffix}`, now]
    );
  }

  private async assignLatestToolchainSnapshot(projectId: string): Promise<void> {
    const result = await this.database.pool.query<ToolchainSnapshotRow>(
      "select id from toolchain_snapshots order by created_at desc limit 1"
    );
    const snapshot = result.rows[0];
    if (!snapshot) {
      return;
    }
    await this.database.pool.query(
      `
        insert into project_toolchain_snapshots (project_id, toolchain_snapshot_id, assigned_at)
        values ($1, $2, now())
      `,
      [projectId, snapshot.id]
    );
  }

  private async createInitialGates(projectId: string, now: Date): Promise<void> {
    for (const [key, label, phase] of initialGates) {
      await this.database.pool.query(
        `
          insert into progress_gates (id, project_id, gate_key, label, phase, status, updated_at)
          values ($1, $2, $3, $4, $5, 'pending', $6)
        `,
        [randomUUID(), projectId, key, label, phase, now]
      );
    }
  }

  private async createChecklist(projectId: string, input: CreateProjectInput, now: Date): Promise<void> {
    for (const [key, label, secret, canContinue] of checklistItems) {
      const provided =
        (key === "app_name" && input.appName) ||
        (key === "package_name" && input.packageName) ||
        (key === "target_audience" && input.userAppPlan);
      await this.database.pool.query(
        `
          insert into user_required_items (
            id, project_id, item_key, label, status, required_for_production,
            can_continue_without_it, secret, updated_at
          )
          values ($1, $2, $3, $4, $5, true, $6, $7, $8)
        `,
        [randomUUID(), projectId, key, label, provided ? "provided" : "needed", canContinue, secret, now]
      );
    }
  }

  private async recordFirstPrompt(projectId: string, prompt: string, now: Date): Promise<void> {
    await this.database.pool.query(
      `
        insert into timeline_events (
          id, project_id, iteration, event_type, title, body, created_at
        )
        values ($1, $2, 1, 'supervisor_prompt_sent', 'Initial supervisor prompt', $3, $4)
      `,
      [randomUUID(), projectId, prompt, now]
    );
  }

  private async recordKeystoreSecret(projectId: string, keystorePath: string, now: Date): Promise<void> {
    const secretPath = join(
      this.config.APP_DATA_DIR,
      "secrets",
      "project-keystores",
      projectId,
      "release-keystore.json"
    );
    const secretId = randomUUID();
    await this.database.pool.query(
      `
        insert into secrets (id, secret_type, storage_path, description, created_at, updated_at)
        values ($1, 'release_keystore_passwords', $2, $3, $4, $4)
      `,
      [secretId, secretPath, `Release keystore passwords for ${basename(keystorePath)}`, now]
    );
    await this.database.pool.query(
      `
        update user_required_items
        set status = 'provided',
            secret_id = $1,
            last_validation = 'release keystore generated by project wizard',
            updated_at = $2
        where project_id = $3 and item_key = 'production_signing_key'
      `,
      [secretId, now, projectId]
    );
  }
}

function mapProjectRow(row: ProjectRow): ProjectSummary {
  return {
    id: row.id,
    projectName: row.project_name,
    appName: row.app_name,
    packageName: row.package_name,
    projectType: row.project_type,
    repositoryUrl: row.repository_url,
    projectDir: row.project_dir,
    status: row.status,
    currentPhase: row.current_phase,
    maxExecutionHours: row.max_execution_hours,
    maxWorkerTurns: row.max_worker_turns,
    remoteReachable: row.remote_reachable ?? false,
    currentVersion: row.current_version,
    lastCommitSha: row.last_commit_sha,
    lastPushedCommitSha: row.last_pushed_commit_sha,
    latestWorkerResponse: row.latest_worker_response,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString()
  };
}

function verificationStatus(
  verification: VerificationSummary[]
): ProjectDetail["verification"]["overallStatus"] {
  if (verification.length === 0) {
    return "unknown";
  }
  const statuses = new Set(verification.map((item) => item.status));
  if (statuses.has("fail")) {
    return statuses.has("pass") ? "mixed" : "fail";
  }
  if (statuses.has("pass")) {
    return "pass";
  }
  return "unknown";
}

function finalStatusSummary(
  project: ProjectSummary,
  progressPercent: number,
  userRequiredItems: UserRequiredItemSummary[],
  verification: VerificationSummary[]
): string {
  if (project.status === "production_ready_user_action_required") {
    const openUserItems = userRequiredItems.filter((item) =>
      ["needed", "failed", "blocked"].includes(item.status)
    );
    return openUserItems.length > 0
      ? `Production-level implementation is ready; ${openUserItems.length} user-owned item(s) remain.`
      : "Production-level implementation is ready; final user-owned store and policy actions may remain.";
  }
  const failedVerification = verification.some((item) => item.status === "fail");
  if (failedVerification) {
    return "Verification has failing evidence; worker review and fixes are still required.";
  }
  if (project.status === "blocked_needs_user") {
    return "Automation is blocked until required user action is completed.";
  }
  return `Project is in ${project.currentPhase}; ${progressPercent}% of progress gates are complete.`;
}

export function buildAgentsMd(input: Pick<CreateProjectInput, "appName" | "packageName">): string {
  return [
    "# AGENTS.md",
    "",
    "## Scope",
    "",
    `This project is Android/Kotlin only. App name: ${input.appName}. Package: ${input.packageName}.`,
    "",
    "## Worker Boundaries",
    "",
    "- The worker implements, reviews, researches, verifies, and reports evidence.",
    "- The supervisor only selects the next short prompt and never edits source directly.",
    "- Stop after the scoped task and wait for the next supervisor prompt.",
    "",
    "## Build And Verification",
    "",
    "- Prefer the repository's Gradle wrapper when present: `./gradlew build`.",
    "- Use targeted tests for small changes and broader tests for shared behavior.",
    "- Do not run emulator/device verification except in the QA/emulator phase or when explicitly requested.",
    "- Report verification tier: T0 metadata, T1 static, T2 module build/test, T3 full non-emulator, T4 emulator/release.",
    "",
    "## Architecture Rules",
    "",
    "- Follow existing Kotlin, Compose, Material 3, and module patterns.",
    "- Keep changes scoped to the current roadmap item.",
    "- Preserve phone, foldable, tablet, landscape, and large-screen behavior.",
    "- Avoid mock-only critical paths in production-ready code.",
    "",
    "## Secrets And Signing",
    "",
    "- Never put secrets in prompts, JSONL logs, screenshots, emails, commit messages, or source files.",
    "- Keep `keystores/`, `*.jks`, `*.keystore`, `*.p12`, `*.pem`, and `signing.properties` ignored by Git.",
    "- Store passwords and external API credentials through ignored files or app secret storage only.",
    "- Confirm `.gitignore` protects signing and secret material before every commit.",
    "",
    "## Done Criteria",
    "",
    "- Summarize completed work concisely.",
    "- List changed files.",
    "- Include verification results and tier.",
    "- List blockers and user-owned external actions.",
    "- Offer next actions as A-G options when useful.",
    "",
    "## Commit And Versioning",
    "",
    "- Commit each completed unit of work with an English commit message.",
    "- Use project versioning policy: semantic version plus `yymmddrrr` suffix.",
    "- Push after larger phase-level work when configured.",
    ""
  ].join("\n");
}

export function agentsGuidanceWorkerPrompt(input: Pick<CreateProjectInput, "appName" | "packageName">): string {
  return [
    `Create or update AGENTS.md for ${input.appName}.`,
    `Scope is Android/Kotlin only. Package: ${input.packageName}.`,
    "Include build/test commands, architecture rules, supervisor/worker boundaries, no-secret rules, keystores ignore requirement, done criteria, verification commands, and commit/versioning rules.",
    "Do not include secrets. Acceptance: AGENTS.md exists or is updated, and .gitignore protects keystores/signing files."
  ].join(" ");
}

function initialSupervisorPrompt(input: CreateProjectInput): string {
  if (input.projectType === "existing") {
    return [
      "Inspect this existing Android/Kotlin project.",
      "Check planning docs, implementation status, build readiness, verification evidence, and roadmap usability.",
      agentsGuidanceWorkerPrompt(input),
      "Report what exists, what is missing, and the next best scoped task. Do not restart from scratch unless required.",
      `App: ${input.appName}. Package: ${input.packageName}. User plan: ${input.userAppPlan}`
    ].join(" ");
  }
  return [
    "Create initial mvp.md and roadmap.md for this Android/Kotlin app.",
    "Use the existing AGENTS.md as worker guidance.",
    "Use Play Store and community market research later, but first draft a coherent MVP direction from the user's plan.",
    "Keep deferred items explicit and prepare for phone, foldable, and tablet UX planning.",
    `App: ${input.appName}. Package: ${input.packageName}. User plan: ${input.userAppPlan}`
  ].join(" ");
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "project";
}

function versionSuffix(date: Date): string {
  const yy = String(date.getUTCFullYear()).slice(-2);
  const mm = String(date.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(date.getUTCDate()).padStart(2, "0");
  return `${yy}${mm}${dd}001`;
}

function randomSecret(): string {
  return randomBytes(24).toString("base64url");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureProjectSensitiveGitignore(projectDir: string): Promise<void> {
  const gitignorePath = join(projectDir, ".gitignore");
  const existing = (await readFile(gitignorePath, "utf8").catch(() => "")).split(/\r?\n/);
  const merged = [...existing];
  for (const line of sensitiveGitignoreLines()) {
    if (line.length > 0 && !merged.includes(line)) {
      merged.push(line);
    }
  }
  await writeFile(gitignorePath, `${merged.filter((line, index) => line.length > 0 || index < merged.length - 1).join("\n")}\n`, "utf8");
}

function sensitiveGitignoreLines(): string[] {
  return ["keystores/", "*.jks", "*.keystore", "signing.properties", "*.p12", "*.pem", ""];
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: Record<string, string>;
    timeoutMs?: number;
  } = {}
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...options.env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs ?? 20_000);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        output: error.message
      });
    });
    child.on("close", (exitCode) => {
      clearTimeout(timer);
      resolve({
        exitCode,
        output: Buffer.concat(chunks).toString("utf8").trim()
      });
    });
  });
}
