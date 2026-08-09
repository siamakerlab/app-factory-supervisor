import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import {
  allowedWorkerEnvironment,
  getSecurityIsolationStatus,
  workerAllowedEnvironmentKeys
} from "./isolation.js";

describe("security isolation", () => {
  it("does not expose app-global secret paths through normal worker configuration", () => {
    const status = getSecurityIsolationStatus(config("/tmp/afs-isolation"));

    expect(status.normalRunnerAccess.workerCannotReachAppSecretPathsThroughConfig).toBe(true);
    expect(status.normalRunnerAccess.appGlobalPathsAbsentFromWorkerEnv).toBe(true);
    expect(status.environmentAllowlist).not.toContain("APP_DATA_DIR");
    expect(status.environmentAllowlist).not.toContain("DATABASE_URL");
    expect(status.environmentAllowlist).not.toContain("AUTH_LOG_PATH");
  });

  it("uses the same worker environment allowlist enforced by the runner", () => {
    process.env.APP_DATA_DIR = "/tmp/app-secret-data";
    process.env.DATABASE_URL = "postgres://secret";
    process.env.AUTH_LOG_PATH = "/tmp/auth.log";
    process.env.PATH = "/usr/bin";

    const env = allowedWorkerEnvironment();

    expect(Object.keys(env).sort()).toEqual(
      workerAllowedEnvironmentKeys.filter((key) => process.env[key]).sort()
    );
    expect(env.APP_DATA_DIR).toBeUndefined();
    expect(env.DATABASE_URL).toBeUndefined();
    expect(env.AUTH_LOG_PATH).toBeUndefined();
  });
});

function config(root: string): AppConfig {
  return {
    NODE_ENV: "test",
    APP_HOST: "127.0.0.1",
    APP_PORT: 3000,
    DATABASE_URL: "postgres://app_factory:app_factory@localhost:5432/app_factory_supervisor",
    APP_DATA_DIR: join(root, "data"),
    APP_PROJECTS_DIR: join(root, "projects"),
    WEB_DIST_DIR: join(root, "dist"),
    AUTH_LOG_PATH: join(root, "data", "logs", "auth.log"),
    TRUST_PROXY: false,
    SESSION_COOKIE_NAME: "afs_session",
    SESSION_COOKIE_SECURE: false,
    SESSION_TTL_DAYS: 7
  };
}
