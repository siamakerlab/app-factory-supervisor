import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

type InstallStatus = "not_started" | "running" | "succeeded" | "failed";
type StepStatus = "pending" | "running" | "pass" | "fail" | "skipped";

export type ToolchainInstallStep = {
  id: string;
  label: string;
  status: StepStatus;
  command: string;
  output: string;
  startedAt: string | null;
  finishedAt: string | null;
};

export type ToolchainStatus = {
  installRunId: string | null;
  status: InstallStatus;
  installRoot: string;
  androidHome: string;
  gradleHome: string;
  avdHome: string;
  steps: ToolchainInstallStep[];
  resolvedVersions: Record<string, string | null>;
  verification: ToolchainInstallStep[];
  latestSnapshot: {
    id: string;
    snapshotName: string;
    androidPlatformVersion: string;
    androidBuildToolsVersion: string;
    gradleVersion: string;
    jdkVersion: string;
    emulatorImage: string | null;
    createdAt: string;
  } | null;
  artifactPath: string | null;
  errorSummary: string | null;
  startedAt: string | null;
  finishedAt: string | null;
};

type InstallRunRow = {
  id: string;
  status: InstallStatus;
  install_root: string;
  android_home: string;
  gradle_home: string;
  avd_home: string;
  steps: ToolchainInstallStep[];
  resolved_versions: Record<string, string | null>;
  verification: ToolchainInstallStep[];
  snapshot_id: string | null;
  artifact_path: string | null;
  error_summary: string | null;
  started_at: Date;
  finished_at: Date | null;
};

type SnapshotRow = {
  id: string;
  snapshot_name: string;
  android_platform_version: string;
  android_build_tools_version: string;
  gradle_version: string;
  jdk_version: string;
  emulator_image: string | null;
  created_at: Date;
};

type CommandResult = {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error: string | null;
  timedOut: boolean;
};

type InstallerPaths = {
  installRoot: string;
  androidHome: string;
  cmdlineToolsDir: string;
  gradleHome: string;
  avdHome: string;
  reportPath: string;
};

const commandLineToolsUrl =
  "https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip";

const targetAvdName = "app_factory_phone_api_auto";

