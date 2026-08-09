import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

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
  codexHomeDir: string;
  codexSchemaDir: string;
  codexSmokeDir: string;
  codexCompatibilityReportPath: string;
};

export function getRuntimePaths(config: AppConfig): RuntimePaths {
  const codexHomeDir = config.CODEX_HOME_DIR ?? join(config.APP_DATA_DIR, "codex-home");
  const codexSchemaDir = config.CODEX_SCHEMA_DIR ?? join(config.APP_DATA_DIR, "codex-schemas", "current");
  const codexSmokeDir = config.CODEX_SMOKE_DIR ?? join(config.APP_DATA_DIR, "runs", "codex-smoke");
  const codexCompatibilityReportPath =
    config.CODEX_COMPATIBILITY_REPORT_PATH ??
    join(config.APP_DATA_DIR, "artifacts", "codex-compatibility-review.md");

  return {
    dataDir: config.APP_DATA_DIR,
    projectsDir: config.APP_PROJECTS_DIR,
    artifactsDir: join(config.APP_DATA_DIR, "artifacts"),
    runsDir: join(config.APP_DATA_DIR, "runs"),
    logsDir: join(config.APP_DATA_DIR, "logs"),
    toolchainsDir: join(config.APP_DATA_DIR, "toolchains"),
    capabilitiesDir: join(config.APP_DATA_DIR, "capabilities"),
    secretsDir: join(config.APP_DATA_DIR, "secrets"),
    codexHomeDir,
    codexSchemaDir,
    codexSmokeDir,
    codexCompatibilityReportPath
  };
}

export async function ensureRuntimeDirectories(paths: RuntimePaths): Promise<void> {
  const directories = [
    paths.dataDir,
    paths.projectsDir,
    paths.artifactsDir,
    paths.runsDir,
    paths.logsDir,
    paths.toolchainsDir,
    paths.capabilitiesDir,
    paths.secretsDir,
    paths.codexHomeDir,
    paths.codexSchemaDir,
    paths.codexSmokeDir,
    dirname(paths.codexCompatibilityReportPath)
  ];

  await Promise.all(
    directories.map((path) =>
      mkdir(path, {
        recursive: true,
        mode: 0o700
      })
    )
  );
}
