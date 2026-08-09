import { relative, resolve } from "node:path";

import type { AppConfig } from "../config.js";
import { getRuntimePaths } from "../runtime/paths.js";

export const workerAllowedEnvironmentKeys = [
  "PATH",
  "HOME",
  "USER",
  "LOGNAME",
  "SHELL",
  "LANG",
  "LC_ALL",
  "TERM",
  "CODEX_HOME",
  "OPENAI_API_KEY",
  "ANDROID_HOME",
  "ANDROID_SDK_ROOT",
  "ANDROID_AVD_HOME",
  "JAVA_HOME",
  "GRADLE_USER_HOME"
] as const;

export type WorkerAllowedEnvironmentKey = (typeof workerAllowedEnvironmentKeys)[number];
export type IsolationGuardStatus = "pass" | "warn" | "fail";

export type SecurityIsolationStatus = {
  status: IsolationGuardStatus;
  workerModel: "same_container_child_process";
  projectWorkspaceRoot: string;
  appDataDir: string;
  codexHomeDir: string;
  appSecretsDir: string;
  environmentAllowlist: WorkerAllowedEnvironmentKey[];
  deniedAppGlobalPaths: string[];
  normalRunnerAccess: {
    workerCannotReachAppSecretPathsThroughConfig: boolean;
    appGlobalPathsAbsentFromWorkerEnv: boolean;
    projectWorkspaceDedicated: boolean;
  };
  guards: Array<{
    id: string;
    label: string;
    status: IsolationGuardStatus;
    detail: string;
  }>;
  limitations: string[];
};

const deniedEnvironmentKeys = [
  "APP_DATA_DIR",
  "APP_PROJECTS_DIR",
  "DATABASE_URL",
  "AUTH_LOG_PATH",
  "SESSION_COOKIE_NAME",
  "SESSION_TTL_DAYS"
];

export function allowedWorkerEnvironment(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    workerAllowedEnvironmentKeys
      .map((key) => [key, process.env[key]])
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
  );
}

export function getSecurityIsolationStatus(config: AppConfig): SecurityIsolationStatus {
  const paths = getRuntimePaths(config);
  const appDataDir = resolve(paths.dataDir);
  const projectWorkspaceRoot = resolve(paths.projectsDir);
  const codexHomeDir = resolve(paths.codexHomeDir);
  const appSecretsDir = resolve(paths.secretsDir);
  const deniedAppGlobalPaths = [
    appSecretsDir,
    resolve(config.AUTH_LOG_PATH),
    resolve(paths.artifactsDir),
    resolve(paths.logsDir)
  ];
  const exposedDeniedEnvKeys = deniedEnvironmentKeys.filter((key) =>
    workerAllowedEnvironmentKeys.includes(key as WorkerAllowedEnvironmentKey)
  );
  const projectWorkspaceDedicated =
    projectWorkspaceRoot !== appDataDir &&
    !isInside(projectWorkspaceRoot, appSecretsDir) &&
    !isInside(appSecretsDir, projectWorkspaceRoot);
  const appGlobalPathsAbsentFromWorkerEnv = exposedDeniedEnvKeys.length === 0;
  const workerCannotReachAppSecretPathsThroughConfig =
    projectWorkspaceDedicated && appGlobalPathsAbsentFromWorkerEnv;

  const guards: SecurityIsolationStatus["guards"] = [
    {
      id: "project-workspace",
      label: "Dedicated project workspace",
      status: projectWorkspaceDedicated ? "pass" : "fail",
      detail: projectWorkspaceDedicated
        ? "Worker cwd is configured under the project workspace, separate from app data and secrets."
        : "Project workspace overlaps with app data or secrets and must be moved before automation."
    },
    {
      id: "worker-env-allowlist",
      label: "Worker environment allowlist",
      status: appGlobalPathsAbsentFromWorkerEnv ? "pass" : "fail",
      detail: appGlobalPathsAbsentFromWorkerEnv
        ? "Worker env excludes app data, database, auth log, and session configuration paths."
        : `Worker env exposes denied keys: ${exposedDeniedEnvKeys.join(", ")}.`
    },
    {
      id: "app-secret-paths",
      label: "App-global secret paths",
      status: workerCannotReachAppSecretPathsThroughConfig ? "pass" : "fail",
      detail: workerCannotReachAppSecretPathsThroughConfig
        ? "Normal runner configuration does not pass app-global secret paths to the worker."
        : "Normal runner configuration may expose app-global secret paths."
    },
    {
      id: "codex-home",
      label: "App-managed Codex home",
      status: isInside(codexHomeDir, appDataDir) ? "warn" : "pass",
      detail: "Codex home is app-managed and must be treated as read-only credentials where possible."
    },
    {
      id: "same-container-limit",
      label: "Same-container boundary",
      status: "warn",
      detail: "The same-container worker model is guarded by configuration, not by a hard kernel sandbox."
    }
  ];

  return {
    status: guards.some((guard) => guard.status === "fail")
      ? "fail"
      : guards.some((guard) => guard.status === "warn")
        ? "warn"
        : "pass",
    workerModel: "same_container_child_process",
    projectWorkspaceRoot,
    appDataDir,
    codexHomeDir,
    appSecretsDir,
    environmentAllowlist: [...workerAllowedEnvironmentKeys],
    deniedAppGlobalPaths,
    normalRunnerAccess: {
      workerCannotReachAppSecretPathsThroughConfig,
      appGlobalPathsAbsentFromWorkerEnv,
      projectWorkspaceDedicated
    },
    guards,
    limitations: [
      "Codex runs with --yolo inside the same container, so OS-level isolation is not provided by this MVP.",
      "Hooks are callbacks and advisory guardrails; missing hooks must not be treated as a security boundary.",
      "Users should deploy the app in an isolated host or container and avoid mounting host secrets into project workspaces.",
      "External credentials, store assets, policy URLs, and real ad/API identifiers remain user-managed production tasks."
    ]
  };
}

function isInside(candidate: string, root: string): boolean {
  const relationship = relative(root, candidate);
  return relationship === "" || (!relationship.startsWith("..") && !relationship.startsWith("/"));
}
