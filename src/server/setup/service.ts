import { constants } from "node:fs";
import { access, mkdir, readFile } from "node:fs/promises";
import { arch, platform } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { getRuntimePaths } from "../runtime/paths.js";

export type CommandCheck = {
  id: string;
  command: string;
  args: string[];
  required: boolean;
  status: "pass" | "fail";
  output: string;
};

export type SetupStatus = {
  adminConfigured: boolean;
  setupComplete: boolean;
  steps: {
    admin: "pending" | "pass" | "fail";
    environment: "pending" | "pass" | "fail";
    ssh: "pending" | "pass" | "fail";
  };
  platform: {
    os: string | null;
    arch: string | null;
  };
  installPaths: Record<string, string>;
  commandChecks: CommandCheck[];
  sshPublicKey: string | null;
  sshPublicKeyPath: string | null;
  lastError: string | null;
};

type SetupRow = {
  admin_step_status: "pending" | "pass" | "fail";
  environment_step_status: "pending" | "pass" | "fail";
  ssh_step_status: "pending" | "pass" | "fail";
  setup_complete: boolean;
  os_name: string | null;
  cpu_arch: string | null;
  install_paths: Record<string, string>;
  command_checks: CommandCheck[];
  ssh_public_key_path: string | null;
  last_error: string | null;
};

const commandChecks: CommandCheckDefinition[] = [
  { id: "codex", command: "codex", args: ["--version"], required: true },
  { id: "codex-login-status", command: "codex", args: ["login", "status"], required: true },
  { id: "docs-mcp-server", command: "docs-mcp-server", args: ["--version"], required: true },
  { id: "context7-mcp", command: "context7-mcp", args: ["--version"], required: true },
  { id: "mcp-server-mobile", command: "mcp-server-mobile", args: ["--version"], required: true },
  { id: "playwright-mcp", command: "playwright-mcp", args: ["--version"], required: true },
  { id: "mcp-server-memory", command: "mcp-server-memory", args: ["--version"], required: true },
  { id: "mcp-server-time", command: "mcp-server-time", args: ["--version"], required: true },
  { id: "git", command: "git", args: ["--version"], required: true },
  { id: "node", command: "node", args: ["--version"], required: true },
  { id: "python3", command: "python3", args: ["--version"], required: true },
  { id: "java", command: "java", args: ["-version"], required: true },
  { id: "gradle", command: "gradle", args: ["--version"], required: true },
  { id: "sdkmanager", command: "sdkmanager", args: ["--list"], required: true },
  { id: "adb", command: "adb", args: ["version"], required: true },
  { id: "emulator", command: "emulator", args: ["-version"], required: true },
  { id: "keytool", command: "keytool", args: ["-help"], required: true }
];

type CommandCheckDefinition = {
  id: string;
  command: string;
  args: string[];
  required: boolean;
};

