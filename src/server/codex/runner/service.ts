import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/client.js";
import { getRuntimePaths } from "../../runtime/paths.js";
import { redactSecrets } from "../../security/secretScanner.js";
import { summarizeCodexJsonl } from "../jsonl.js";

export type CodexRunRole = "supervisor" | "worker";

export type CodexRunInput = {
  projectId: string;
  role: CodexRunRole;
  prompt: string;
  outputSchema?: Record<string, unknown> | undefined;
  executable?: string | undefined;
  overridePromptLimit?: boolean | undefined;
};

export type CodexRunnerCommand = {
  command: string;
  args: string[];
  cwd: string;
  jsonlPath: string;
  stderrPath: string;
  lastMessagePath: string;
  promptPath: string;
  schemaPath: string;
  timeoutMs?: number;
};

export type CodexRunResult = {
  runId: string;
  projectId: string;
  role: CodexRunRole;
  iteration: number;
  status: "succeeded" | "failed";
  exitCode: number | null;
  finalMessage: string;
  jsonlArtifactId: string;
  stderrArtifactId: string;
  promptArtifactId: string;
  finalMessageArtifactId: string;
  jsonSummary: ReturnType<typeof summarizeCodexJsonl>;
};

type ProjectRow = {
  id: string;
  project_dir: string;
};

const defaultOutputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    taskType: {
      type: "string",
      enum: [
        "product_planning",
        "market_research",
        "roadmap_creation_audit",
        "ux_planning",
        "implementation",
        "code_review",
        "verification",
        "bug_fixing",
        "screenshot_analysis",
        "release_readiness_summary"
      ]
    },
    summary: { type: "string" },
    changedFiles: {
      type: "array",
      items: { type: "string" }
    },
    verification: { type: "string" },
    blockers: {
      type: "array",
      items: { type: "string" }
    },
    nextActions: {
      type: "array",
      items: { type: "string" }
    },
    suggestedOptions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          option: { type: "string", enum: ["A", "B", "C", "D", "E", "F", "G"] },
          prompt: { type: "string" }
        },
        required: ["option", "prompt"]
      }
    }
  },
  required: [
    "taskType",
    "summary",
    "changedFiles",
    "verification",
    "blockers",
    "nextActions",
    "suggestedOptions"
  ]
} as const;

