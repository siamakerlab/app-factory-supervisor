import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../config.js";

export type RuntimePaths = {
  dataDir: string;
  projectsDir: string;
  artifactsDir: string;
  runsDir: string;
  logsDir: string;
  toolchainsDir: string;
  capabilitiesDir: string;
  secretsDir: string;
};

export function getRuntimePaths(config: AppConfig): RuntimePaths {
  return {
    dataDir: config.APP_DATA_DIR,
    projectsDir: config.APP_PROJECTS_DIR,
    artifactsDir: join(config.APP_DATA_DIR, "artifacts"),
    runsDir: join(config.APP_DATA_DIR, "runs"),
    logsDir: join(config.APP_DATA_DIR, "logs"),
    toolchainsDir: join(config.APP_DATA_DIR, "toolchains"),
    capabilitiesDir: join(config.APP_DATA_DIR, "capabilities"),
    secretsDir: join(config.APP_DATA_DIR, "secrets")
  };
}

export async function ensureRuntimeDirectories(paths: RuntimePaths): Promise<void> {
  await Promise.all(
    Object.values(paths).map((path) =>
      mkdir(path, {
        recursive: true,
        mode: 0o700
      })
    )
  );
}
