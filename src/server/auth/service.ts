import { randomUUID } from "node:crypto";
import { appendFile } from "node:fs/promises";

import type { AppConfig } from "../config.js";
import type { Database } from "../db/client.js";
import { hashPassword, verifyPassword } from "./password.js";
import { createSessionToken, hashSessionToken } from "./tokens.js";

export type SessionUser = {
  userId: string;
  adminId: string;
  sessionId: string;
  expiresAt: string;
};

export type LoginResult =
  | {
      ok: true;
      token: string;
      user: SessionUser;
    }
  | {
      ok: false;
      reason: "invalid_credentials" | "setup_required";
    };

type UserRow = {
  id: string;
  admin_id: string;
  password_hash: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  admin_id: string;
  expires_at: Date;
};

export class AuthService {
  constructor(
    private readonly database: Database,
    private readonly config: AppConfig
  ) {}

  async isAdminConfigured(): Promise<boolean> {
    const result = await this.database.pool.query("select 1 from users limit 1");
    return (result.rowCount ?? 0) > 0;
  }

  async createAdmin(adminId: string, password: string): Promise<SessionUser> {
    const existing = await this.isAdminConfigured();
    if (existing) {
      throw new Error("admin_already_configured");
    }

    const userId = randomUUID();
    const passwordHash = await hashPassword(password);
    await this.database.pool.query(
      `
        insert into users (id, admin_id, password_hash, created_at, updated_at)
        values ($1, $2, $3, now(), now())
      `,
      [userId, adminId, passwordHash]
    );

    return {
      userId,
      adminId,
      sessionId: "",
      expiresAt: new Date().toISOString()
    };
  }

  async login(
    adminId: string,
    password: string,
    context: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<LoginResult> {
    const user = await this.findUserByAdminId(adminId);
    if (!user) {
      await this.recordLoginAttempt(adminId, false, "invalid_credentials", context);
      return {
        ok: false,
        reason: "invalid_credentials"
      };
    }

    const valid = await verifyPassword(password, user.password_hash);
    if (!valid) {
      await this.recordLoginAttempt(adminId, false, "invalid_credentials", context);
      return {
        ok: false,
        reason: "invalid_credentials"
      };
    }

    await this.recordLoginAttempt(adminId, true, null, context);
    const session = await this.createSession(user, context);
    return {
      ok: true,
      ...session
    };
  }

  async getSession(token: string | undefined): Promise<SessionUser | null> {
    if (!token) {
      return null;
    }

    const result = await this.database.pool.query<SessionRow>(
      `
        select user_sessions.id, user_sessions.user_id, users.admin_id, user_sessions.expires_at
        from user_sessions
        join users on users.id = user_sessions.user_id
        where user_sessions.session_hash = $1
          and user_sessions.revoked_at is null
          and user_sessions.expires_at > now()
      `,
      [hashSessionToken(token)]
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }

    await this.database.pool.query("update user_sessions set last_seen_at = now() where id = $1", [
      row.id
    ]);

    return {
      userId: row.user_id,
      adminId: row.admin_id,
      sessionId: row.id,
      expiresAt: row.expires_at.toISOString()
    };
  }

  async logout(token: string | undefined): Promise<void> {
    if (!token) {
      return;
    }

    await this.database.pool.query(
      "update user_sessions set revoked_at = now() where session_hash = $1",
      [hashSessionToken(token)]
    );
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.findUserById(userId);
    if (!user || !(await verifyPassword(currentPassword, user.password_hash))) {
      throw new Error("invalid_current_password");
    }

    const nextHash = await hashPassword(newPassword);
    await this.database.pool.query(
      "update users set password_hash = $1, updated_at = now() where id = $2",
      [nextHash, userId]
    );
    await this.database.pool.query(
      "update user_sessions set revoked_at = now() where user_id = $1 and revoked_at is null",
      [userId]
    );
  }

  private async createSession(
    user: UserRow,
    context: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<{ token: string; user: SessionUser }> {
    const token = createSessionToken();
    const sessionId = randomUUID();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

    await this.database.pool.query(
      `
        insert into user_sessions (
          id, user_id, session_hash, ip_address, user_agent, created_at, last_seen_at, expires_at
        )
        values ($1, $2, $3, $4, $5, now(), now(), $6)
      `,
      [
        sessionId,
        user.id,
        hashSessionToken(token),
        context.ipAddress ?? null,
        context.userAgent ?? null,
        expiresAt
      ]
    );

    return {
      token,
      user: {
        userId: user.id,
        adminId: user.admin_id,
        sessionId,
        expiresAt: expiresAt.toISOString()
      }
    };
  }

  private async findUserByAdminId(adminId: string): Promise<UserRow | null> {
    const result = await this.database.pool.query<UserRow>(
      "select id, admin_id, password_hash from users where admin_id = $1",
      [adminId]
    );
    return result.rows[0] ?? null;
  }

  private async findUserById(userId: string): Promise<UserRow | null> {
    const result = await this.database.pool.query<UserRow>(
      "select id, admin_id, password_hash from users where id = $1",
      [userId]
    );
    return result.rows[0] ?? null;
  }

  private async recordLoginAttempt(
    adminId: string,
    success: boolean,
    failureReason: string | null,
    context: {
      ipAddress?: string;
      userAgent?: string;
    }
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into login_attempts (
          id, admin_id, ip_address, user_agent, success, failure_reason, created_at
        )
        values ($1, $2, $3, $4, $5, $6, now())
      `,
      [
        randomUUID(),
        adminId,
        context.ipAddress ?? "127.0.0.1",
        context.userAgent ?? null,
        success,
        failureReason
      ]
    );

    if (!success) {
      await this.writeAuthFailureLog(adminId, failureReason ?? "unknown", context.ipAddress);
    }
  }

  private async writeAuthFailureLog(
    adminId: string,
    reason: string,
    ipAddress: string | undefined
  ): Promise<void> {
    const line = `AUTH_FAIL ip=${escapeLogValue(ipAddress ?? "127.0.0.1")} admin_id=${escapeLogValue(adminId)} reason=${escapeLogValue(reason)}\n`;
    process.stderr.write(line);
    await appendFile(this.config.AUTH_LOG_PATH, line, {
      encoding: "utf8",
      mode: 0o600
    });
  }
}

function escapeLogValue(value: string): string {
  return encodeURIComponent(value);
}
