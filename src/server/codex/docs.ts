import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { access, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

const indexName = "openai-codex";
const smokeQuery = "codex exec --json output-schema hooks MCP";

const codexDocSources = [
  ["Codex CLI", "https://developers.openai.com/codex/cli"],
  ["Non-interactive mode", "https://developers.openai.com/codex/non-interactive-mode"],
  ["Developer commands", "https://developers.openai.com/codex/developer-commands"],
  ["Config reference", "https://developers.openai.com/codex/config-reference"],
  ["Hooks", "https://developers.openai.com/codex/hooks"],
  ["MCP", "https://developers.openai.com/codex/mcp"],
  ["Codex MCP server", "https://developers.openai.com/codex/mcp-server"],
  ["Security overview", "https://developers.openai.com/codex/security"],
  ["Sandboxing", "https://developers.openai.com/codex/sandboxing"],
  ["Approvals and security", "https://developers.openai.com/codex/agent-approvals-security"],
  ["Internet access", "https://developers.openai.com/codex/cloud/internet-access"],
  ["Skills", "https://developers.openai.com/codex/build-skills"],
  ["Plugins", "https://developers.openai.com/codex/build-plugins"],
  ["Codex SDK", "https://developers.openai.com/codex/sdk"],
  ["App Server", "https://developers.openai.com/codex/app-server"],
  ["Changelog", "https://developers.openai.com/codex/changelog"],
  ["AGENTS.md", "https://developers.openai.com/codex/agent-configuration/agents-md"]
] as const;

export type CodexDocsIndexStatus = {
  id: string | null;
  status: "not_started" | "indexing" | "ready" | "failed";
  indexName: string;
  storePath: string;
  documentCount: number;
  uniqueUrlCount: number;
  codexCliVersion: string | null;
  indexedUrlList: string[];
  searchSmokeTest: {
    query: string;
    status: "pass" | "fail" | "not_run";
    resultCount: number;
    outputPreview: string;
  };
  artifactPath: string | null;
  gapReport: string;
  indexedAt: string | null;
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

type DocsIndexRow = {
  id: string;
  index_name: string;
  store_path: string;
  document_count: number;
  unique_url_count: number;
  codex_cli_version: string | null;
  indexed_at: Date | null;
  status: "not_started" | "indexing" | "ready" | "failed";
  metadata: DocsIndexMetadata;
};

type DocsIndexMetadata = Omit<CodexDocsIndexStatus, "id" | "indexedAt">;

export class CodexDocsIndexService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getStatus(): Promise<CodexDocsIndexStatus> {
    const result = await this.database.pool.query<DocsIndexRow>(
      `
        select *
        from codex_doc_indexes
        where index_name = $1
        limit 1
      `,
      [indexName]
    );
    const row = result.rows[0];
    if (!row) {
      return this.emptyStatus();
    }
    return {
      ...row.metadata,
      id: row.id,
      indexName: row.index_name,
      storePath: row.store_path,
      documentCount: row.document_count,
      uniqueUrlCount: row.unique_url_count,
      codexCliVersion: row.codex_cli_version,
      indexedAt: row.indexed_at?.toISOString() ?? null
    };
  }

  async runIndex(): Promise<CodexDocsIndexStatus> {
    const paths = getRuntimePaths(this.config);
    const startedAt = new Date();
    await Promise.all([
      mkdir(paths.codexDocsStoreDir, { recursive: true, mode: 0o700 }),
      mkdir(dirname(paths.codexDocsReportPath), { recursive: true, mode: 0o700 })
    ]);

    await this.upsertIndex({
      status: "indexing",
      documentCount: 0,
      uniqueUrlCount: 0,
      codexCliVersion: null,
      metadata: {
        ...this.emptyStatus(),
        status: "indexing",
        storePath: paths.codexDocsStoreDir,
        gapReport: "Codex documentation indexing is running."
      }
    });

    const env = {
      ...process.env,
      DOCS_MCP_STORE_PATH: paths.codexDocsStoreDir
    };
    const codexVersion = await runCommand("codex", ["--version"], {
      env,
      timeoutMs: 10_000
    });
    const docsVersion = await runCommand("docs-mcp-server", ["--version"], {
      env,
      timeoutMs: 10_000
    });

    const scrapeResults: Array<{ title: string; url: string; result: CommandResult }> = [];
    for (const [title, url] of codexDocSources) {
      const result = await runCommand(
        "docs-mcp-server",
        [
          "scrape",
          indexName,
          url,
          "--store-path",
          paths.codexDocsStoreDir,
          "--scrape-mode",
          "fetch",
          "--max-pages",
          "1",
          "--clean",
          scrapeResults.length === 0 ? "true" : "false",
          "--quiet"
        ],
        {
          env,
          timeoutMs: 90_000
        }
      );
      scrapeResults.push({ title, url, result });
    }

    const search = await runCommand(
      "docs-mcp-server",
      [
        "search",
        indexName,
        smokeQuery,
        "--store-path",
        paths.codexDocsStoreDir,
        "--output",
        "json",
        "--limit",
        "5",
        "--quiet"
      ],
      {
        env,
        timeoutMs: 30_000
      }
    );

    const indexedUrlList = scrapeResults
      .filter(({ result }) => result.exitCode === 0)
      .map(({ url }) => url);
    const searchResultCount = countSearchResults(search.stdout);
    const status =
      commandSucceeded(docsVersion) &&
      scrapeResults.every(({ result }) => result.exitCode === 0) &&
      search.exitCode === 0 &&
      searchResultCount > 0
        ? "ready"
        : "failed";
    const gapReport = renderGapReport({
      docsVersion,
      scrapeResults,
      search,
      searchResultCount
    });
    const report = renderDocsReport({
      status,
      startedAt,
      codexCliVersion: commandSucceeded(codexVersion)
        ? firstNonEmptyLine(codexVersion.stdout || codexVersion.stderr)
        : null,
      docsMcpVersion: commandSucceeded(docsVersion)
        ? firstNonEmptyLine(docsVersion.stdout || docsVersion.stderr)
        : "unavailable",
      storePath: paths.codexDocsStoreDir,
      indexedUrlList,
      scrapeResults,
      search,
      searchResultCount,
      gapReport
    });
    await writeFile(paths.codexDocsReportPath, report, "utf8");
    const artifactId = await this.insertArtifact(
      "codex_docs_index_report",
      paths.codexDocsReportPath,
      {
        status,
        indexName
      }
    );
    const codexCliVersion = commandSucceeded(codexVersion)
      ? firstNonEmptyLine(codexVersion.stdout || codexVersion.stderr)
      : null;
    const metadata: DocsIndexMetadata = {
      status,
      indexName,
      storePath: paths.codexDocsStoreDir,
      documentCount: indexedUrlList.length,
      uniqueUrlCount: new Set(indexedUrlList).size,
      codexCliVersion,
      indexedUrlList,
      searchSmokeTest: {
        query: smokeQuery,
        status: search.exitCode === 0 && searchResultCount > 0 ? "pass" : "fail",
        resultCount: searchResultCount,
        outputPreview: trim(search.stdout || search.stderr || search.error)
      },
      artifactPath: paths.codexDocsReportPath,
      gapReport
    };
    const id = await this.upsertIndex({
      status,
      documentCount: indexedUrlList.length,
      uniqueUrlCount: new Set(indexedUrlList).size,
      codexCliVersion,
      metadata
    });
    await this.linkArtifactToMetadata(artifactId, id);

    return {
      ...metadata,
      id,
      indexedAt: startedAt.toISOString()
    };
  }

  async search(query: string): Promise<{
    status: "ready" | "failed";
    query: string;
    resultCount: number;
    output: unknown;
  }> {
    const current = await this.getStatus();
    if (current.status !== "ready") {
      return {
        status: "failed",
        query,
        resultCount: 0,
        output: {
          error: "codex_docs_index_not_ready",
          gapReport: current.gapReport
        }
      };
    }

    const paths = getRuntimePaths(this.config);
    const result = await runCommand(
      "docs-mcp-server",
      [
        "search",
        indexName,
        query,
        "--store-path",
        paths.codexDocsStoreDir,
        "--output",
        "json",
        "--limit",
        "5",
        "--quiet"
      ],
      {
        env: {
          ...process.env,
          DOCS_MCP_STORE_PATH: paths.codexDocsStoreDir
        },
        timeoutMs: 30_000
      }
    );
    const parsed = parseJson(result.stdout);
    return {
      status: result.exitCode === 0 ? "ready" : "failed",
      query,
      resultCount: countSearchResults(result.stdout),
      output: parsed ?? trim(result.stdout || result.stderr || result.error)
    };
  }

  private emptyStatus(): CodexDocsIndexStatus {
    const paths = getRuntimePaths(this.config);
    return {
      id: null,
      status: "not_started",
      indexName,
      storePath: paths.codexDocsStoreDir,
      documentCount: 0,
      uniqueUrlCount: 0,
      codexCliVersion: null,
      indexedUrlList: [],
      searchSmokeTest: {
        query: smokeQuery,
        status: "not_run",
        resultCount: 0,
        outputPreview: ""
      },
      artifactPath: null,
      gapReport: "Codex official documentation has not been indexed.",
      indexedAt: null
    };
  }

  private async upsertIndex(input: {
    status: "not_started" | "indexing" | "ready" | "failed";
    documentCount: number;
    uniqueUrlCount: number;
    codexCliVersion: string | null;
    metadata: DocsIndexMetadata;
  }): Promise<string> {
    const paths = getRuntimePaths(this.config);
    const id = randomUUID();
    const result = await this.database.pool.query<{ id: string }>(
      `
        insert into codex_doc_indexes (
          id,
          index_name,
          store_path,
          document_count,
          unique_url_count,
          codex_cli_version,
          indexed_at,
          status,
          metadata
        )
        values ($1, $2, $3, $4, $5, $6, now(), $7, $8)
        on conflict (index_name) do update set
          store_path = excluded.store_path,
          document_count = excluded.document_count,
          unique_url_count = excluded.unique_url_count,
          codex_cli_version = excluded.codex_cli_version,
          indexed_at = excluded.indexed_at,
          status = excluded.status,
          metadata = excluded.metadata
        returning id
      `,
      [
        id,
        indexName,
        paths.codexDocsStoreDir,
        input.documentCount,
        input.uniqueUrlCount,
        input.codexCliVersion,
        input.status,
        input.metadata
      ]
    );
    return result.rows[0]?.id ?? id;
  }

  private async insertArtifact(
    artifactType: string,
    path: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const artifactId = randomUUID();
    const fileStats = await stat(path);
    const sha256 = createHash("sha256")
      .update(await readFile(path))
      .digest("hex");
    await this.database.pool.query(
      `
        insert into artifacts (id, artifact_type, path, sha256, size_bytes, redacted, metadata, created_at)
        values ($1, $2, $3, $4, $5, false, $6, now())
      `,
      [artifactId, artifactType, path, sha256, fileStats.size, metadata]
    );
    return artifactId;
  }

  private async linkArtifactToMetadata(artifactId: string, docIndexId: string): Promise<void> {
    await this.database.pool.query(
      `
        update artifacts
        set metadata = metadata || $1::jsonb
        where id = $2
      `,
      [
        {
          codexDocIndexId: docIndexId
        },
        artifactId
      ]
    );
  }
}

function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
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
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "unavailable"
  );
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function countSearchResults(value: string): number {
  const parsed = parseJson(value);
  if (parsed && typeof parsed === "object") {
    const maybeResults = (parsed as { results?: unknown; documents?: unknown }).results;
    if (Array.isArray(maybeResults)) {
      return maybeResults.length;
    }
    const maybeDocuments = (parsed as { documents?: unknown }).documents;
    if (Array.isArray(maybeDocuments)) {
      return maybeDocuments.length;
    }
  }
  return value.trim().length > 0 ? 1 : 0;
}

