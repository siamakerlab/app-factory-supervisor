import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute, relative, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";

export type ArtifactSummary = {
  id: string;
  projectId: string | null;
  runId: string | null;
  artifactType: string;
  path: string;
  sha256: string | null;
  sizeBytes: number | null;
  redacted: boolean;
  retentionClass: string;
  compressedAt: string | null;
  verifiedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  metadata: Record<string, unknown>;
};

export type ArtifactContent = {
  artifact: ArtifactSummary;
  filename: string;
  stream: NodeJS.ReadableStream;
};

type ArtifactRow = {
  id: string;
  project_id: string | null;
  run_id: string | null;
  artifact_type: string;
  path: string;
  sha256: string | null;
  size_bytes: string | number | null;
  redacted: boolean;
  retention_class: string;
  compressed_at: Date | null;
  verified_at: Date | null;
  deleted_at: Date | null;
  created_at: Date;
  metadata: Record<string, unknown>;
};

export class ArtifactService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async listRecent(input: { projectId?: string; limit?: number } = {}): Promise<ArtifactSummary[]> {
    const limit = Math.min(Math.max(input.limit ?? 20, 1), 100);
    const params: Array<string | number> = [limit];
    let where = "deleted_at is null";
    if (input.projectId) {
      params.push(input.projectId);
      where += ` and project_id = $${params.length}`;
    }
    const result = await this.database.pool.query<ArtifactRow>(
      `
        select *
        from artifacts
        where ${where}
        order by created_at desc
        limit $1
      `,
      params
    );
    return result.rows.map(mapArtifactRow);
  }

  async getArtifact(id: string): Promise<ArtifactSummary | null> {
    const result = await this.database.pool.query<ArtifactRow>(
      "select * from artifacts where id = $1 and deleted_at is null",
      [id]
    );
    return result.rows[0] ? mapArtifactRow(result.rows[0]) : null;
  }

  async openContent(id: string): Promise<ArtifactContent | null> {
    const artifact = await this.getArtifact(id);
    if (!artifact || artifact.redacted) {
      return null;
    }
    this.assertAllowedPath(artifact.path);
    const fileStats = await stat(artifact.path);
    if (!fileStats.isFile()) {
      return null;
    }
    if (artifact.sha256) {
      const actualHash = createHash("sha256").update(await readFile(artifact.path)).digest("hex");
      if (actualHash !== artifact.sha256) {
        throw new Error("artifact_hash_mismatch");
      }
      await this.database.pool.query("update artifacts set verified_at = now() where id = $1", [
        id
      ]);
    }
    return {
      artifact,
      filename: basename(artifact.path),
      stream: createReadStream(artifact.path)
    };
  }

  private assertAllowedPath(path: string): void {
    const realPath = resolve(path);
    const allowedRoots = [resolve(this.config.APP_DATA_DIR), resolve(this.config.APP_PROJECTS_DIR)];
    const allowed = allowedRoots.some((root) => {
      const pathRelativeToRoot = relative(root, realPath);
      return (
        pathRelativeToRoot === "" ||
        (!pathRelativeToRoot.startsWith("..") && !isAbsolute(pathRelativeToRoot))
      );
    });
    if (!allowed) {
      throw new Error("artifact_path_outside_allowed_roots");
    }
  }
}

function mapArtifactRow(row: ArtifactRow): ArtifactSummary {
  return {
    id: row.id,
    projectId: row.project_id,
    runId: row.run_id,
    artifactType: row.artifact_type,
    path: row.path,
    sha256: row.sha256,
    sizeBytes: row.size_bytes === null ? null : Number(row.size_bytes),
    redacted: row.redacted,
    retentionClass: row.retention_class,
    compressedAt: row.compressed_at?.toISOString() ?? null,
    verifiedAt: row.verified_at?.toISOString() ?? null,
    deletedAt: row.deleted_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    metadata: row.metadata
  };
}
