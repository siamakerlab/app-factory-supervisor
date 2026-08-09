import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

export type ProjectExportSummary = {
  id: string;
  projectId: string;
  status: "queued" | "running" | "ready" | "failed" | "expired" | "deleted";
  exportType: "full_project_archive";
  includeIgnoredFiles: boolean;
  includeKeystores: boolean;
  artifactId: string | null;
  fileCount: number | null;
  sizeBytes: number | null;
  sha256: string | null;
  errorSummary: string | null;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  expiresAt: string | null;
};

export type ProjectExportContent = {
  exportRecord: ProjectExportSummary;
  filename: string;
  stream: NodeJS.ReadableStream;
};

type ProjectRow = {
  id: string;
  project_name: string;
  project_dir: string;
};

type ExportRow = {
  id: string;
  project_id: string;
  status: ProjectExportSummary["status"];
  export_type: "full_project_archive";
  include_ignored_files: boolean;
  include_keystores: boolean;
  artifact_id: string | null;
  file_count: number | null;
  size_bytes: string | number | null;
  sha256: string | null;
  error_summary: string | null;
  requested_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
  expires_at: Date | null;
};

type ArtifactRow = {
  path: string;
  sha256: string | null;
  redacted: boolean;
  deleted_at: Date | null;
};

type ExportTimeoutRow = {
  export_timeout_seconds: number;
};

export class ProjectExportService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async listProjectExports(projectId: string): Promise<ProjectExportSummary[]> {
    const result = await this.database.pool.query<ExportRow>(
      `
        select *
        from project_exports
        where project_id = $1
        order by requested_at desc
        limit 20
      `,
      [projectId]
    );
    return result.rows.map(mapExportRow);
  }

  async listRecentExports(limit = 20): Promise<ProjectExportSummary[]> {
    const result = await this.database.pool.query<ExportRow>(
      `
        select *
        from project_exports
        order by requested_at desc
        limit $1
      `,
      [Math.min(Math.max(limit, 1), 100)]
    );
    return result.rows.map(mapExportRow);
  }

  async requestFullExport(projectId: string, requestedByUserId: string | null): Promise<ProjectExportSummary> {
    const project = await this.getProject(projectId);
    this.assertProjectPath(project.project_dir);
    const id = randomUUID();
    const exportDir = join(getRuntimePaths(this.config).artifactsDir, "project-exports", projectId);
    await mkdir(exportDir, { recursive: true, mode: 0o700 });
    const zipPath = join(exportDir, `${safeName(project.project_name)}-${id}.zip`);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    const timeoutMs = await this.getExportTimeoutMs();

    await this.database.pool.query(
      `
        insert into project_exports (
          id, project_id, requested_by_user_id, status, export_type,
          include_ignored_files, include_keystores, requested_at, expires_at
        )
        values ($1, $2, $3, 'queued', 'full_project_archive', true, true, now(), $4)
      `,
      [id, projectId, requestedByUserId, expiresAt]
    );

    await this.database.pool.query(
      "update project_exports set status = 'running', started_at = now() where id = $1",
      [id]
    );

    try {
      const fileCount = await countFiles(project.project_dir);
      const zip = await runCommand("zip", ["-r", "-q", zipPath, "."], {
        cwd: project.project_dir,
        timeoutMs
      });
      if (zip.exitCode !== 0) {
        throw new Error(zip.output || "zip command failed");
      }
      const fileStats = await stat(zipPath);
      const sha256 = createHash("sha256").update(await readFile(zipPath)).digest("hex");
      const artifactId = randomUUID();
      await this.database.pool.query(
        `
          insert into artifacts (
            id, project_id, artifact_type, path, sha256, size_bytes, redacted,
            retention_class, metadata, created_at
          )
          values ($1, $2, 'project_export', $3, $4, $5, true, 'project_export', $6, now())
        `,
        [
          artifactId,
          projectId,
          zipPath,
          sha256,
          fileStats.size,
          JSON.stringify({
            exportId: id,
            includeIgnoredFiles: true,
            includeKeystores: true,
            source: "filesystem_project_root"
          })
        ]
      );
      await this.database.pool.query(
        `
          update project_exports
          set status = 'ready',
              artifact_id = $2,
              file_count = $3,
              size_bytes = $4,
              sha256 = $5,
              finished_at = now()
          where id = $1
        `,
        [id, artifactId, fileCount, fileStats.size, sha256]
      );
    } catch (error) {
      await this.database.pool.query(
        `
          update project_exports
          set status = 'failed',
              error_summary = $2,
              finished_at = now()
          where id = $1
        `,
        [id, error instanceof Error ? error.message.slice(0, 2000) : "unknown export error"]
      );
    }

    const exportRecord = await this.getExport(id);
    if (!exportRecord) {
      throw new Error("project_export_missing_after_create");
    }
    return exportRecord;
  }

  async getExport(id: string): Promise<ProjectExportSummary | null> {
    const result = await this.database.pool.query<ExportRow>(
      "select * from project_exports where id = $1",
      [id]
    );
    return result.rows[0] ? mapExportRow(result.rows[0]) : null;
  }

  async openExportContent(id: string): Promise<ProjectExportContent | null> {
    const exportRecord = await this.getExport(id);
    if (!exportRecord || exportRecord.status !== "ready" || !exportRecord.artifactId) {
      return null;
    }
    if (exportRecord.expiresAt && new Date(exportRecord.expiresAt).getTime() <= Date.now()) {
      await this.database.pool.query("update project_exports set status = 'expired' where id = $1", [
        id
      ]);
      return null;
    }
    const artifactResult = await this.database.pool.query<ArtifactRow>(
      "select path, sha256, redacted, deleted_at from artifacts where id = $1",
      [exportRecord.artifactId]
    );
    const artifact = artifactResult.rows[0];
    if (!artifact || artifact.deleted_at) {
      return null;
    }
    this.assertArtifactPath(artifact.path);
    const actualHash = createHash("sha256").update(await readFile(artifact.path)).digest("hex");
    if (artifact.sha256 && artifact.sha256 !== actualHash) {
      throw new Error("project_export_hash_mismatch");
    }
    await this.database.pool.query("update artifacts set verified_at = now() where id = $1", [
      exportRecord.artifactId
    ]);
    return {
      exportRecord,
      filename: basename(artifact.path),
      stream: createReadStream(artifact.path)
    };
  }

  async deleteExport(id: string): Promise<ProjectExportSummary | null> {
    const exportRecord = await this.getExport(id);
    if (!exportRecord) {
      return null;
    }
    await this.database.pool.query(
      `
        update project_exports
        set status = 'deleted',
            finished_at = coalesce(finished_at, now())
        where id = $1
      `,
      [id]
    );
    if (exportRecord.artifactId) {
      await this.database.pool.query("update artifacts set deleted_at = now() where id = $1", [
        exportRecord.artifactId
      ]);
    }
    return this.getExport(id);
  }

  private async getProject(projectId: string): Promise<ProjectRow> {
    const result = await this.database.pool.query<ProjectRow>(
      "select id, project_name, project_dir from projects where id = $1",
      [projectId]
    );
    const project = result.rows[0];
    if (!project) {
      throw new Error("project_not_found");
    }
    return project;
  }

  private async getExportTimeoutMs(): Promise<number> {
    const result = await this.database.pool.query<ExportTimeoutRow>(
      "select export_timeout_seconds from app_settings where id = true"
    );
    return (result.rows[0]?.export_timeout_seconds ?? 1800) * 1000;
  }

  private assertProjectPath(path: string): void {
    assertInsideRoot(path, this.config.APP_PROJECTS_DIR, "project_path_outside_workspace");
  }

  private assertArtifactPath(path: string): void {
    assertInsideRoot(path, this.config.APP_DATA_DIR, "project_export_artifact_outside_data");
  }
}