export class ToolchainService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getStatus(): Promise<ToolchainStatus> {
    const [run, snapshot] = await Promise.all([this.getLatestRun(), this.getLatestSnapshot()]);
    if (!run) {
      return this.emptyStatus(snapshot);
    }
    return {
      installRunId: run.id,
      status: run.status,
      installRoot: run.install_root,
      androidHome: run.android_home,
      gradleHome: run.gradle_home,
      avdHome: run.avd_home,
      steps: run.steps,
      resolvedVersions: run.resolved_versions,
      verification: run.verification,
      latestSnapshot: snapshot,
      artifactPath: run.artifact_path,
      errorSummary: run.error_summary,
      startedAt: run.started_at.toISOString(),
      finishedAt: run.finished_at?.toISOString() ?? null
    };
  }

  async install(): Promise<ToolchainStatus> {
    const paths = this.getInstallerPaths();
    await Promise.all([
      mkdir(paths.installRoot, { recursive: true, mode: 0o700 }),
      mkdir(paths.androidHome, { recursive: true, mode: 0o700 }),
      mkdir(paths.avdHome, { recursive: true, mode: 0o700 })
    ]);

    const installRunId = randomUUID();
    const steps = createInstallSteps(paths);
    await this.insertRun(installRunId, "running", paths, steps);

    const isRootCapable = typeof process.getuid !== "function" || process.getuid() === 0;
    if (!isRootCapable) {
      const failedSteps = markFailed(
        steps,
        "preflight-root",
        "Toolchain installer requires a root-capable container because first-run setup installs OS packages."
      );
      await writeFile(paths.reportPath, renderReport("failed", failedSteps, [], {}, null), "utf8");
      const artifactId = await this.insertArtifact("toolchain_install_report", paths.reportPath, {
        status: "failed"
      });
      await this.finishRun(installRunId, {
        status: "failed",
        steps: failedSteps,
        verification: [],
        resolvedVersions: {},
        snapshotId: null,
        artifactId,
        errorSummary: "Toolchain installer requires a root-capable container."
      });
      return this.getStatus();
    }

    const env = this.commandEnv(paths);
    const completedSteps: ToolchainInstallStep[] = [];
    let failed = false;
    for (const step of steps) {
      const completed = await this.runStep(step, env);
      completedSteps.push(completed);
      await this.updateRunSteps(installRunId, completedSteps.concat(steps.slice(completedSteps.length)));
      if (completed.status === "fail") {
        failed = true;
        break;
      }
    }

    const resolvedVersions = failed ? {} : await this.resolveVersions(paths);
    const verification = failed ? [] : await this.verify(paths);
    const verificationFailed = verification.some((step) => step.status === "fail");
    const status: InstallStatus = failed || verificationFailed ? "failed" : "succeeded";
    const snapshotId =
      status === "succeeded" ? await this.createSnapshot(resolvedVersions, verification) : null;
    await writeFile(
      paths.reportPath,
      renderReport(status, completedSteps, verification, resolvedVersions, snapshotId),
      "utf8"
    );
    const artifactId = await this.insertArtifact("toolchain_install_report", paths.reportPath, {
      status,
      snapshotId
    });
    await this.finishRun(installRunId, {
      status,
      steps: completedSteps.concat(
        steps.slice(completedSteps.length).map((step) => ({ ...step, status: "skipped" as const }))
      ),
      verification,
      resolvedVersions,
      snapshotId,
      artifactId,
      errorSummary:
        status === "succeeded"
          ? null
          : "Android toolchain install or verification failed. See install report artifact."
    });
    return this.getStatus();
  }

  private getInstallerPaths(): InstallerPaths {
    const runtimePaths = getRuntimePaths(this.config);
    const installRoot = runtimePaths.toolchainsDir;
    const androidHome = join(installRoot, "android-sdk");
    return {
      installRoot,
      androidHome,
      cmdlineToolsDir: join(androidHome, "cmdline-tools", "latest"),
      gradleHome: join(installRoot, "gradle"),
      avdHome: join(installRoot, "avd"),
      reportPath: join(runtimePaths.artifactsDir, "toolchain-install-report.md")
    };
  }

  private commandEnv(paths: InstallerPaths): NodeJS.ProcessEnv {
    return {
      ...process.env,
      ANDROID_HOME: paths.androidHome,
      ANDROID_SDK_ROOT: paths.androidHome,
      ANDROID_AVD_HOME: paths.avdHome,
      PATH: [
        join(paths.androidHome, "platform-tools"),
        join(paths.cmdlineToolsDir, "bin"),
        join(paths.androidHome, "emulator"),
        join(paths.gradleHome, "bin"),
        process.env.PATH ?? ""
      ].join(":")
    };
  }

  private async runStep(step: ToolchainInstallStep, env: NodeJS.ProcessEnv): Promise<ToolchainInstallStep> {
    const startedAt = new Date().toISOString();
    const result = await runCommand("bash", ["-c", step.command], {
      env,
      timeoutMs: 20 * 60 * 1000
    });
    return {
      ...step,
      status: result.exitCode === 0 ? "pass" : "fail",
      output: trim([result.stdout, result.stderr, result.error].filter(Boolean).join("\n")),
      startedAt,
      finishedAt: new Date().toISOString()
    };
  }

  private async resolveVersions(paths: InstallerPaths): Promise<Record<string, string | null>> {
    const env = this.commandEnv(paths);
    const [sdkList, gradle, java, adb, emulator] = await Promise.all([
      runCommand("bash", ["-c", "sdkmanager --list_installed"], { env, timeoutMs: 60_000 }),
      runCommand("bash", ["-c", "gradle --version"], { env, timeoutMs: 30_000 }),
      runCommand("bash", ["-c", "java -version"], { env, timeoutMs: 30_000 }),
      runCommand("bash", ["-c", "adb version"], { env, timeoutMs: 30_000 }),
      runCommand("bash", ["-c", "emulator -version"], { env, timeoutMs: 30_000 })
    ]);
    const installed = `${sdkList.stdout}\n${sdkList.stderr}`;
    return {
      androidPlatform: match(installed, /platforms;android-(\d+)/),
      androidBuildTools: match(installed, /build-tools;([0-9.]+)/),
      androidCmdlineTools: match(installed, /cmdline-tools;latest\s*\|\s*([^\n]+)/),
      emulatorImage: match(installed, /(system-images;android-\d+;google_apis;[^\s|]+)/),
      gradle: match(`${gradle.stdout}\n${gradle.stderr}`, /Gradle\s+([0-9.]+)/),
      jdk: match(`${java.stdout}\n${java.stderr}`, /version "([^"]+)"/),
      adb: firstLine(adb.stdout || adb.stderr),
      emulator: firstLine(emulator.stdout || emulator.stderr)
    };
  }

  private async verify(paths: InstallerPaths): Promise<ToolchainInstallStep[]> {
    const env = this.commandEnv(paths);
    const definitions = [
      ["java", "java -version"],
      ["gradle", "gradle --version"],
      ["sdkmanager", "sdkmanager --list_installed"],
      ["adb", "adb version"],
      ["emulator", "emulator -version"],
      ["avdmanager", "avdmanager list avd"],
      ["debug-keystore", `test -f "${join(paths.installRoot, "debug.keystore")}"`]
    ] as const;
    const results: ToolchainInstallStep[] = [];
    for (const [id, command] of definitions) {
      const startedAt = new Date().toISOString();
      const result = await runCommand("bash", ["-c", command], {
        env,
        timeoutMs: 60_000
      });
      results.push({
        id,
        label: command,
        command,
        status: result.exitCode === 0 ? "pass" : "fail",
        output: trim([result.stdout, result.stderr, result.error].filter(Boolean).join("\n")),
        startedAt,
        finishedAt: new Date().toISOString()
      });
    }
    return results;
  }

  private async createSnapshot(
    versions: Record<string, string | null>,
    verification: ToolchainInstallStep[]
  ): Promise<string> {
    const id = randomUUID();
    const androidPlatform = versions.androidPlatform ?? "unknown";
    const androidBuildTools = versions.androidBuildTools ?? "unknown";
    const gradle = versions.gradle ?? "unknown";
    const jdk = versions.jdk ?? "unknown";
    await this.database.pool.query(
      `
        insert into toolchain_snapshots (
          id,
          snapshot_name,
          android_platform_version,
          android_build_tools_version,
          android_cmdline_tools_version,
          gradle_version,
          jdk_version,
          emulator_image,
          metadata,
          created_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
      `,
      [
        id,
        `android-${androidPlatform}-gradle-${gradle}`,
        androidPlatform,
        androidBuildTools,
        versions.androidCmdlineTools ?? null,
        gradle,
        jdk,
        versions.emulatorImage ?? null,
        JSON.stringify({
          verification,
          resolvedVersions: versions
        })
      ]
    );
    return id;
  }

  private async getLatestRun(): Promise<InstallRunRow | null> {
    const result = await this.database.pool.query<InstallRunRow>(
      `
        select r.*, a.path as artifact_path
        from toolchain_install_runs r
        left join artifacts a on a.id = r.artifact_id
        order by r.started_at desc
        limit 1
      `
    );
    return result.rows[0] ?? null;
  }

  private async getLatestSnapshot() {
    const result = await this.database.pool.query<SnapshotRow>(
      `
        select *
        from toolchain_snapshots
        order by created_at desc
        limit 1
      `
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      id: row.id,
      snapshotName: row.snapshot_name,
      androidPlatformVersion: row.android_platform_version,
      androidBuildToolsVersion: row.android_build_tools_version,
      gradleVersion: row.gradle_version,
      jdkVersion: row.jdk_version,
      emulatorImage: row.emulator_image,
      createdAt: row.created_at.toISOString()
    };
  }

  private emptyStatus(snapshot: ToolchainStatus["latestSnapshot"]): ToolchainStatus {
    const paths = this.getInstallerPaths();
    return {
      installRunId: null,
      status: "not_started",
      installRoot: paths.installRoot,
      androidHome: paths.androidHome,
      gradleHome: paths.gradleHome,
      avdHome: paths.avdHome,
      steps: createInstallSteps(paths),
      resolvedVersions: {},
      verification: [],
      latestSnapshot: snapshot,
      artifactPath: null,
      errorSummary: null,
      startedAt: null,
      finishedAt: null
    };
  }

  private async insertRun(
    id: string,
    status: InstallStatus,
    paths: InstallerPaths,
    steps: ToolchainInstallStep[]
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into toolchain_install_runs (
          id, status, install_root, android_home, gradle_home, avd_home, steps, started_at
        )
        values ($1, $2, $3, $4, $5, $6, $7, now())
      `,
      [
        id,
        status,
        paths.installRoot,
        paths.androidHome,
        paths.gradleHome,
        paths.avdHome,
        JSON.stringify(steps)
      ]
    );
  }

  private async updateRunSteps(id: string, steps: ToolchainInstallStep[]): Promise<void> {
    await this.database.pool.query("update toolchain_install_runs set steps = $1 where id = $2", [
      JSON.stringify(steps),
      id
    ]);
  }

  private async finishRun(
    id: string,
    input: {
      status: InstallStatus;
      steps: ToolchainInstallStep[];
      verification: ToolchainInstallStep[];
      resolvedVersions: Record<string, string | null>;
      snapshotId: string | null;
      artifactId: string;
      errorSummary: string | null;
    }
  ): Promise<void> {
    await this.database.pool.query(
      `
        update toolchain_install_runs
        set status = $2,
            steps = $3,
            verification = $4,
            resolved_versions = $5,
            snapshot_id = $6,
            artifact_id = $7,
            error_summary = $8,
            finished_at = now()
        where id = $1
      `,
      [
        id,
        input.status,
        JSON.stringify(input.steps),
        JSON.stringify(input.verification),
        JSON.stringify(input.resolvedVersions),
        input.snapshotId,
        input.artifactId,
        input.errorSummary
      ]
    );
  }

  private async insertArtifact(
    artifactType: string,
    path: string,
    metadata: Record<string, unknown>
  ): Promise<string> {
    const artifactId = randomUUID();
    const fileStats = await stat(path);
    const sha256 = createHash("sha256").update(await readFile(path)).digest("hex");
    await this.database.pool.query(
      `
        insert into artifacts (id, artifact_type, path, sha256, size_bytes, redacted, metadata, created_at)
        values ($1, $2, $3, $4, $5, false, $6, now())
      `,
      [artifactId, artifactType, path, sha256, fileStats.size, JSON.stringify(metadata)]
    );
    return artifactId;
  }
}

function createInstallSteps(paths: InstallerPaths): ToolchainInstallStep[] {
  const sdkManager = join(paths.cmdlineToolsDir, "bin", "sdkmanager");
  const avdManager = join(paths.cmdlineToolsDir, "bin", "avdmanager");
  return [
    step("preflight-root", "Verify root-capable installer runtime", "test \"$(id -u)\" = \"0\""),
    step(
      "system-packages",
      "Install OS packages",
      "apt-get update && apt-get install -y --no-install-recommends git curl unzip zip python3 ca-certificates default-jdk-headless imagemagick webp jq xz-utils chromium"
    ),
    step(
      "android-cmdline-tools",
      "Install Android SDK command-line tools",
      `rm -rf "${paths.cmdlineToolsDir}" /tmp/android-cmdline-tools && mkdir -p "${paths.androidHome}/cmdline-tools" /tmp/android-cmdline-tools && curl -fsSL "${commandLineToolsUrl}" -o /tmp/android-cmdline-tools/tools.zip && unzip -qo /tmp/android-cmdline-tools/tools.zip -d /tmp/android-cmdline-tools && mv /tmp/android-cmdline-tools/cmdline-tools "${paths.cmdlineToolsDir}"`
    ),
    step("android-licenses", "Accept Android SDK licenses", `yes | "${sdkManager}" --licenses`),
    step(
      "android-sdk-packages",
      "Install Android SDK packages",
      `"${sdkManager}" "platform-tools" "emulator" "platforms;android-36" "build-tools;36.0.0" "system-images;android-36;google_apis;x86_64"`
    ),
    step(
      "gradle",
      "Install latest stable Gradle",
      `node -e "const fs=require('fs');fetch('https://services.gradle.org/versions/current').then(r=>r.json()).then(j=>{fs.writeFileSync('/tmp/gradle-version.txt',j.version)})" && curl -fsSL "https://services.gradle.org/distributions/gradle-$(cat /tmp/gradle-version.txt)-bin.zip" -o /tmp/gradle.zip && unzip -qo /tmp/gradle.zip -d "${paths.installRoot}" && rm -rf "${paths.gradleHome}" && ln -sfn "${paths.installRoot}/gradle-$(cat /tmp/gradle-version.txt)" "${paths.gradleHome}"`
    ),
    step(
      "debug-keystore",
      "Create debug keystore",
      `keytool -genkeypair -alias androiddebugkey -keypass android -storepass android -keystore "${join(paths.installRoot, "debug.keystore")}" -dname "CN=Android Debug,O=Android,C=US" -keyalg RSA -keysize 2048 -validity 10000 || test -f "${join(paths.installRoot, "debug.keystore")}"`
    ),
    step(
      "avd",
      "Create Android Virtual Device",
      `echo "no" | "${avdManager}" create avd --force --name "${targetAvdName}" --package "system-images;android-36;google_apis;x86_64" --device "pixel_6"`
    )
  ];
}

function step(id: string, label: string, command: string): ToolchainInstallStep {
  return {
    id,
    label,
    command,
    status: "pending",
    output: "",
    startedAt: null,
    finishedAt: null
  };
}

function markFailed(
  steps: ToolchainInstallStep[],
  failedId: string,
  output: string
): ToolchainInstallStep[] {
  return steps.map((step) => {
    if (step.id === failedId) {
      return {
        ...step,
        status: "fail",
        output,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString()
      };
    }
    return {
      ...step,
      status: "skipped"
    };
  });
}

function runCommand(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    timeoutMs: number;
  }
): Promise<CommandResult> {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode: null,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: error.message,
        timedOut
      });
    });
    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({
        exitCode,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        error: timedOut ? `${command} timed out after ${options.timeoutMs}ms` : null,
        timedOut
      });
    });
  });
}

function match(value: string, pattern: RegExp): string | null {
  return pattern.exec(value)?.[1] ?? null;
}

function firstLine(value: string): string | null {
  return (
    value
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? null
  );
}

function trim(value: string | null | undefined): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.replace(/\s+/g, " ").slice(0, 4000);
}

function renderReport(
  status: InstallStatus,
  steps: ToolchainInstallStep[],
  verification: ToolchainInstallStep[],
  versions: Record<string, string | null>,
  snapshotId: string | null
): string {
  return [
    "# Android Toolchain Install Report",
    "",
    `Status: ${status}`,
    `Snapshot ID: ${snapshotId ?? "none"}`,
    "",
    "## Resolved Versions",
    "",
    ...Object.entries(versions).map(([key, value]) => `- ${key}: ${value ?? "unknown"}`),
    "",
    "## Install Steps",
    "",
    ...steps.map((step) => `- ${step.id}: ${step.status} ${step.output}`),
    "",
    "## Verification",
    "",
    ...(verification.length > 0
      ? verification.map((step) => `- ${step.id}: ${step.status} ${step.output}`)
      : ["- not run"]),
    ""
  ].join("\n");
}
