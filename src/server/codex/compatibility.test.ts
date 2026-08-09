import { describe, expect, it } from "vitest";

import { CodexCompatibilityService } from "./compatibility.js";
import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";

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

describe("CodexCompatibilityService", () => {
  it("marks the build environment not ready before the first review", async () => {
    const service = new CodexCompatibilityService(
      {
        pool: {
          query: () => Promise.resolve({ rows: [] })
        },
        close: () => Promise.resolve(),
        ping: () => Promise.resolve()
      } as unknown as Database,
      config
    );

    const review = await service.getLatestReview();

    expect(review.status).toBe("not_run");
    expect(review.buildEnvironmentReady).toBe(false);
    expect(review.codexAuthUsable).toBe(false);
    expect(review.ownership.codexHomeDir).not.toContain(config.APP_PROJECTS_DIR);
  });
});