export class CodexRunnerService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async buildCommand(input: CodexRunInput): Promise<CodexRunnerCommand> {
    const project = await this.getProject(input.projectId);
    const iteration = await this.nextIteration(input.projectId, input.role);
    const paths = getRuntimePaths(this.config);
    const runDir = join(paths.runsDir, input.projectId, `${input.role}-${iteration}`);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const promptPath = join(runDir, "prompt.txt");
    const schemaPath = join(runDir, "output-schema.json");
    const jsonlPath = join(runDir, "codex.jsonl");
    const stderrPath = join(runDir, "stderr.log");
    const lastMessagePath = join(runDir, "last-message.txt");
    await Promise.all([
      writeFile(promptPath, input.prompt, "utf8"),
      writeFile(schemaPath, JSON.stringify(input.outputSchema ?? defaultOutputSchema, null, 2), "utf8")
    ]);
    const command = input.executable ?? "codex";
    return {
      command,
      args: [
        "exec",
        "--json",
        "--yolo",
        "--dangerously-bypass-hook-trust",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        lastMessagePath,
        "-C",
        project.project_dir,
        input.prompt
      ],
      cwd: project.project_dir,
      jsonlPath,
      stderrPath,
      lastMessagePath,
      promptPath,
      schemaPath
    };
  }

  async run(input: CodexRunInput): Promise<CodexRunResult> {
    const project = await this.getProject(input.projectId);
    const iteration = await this.nextIteration(input.projectId, input.role);
    const command = await this.buildCommandWithIteration(input, project.project_dir, iteration);
    const runId = randomUUID();
    const startedAt = new Date();
    await this.database.pool.query(
      `
        insert into runs (id, project_id, role, iteration, status, started_at)
        values ($1, $2, $3, $4, 'running', $5)
      `,
      [runId, input.projectId, input.role, iteration, startedAt]
    );

    const timeoutMs = await this.codexTurnTimeoutMs();
    const execution = await runProcess({ ...command, timeoutMs });
    const rawJsonl = await readText(command.jsonlPath);
    const rawStderr = await readText(command.stderrPath);
    const redactedJsonl = redactSecrets(rawJsonl);
    const redactedStderr = redactSecrets(rawStderr);
    if (redactedJsonl.findings.length > 0) {
      await writeFile(command.jsonlPath, redactedJsonl.redacted, "utf8");
    }
    if (redactedStderr.findings.length > 0) {
      await writeFile(command.stderrPath, redactedStderr.redacted, "utf8");
    }
    const jsonl = redactedJsonl.redacted;
    const stderr = redactedStderr.redacted;
    const jsonSummary = summarizeCodexJsonl(jsonl);
    const outputLastMessage = await readText(command.lastMessagePath);
    const redactedLastMessage = redactSecrets(outputLastMessage);
    if (redactedLastMessage.findings.length > 0) {
      await writeFile(command.lastMessagePath, redactedLastMessage.redacted, "utf8");
    }
    const finalMessage =
      redactedLastMessage.redacted ||
      jsonSummary.finalMessage ||
      fallbackFinalMessage(execution, stderr);
    const status = execution.exitCode === 0 ? "succeeded" : "failed";
    const codexThreadId = jsonSummary.threadId;
    const [promptArtifactId, jsonlArtifactId, stderrArtifactId, finalMessageArtifactId] =
      await Promise.all([
        this.insertArtifact(input.projectId, runId, "codex_prompt", command.promptPath, false),
        this.insertArtifact(input.projectId, runId, "codex_jsonl", command.jsonlPath, false, {
          eventTypes: jsonSummary.eventTypes,
          eventCategories: jsonSummary.eventCategories,
          tokenUsage: jsonSummary.tokenUsage,
          failedCommands: jsonSummary.failedCommands,
          schemaVersionSensitive: jsonSummary.schemaVersionSensitive,
          redactedSecretFindings: redactedJsonl.findings.map((finding) => finding.kind)
        }),
        this.insertArtifact(input.projectId, runId, "codex_stderr", command.stderrPath, false, {
          redactedSecretFindings: redactedStderr.findings.map((finding) => finding.kind)
        }),
        this.writeAndInsertFinalMessage(input.projectId, runId, command.lastMessagePath, finalMessage)
      ]);

    await this.database.pool.query(
      `
        update runs
        set status = $2,
            prompt_artifact_id = $3,
            jsonl_artifact_id = $4,
            worker_final_response = $5,
            worker_final_response_artifact_id = $6,
            exit_code = $7,
            codex_thread_id = $8,
            finished_at = now()
        where id = $1
      `,
      [
        runId,
        status,
        promptArtifactId,
        jsonlArtifactId,
        input.role === "worker" ? finalMessage : null,
        input.role === "worker" ? finalMessageArtifactId : null,
        execution.exitCode,
        codexThreadId
      ]
    );
    await this.recordTimeline(input.projectId, runId, input.role, iteration, input.prompt, finalMessage);

    return {
      runId,
      projectId: input.projectId,
      role: input.role,
      iteration,
      status,
      exitCode: execution.exitCode,
      finalMessage,
      jsonlArtifactId,
      stderrArtifactId,
      promptArtifactId,
      finalMessageArtifactId,
      jsonSummary
    };
  }

  private async buildCommandWithIteration(
    input: CodexRunInput,
    projectDir: string,
    iteration: number
  ): Promise<CodexRunnerCommand> {
    const paths = getRuntimePaths(this.config);
    const runDir = join(paths.runsDir, input.projectId, `${input.role}-${iteration}`);
    await mkdir(runDir, { recursive: true, mode: 0o700 });
    const promptPath = join(runDir, "prompt.txt");
    const schemaPath = join(runDir, "output-schema.json");
    const jsonlPath = join(runDir, "codex.jsonl");
    const stderrPath = join(runDir, "stderr.log");
    const lastMessagePath = join(runDir, "last-message.txt");
    await Promise.all([
      writeFile(promptPath, input.prompt, "utf8"),
      writeFile(schemaPath, JSON.stringify(input.outputSchema ?? defaultOutputSchema, null, 2), "utf8")
    ]);
    return {
      command: input.executable ?? "codex",
      args: [
        "exec",
        "--json",
        "--yolo",
        "--dangerously-bypass-hook-trust",
        "--output-schema",
        schemaPath,
        "--output-last-message",
        lastMessagePath,
        "-C",
        projectDir,
        input.prompt
      ],
      cwd: projectDir,
      jsonlPath,
      stderrPath,
      lastMessagePath,
      promptPath,
      schemaPath
    };
  }

  private async getProject(projectId: string): Promise<ProjectRow> {
    const result = await this.database.pool.query<ProjectRow>(
      "select id, project_dir from projects where id = $1",
      [projectId]
    );
    const project = result.rows[0];
    if (!project) {
      throw new Error("project_not_found");
    }
    return project;
  }

  private async nextIteration(projectId: string, role: CodexRunRole): Promise<number> {
    const result = await this.database.pool.query<{ next_iteration: number }>(
      "select coalesce(max(iteration), 0) + 1 as next_iteration from runs where project_id = $1 and role = $2",
      [projectId, role]
    );
    return result.rows[0]?.next_iteration ?? 1;
  }

  private async codexTurnTimeoutMs(): Promise<number> {
    const result = await this.database.pool.query<{ codex_turn_timeout_seconds: number }>(
      "select codex_turn_timeout_seconds from app_settings where id = true"
    );
    const seconds = result.rows[0]?.codex_turn_timeout_seconds ?? 3600;
    return Math.max(1, seconds) * 1000;
  }

  private async insertArtifact(
    projectId: string,
    runId: string,
    artifactType: string,
    path: string,
    redacted: boolean,
    metadata: Record<string, unknown> = {}
  ): Promise<string> {
    const artifactId = randomUUID();
    const fileStats = await stat(path);
    const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    await this.database.pool.query(
      `
        insert into artifacts (
          id, project_id, run_id, artifact_type, path, sha256, size_bytes,
          redacted, retention_class, metadata, created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, 'run_log', $9, now())
      `,
      [
        artifactId,
        projectId,
        runId,
        artifactType,
        path,
        sha256,
        fileStats.size,
        redacted,
        JSON.stringify({ source: "codex_runner", ...metadata })
      ]
    );
    return artifactId;
  }

  private async writeAndInsertFinalMessage(
    projectId: string,
    runId: string,
    path: string,
    finalMessage: string
  ): Promise<string> {
    await writeFile(path, finalMessage, "utf8");
    return this.insertArtifact(projectId, runId, "codex_last_message", path, false);
  }

  private async recordTimeline(
    projectId: string,
    runId: string,
    role: CodexRunRole,
    iteration: number,
    prompt: string,
    finalMessage: string
  ): Promise<void> {
    if (role === "supervisor") {
      await this.database.pool.query(
        `
          insert into timeline_events (
            id, project_id, run_id, iteration, event_type, title, body, created_at
          )
          values ($1, $2, $3, $4, 'supervisor_prompt_sent', 'Supervisor prompt', $5, now())
        `,
        [randomUUID(), projectId, runId, iteration, prompt]
      );
      return;
    }
    await this.database.pool.query(
      `
        insert into timeline_events (
          id, project_id, run_id, iteration, event_type, title, body, metadata, created_at
        )
        values ($1, $2, $3, $4, 'worker_final_response', 'Worker final response', $5, $6, now())
      `,
      [randomUUID(), projectId, runId, iteration, finalMessage, JSON.stringify(parseWorkerContract(finalMessage))]
    );
  }
}

