import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";
import type { CreateProjectInput } from "./schema.js";

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
      ["keystores/", "*.jks", "*.keystore", "signing.properties", ""].join("\n"),
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

function initialSupervisorPrompt(input: CreateProjectInput): string {
  if (input.projectType === "existing") {
    return [
      "Inspect this existing Android/Kotlin project.",
      "Check planning docs, implementation status, build readiness, verification evidence, and roadmap usability.",
      "Report what exists, what is missing, and the next best scoped task. Do not restart from scratch unless required.",
      `App: ${input.appName}. Package: ${input.packageName}. User plan: ${input.userAppPlan}`
    ].join(" ");
  }
  return [
    "Create initial mvp.md and roadmap.md for this Android/Kotlin app.",
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
