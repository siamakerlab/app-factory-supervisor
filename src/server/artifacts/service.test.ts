import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { ArtifactService } from "./service.js";

describe("ArtifactService", () => {
  it("rejects artifact content when the stored hash does not match the file", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "afs-artifacts-"));
    const artifactPath = join(dataDir, "report.txt");
    await writeFile(artifactPath, "changed", "utf8");
    const database = fakeDatabase({
      id: "artifact-1",
      project_id: null,
      run_id: null,
      artifact_type: "report",
      path: artifactPath,
      sha256: "0000",
      size_bytes: 7,
      redacted: false,
      retention_class: "run_log",
      compressed_at: null,
      verified_at: null,
      deleted_at: null,
      created_at: new Date("2026-08-09T00:00:00.000Z"),
      metadata: {}
    });
    const service = new ArtifactService(database, config(dataDir));

    await expect(service.openContent("artifact-1")).rejects.toThrow("artifact_hash_mismatch");
  });
});

function config(dataDir: string): AppConfig {
  return {
    NODE_ENV: "test",
    APP_HOST: "0.0.0.0",
    APP_PORT: 3000,
    DATABASE_URL: "postgres://example",
    APP_DATA_DIR: dataDir,
    APP_PROJECTS_DIR: join(dataDir, "projects"),
    WEB_DIST_DIR: "dist/web",
    AUTH_LOG_PATH: join(dataDir, "auth.log"),
    TRUST_PROXY: false,
    SESSION_COOKIE_NAME: "afs_session",
    SESSION_COOKIE_SECURE: false,
    SESSION_TTL_DAYS: 7
  };
}

function fakeDatabase(row: unknown): Database {
  return {
    pool: {
      query: (sql: string) => {
        if (sql.startsWith("select * from artifacts")) {
          return Promise.resolve({
            rows: [row],
            rowCount: 1
          });
        }
        return Promise.resolve({
          rows: [],
          rowCount: 0
        });
      }
    } as Database["pool"],
    close: () => Promise.resolve(),
    ping: () => Promise.resolve()
  };
}
