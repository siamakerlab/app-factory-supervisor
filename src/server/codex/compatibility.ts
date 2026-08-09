import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";
import { parserRecognizesRequiredCodexEvents, summarizeCodexJsonl } from "./jsonl.js";

const managedMarker = "app-factory-supervisor managed";

export type CodexCompatibilityStatus = "pass" | "fail" | "not_run";

export type CodexCompatibilityReview = {
  id: string | null;
  status: CodexCompatibilityStatus;
  codexCliVersion: string | null;
  codexAuthUsable: boolean;
  jsonModeSupported: boolean;
  outputSchemaSupported: boolean;
  outputLastMessageSupported: boolean;
  execResumeSupported: boolean;
  hooksSupported: boolean;
  appServerTypeScriptSchemasGenerated: boolean;
  appServerJsonSchemasGenerated: boolean;
  configValidationPassed: boolean;
  stopHookCallbackVerified: boolean;
  jsonlParserRecognizesCurrentEvents: boolean;
  mcpRequiredSupported: boolean;
  buildEnvironmentReady: boolean;
  gapSummary: string;
  artifactPath: string | null;
  generatedSchemaPaths: {
    typeScript: string | null;
    jsonSchema: string | null;
  };
  smokeArtifacts: {
    jsonl: string | null;
    stderr: string | null;
    lastMessage: string | null;
  };
  ownership: {
    codexHomeDir: string;
    configPath: string;
    hooksPath: string;
    configOwner: "app" | "user" | "missing";
    hooksOwner: "app" | "user" | "missing";
    conflicts: string[];
  };
  createdAt: string | null;
};

type CommandResult = {
  command: string;
  args: string[];
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error: string | null;
};

type ReviewRow = {
  id: string;
  codex_cli_version: string;
  json_mode_supported: boolean;
  output_schema_supported: boolean;
  output_last_message_supported: boolean;
  exec_resume_supported: boolean;
  hooks_supported: boolean;
  mcp_required_supported: boolean;
  gap_summary: string;
  artifact_path: string | null;
  metadata: ReviewMetadata;
  created_at: Date;
};

type ReviewMetadata = Omit<CodexCompatibilityReview, "id">;