function renderGapReport(input: {
  docsVersion: CommandResult;
  scrapeResults: Array<{ title: string; url: string; result: CommandResult }>;
  search: CommandResult;
  searchResultCount: number;
}): string {
  const gaps = [
    !commandSucceeded(input.docsVersion)
      ? `docs-mcp-server is unavailable: ${trim(input.docsVersion.error || input.docsVersion.stderr)}`
      : null,
    ...input.scrapeResults.map(({ title, result }) =>
      commandSucceeded(result)
        ? null
        : `${title} scrape failed: ${trim(result.error || result.stderr)}`
    ),
    !commandSucceeded(input.search)
      ? `openai-codex search smoke failed: ${trim(input.search.error || input.search.stderr)}`
      : null,
    input.searchResultCount === 0 ? "openai-codex search smoke returned no results." : null
  ].filter((gap): gap is string => gap !== null);
  return gaps.length === 0 ? "Codex documentation index is ready and queryable." : gaps.join(" ");
}

function renderDocsReport(input: {
  status: "ready" | "failed";
  startedAt: Date;
  codexCliVersion: string | null;
  docsMcpVersion: string;
  storePath: string;
  indexedUrlList: string[];
  scrapeResults: Array<{ title: string; url: string; result: CommandResult }>;
  search: CommandResult;
  searchResultCount: number;
  gapReport: string;
}): string {
  return [
    "# Codex Documentation Index",
    "",
    `Generated: ${input.startedAt.toISOString()}`,
    `Status: ${input.status}`,
    `Index name: ${indexName}`,
    `Store path: ${input.storePath}`,
    `Codex CLI version: ${input.codexCliVersion ?? "unavailable"}`,
    `docs-mcp-server version: ${input.docsMcpVersion}`,
    `Document count: ${input.indexedUrlList.length}`,
    `Unique URL count: ${new Set(input.indexedUrlList).size}`,
    "",
    "## Indexed URLs",
    "",
    ...(input.indexedUrlList.length > 0
      ? input.indexedUrlList.map((url) => `- ${url}`)
      : ["- none"]),
    "",
    "## Search Smoke Test",
    "",
    `- Query: ${smokeQuery}`,
    `- Exit code: ${input.search.exitCode ?? "spawn_failed"}`,
    `- Result count: ${input.searchResultCount}`,
    `- Output: ${trim(input.search.stdout || input.search.stderr || input.search.error)}`,
    "",
    "## Scrape Results",
    "",
    ...input.scrapeResults.map(
      ({ title, url, result }) =>
        `- ${title}: ${result.exitCode === 0 ? "pass" : "fail"} (${url}) ${trim(
          result.stderr || result.error
        )}`
    ),
    "",
    "## Gap Report",
    "",
    input.gapReport,
    ""
  ].join("\n");
}

function trim(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 1000);
}

export async function docsMcpServerAvailable(): Promise<boolean> {
  const result = await runCommand("docs-mcp-server", ["--version"], {
    timeoutMs: 10_000
  });
  return commandSucceeded(result);
}

export async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
