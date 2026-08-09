import type { FastifyInstance } from "fastify";

import type { Database } from "../../db/client.js";

type LoginAttemptRow = {
  admin_id: string | null;
  ip_address: string;
  user_agent: string | null;
  success: boolean;
  failure_reason: string | null;
  created_at: Date;
};

type BannedIpRow = {
  ip_address: string;
  reason: string;
  source: string;
  banned_at: Date;
  expires_at: Date | null;
};

export function registerFail2banRoutes(server: FastifyInstance, database: Database): void {
  server.get("/api/security/fail2ban", async () => {
    const [attempts, bannedIps] = await Promise.all([
      database.pool.query<LoginAttemptRow>(
        `
          select admin_id, host(ip_address) as ip_address, user_agent, success, failure_reason, created_at
          from login_attempts
          order by created_at desc
          limit 100
        `
      ),
      database.pool.query<BannedIpRow>(
        `
          select host(ip_address) as ip_address, reason, source, banned_at, expires_at
          from banned_ips
          order by banned_at desc
          limit 100
        `
      )
    ]);

    return {
      attempts: attempts.rows.map((row) => ({
        adminId: row.admin_id,
        ipAddress: row.ip_address,
        userAgent: row.user_agent,
        success: row.success,
        failureReason: row.failure_reason,
        createdAt: row.created_at.toISOString()
      })),
      bannedIps: bannedIps.rows.map((row) => ({
        ipAddress: row.ip_address,
        reason: row.reason,
        source: row.source,
        bannedAt: row.banned_at.toISOString(),
        expiresAt: row.expires_at?.toISOString() ?? null
      }))
    };
  });
}