export class CodexCompatibilityService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getLatestReview(): Promise<CodexCompatibilityReview> {
    const result = await this.database.pool.query<ReviewRow>(
      `
        select r.*, a.path as artifact_path
        from codex_compatibility_reviews r
        left join artifacts a on a.id = r.artifact_id
        order by r.created_at desc
        limit 1
      `
    );
    const row = result.rows[0];
    if (!row) {
      return this.emptyReview();
    }
    return {
      ...row.metadata,
      id: row.id,
      artifactPath: row.artifact_path,
      createdAt: row.created_at.toISOString()
    };
  }

  async runReview(): Promise<CodexCompatibilityReview> {
    const paths = getRuntimePaths(this.config);
    const reviewStartedAt = new Date();
    await Promise.all([
      mkdir(paths.codexHomeDir, { recursive: true, mode: 0o700 }),
      mkdir(paths.codexSchemaDir, { recursive: true, mode: 0o700 }),
      mkdir(paths.codexSmokeDir, { recursive: true, mode: 0o700 }),
      mkdir(dirname(paths.codexCompatibilityReportPath), { recursive: true, mode: 0o700 })
    ]);

    const ownership = await this.ensureManagedCodexFiles(paths.codexHomeDir);
    const env = {
      ...process.env,
      CODEX_HOME: paths.codexHomeDir
    };

    const version = await runCommand("codex", ["--version"], {
      env,
      timeoutMs: 10_000
    });
    const codexCliVersion = commandSucceeded(version)
      ? firstNonEmptyLine(version.stdout || version.stderr)
      : "unavailable";

    const execHelp = await runCommand("codex", ["exec", "--help"], {
      env,
      timeoutMs: 10_000
    });
    const rootHelp = await runCommand("codex", ["--help"], {
      env,
      timeoutMs: 10_000
    });
    const execHelpText = `${execHelp.stdout}\n${execHelp.stderr}`;
    const rootHelpText = `${rootHelp.stdout}\n${rootHelp.stderr}`;

    const smoke = await this.runSmoke(paths.codexSmokeDir, env);
    const schemaResult = await this.generateSchemas(paths.codexSchemaDir, env);
    const configValidation = await runCommand("codex", ["--strict-config", "--version"], {
      env,
      timeoutMs: 10_000
    });
    const stopHookCallbackVerified = await this.recordStopHookCallback({
      source: "compatibility_review",
      createdAt: reviewStartedAt.toISOString()
    });
    const jsonlSummary = summarizeCodexJsonl(smoke.stdout);

    const flags = {
      codexAuthUsable: smoke.exitCode === 0,
      jsonModeSupported: execHelpText.includes("--json"),
      outputSchemaSupported: execHelpText.includes("--output-schema"),
      outputLastMessageSupported: execHelpText.includes("--output-last-message"),
      execResumeSupported: execHelpText.includes("resume") || rootHelpText.includes("resume"),
      hooksSupported: ownership.conflicts.length === 0 && commandSucceeded(configValidation),
      appServerTypeScriptSchemasGenerated: schemaResult.typeScript.exitCode === 0,
      appServerJsonSchemasGenerated: schemaResult.jsonSchema.exitCode === 0,
      configValidationPassed: commandSucceeded(configValidation),
      stopHookCallbackVerified,
      jsonlParserRecognizesCurrentEvents:
        parserRecognizesRequiredCodexEvents() && jsonlSummary.requiredEventsRecognized,
      mcpRequiredSupported: false
    };

    const buildEnvironmentReady =
      flags.codexAuthUsable &&
      flags.jsonModeSupported &&
      flags.outputSchemaSupported &&
      flags.outputLastMessageSupported &&
      flags.execResumeSupported &&
      flags.hooksSupported &&
      flags.appServerTypeScriptSchemasGenerated &&
      flags.appServerJsonSchemasGenerated &&
      flags.configValidationPassed &&
      flags.stopHookCallbackVerified &&
      flags.jsonlParserRecognizesCurrentEvents;

    const generatedSchemaPaths = {
      typeScript: flags.appServerTypeScriptSchemasGenerated ? schemaResult.typeScriptPath : null,
      jsonSchema: flags.appServerJsonSchemasGenerated ? schemaResult.jsonSchemaPath : null
    };
    const smokeArtifacts = {
      jsonl: smoke.jsonlArtifactPath,
      stderr: smoke.stderrArtifactPath,
      lastMessage: smoke.lastMessageArtifactPath
    };

    const gapSummary = summarizeGaps({
      ...flags,
      buildEnvironmentReady,
      codexCliAvailable: commandSucceeded(version),
      smokeError: smoke.stderr || smoke.error,
      schemaTypeScriptError: schemaResult.typeScript.stderr || schemaResult.typeScript.error,
      schemaJsonError: schemaResult.jsonSchema.stderr || schemaResult.jsonSchema.error,
      configError: configValidation.stderr || configValidation.error,
      ownershipConflicts: ownership.conflicts
    });

    const metadata: ReviewMetadata = {
      status: buildEnvironmentReady ? "pass" : "fail",
      codexCliVersion,
      ...flags,
      buildEnvironmentReady,
      gapSummary,
      artifactPath: paths.codexCompatibilityReportPath,
      generatedSchemaPaths,
      smokeArtifacts,
      ownership,
      createdAt: reviewStartedAt.toISOString()
    };

    const report = renderReviewReport(metadata, {
      version,
      execHelp,
      rootHelp,
      smoke,
      schemaTypeScript: schemaResult.typeScript,
      schemaJson: schemaResult.jsonSchema,
      configValidation,
      jsonlSummary
    });
    await writeFile(paths.codexCompatibilityReportPath, report, "utf8");
    const artifactId = await this.insertArtifact(
      "codex_compatibility_report",
      paths.codexCompatibilityReportPath,
      {
        codexCliVersion,
        buildEnvironmentReady
      }
    );

    await this.insertDirectoryArtifact("codex_app_server_schema_dir", paths.codexSchemaDir, {
      codexCliVersion,
      generatedSchemaPaths
    });

    const reviewId = randomUUID();
    await this.database.pool.query(
      `
        insert into codex_compatibility_reviews (
          id,
          codex_cli_version,
          json_mode_supported,
          output_schema_supported,
          output_last_message_supported,
          exec_resume_supported,
          hooks_supported,
          mcp_required_supported,
          gap_summary,
          artifact_id,
          metadata,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
      `,
      [
        reviewId,
        codexCliVersion,
        flags.jsonModeSupported,
        flags.outputSchemaSupported,
        flags.outputLastMessageSupported,
        flags.execResumeSupported,
        flags.hooksSupported,
        flags.mcpRequiredSupported,
        gapSummary,
        artifactId,
        metadata
      ]
    );

    return {
      ...metadata,
      id: reviewId,
      artifactPath: paths.codexCompatibilityReportPath,
      createdAt: reviewStartedAt.toISOString()
    };
  }

  private emptyReview(): CodexCompatibilityReview {
    const paths = getRuntimePaths(this.config);
    const ownership = {
      codexHomeDir: paths.codexHomeDir,
      configPath: join(paths.codexHomeDir, "config.toml"),
      hooksPath: join(paths.codexHomeDir, "hooks.json"),
      configOwner: "missing" as const,
      hooksOwner: "missing" as const,
      conflicts: []
    };
    return {
      id: null,
      status: "not_run",
      codexCliVersion: null,
      codexAuthUsable: false,
      jsonModeSupported: false,
      outputSchemaSupported: false,
      outputLastMessageSupported: false,
      execResumeSupported: false,
      hooksSupported: false,
      appServerTypeScriptSchemasGenerated: false,
      appServerJsonSchemasGenerated: false,
      configValidationPassed: false,
      stopHookCallbackVerified: false,
      jsonlParserRecognizesCurrentEvents: parserRecognizesRequiredCodexEvents(),
      mcpRequiredSupported: false,
      buildEnvironmentReady: false,
      gapSummary: "Codex compatibility review has not run.",
      artifactPath: null,
      generatedSchemaPaths: {
        typeScript: null,
        jsonSchema: null
      },
      smokeArtifacts: {
        jsonl: null,
        stderr: null,
        lastMessage: null
      },
      ownership,
      createdAt: null
    };
  }

  private async runSmoke(smokeRoot: string, env: NodeJS.ProcessEnv) {
    const runDir = join(smokeRoot, safeTimestamp(new Date()));
    const workspaceDir = join(runDir, "workspace");
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    const jsonlArtifactPath = join(runDir, "codex-smoke.jsonl");
    const stderrArtifactPath = join(runDir, "codex-smoke.stderr.log");
    const lastMessageArtifactPath = join(runDir, "codex-smoke-last-message.txt");
    const result = await runCommand(
      "codex",
      [
        "exec",
        "--json",
        "--yolo",
        "--dangerously-bypass-hook-trust",
        "--skip-git-repo-check",
        "--output-last-message",
        lastMessageArtifactPath,
        "Reply exactly: codex compatibility smoke"
      ],
      {
        cwd: workspaceDir,
        env,
        timeoutMs: 45_000
      }
    );
    await Promise.all([
      writeFile(jsonlArtifactPath, result.stdout, "utf8"),
      writeFile(stderrArtifactPath, result.stderr || result.error || "", "utf8"),
      fileExists(lastMessageArtifactPath).then(async (exists) => {
        if (!exists) {
          await writeFile(lastMessageArtifactPath, "", "utf8");
        }
      })
    ]);

    await Promise.all([
      this.insertArtifact("codex_smoke_jsonl", jsonlArtifactPath, { exitCode: result.exitCode }),
      this.insertArtifact("codex_smoke_stderr", stderrArtifactPath, { exitCode: result.exitCode }),
      this.insertArtifact("codex_smoke_last_message", lastMessageArtifactPath, {
        exitCode: result.exitCode
      })
    ]);

    return {
      ...result,
      jsonlArtifactPath,
      stderrArtifactPath,
      lastMessageArtifactPath
    };
  }

  private async generateSchemas(schemaRoot: string, env: NodeJS.ProcessEnv) {
    const typeScriptPath = join(schemaRoot, "typescript");
    const jsonSchemaPath = join(schemaRoot, "json-schema");
    await Promise.all([
      mkdir(typeScriptPath, { recursive: true, mode: 0o700 }),
      mkdir(jsonSchemaPath, { recursive: true, mode: 0o700 })
    ]);

    const typeScript = await runCommand("codex", ["app-server", "generate-ts", "--out", typeScriptPath], {
      env,
      timeoutMs: 30_000
    });
    const jsonSchema = await runCommand(
      "codex",
      ["app-server", "generate-json-schema", "--out", jsonSchemaPath],
      {
        env,
        timeoutMs: 30_000
      }
    );

    return {
      typeScript,
      jsonSchema,
      typeScriptPath,
      jsonSchemaPath
    };
  }

  private async ensureManagedCodexFiles(codexHomeDir: string) {
    const configPath = join(codexHomeDir, "config.toml");
    const hooksPath = join(codexHomeDir, "hooks.json");
    const [configOwner, hooksOwner] = await Promise.all([
      ensureManagedFile(
        configPath,
        `# ${managedMarker}\n# Owner: App Factory Supervisor\n# Purpose: Codex compatibility validation and worker runtime defaults.\n`
      ),
      ensureManagedFile(
        hooksPath,
        `${JSON.stringify(
          {
            description: `${managedMarker}: Stop callback for App Factory Supervisor.`,
            hooks: {
              Stop: [
                {
                  hooks: [
                    {
                      type: "command",
                      command:
                        "node -e \"fetch(process.env.APP_FACTORY_STOP_HOOK_URL || 'http://127.0.0.1:3000/api/codex/hooks/stop',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({source:'codex-stop-hook'})}).catch(()=>{}).finally(()=>{})\"",
                      timeout: 5
                    }
                  ]
                }
              ]
            }
          },
          null,
          2
        )}\n`
      )
    ]);
    const conflicts = [
      ...(configOwner === "user" ? ["config.toml exists without app-managed marker"] : []),
      ...(hooksOwner === "user" ? ["hooks.json exists without app-managed marker"] : [])
    ];
    return {
      codexHomeDir,
      configPath,
      hooksPath,
      configOwner,
      hooksOwner,
      conflicts
    };
  }

  async recordStopHookCallback(metadata: Record<string, unknown>): Promise<boolean> {
    try {
      await this.database.pool.query(
        `
          insert into app_audit_events (id, event_type, actor_type, summary, metadata, created_at)
          values ($1, 'codex.stop_hook_callback', 'codex_hook', 'Codex Stop hook callback accepted', $2, now())
        `,
        [randomUUID(), metadata]
      );
      return true;
    } catch {
      return false;
    }
  }

  private async insertArtifact(
    artifactType: string,
    path: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const artifactId = randomUUID();
    const fileStats = await stat(path);
    const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    await this.database.pool.query(
      `
        insert into artifacts (id, artifact_type, path, sha256, size_bytes, redacted, metadata, created_at)
        values ($1, $2, $3, $4, $5, false, $6, now())
      `,
      [artifactId, artifactType, path, sha256, fileStats.size, metadata]
    );
    return artifactId;
  }

  private async insertDirectoryArtifact(
    artifactType: string,
    path: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const artifactId = randomUUID();
    const digest = createHash("sha256");
    let sizeBytes = 0;
    for (const filePath of await listFiles(path)) {
      const fileStats = await stat(filePath);
      sizeBytes += fileStats.size;
      digest.update(relative(path, filePath));
      digest.update(await readFile(filePath));
    }
    await this.database.pool.query(
      `
        insert into artifacts (id, artifact_type, path, sha256, size_bytes, redacted, metadata, created_at)
        values ($1, $2, $3, $4, $5, false, $6, now())
      `,
      [artifactId, artifactType, path, digest.digest("hex"), sizeBytes, metadata]
    );
    return artifactId;
  }
}

