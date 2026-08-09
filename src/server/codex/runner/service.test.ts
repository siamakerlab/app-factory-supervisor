import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../../config.js";
import type { Database } from "../../db/client.js";
import { CodexRunnerService } from "./service.js";

describe("CodexRunnerService", () => {
  it("builds codex exec JSON mode commands with yolo and output artifacts", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "afs-codex-runner-"));
    const projectDir = await mkdtemp(join(tmpdir(), "afs-project-"));
    const service = new CodexRunnerService(fakeDatabase(projectDir), config(dataDir, projectDir));

    const command = await service.buildCommand({
      projectId: "11111111-1111-4111-8111-111111111111",
      role: "worker",
      prompt: "Do a small task."
    });

    expect(command.command).toBe("codex");
    expect(command.args).toContain("exec");
    expect(command.args).toContain("--json");
    expect(command.args).toContain("--yolo");
    expect(command.args).toContain("--dangerously-bypass-hook-trust");
    expect(command.args).toContain("--output-schema");
    expect(command.args).toContain("--output-last-message");
    expect(command.args).toContain("-C");
    expect(command.args).toContain(projectDir);
    expect(command.jsonlPath).toContain("worker-1");
    const schema = JSON.parse(await readFile(command.schemaPath, "utf8")) as {
      required: string[];
      properties: Record<string, unknown>;
    };
    expect(schema.required).toContain("taskType");
    expect(schema.required).toContain("suggestedOptions");
    expect(schema.properties.suggestedOptions).toBeTruthy();
  });
});

function config(dataDir: string, projectDir: string): AppConfig {
  return {
    NODE_ENV: "test",
    APP_HOST: "0.0.0.0",
    APP_PORT: 3000,
    DATABASE_URL: "postgres://example",
    APP_DATA_DIR: dataDir,
    APP_PROJECTS_DIR: projectDir,
    WEB_DIST_DIR: "dist/web",
    AUTH_LOG_PATH: join(dataDir, "auth.log"),
    TRUST_PROXY: false,
    SESSION_COOKIE_NAME: "afs_session",
    SESSION_COOKIE_SECURE: false,
    SESSION_TTL_DAYS: 7
  };
}

function fakeDatabase(projectDir: string): Database {
  return {
    pool: {
      query: (sql: string) => {
        if (sql.includes("from projects")) {
          return Promise.resolve({
            rows: [{ id: "11111111-1111-4111-8111-111111111111", project_dir: projectDir }],
            rowCount: 1
          });
        }
        if (sql.includes("max(iteration)")) {
          return Promise.resolve({
            rows: [{ next_iteration: 1 }],
            rowCount: 1
          });
        }
        if (sql.includes("codex_turn_timeout_seconds")) {
          return Promise.resolve({
            rows: [{ codex_turn_timeout_seconds: 3600 }],
            rowCount: 1
          });
        }
        return Promise.resolve({ rows: [], rowCount: 0 });
      }
    } as Database["pool"],
    close: () => Promise.resolve(),
    ping: () => Promise.resolve()
  };
}
