import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { AppConfig } from "../config.js";
import { AuthService } from "./service.js";

describe("auth failure logging", () => {
  it("writes fail2ban-compatible auth failure lines", async () => {
    const dir = await mkdtemp(join(tmpdir(), "afs-auth-log-"));
    const authLogPath = join(dir, "auth.log");
    const service = new AuthService(
      {
        pool: {
          query: () =>
            Promise.resolve({
            rows: [],
            rowCount: 1
            })
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
});
