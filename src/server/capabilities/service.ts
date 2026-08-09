import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

type CapabilityType = "mcp" | "skill" | "agent";
type SourceType = "bundled" | "repository" | "user";
type CapabilityStatus = "configured" | "missing" | "optional_disabled" | "conflict";
type InstallRunStatus = "not_started" | "running" | "succeeded" | "failed";
type InstallStepStatus = "pending" | "pass" | "fail" | "skipped";

export type CapabilityDefinition = {
  type: CapabilityType;
  id: string;
  sourceType: SourceType;
  source: string | null;
  required: boolean;
  wiredTo: string[];
  installStage: "wizard" | "image" | "user";
  description: string;
  metadata?: Record<string, unknown>;
};

export type CapabilityRecord = CapabilityDefinition & {
  status: CapabilityStatus;
  version: string | null;
  revision: string | null;
  lastVerifiedAt: string | null;
};

export type CapabilityInstallStep = {
  id: string;
  label: string;
  status: InstallStepStatus;
  output: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type CapabilityStatusResponse = {
  installRunId: string | null;
  status: InstallRunStatus;
  capabilitiesRoot: string;
  codexConfigPath: string;
  requiredCount: number;
  installedCount: number;
  missingRequiredCount: number;
  conflictSummary: string | null;
  appManagedConfigPresent: boolean;
  capabilities: CapabilityRecord[];
  steps: CapabilityInstallStep[];
  artifactPath: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type InstallRunRow = {
  id: string;
  status: InstallRunStatus;
  config_path: string;
  capabilities_root: string;
  installed_count: number;
  required_count: number;
  missing_required_count: number;
  conflict_summary: string | null;
  artifact_path: string | null;
  steps: CapabilityInstallStep[];
  started_at: Date;
  finished_at: Date | null;
};

type CapabilityRow = {
  capability_type: CapabilityType;
  capability_id: string;
  source_type: SourceType;
  source: string | null;
  revision: string | null;
  version: string | null;
  wired_to: string[];
  status: CapabilityStatus;
  metadata: Record<string, unknown>;
  last_verified_at: Date | null;
};

const managedStart = "# >>> app-factory-supervisor managed capabilities";
const managedEnd = "# <<< app-factory-supervisor managed capabilities";

export const defaultCapabilities: CapabilityDefinition[] = [
  mcp("mobile-docs", "repository", "https://github.com/siamakerlab/mobile-docs-mcp-server", true, {
    command: "docs-mcp-server",
    args: ["--protocol", "stdio"],
    npmPackage: "mobile-docs-mcp",
    packageVersion: "0.2.0"
  }),
  mcp("context7", "repository", "https://github.com/upstash/context7", true, {
    command: "context7-mcp",
    args: [],
    npmPackage: "@upstash/context7-mcp",
    packageVersion: "4.0.0"
  }),
  mcp("mobile-mcp", "repository", "https://github.com/mobile-next/mobile-mcp", true, {
    command: "mcp-server-mobile",
    args: [],
    npmPackage: "@mobilenext/mobile-mcp",
    packageVersion: "1.0.2"
  }),
  mcp("playwright", "repository", "https://github.com/microsoft/playwright-mcp", true, {
    command: "playwright-mcp",
    args: [],
    npmPackage: "@playwright/mcp",
    packageVersion: "0.0.79"
  }),
  mcp("memory", "repository", "https://github.com/modelcontextprotocol/servers/tree/main/src/memory", true, {
    command: "mcp-server-memory",
    args: [],
    npmPackage: "@modelcontextprotocol/server-memory",
    packageVersion: "2026.7.4"
  }),
  mcp("time", "repository", "https://github.com/guanxiong-shen/mcp-server-time", true, {
    command: "mcp-server-time",
    args: [],
    npmPackage: "@guanxiong/mcp-server-time",
    packageVersion: "1.0.0"
  }),
  mcp("github", "repository", "https://github.com/github/github-mcp-server", false, undefined, [
    "credentials-required"
  ]),
  mcp("play-store-mcp", "repository", null, false, undefined, ["credentials-required"]),
  mcp("app-publish", "repository", null, false, undefined, ["credentials-required"]),
  mcp("firebase", "repository", "https://github.com/firebase/firebase-tools", false, undefined, [
    "credentials-required"
  ]),
  mcp("sentry", "repository", "https://github.com/getsentry/sentry-mcp", false, undefined, [
    "credentials-required"
  ]),
  mcp("code-review-graph", "repository", null, false, undefined, ["advanced"]),
  mcp("db-mcp", "repository", null, false, undefined, ["advanced"]),
  mcp("fetch-search-mcp", "repository", null, false, undefined, ["advanced"]),
  ...[
    "material-3",
    "material3-expert",
    "compose-expert",
    "jetpack-compose-expert",
    "compose-architecture-expert",
    "adaptive",
    "adaptive-layout-expert",
    "edge-to-edge",
    "navigation-3",
    "kotlin-expert",
    "android-testing",
    "testing-setup",
    "android-bug-finder",
    "build-failure-debugger",
    "r8-analyzer",
    "play-billing",
    "admob-agent-skill",
    "play-policy-insights",
    "perfetto-sql",
    "perfetto-trace-analysis",
    "project-explore",
    "dependency-version-review",
    "placeholder-audit",
    "completion-verify",
    "final-gate",
    "license-compliance-review",
    "license-report",
    "qa-scenario-writer"
  ].map((id) => skill(id)),
  ...[
    "repo-cartographer",
    "requirements-analyst",
    "product-planner",
    "gap-analysis-reviewer",
    "android-architecture-reviewer",
    "data-layer-reviewer",
    "coroutine-flow-reviewer",
    "navigation-ux-reviewer",
    "accessibility-reviewer",
    "privacy-permission-reviewer",
    "security-reviewer",
    "performance-reviewer",
    "empty-error-loading-state-reviewer",
    "screenshot-regression-reviewer",
    "release-packaging-reviewer",
    "android-test-engineer",
    "build-failure-debugger"
  ].map((id) => agent(id))
];

export class CapabilityService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getStatus(): Promise<CapabilityStatusResponse> {
    const [run, rows] = await Promise.all([this.getLatestRun(), this.getCapabilityRows()]);
    const paths = this.getPaths();
    const capabilities = mergeDefinitions(rows);
    const requiredCount = capabilities.filter((capability) => capability.required).length;
    const installedCount = capabilities.filter((capability) => capability.status === "configured").length;
    const missingRequiredCount = capabilities.filter(
      (capability) => capability.required && capability.status !== "configured"
    ).length;

    return {
      installRunId: run?.id ?? null,
      status: run?.status ?? "not_started",
      capabilitiesRoot: run?.capabilities_root ?? paths.capabilitiesRoot,
      codexConfigPath: run?.config_path ?? paths.configPath,
      requiredCount: run?.required_count ?? requiredCount,
      installedCount: run?.installed_count ?? installedCount,
      missingRequiredCount: run?.missing_required_count ?? missingRequiredCount,
      conflictSummary: run?.conflict_summary ?? null,
      appManagedConfigPresent: await hasManagedConfig(paths.configPath),
      capabilities,
      steps: run?.steps ?? createSteps(),
      artifactPath: run?.artifact_path ?? null,
      startedAt: run?.started_at.toISOString() ?? null,
      finishedAt: run?.finished_at?.toISOString() ?? null
    };
  }

  async install(): Promise<CapabilityStatusResponse> {
    const paths = this.getPaths();
    await Promise.all([
      mkdir(paths.capabilitiesRoot, { recursive: true, mode: 0o700 }),
      mkdir(paths.skillsDir, { recursive: true, mode: 0o700 }),
      mkdir(paths.agentsDir, { recursive: true, mode: 0o700 }),
      mkdir(paths.artifactsDir, { recursive: true, mode: 0o700 }),
      mkdir(paths.codexDir, { recursive: true, mode: 0o700 })
    ]);

    const runId = randomUUID();
    const steps = createSteps();
    await this.insertRun(runId, "running", paths, steps);

    const completedSteps: CapabilityInstallStep[] = [];
    const recordStep = async (
      id: string,
      fn: () => Promise<string>
    ): Promise<CapabilityInstallStep> => {
      const step = steps.find((candidate) => candidate.id === id);
      if (!step) {
        throw new Error(`unknown capability install step: ${id}`);
      }
      const startedAt = new Date().toISOString();
      try {
        const output = await fn();
        return {
          ...step,
          status: "pass",
          output,
          startedAt,
          finishedAt: new Date().toISOString()
        };
      } catch (error) {
        return {
          ...step,
          status: "fail",
          output: error instanceof Error ? error.message : "unknown error",
          startedAt,
          finishedAt: new Date().toISOString()
        };
      }
    };

    for (const [id, fn] of [
      ["write-capability-records", () => this.writeCapabilityRecords()],
      ["install-required-mcps", () => this.installRequiredMcps()],
      ["wire-bundled-capabilities", () => this.wireBundledCapabilities(paths)],
      ["write-codex-config", () => this.writeCodexConfig(paths)],
      ["validate-capabilities", () => this.validateCapabilities()]
    ] as const) {
      const completed = await recordStep(id, fn);
      completedSteps.push(completed);
      await this.updateRunSteps(runId, completedSteps.concat(steps.slice(completedSteps.length)));
      if (completed.status === "fail") {
        break;
      }
    }

    const rows = await this.getCapabilityRows();
    const capabilities = mergeDefinitions(rows);
    const requiredCount = capabilities.filter((capability) => capability.required).length;
    const installedCount = capabilities.filter((capability) => capability.status === "configured").length;
    const missingRequired = capabilities.filter(
      (capability) => capability.required && capability.status !== "configured"
    );
    const failedStep = completedSteps.find((step) => step.status === "fail");
    const status: InstallRunStatus = failedStep || missingRequired.length > 0 ? "failed" : "succeeded";
    const conflictSummary = capabilities.some((capability) => capability.status === "conflict")
      ? "Capability ownership conflict detected"
      : null;

    const reportPath = join(paths.artifactsDir, "capability-install-report.md");
    await writeFile(
      reportPath,
      renderReport(status, capabilities, completedSteps, paths.configPath, conflictSummary),
      "utf8"
    );
    const artifactId = await this.insertArtifact("capability_install_report", reportPath, {
      status,
      requiredCount,
      installedCount,
      missingRequiredCount: missingRequired.length
    });
    await this.finishRun(runId, {
      status,
      steps: completedSteps.concat(
        steps.slice(completedSteps.length).map((step) => ({ ...step, status: "skipped" as const }))
      ),
      requiredCount,
      installedCount,
      missingRequiredCount: missingRequired.length,
      conflictSummary,
      artifactId
    });

    return this.getStatus();
  }

  private getPaths() {
    const runtimePaths = getRuntimePaths(this.config);
    const capabilitiesRoot = runtimePaths.capabilitiesDir;
    const codexDir = join(this.config.APP_DATA_DIR, "codex");
    return {
      capabilitiesRoot,
      skillsDir: join(capabilitiesRoot, "skills"),
      agentsDir: join(capabilitiesRoot, "agents"),
      artifactsDir: runtimePaths.artifactsDir,
      codexDir,
      configPath: join(codexDir, "config.toml")
    };
  }

  private async writeCapabilityRecords(): Promise<string> {
    for (const capability of defaultCapabilities) {
      await this.database.pool.query(
        `
          insert into capability_installations (
            id, capability_type, capability_id, source_type, source, revision, version,
            wired_to, status, metadata, last_verified_at
          )
          values ($1, $2, $3, $4, $5, null, null, $6, $7, $8, now())
          on conflict (capability_type, capability_id) do update
          set source_type = excluded.source_type,
              source = excluded.source,
              wired_to = excluded.wired_to,
              status = excluded.status,
              metadata = excluded.metadata,
              last_verified_at = now()
        `,
        [
          randomUUID(),
          capability.type,
          capability.id,
          capability.sourceType,
          capability.source,
          capability.wiredTo,
          defaultStatus(capability),
          JSON.stringify({
            ...capability.metadata,
            required: capability.required,
            installStage: capability.installStage,
            description: capability.description
          })
        ]
      );
    }
    return `Registered ${defaultCapabilities.length} default capabilities.`;
  }

  private async wireBundledCapabilities(paths: ReturnType<CapabilityService["getPaths"]>): Promise<string> {
    const bundled = defaultCapabilities.filter((capability) => capability.sourceType === "bundled");
    for (const capability of bundled) {
      const targetDir = capability.type === "agent" ? paths.agentsDir : paths.skillsDir;
      const manifestPath = join(targetDir, capability.id, capability.type === "agent" ? "AGENT.md" : "SKILL.md");
      await mkdir(join(targetDir, capability.id), { recursive: true, mode: 0o700 });
      if (!(await fileExists(manifestPath))) {
        await writeFile(manifestPath, renderCapabilityManifest(capability), "utf8");
      }
    }
    return `Prepared ${bundled.length} bundled skill/agent manifests without overwriting existing files.`;
  }

  private async installRequiredMcps(): Promise<string> {
    const installable = defaultCapabilities.filter(
      (capability) =>
        capability.type === "mcp" &&
        capability.required &&
        typeof capability.metadata?.config === "object" &&
        capability.metadata.config !== null &&
        "npmPackage" in capability.metadata.config
    );
    const outputs: string[] = [];
    for (const capability of installable) {
      const config = getMcpCommandConfig(capability);
      if (!config.npmPackage || !config.packageVersion) {
        continue;
      }
      const spec = `${config.npmPackage}@${config.packageVersion}`;
      const install = await runCommand("npm", ["install", "-g", spec], 10 * 60 * 1000);
      if (install.exitCode !== 0) {
        await this.markCapabilityStatus(capability, "missing", install.output || `npm install -g ${spec} failed`);
        throw new Error(`Failed to install ${capability.id}: ${install.output || install.error}`);
      }
      const version = await runCommand(config.command, ["--version"], 30_000);
      if (version.exitCode !== 0) {
        await this.markCapabilityStatus(
          capability,
          "missing",
          version.output || `${config.command} --version failed`
        );
        throw new Error(`Installed ${capability.id}, but ${config.command} is not executable.`);
      }
      await this.markCapabilityStatus(capability, "configured", null, {
        version: firstLine(version.output) || config.packageVersion
      });
      outputs.push(`${capability.id}: ${spec} (${config.command})`);
    }
    return outputs.length > 0 ? `Installed required MCP packages: ${outputs.join(", ")}.` : "No MCP packages to install.";
  }

  private async writeCodexConfig(paths: ReturnType<CapabilityService["getPaths"]>): Promise<string> {
    const existing = await readTextIfExists(paths.configPath);
    const unmanagedConflict =
      existing.includes(managedStart) && !existing.includes(managedEnd)
        ? "Existing managed config start marker has no matching end marker."
        : null;
    if (unmanagedConflict) {
      await this.markAllRequiredConflict(unmanagedConflict);
      throw new Error(unmanagedConflict);
    }

    const managed = renderManagedConfig(defaultCapabilities.filter((capability) => capability.type === "mcp"));
    const next = replaceManagedSection(existing, managed);
    await writeFile(paths.configPath, next, {
      encoding: "utf8",
      mode: 0o600
    });
    return `Wrote app-managed MCP section to ${paths.configPath}.`;
  }

  private async validateCapabilities(): Promise<string> {
    const result = await this.database.pool.query<CapabilityRow>(
      `
        select *
        from capability_installations
        where status = 'missing'
          and metadata->>'required' = 'true'
      `
    );
    if ((result.rowCount ?? 0) > 0) {
      throw new Error(
        `Missing required capabilities: ${result.rows
          .map((row) => `${row.capability_type}:${row.capability_id}`)
          .join(", ")}`
      );
    }
    return "Required capabilities are configured.";
  }

  private async markAllRequiredConflict(summary: string): Promise<void> {
    await this.database.pool.query(
      `
        update capability_installations
        set status = 'conflict',
            metadata = metadata || $1::jsonb,
            last_verified_at = now()
        where metadata->>'required' = 'true'
      `,
      [JSON.stringify({ conflictSummary: summary })]
    );
  }

  private async markCapabilityStatus(
    capability: CapabilityDefinition,
    status: CapabilityStatus,
    error: string | null,
    input: { version?: string | null; revision?: string | null } = {}
  ): Promise<void> {
    await this.database.pool.query(
      `
        update capability_installations
        set status = $3,
            version = coalesce($4, version),
            revision = coalesce($5, revision),
            metadata = metadata || $6::jsonb,
            last_verified_at = now()
        where capability_type = $1
          and capability_id = $2
      `,
      [
        capability.type,
        capability.id,
        status,
        input.version ?? null,
        input.revision ?? null,
        JSON.stringify(error ? { lastInstallError: error } : { lastInstallError: null })
      ]
    );
  }

  private async getLatestRun(): Promise<InstallRunRow | null> {
    const result = await this.database.pool.query<InstallRunRow>(
      `
        select r.*, a.path as artifact_path
        from capability_install_runs r
        left join artifacts a on a.id = r.artifact_id
        order by r.started_at desc
        limit 1
      `
    );
    return result.rows[0] ?? null;
  }

  private async getCapabilityRows(): Promise<CapabilityRow[]> {
    const result = await this.database.pool.query<CapabilityRow>(
      "select * from capability_installations order by capability_type, capability_id"
    );
    return result.rows;
  }

  private async insertRun(
    id: string,
    status: InstallRunStatus,
    paths: ReturnType<CapabilityService["getPaths"]>,
    steps: CapabilityInstallStep[]
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into capability_install_runs (
          id, status, config_path, capabilities_root, steps, started_at
        )
        values ($1, $2, $3, $4, $5, now())
      `,
      [id, status, paths.configPath, paths.capabilitiesRoot, JSON.stringify(steps)]
    );
  }

  private async updateRunSteps(id: string, steps: CapabilityInstallStep[]): Promise<void> {
    await this.database.pool.query("update capability_install_runs set steps = $1 where id = $2", [
      JSON.stringify(steps),
      id
    ]);
  }

  private async finishRun(
    id: string,
    input: {
      status: InstallRunStatus;
      steps: CapabilityInstallStep[];
      requiredCount: number;
      installedCount: number;
      missingRequiredCount: number;
      conflictSummary: string | null;
      artifactId: string;
    }
  ): Promise<void> {
    await this.database.pool.query(
      `
        update capability_install_runs
        set status = $2,
            installed_count = $3,
            required_count = $4,
            missing_required_count = $5,
            conflict_summary = $6,
            artifact_id = $7,
            steps = $8,
            finished_at = now()
        where id = $1
      `,
      [
        id,
        input.status,
        input.installedCount,
        input.requiredCount,
        input.missingRequiredCount,
        input.conflictSummary,
        input.artifactId,
        JSON.stringify(input.steps)
      ]
    );
  }

  private async insertArtifact(
    artifactType: string,
    path: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const artifactId = randomUUID();
    const fileStats = await stat(path);
    await this.database.pool.query(
      `
        insert into artifacts (id, artifact_type, path, sha256, size_bytes, redacted, metadata, created_at)
        values ($1, $2, $3, null, $4, false, $5, now())
      `,
      [artifactId, artifactType, path, fileStats.size, JSON.stringify(metadata)]
    );
    return artifactId;
  }
}

function mcp(
  id: string,
  sourceType: SourceType,
  source: string | null,
  required: boolean,
  config?: Record<string, unknown>,
  tags: string[] = []
): CapabilityDefinition {
  return {
    type: "mcp",
    id,
    sourceType,
    source,
    required,
    wiredTo: ["worker"],
    installStage: "wizard",
    description: required ? "Required default MCP server" : "Optional MCP server",
    metadata: {
      tags,
      config: config ?? { command: id, args: [] }
    }
  };
}

function skill(id: string): CapabilityDefinition {
  return {
    type: "skill",
    id,
    sourceType: "bundled",
    source: null,
    required: true,
    wiredTo: ["worker"],
    installStage: "image",
    description: "Product-owned bundled worker skill"
  };
}

function agent(id: string): CapabilityDefinition {
  return {
    type: "agent",
    id,
    sourceType: "bundled",
    source: null,
    required: true,
    wiredTo: ["worker"],
    installStage: "image",
    description: "Worker-invoked review perspective"
  };
}

function defaultStatus(capability: CapabilityDefinition): CapabilityStatus {
  if (!capability.required) {
    return "optional_disabled";
  }
  if (capability.sourceType === "repository" && !capability.source) {
    return "missing";
  }
  return "configured";
}

function mergeDefinitions(rows: CapabilityRow[]): CapabilityRecord[] {
  const rowMap = new Map(rows.map((row) => [`${row.capability_type}:${row.capability_id}`, row]));
  return defaultCapabilities.map((definition) => {
    const row = rowMap.get(`${definition.type}:${definition.id}`);
    const metadata = row?.metadata ?? {};
    return {
      ...definition,
      status: row?.status ?? "missing",
      sourceType: row?.source_type ?? definition.sourceType,
      source: row?.source ?? definition.source,
      wiredTo: row?.wired_to ?? definition.wiredTo,
      version: row?.version ?? null,
      revision: row?.revision ?? null,
      lastVerifiedAt: row?.last_verified_at?.toISOString() ?? null,
      required:
        typeof metadata.required === "boolean" ? metadata.required : definition.required,
      installStage:
        metadata.installStage === "wizard" || metadata.installStage === "image" || metadata.installStage === "user"
          ? metadata.installStage
          : definition.installStage,
      description: typeof metadata.description === "string" ? metadata.description : definition.description
    };
  });
}

function createSteps(): CapabilityInstallStep[] {
  return [
    step("write-capability-records", "Register default capability records"),
    step("install-required-mcps", "Install required MCP server packages"),
    step("wire-bundled-capabilities", "Copy or prepare bundled skills and agents"),
    step("write-codex-config", "Write app-managed Codex MCP config"),
    step("validate-capabilities", "Validate required capability readiness")
  ];
}

function step(id: string, label: string): CapabilityInstallStep {
  return {
    id,
    label,
    status: "pending",
    output: "",
    startedAt: null,
    finishedAt: null
  };
}

function renderManagedConfig(capabilities: CapabilityDefinition[]): string {
  const required = capabilities.filter((capability) => capability.required);
  const optional = capabilities.filter((capability) => !capability.required);
  return [
    managedStart,
    "# owner = app-factory-supervisor",
    `# generated_at = ${new Date().toISOString()}`,
    "# Required MCPs are enabled for worker use. Optional credentialed MCPs stay disabled until credentials exist.",
    ...required.map(renderMcpConfig),
    "",
    "# Optional MCP inventory, intentionally disabled by default:",
    ...optional.map((capability) => `# ${capability.id}: ${capability.source ?? "source pending"}`),
    managedEnd,
    ""
  ].join("\n");
}

function renderMcpConfig(capability: CapabilityDefinition): string {
  const { command, args } = getMcpCommandConfig(capability);
  return [
    "",
    `[mcp_servers.${JSON.stringify(capability.id)}]`,
    `command = ${JSON.stringify(command)}`,
    `args = [${args.map((arg) => JSON.stringify(arg)).join(", ")}]`,
    "required = true",
    "startup_timeout_sec = 30",
    "tool_timeout_sec = 120"
  ].join("\n");
}

function getMcpCommandConfig(capability: CapabilityDefinition): {
  command: string;
  args: string[];
  npmPackage: string | null;
  packageVersion: string | null;
} {
  const config = capability.metadata?.config;
  return {
    command:
      typeof config === "object" && config && "command" in config && typeof config.command === "string"
        ? config.command
        : capability.id,
    args:
      typeof config === "object" && config && "args" in config && Array.isArray(config.args)
        ? config.args.filter((arg): arg is string => typeof arg === "string")
        : [],
    npmPackage:
      typeof config === "object" && config && "npmPackage" in config && typeof config.npmPackage === "string"
        ? config.npmPackage
        : null,
    packageVersion:
      typeof config === "object" &&
      config &&
      "packageVersion" in config &&
      typeof config.packageVersion === "string"
        ? config.packageVersion
        : null
  };
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ exitCode: number | null; output: string; error: string | null }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      resolve({
        exitCode: null,
        output: Buffer.concat(chunks).toString("utf8").trim(),
        error: `${command} timed out`
      });
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({
        exitCode: null,
        output: Buffer.concat(chunks).toString("utf8").trim(),
        error: error.message
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({
        exitCode: code,
        output: Buffer.concat(chunks).toString("utf8").trim(),
        error: null
      });
    });
  });
}