async function ensureManagedFile(path: string, contents: string): Promise<"app" | "user"> {
  if (!(await fileExists(path))) {
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await writeFile(path, contents, {
      encoding: "utf8",
      mode: 0o600
    });
    return "app";
  }
  const existing = await readFile(path, "utf8");
  if (existing.includes(managedMarker) || existing.includes('"owner": "app-factory-supervisor"')) {
    if (existing !== contents) {
      await writeFile(path, contents, {
        encoding: "utf8",
        mode: 0o600
      });
    }
    return "app";
  }
  return "user";
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        error: error.message
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        command,
        args,
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        timedOut,
        error: timedOut ? `${command} timed out after ${options.timeoutMs}ms` : null
      });
    });
  });
}

function commandSucceeded(result: CommandResult): boolean {
  return result.exitCode === 0 && !result.timedOut && result.error === null;
}

function firstNonEmptyLine(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? "unavailable";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function listFiles(path: string): Promise<string[]> {
  const entries = await readdir(path, {
    withFileTypes: true
  });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = join(path, entry.name);
      if (entry.isDirectory()) {
        return listFiles(entryPath);
      }
      return [entryPath];
    })
  );
  return files.flat().sort();
}

function safeTimestamp(date: Date): string {
  return date.toISOString().replaceAll(":", "").replaceAll(".", "");
}