function parseWorkerContract(finalMessage: string): {
  suggestedOptions: Array<{ option: string; prompt: string }>;
  taskType: string | null;
} {
  try {
    const parsed = JSON.parse(finalMessage) as {
      taskType?: unknown;
      suggestedOptions?: unknown;
      nextActions?: unknown;
    };
    return {
      taskType: typeof parsed.taskType === "string" ? parsed.taskType : null,
      suggestedOptions: normalizeOptions(parsed.suggestedOptions ?? parsed.nextActions)
    };
  } catch {
    return {
      taskType: null,
      suggestedOptions: normalizeOptions(finalMessage)
    };
  }
}

function normalizeOptions(value: unknown): Array<{ option: string; prompt: string }> {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      if (typeof item === "string") {
        return optionFromText(item);
      }
      if (typeof item === "object" && item !== null) {
        const record = item as { option?: unknown; prompt?: unknown };
        if (
          typeof record.option === "string" &&
          /^[A-G]$/.test(record.option) &&
          typeof record.prompt === "string"
        ) {
          return [{ option: record.option, prompt: record.prompt }];
        }
      }
      return [];
    });
  }
  if (typeof value === "string") {
    return optionFromText(value);
  }
  return [];
}

function optionFromText(value: string): Array<{ option: string; prompt: string }> {
  const matches = [...value.matchAll(/^\s*([A-G])[).:\s-]\s*(.+)$/gm)];
  return matches.map((match) => ({
    option: match[1]!,
    prompt: match[2]!.trim()
  }));
}

function runProcess(command: CodexRunnerCommand): Promise<{ exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(command.command, command.args, {
      cwd: command.cwd,
      env: allowedEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;
    const timeout = command.timeoutMs
      ? setTimeout(() => {
          if (settled) {
            return;
          }
          stderrChunks.push(Buffer.from(`Codex run timed out after ${command.timeoutMs}ms.\n`));
          child.kill("SIGTERM");
        }, command.timeoutMs)
      : undefined;
    child.stdout.on("data", (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderrChunks.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      void Promise.all([
        writeFile(command.jsonlPath, "", "utf8"),
        writeFile(command.stderrPath, error.message, "utf8")
      ]).then(() => resolve({ exitCode: null }));
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timeout) {
        clearTimeout(timeout);
      }
      void Promise.all([
        writeFile(command.jsonlPath, Buffer.concat(stdoutChunks).toString("utf8"), "utf8"),
        writeFile(command.stderrPath, Buffer.concat(stderrChunks).toString("utf8"), "utf8")
      ]).then(() => resolve({ exitCode }));
    });
  });
}


function allowedEnvironment(): NodeJS.ProcessEnv {
  const allowedKeys = [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TERM",
    "CODEX_HOME",
    "OPENAI_API_KEY",
    "ANDROID_HOME",
    "ANDROID_SDK_ROOT",
    "ANDROID_AVD_HOME",
    "JAVA_HOME",
    "GRADLE_USER_HOME"
  ];
  return Object.fromEntries(
    allowedKeys
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

async function readText(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

function fallbackFinalMessage(
  execution: { exitCode: number | null },
  stderr: string
): string {
  return execution.exitCode === 0
    ? "Codex run completed without an output-last-message artifact."
    : `Codex run failed. ${stderr.slice(0, 1000)}`;
}
