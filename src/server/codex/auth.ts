import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { AppConfig } from "../config.js";
import { getRuntimePaths } from "../runtime/paths.js";

export type CodexAuthStatus = {
  authenticated: boolean;
  codexHomeDir: string;
  authFilePresent: boolean;
  login: CodexDeviceLoginSession | null;
};

export type CodexDeviceLoginSession = {
  id: string;
  status: "idle" | "starting" | "waiting_for_user" | "succeeded" | "failed" | "cancelled";
  verificationUri: string | null;
  userCode: string | null;
  expiresAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  exitCode: number | null;
  message: string | null;
};

type MutableLoginSession = CodexDeviceLoginSession & {
  process: ChildProcess | null;
  output: string;
};

const ansiPattern = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const loginStatusTimeoutMs = 10_000;

export class CodexAuthService {
  private loginSession: MutableLoginSession | null = null;

  constructor(private readonly config: AppConfig) {}

  async getStatus(): Promise<CodexAuthStatus> {
    await this.refreshLoginStatus();
    const paths = getRuntimePaths(this.config);
    return {
      authenticated: await this.isAuthenticated(),
      codexHomeDir: paths.codexHomeDir,
      authFilePresent: existsSync(this.authFilePath()),
      login: this.publicLoginSession()
    };
  }

  async startDeviceLogin(): Promise<CodexDeviceLoginSession> {
    await this.refreshLoginStatus();
    if (this.loginSession && ["starting", "waiting_for_user"].includes(this.loginSession.status)) {
      return this.publicLoginSession()!;
    }

    const paths = getRuntimePaths(this.config);
    await mkdir(paths.codexHomeDir, {
      recursive: true,
      mode: 0o700
    });

    const now = new Date();
    const session: MutableLoginSession = {
      id: `codex-login-${now.toISOString().replace(/[-:.TZ]/g, "")}`,
      status: "starting",
      verificationUri: null,
      userCode: null,
      expiresAt: null,
      startedAt: now.toISOString(),
      finishedAt: null,
      exitCode: null,
      message: "Starting Codex device login.",
      process: null,
      output: ""
    };
    this.loginSession = session;

    const child = spawn("codex", ["login", "--device-auth"], {
      env: this.codexEnvironment(),
      stdio: ["ignore", "pipe", "pipe"]
    });
    session.process = child;

    const capture = (chunk: Buffer) => {
      session.output += stripAnsi(chunk.toString("utf8"));
      const parsed = parseCodexDeviceLoginOutput(session.output);
      if (parsed.verificationUri || parsed.userCode) {
        session.verificationUri = parsed.verificationUri ?? session.verificationUri;
        session.userCode = parsed.userCode ?? session.userCode;
        session.expiresAt = parsed.expiresAt ?? session.expiresAt;
        session.status = "waiting_for_user";
        session.message = "Open the verification URL and enter the device code.";
      }
    };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", (error) => {
      session.status = "failed";
      session.finishedAt = new Date().toISOString();
      session.message = error.message;
      session.process = null;
    });
    child.on("close", (exitCode) => {
      session.exitCode = exitCode;
      session.finishedAt = new Date().toISOString();
      session.process = null;
      if (session.status === "cancelled") {
        return;
      }
      if (exitCode === 0 && existsSync(this.authFilePath())) {
        session.status = "succeeded";
        session.message = "Codex login completed.";
      } else {
        session.status = "failed";
        session.message = session.output.trim().slice(-1000) || `Codex login exited with ${exitCode}.`;
      }
    });

    return this.publicLoginSession()!;
  }

  cancelDeviceLogin(): CodexDeviceLoginSession | null {
    const session = this.loginSession;
    if (!session) {
      return null;
    }
    if (session.process) {
      session.status = "cancelled";
      session.finishedAt = new Date().toISOString();
      session.message = "Codex device login cancelled.";
      session.process.kill("SIGTERM");
      session.process = null;
    }
    return this.publicLoginSession();
  }

  private async refreshLoginStatus(): Promise<void> {
    const session = this.loginSession;
    if (!session || session.status !== "waiting_for_user") {
      return;
    }
    if (await this.isAuthenticated()) {
      session.status = "succeeded";
      session.finishedAt = new Date().toISOString();
      session.message = "Codex login completed.";
      if (session.process) {
        session.process.kill("SIGTERM");
        session.process = null;
      }
    }
  }

  private async isAuthenticated(): Promise<boolean> {
    if (!existsSync(this.authFilePath())) {
      return false;
    }
    const status = await runCodexLoginStatus(this.codexEnvironment());
    return status.exitCode === 0 && !/not logged in/i.test(status.output);
  }

  private codexEnvironment(): NodeJS.ProcessEnv {
    const paths = getRuntimePaths(this.config);
    return {
      ...process.env,
      CODEX_HOME: paths.codexHomeDir,
      HOME: dirname(paths.codexHomeDir)
    };
  }

  private authFilePath(): string {
    return `${getRuntimePaths(this.config).codexHomeDir}/auth.json`;
  }

  private publicLoginSession(): CodexDeviceLoginSession | null {
    if (!this.loginSession) {
      return null;
    }
    const { process: _process, output: _output, ...publicSession } = this.loginSession;
    return publicSession;
  }
}

export function parseCodexDeviceLoginOutput(output: string): {
  verificationUri: string | null;
  userCode: string | null;
  expiresAt: string | null;
} {
  const text = stripAnsi(output);
  const verificationUri = text.match(/https:\/\/auth\.openai\.com\/codex\/device/)?.[0] ?? null;
  const userCode = text.match(/\b[A-Z0-9]{4}-[A-Z0-9]{5}\b/)?.[0] ?? null;
  const expiresAt = /expires in 15 minutes/i.test(text)
    ? new Date(Date.now() + 15 * 60 * 1000).toISOString()
    : null;
  return {
    verificationUri,
    userCode,
    expiresAt
  };
}

function stripAnsi(value: string): string {
  return value.replace(ansiPattern, "");
}

function runCodexLoginStatus(env: NodeJS.ProcessEnv): Promise<{ exitCode: number | null; output: string }> {
  return new Promise((resolve) => {
    let settled = false;
    const child = spawn("codex", ["login", "status"], {
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    const chunks: Buffer[] = [];
    const finish = (exitCode: number | null, output?: string) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({
        exitCode,
        output: stripAnsi(output ?? Buffer.concat(chunks).toString("utf8"))
      });
    };
    const timeout = setTimeout(() => {
      child.kill("SIGTERM");
      finish(null, "Codex login status timed out.");
    }, loginStatusTimeoutMs);
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => finish(null, error.message));
    child.on("close", (exitCode) => finish(exitCode));
  });
}
