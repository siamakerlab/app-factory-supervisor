import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AppConfig } from "../config.js";
import { AuthService } from "./service.js";

describe("auth failure logging", () => {
  it("writes fail2ban-compatible auth failure lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afs-auth-log-"));
    const authLogPath = join(dir, "auth.log");
    const service = new AuthService(
      {
        pool: {
          query: (sql: string) => {
            if (sql.includes("from banned_ips")) {
              return Promise.resolve({
                rows: [],
                rowCount: 0
              });
            }
            if (sql.includes("from app_settings")) {
              return Promise.resolve({
                rows: [{ login_failures_before_ban: 3 }],
                rowCount: 1
              });
            }
            if (sql.includes("failure_count")) {
              return Promise.resolve({
                rows: [{ failure_count: 1 }],
                rowCount: 1
              });
            }
            return Promise.resolve({
              rows: [],
              rowCount: 1
            });
          }
        },
        close: () => Promise.resolve(),
        ping: () => Promise.resolve()
      } as never,
      {
        AUTH_LOG_PATH: authLogPath,
        SESSION_TTL_DAYS: 7
      } as AppConfig
    );

    await service.login("admin user", "bad-password", {
      ipAddress: "203.0.113.10",
      userAgent: "test"
    });

    const log = await readFile(authLogPath, "utf8");
    expect(log).toBe("AUTH_FAIL ip=203.0.113.10 admin_id=admin%20user reason=invalid_credentials\n");

    await rm(dir, {
      recursive: true,
      force: true
    });
  });

  it("bans an IP after the configured number of failed logins", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afs-auth-ban-"));
    const authLogPath = join(dir, "auth.log");
    const attempts: string[] = [];
    const bannedIps = new Set<string>();
    const query = vi.fn((sql: string, params: unknown[] = []) => {
      if (sql.includes("from banned_ips")) {
        const ipAddress = String(params[0]);
        return Promise.resolve({
          rows: bannedIps.has(ipAddress) ? [{ value: 1 }] : [],
          rowCount: bannedIps.has(ipAddress) ? 1 : 0
        });
      }
      if (sql.includes("from users where admin_id")) {
        return Promise.resolve({
          rows: [],
          rowCount: 0
        });
      }
      if (sql.includes("insert into login_attempts")) {
        attempts.push(String(params[2]));
        return Promise.resolve({
          rows: [],
          rowCount: 1
        });
      }
      if (sql.includes("from app_settings")) {
        return Promise.resolve({
          rows: [{ login_failures_before_ban: 3 }],
          rowCount: 1
        });
      }
      if (sql.includes("failure_count")) {
        return Promise.resolve({
          rows: [{ failure_count: attempts.length }],
          rowCount: 1
        });
      }
      if (sql.includes("insert into banned_ips")) {
        bannedIps.add(String(params[1]));
        return Promise.resolve({
          rows: [],
          rowCount: 1
        });
      }
      return Promise.resolve({
        rows: [],
        rowCount: 0
      });
    });
    const service = new AuthService(
      {
        pool: {
          query
        },
        close: () => Promise.resolve(),
        ping: () => Promise.resolve()
      } as never,
      {
        AUTH_LOG_PATH: authLogPath,
        SESSION_TTL_DAYS: 7
      } as AppConfig
    );

    await service.login("admin", "bad-password", { ipAddress: "203.0.113.10" });
    await service.login("admin", "bad-password", { ipAddress: "203.0.113.10" });
    const third = await service.login("admin", "bad-password", { ipAddress: "203.0.113.10" });
    const fourth = await service.login("admin", "bad-password", { ipAddress: "203.0.113.10" });

    expect(third).toEqual({
      ok: false,
      reason: "invalid_credentials"
    });
    expect(fourth).toEqual({
      ok: false,
      reason: "ip_banned"
    });
    expect(bannedIps.has("203.0.113.10")).toBe(true);

    await rm(dir, {
      recursive: true,
      force: true
    });
  });
});
