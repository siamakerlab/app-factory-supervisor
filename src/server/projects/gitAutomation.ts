import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";

export type CommitInput = {
  unitType: string;
  scope: string;
  verificationTier?: string | undefined;
  summary?: string | undefined;
};

export type PushInput = {
  phase: string;
  summary?: string | undefined;
};

export type GitAutomationResult = {
  status: "succeeded" | "failed" | "skipped";
  eventType: "unit_commit" | "phase_push" | "push_failed" | "commit_skipped";
  version: string;
  commitSha: string | null;
  pushedCommitSha: string | null;
  summary: string;
  commandOutput: string;
};

type ProjectRow = {
  id: string;
  project_dir: string;
  status: string;
};

type VersionRow = {
  project_id: string;
  major: number;
  minor: number;
  patch: number;
  run_suffix: string;
  current_version: string;
  last_commit_sha: string | null;
  last_pushed_commit_sha: string | null;
};

export class GitAutomationService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async commitUnitWork(projectId: string, input: CommitInput): Promise<GitAutomationResult> {
    const project = await this.getProject(projectId);
    const beforeStatus = await runGit(project.project_dir, ["status", "--porcelain"], this.gitEnv());
    if (!beforeStatus.output.trim()) {
      const version = await this.getVersion(projectId);
      const result: GitAutomationResult = {
        status: "skipped",
        eventType: "commit_skipped",
        version: version.current_version,
        commitSha: version.last_commit_sha,
        pushedCommitSha: version.last_pushed_commit_sha,
        summary: "No file changes to commit.",
        commandOutput: beforeStatus.output
      };
      await this.recordEvent(projectId, result, input);
      return result;
    }

    const nextVersion = await this.nextPatchVersion(projectId);
    const add = await runGit(project.project_dir, ["add", "--all"], this.gitEnv());
    const message = formatCommitMessage(input, nextVersion.current_version);
    const commit = await runGit(project.project_dir, ["commit", "-m", message], this.gitEnv());
    if (commit.exitCode !== 0) {
      const result: GitAutomationResult = {
        status: "failed",
        eventType: "unit_commit",
        version: nextVersion.current_version,
        commitSha: null,
        pushedCommitSha: nextVersion.last_pushed_commit_sha,
        summary: "Git commit failed.",
        commandOutput: [add.output, commit.output].join("\n").trim()
      };
      await this.recordEvent(projectId, result, input);
      return result;
    }