function firstLine(value: string): string | null {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) ?? null;
}

function replaceManagedSection(existing: string, managed: string): string {
  const start = existing.indexOf(managedStart);
  if (start === -1) {
    return existing.trim() ? `${existing.trimEnd()}\n\n${managed}` : managed;
  }
  const end = existing.indexOf(managedEnd, start);
  if (end === -1) {
    return existing;
  }
  const after = end + managedEnd.length;
  return `${existing.slice(0, start).trimEnd()}\n\n${managed}${existing.slice(after).trimStart()}`;
}

async function hasManagedConfig(path: string): Promise<boolean> {
  const text = await readTextIfExists(path);
  return text.includes(managedStart) && text.includes(managedEnd);
}

async function readTextIfExists(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return "";
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function renderCapabilityManifest(capability: CapabilityDefinition): string {
  if (capability.type === "agent") {
    return [
      `# ${capability.id}`,
      "",
      "Worker-invoked review perspective for Android/Kotlin production readiness.",
      "",
      "The supervisor never invokes this agent directly. Worker prompts may ask Codex to use this perspective during review."
    ].join("\n");
  }
  return [
    `# ${capability.id}`,
    "",
    "Product-owned worker skill for Android/Kotlin implementation and review.",
    "",
    "This manifest is created by first-run capability wiring when the image does not provide a fuller bundled copy."
  ].join("\n");
}

function renderReport(
  status: InstallRunStatus,
  capabilities: CapabilityRecord[],
  steps: CapabilityInstallStep[],
  configPath: string,
  conflictSummary: string | null
): string {
  const requiredMissing = capabilities.filter(
    (capability) => capability.required && capability.status !== "configured"
  );
  return [
    "# Capability Install Report",
    "",
    `Status: ${status}`,
    `Generated: ${new Date().toISOString()}`,
    `Codex config: ${configPath}`,
    conflictSummary ? `Conflict: ${conflictSummary}` : "Conflict: none",
    "",
    "## Steps",
    ...steps.map((step) => `- ${step.status}: ${step.label}`),
    "",
    "## Required Missing",
    ...(requiredMissing.length === 0
      ? ["- none"]
      : requiredMissing.map((capability) => `- ${capability.type}:${capability.id}`)),
    "",
    "## Capability Inventory",
    ...capabilities.map(
      (capability) =>
        `- ${capability.status}: ${capability.type}:${capability.id} (${capability.installStage}, ${capability.sourceType})`
    )
  ].join("\n");
}