export class SetupService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async getStatus(): Promise<SetupStatus> {
    await this.syncAdminStep();
    const row = await this.getRow();
    return {
      adminConfigured: row.admin_step_status === "pass",
      setupComplete: row.setup_complete,
      steps: {
        admin: row.admin_step_status,
        environment: row.environment_step_status,
        ssh: row.ssh_step_status
      },
      platform: {
        os: row.os_name,
        arch: row.cpu_arch
      },
      installPaths: row.install_paths,
      commandChecks: row.command_checks,
      sshPublicKey: row.ssh_public_key_path ? await readPublicKey(row.ssh_public_key_path) : null,
      sshPublicKeyPath: row.ssh_public_key_path,
      lastError: row.last_error
    };
  }

  async verifyEnvironment(): Promise<SetupStatus> {
    const checks = await Promise.all(
      commandChecks.map((check) => runCommandCheck(check, this.commandEnv()))
    );
    const status = checks.every((check) => !check.required || check.status === "pass")
      ? "pass"
      : "fail";

    await this.database.pool.query(
      `
        update setup_wizard_state
        set environment_step_status = $1,
            os_name = $2,
            cpu_arch = $3,
            install_paths = $4,
            command_checks = $5,
            last_error = $6,
            updated_at = now()
        where id = true
      `,
      [
        status,
        platform(),
        arch(),
        {
          data: this.config.APP_DATA_DIR,
          projects: this.config.APP_PROJECTS_DIR,
          toolchains: join(this.config.APP_DATA_DIR, "toolchains"),
          capabilities: join(this.config.APP_DATA_DIR, "capabilities")
        },
        JSON.stringify(checks),
        status === "pass" ? null : "One or more required setup commands failed"
      ]
    );

    await this.refreshCompletionFlag();
    return this.getStatus();
  }

  async ensureSshKey(): Promise<SetupStatus> {
    const keyDir = join(this.config.APP_DATA_DIR, "secrets", "git_ssh");
    const privateKeyPath = join(keyDir, "id_ed25519");
    const publicKeyPath = `${privateKeyPath}.pub`;

    await mkdir(keyDir, {
      recursive: true,
      mode: 0o700
    });

    if (!(await fileExists(publicKeyPath))) {
      await runCommand("ssh-keygen", [
        "-t",
        "ed25519",
        "-N",
        "",
        "-f",
        privateKeyPath,
        "-C",
        "app-factory-supervisor"
      ], this.commandEnv());
    }

    await this.database.pool.query(
      `
        update setup_wizard_state
        set ssh_step_status = 'pass',
            ssh_public_key_path = $1,
            last_error = null,
            updated_at = now()
        where id = true
      `,
      [publicKeyPath]
    );

    await this.refreshCompletionFlag();
    return this.getStatus();
  }

  private async syncAdminStep(): Promise<void> {
    const result = await this.database.pool.query("select 1 from users limit 1");
    await this.database.pool.query(
      `
        update setup_wizard_state
        set admin_step_status = $1,
            updated_at = now()
        where id = true
      `,
      [(result.rowCount ?? 0) > 0 ? "pass" : "pending"]
    );
    await this.refreshCompletionFlag();
  }

  private async refreshCompletionFlag(): Promise<void> {
    await this.database.pool.query(
      `
        update setup_wizard_state
        set setup_complete =
          admin_step_status = 'pass'
          and environment_step_status = 'pass'
          and ssh_step_status = 'pass',
          updated_at = now()
        where id = true
      `
    );
  }

  private async getRow(): Promise<SetupRow> {
    const result = await this.database.pool.query<SetupRow>(
      "select * from setup_wizard_state where id = true"
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("setup_wizard_state singleton row is missing");
    }
    return row;
  }

  private commandEnv(): NodeJS.ProcessEnv {
    const paths = getRuntimePaths(this.config);
    const androidHome = join(paths.toolchainsDir, "android-sdk");
    return {
      ...process.env,
      CODEX_HOME: paths.codexHomeDir,
      HOME: dirname(paths.codexHomeDir),
      ANDROID_HOME: androidHome,
      ANDROID_SDK_ROOT: androidHome,
      ANDROID_AVD_HOME: join(paths.toolchainsDir, "avd"),
      PATH: [
        join(androidHome, "platform-tools"),
        join(androidHome, "cmdline-tools", "latest", "bin"),
        join(androidHome, "emulator"),
        join(paths.toolchainsDir, "gradle", "bin"),
        process.env.PATH ?? ""
      ].join(":")
    };
  }
}

async function runCommandCheck(
  definition: CommandCheckDefinition,
  env: NodeJS.ProcessEnv
): Promise<CommandCheck> {
  try {
    const output = await runCommand(definition.command, definition.args, env, 5000);
    return {
      ...definition,
      status: "pass",
      output: output.slice(0, 2000)
    };
  } catch (error) {
    return {
      ...definition,
      status: "fail",
      output: error instanceof Error ? error.message.slice(0, 2000) : "unknown error"
    };
  }
}

async function runCommand(
  command: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs = 15000
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const output = Buffer.concat(chunks).toString("utf8").trim();
      if (code === 0) {
        resolve(output);
        return;
      }
      reject(new Error(output || `${command} exited with code ${code}`));
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function readPublicKey(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    await mkdir(dirname(path), {
      recursive: true,
      mode: 0o700
    });
    return null;
  }
}