function summarizeGaps(input: {
  codexCliAvailable: boolean;
  codexAuthUsable: boolean;
  jsonModeSupported: boolean;
  outputSchemaSupported: boolean;
  outputLastMessageSupported: boolean;
  execResumeSupported: boolean;
  hooksSupported: boolean;
  appServerTypeScriptSchemasGenerated: boolean;
  appServerJsonSchemasGenerated: boolean;
  configValidationPassed: boolean;
  stopHookCallbackVerified: boolean;
  jsonlParserRecognizesCurrentEvents: boolean;
  buildEnvironmentReady: boolean;
  smokeError: string | null;
  schemaTypeScriptError: string | null;
  schemaJsonError: string | null;
  configError: string | null;
  ownershipConflicts: string[];
}): string {
  const gaps = [
    !input.codexCliAvailable ? "Codex CLI is unavailable." : null,
    !input.codexAuthUsable ? `Codex exec smoke failed: ${trimGap(input.smokeError)}` : null,
    !input.jsonModeSupported ? "codex exec help does not expose --json." : null,
    !input.outputSchemaSupported ? "codex exec help does not expose --output-schema." : null,
    !input.outputLastMessageSupported ? "codex exec help does not expose --output-last-message." : null,
    !input.execResumeSupported ? "Codex help does not expose resume support." : null,
    !input.appServerTypeScriptSchemasGenerated
      ? `TypeScript schema generation failed: ${trimGap(input.schemaTypeScriptError)}`
      : null,
    !input.appServerJsonSchemasGenerated
      ? `JSON schema generation failed: ${trimGap(input.schemaJsonError)}`
      : null,
    !input.configValidationPassed
      ? `Codex strict config validation failed: ${trimGap(input.configError)}`
      : null,
    !input.hooksSupported ? "Hook config did not load cleanly or ownership conflicts exist." : null,
    !input.stopHookCallbackVerified ? "Stop hook callback route could not record a backend callback." : null,
    !input.jsonlParserRecognizesCurrentEvents ? "JSONL parser does not recognize required event names." : null,
    ...input.ownershipConflicts
  ].filter((gap): gap is string => gap !== null);
  return gaps.length === 0 && input.buildEnvironmentReady
    ? "Codex compatibility review passed."
    : gaps.join(" ");
}

