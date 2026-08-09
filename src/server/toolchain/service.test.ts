import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { ToolchainService } from "./service.js";

const config: AppConfig = {
  NODE_ENV: "test",
  APP_HOST: "127.0.0.1",
  APP_PORT: 3000,
  DATABASE_URL: "postgres://example",
  APP_DATA_DIR: "/tmp/app-factory-test-data",
  APP_PROJECTS_DIR: "/tmp/app-factory-test-projects",
  WEB_DIST_DIR: "./dist/web",
  AUTH_LOG_PATH: "/tmp/app-factory-test-data/logs/auth.log",
  TRUST_PROXY: false,
  SESSION_COOKIE_NAME: "afs_session",
  SESSION_COOKIE_SECURE: false,
  SESSION_TTL_DAYS: 7
};

describe("ToolchainService", () => {
  it("reports no snapshot before the first installer run", async () => {
    const service = new ToolchainService(
      {
        pool: {
          query: () => Promise.resolve({ rows: [] })
        },
        close: () => Promise.resolve(),
        ping: () => Promise.resolve()
      } as unknown as Database,
      config
    );

    const status = await service.getStatus();

    expect(status.status).toBe("not_started");
    expect(status.latestSnapshot).toBeNull();
    expect(status.steps.map((step) => step.id)).toContain("android-sdk-packages");
    expect(status.steps.map((step) => step.id)).toContain("avd");
  });
});