function mapExportRow(row: ExportRow): ProjectExportSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    status: row.status,
    exportType: row.export_type,
    includeIgnoredFiles: row.include_ignored_files,
    includeKeystores: row.include_keystores,
    artifactId: row.artifact_id,
    fileCount: row.file_count,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    sha256: row.sha256,
    errorSummary: row.error_summary,
    requestedAt: row.requested_at.toISOString(),
    startedAt: row.started_at?.toISOString() ?? null,
    finishedAt: row.finished_at?.toISOString() ?? null,
    expiresAt: row.expires_at?.toISOString() ?? null
  };
}

async function countFiles(root: string): Promise<number> {
  let count = 0;
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      count += await countFiles(fullPath);
    } else if (entry.isFile()) {
      count += 1;
    }
  }
  return count;
}

function safeName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "project";
}

export function assertInsideRoot(path: string, root: string, errorMessage: string): void {
  const absolutePath = resolve(path);
  const absoluteRoot = resolve(root);
  const relativePath = relative(absoluteRoot, absolutePath);
  if (relativePath.startsWith("..") || resolve(relativePath) === relativePath) {
    throw new Error(errorMessage);
  }
}

function runCommand(
  command: string,
  args: string[],
  options: {
    cwd: string;
    timeoutMs: number;
  }
): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => child.kill("SIGTERM"), options.timeoutMs);
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