    const revParse = await runGit(project.project_dir, ["rev-parse", "HEAD"], this.gitEnv());
    const commitSha = revParse.output.trim() || null;
    await this.database.pool.query(
      `
        update project_version_state
        set last_commit_sha = $2,
            updated_at = now()
        where project_id = $1
      `,
      [projectId, commitSha]
    );
    const result: GitAutomationResult = {
      status: "succeeded",
      eventType: "unit_commit",
      version: nextVersion.current_version,
      commitSha,
      pushedCommitSha: nextVersion.last_pushed_commit_sha,
      summary: input.summary ?? `Committed ${input.unitType}: ${input.scope}.`,
      commandOutput: [add.output, commit.output, revParse.output].join("\n").trim()
    };
    await this.recordEvent(projectId, result, input);
    return result;
  }

  async pushPhase(projectId: string, input: PushInput): Promise<GitAutomationResult> {
    const project = await this.getProject(projectId);
    const current = await this.getVersion(projectId);
    const push = await runGit(project.project_dir, ["push", "origin", "HEAD"], this.gitEnv(), 60_000);
    if (push.exitCode !== 0) {
      const result: GitAutomationResult = {
        status: "failed",
        eventType: "push_failed",
        version: current.current_version,
        commitSha: current.last_commit_sha,
        pushedCommitSha: current.last_pushed_commit_sha,
        summary: "Phase push failed. Local commits are preserved for retry.",
        commandOutput: push.output
      };
      await this.recordEvent(projectId, result, {
        unitType: "phase_push",
        scope: input.phase,
        summary: input.summary
      });
      return result;
    }

    const nextVersion = await this.nextMinorVersion(projectId);
    await this.database.pool.query(
      `
        update project_version_state
        set last_pushed_commit_sha = last_commit_sha,
            updated_at = now()
        where project_id = $1
      `,
      [projectId]
    );
    const updated = await this.getVersion(projectId);
    const result: GitAutomationResult = {
      status: "succeeded",
      eventType: "phase_push",
      version: nextVersion.current_version,
      commitSha: updated.last_commit_sha,
      pushedCommitSha: updated.last_pushed_commit_sha,
      summary: input.summary ?? `Pushed phase completion: ${input.phase}.`,
      commandOutput: push.output
    };
    await this.recordEvent(projectId, result, {
      unitType: "phase_push",
      scope: input.phase
    });
    return result;
  }

  async getEvents(projectId: string): Promise<GitAutomationResult[]> {
    const result = await this.database.pool.query<{
      event_type: GitAutomationResult["eventType"];
      version: string;
      commit_sha: string | null;
      pushed_commit_sha: string | null;
      status: GitAutomationResult["status"];
      summary: string;
      command_output: string | null;
    }>(
      `
        select event_type, version, commit_sha, pushed_commit_sha, status, summary, command_output
        from project_git_automation_events
        where project_id = $1
        order by created_at desc
        limit 50
      `,
      [projectId]
    );
    return result.rows.map((row) => ({
      eventType: row.event_type,
      version: row.version,
      commitSha: row.commit_sha,
      pushedCommitSha: row.pushed_commit_sha,
      status: row.status,
      summary: row.summary,
      commandOutput: row.command_output ?? ""
    }));
  }

  private async getProject(projectId: string): Promise<ProjectRow> {
    const result = await this.database.pool.query<ProjectRow>(
      "select id, project_dir, status from projects where id = $1",
      [projectId]
    );
    const project = result.rows[0];
    if (!project) {
      throw new Error("project_not_found");
    }
    return project;
  }

  private async getVersion(projectId: string): Promise<VersionRow> {
    const result = await this.database.pool.query<VersionRow>(
      "select * from project_version_state where project_id = $1",
      [projectId]
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("project_version_state_missing");
    }
    return row;
  }

  private async nextPatchVersion(projectId: string): Promise<VersionRow> {
    const current = await this.getVersion(projectId);
    const patch = current.patch + 1;
    const version = `${current.major}.${current.minor}.${patch}+${current.run_suffix}`;
    await this.database.pool.query(
      `
        update project_version_state
        set patch = $2,
            current_version = $3,
            updated_at = now()
        where project_id = $1
      `,
      [projectId, patch, version]
    );
    return this.getVersion(projectId);
  }

  private async nextMinorVersion(projectId: string): Promise<VersionRow> {
    const current = await this.getVersion(projectId);
    const minor = current.minor + 1;
    const version = `${current.major}.${minor}.0+${current.run_suffix}`;
    await this.database.pool.query(
      `
        update project_version_state
        set minor = $2,
            patch = 0,
            current_version = $3,
            updated_at = now()
        where project_id = $1
      `,
      [projectId, minor, version]
    );
    return this.getVersion(projectId);
  }

  private async recordEvent(
    projectId: string,
    result: GitAutomationResult,
    input: CommitInput
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into project_git_automation_events (
          id, project_id, event_type, unit_type, scope, phase, version,
          verification_tier, commit_sha, pushed_commit_sha, status, summary,
          command_output, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
      `,
      [
        randomUUID(),
        projectId,
        result.eventType,
        input.unitType,
        input.scope,
        result.eventType === "phase_push" || result.eventType === "push_failed" ? input.scope : null,
        result.version,
        input.verificationTier ?? null,
        result.commitSha,
        result.pushedCommitSha,
        result.status,
        result.summary,
        result.commandOutput.slice(0, 8000)
      ]
    );
  }

  private gitEnv(): Record<string, string> {
    return {
      HOME: `${this.config.APP_DATA_DIR}/git-home`
    };
  }
}

export function formatCommitMessage(input: CommitInput, version: string): string {
  const tier = input.verificationTier ? ` ${input.verificationTier}` : " T0";
  return `${input.unitType}: ${input.scope} ${version}${tier}`;
}

function runGit(
  cwd: string,
  args: string[],
  env: Record<string, string>,
  timeoutMs = 30_000
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, {
      cwd,
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), timeoutMs);
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
