import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { CodexHookService } from "./hooks.js";

describe("CodexHookService", () => {
  it("installs app-managed Stop and SessionEnd hooks with metadata", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "afs-hooks-"));
    const service = new CodexHookService(fakeDatabase(), config(dataDir));

    const status = await service.installManagedHooks();
    const hooks = await readFile(status.hooksPath, "utf8");
    const configFile = await readFile(status.configPath, "utf8");

    expect(status.hooksOwner).toBe("app");
    expect(status.configOwner).toBe("app");
    expect(hooks).toContain("APP_FACTORY_SUPERVISOR_MANAGED");
    expect(hooks).toContain("\"Stop\"");
    expect(hooks).toContain("\"SessionEnd\"");
    expect(hooks).toContain("App Factory Supervisor");
    expect(hooks).toContain("codex-stop-hook");
    expect(configFile).toContain("APP_FACTORY_SUPERVISOR_MANAGED");
    expect(configFile).toContain("App-Version: 0.1.0");
  });

  it("detects user-owned hook conflicts unless force is used", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "afs-hooks-conflict-"));
    const codexHome = join(dataDir, "codex-home");
    await mkdir(codexHome, { recursive: true });
    await writeFile(join(codexHome, "hooks.json"), "{\"hooks\":{}}\n", "utf8");
    const service = new CodexHookService(fakeDatabase(), config(dataDir));

    const status = await service.installManagedHooks();

    expect(status.hooksOwner).toBe("user");
    expect(status.conflicts).toContain("hooks.json exists without app-managed marker");
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

function fakeDatabase(): Database {
  return {
    pool: {
      query: (sql: string) => {
        if (sql.includes("worker_poll_interval_seconds")) {
          return Promise.resolve({
            rows: [{ worker_poll_interval_seconds: 300 }],
            rowCount: 1
          });
        }
        if (sql.includes("from app_audit_events")) {
          return Promise.resolve({
            rows: [],
            rowCount: 0
          });
        }
        return Promise.resolve({ rows: [], rowCount: 1 });
      }
    } as Database["pool"],
    close: () => Promise.resolve(),
    ping: () => Promise.resolve()
  };
}