function trimGap(value: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "no diagnostic output";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 500);
}

function renderReviewReport(
  review: ReviewMetadata,
  commands: {
    version: CommandResult;
    execHelp: CommandResult;
    rootHelp: CommandResult;
    smoke: CommandResult;
    schemaTypeScript: CommandResult;
    schemaJson: CommandResult;
    configValidation: CommandResult;
    jsonlSummary: ReturnType<typeof summarizeCodexJsonl>;
  }
): string {
  const lines = [
    "# Codex Compatibility Review",
    "",
    `Generated: ${review.createdAt}`,
    `Status: ${review.status}`,
    `Codex CLI version: ${review.codexCliVersion}`,
    `Build environment ready: ${review.buildEnvironmentReady ? "yes" : "no"}`,
    "",
    "## Checks",
    "",
    `- Codex auth usable: ${formatBool(review.codexAuthUsable)}`,
    `- JSON mode supported: ${formatBool(review.jsonModeSupported)}`,
    `- Output schema supported: ${formatBool(review.outputSchemaSupported)}`,
    `- Output last message supported: ${formatBool(review.outputLastMessageSupported)}`,
    `- Exec resume supported: ${formatBool(review.execResumeSupported)}`,
    `- Hooks supported: ${formatBool(review.hooksSupported)}`,
    `- App-server TypeScript schemas generated: ${formatBool(review.appServerTypeScriptSchemasGenerated)}`,
    `- App-server JSON schemas generated: ${formatBool(review.appServerJsonSchemasGenerated)}`,
    `- Config validation passed: ${formatBool(review.configValidationPassed)}`,
    `- Stop hook callback verified: ${formatBool(review.stopHookCallbackVerified)}`,
    `- JSONL parser recognizes required events: ${formatBool(review.jsonlParserRecognizesCurrentEvents)}`,
    "",
    "## Artifacts",
    "",
    `- JSONL smoke output: ${review.smokeArtifacts.jsonl ?? "none"}`,
    `- Smoke stderr: ${review.smokeArtifacts.stderr ?? "none"}`,
    `- Smoke last message: ${review.smokeArtifacts.lastMessage ?? "none"}`,
    `- TypeScript schemas: ${review.generatedSchemaPaths.typeScript ?? "none"}`,
    `- JSON schemas: ${review.generatedSchemaPaths.jsonSchema ?? "none"}`,
    "",
    "## Managed Config And Hooks",
    "",
    `- Codex home: ${review.ownership.codexHomeDir}`,
    `- Config owner: ${review.ownership.configOwner}`,
    `- Hooks owner: ${review.ownership.hooksOwner}`,
    `- Conflicts: ${review.ownership.conflicts.length === 0 ? "none" : review.ownership.conflicts.join("; ")}`,
    "",
    "## JSONL Summary",
    "",
    `- Total lines: ${commands.jsonlSummary.totalLines}`,
    `- Parsed events: ${commands.jsonlSummary.parsedEvents}`,
    `- Malformed lines: ${commands.jsonlSummary.malformedLines}`,
    `- Event types: ${commands.jsonlSummary.eventTypes.join(", ") || "none"}`,
    "",
    "## Gap Summary",
    "",
    review.gapSummary,
    "",
    "## Command Results",
    "",
    renderCommand("codex --version", commands.version),
    renderCommand("codex exec --help", commands.execHelp),
    renderCommand("codex --help", commands.rootHelp),
    renderCommand("codex exec --json smoke", commands.smoke),
    renderCommand("codex app-server generate-ts", commands.schemaTypeScript),
    renderCommand("codex app-server generate-json-schema", commands.schemaJson),
    renderCommand("codex --strict-config --version", commands.configValidation),
    ""
  ];
  return lines.join("\n");
}

function formatBool(value: boolean): string {
  return value ? "pass" : "fail";
}

function renderCommand(title: string, result: CommandResult): string {
  return [
    `### ${title}`,
    "",
    `- Exit code: ${result.exitCode ?? "spawn_failed"}`,
    `- Timed out: ${result.timedOut ? "yes" : "no"}`,
    `- Error: ${result.error ?? "none"}`,
    `- Stdout: ${trimGap(result.stdout)}`,
    `- Stderr: ${trimGap(result.stderr)}`
  ].join("\n");
}
