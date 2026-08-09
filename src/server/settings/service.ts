import { randomUUID } from "node:crypto";

import type { Database } from "../db/client.js";
import {
  publicSettingsSchema,
  updatePublicSettingsSchema,
  type PublicSettings,
  type UpdatePublicSettings
} from "./schema.js";

type SettingsRow = {
  default_max_execution_hours: number;
  default_max_worker_turns: number;
  default_retry_limit: number;
  login_failures_before_ban: number;
  min_free_memory_mb: number;
  min_available_memory_percent: number;
  min_free_disk_mb: number;
  max_cpu_usage_percent: number | null;
  max_load_average: string | null;
  memory_recheck_interval_seconds: number;
  resource_recheck_interval_seconds: number;
  stale_heartbeat_seconds: number;
  worker_poll_interval_seconds: number;
  codex_turn_timeout_seconds: number;
  build_timeout_seconds: number;
  test_timeout_seconds: number;
  mcp_tool_timeout_seconds: number;
  export_timeout_seconds: number;
  emulator_timeout_seconds: number;
  email_notifications_enabled: boolean;
  smtp_secret_id: string | null;
};

const fieldToColumn = {
  defaultMaxExecutionHours: "default_max_execution_hours",
  defaultMaxWorkerTurns: "default_max_worker_turns",
  defaultRetryLimit: "default_retry_limit",
  loginFailuresBeforeBan: "login_failures_before_ban",
  minFreeMemoryMb: "min_free_memory_mb",
  minAvailableMemoryPercent: "min_available_memory_percent",
  minFreeDiskMb: "min_free_disk_mb",
  maxCpuUsagePercent: "max_cpu_usage_percent",
  maxLoadAverage: "max_load_average",
  memoryRecheckIntervalSeconds: "memory_recheck_interval_seconds",
  resourceRecheckIntervalSeconds: "resource_recheck_interval_seconds",
  staleHeartbeatSeconds: "stale_heartbeat_seconds",
  workerPollIntervalSeconds: "worker_poll_interval_seconds",
  codexTurnTimeoutSeconds: "codex_turn_timeout_seconds",
  buildTimeoutSeconds: "build_timeout_seconds",
  testTimeoutSeconds: "test_timeout_seconds",
  mcpToolTimeoutSeconds: "mcp_tool_timeout_seconds",
  exportTimeoutSeconds: "export_timeout_seconds",
  emulatorTimeoutSeconds: "emulator_timeout_seconds",
  emailNotificationsEnabled: "email_notifications_enabled"
} as const satisfies Record<keyof UpdatePublicSettings, string>;

export type SettingsAuditActor = {
  actorType: "system" | "admin";
  actorId?: string;
  ipAddress?: string;
};

export class SettingsService {
  constructor(private readonly database: Database) {}

  async getPublicSettings(): Promise<PublicSettings> {
    const row = await this.getSettingsRow();
    return mapSettingsRow(row);
  }

  async updatePublicSettings(
    input: unknown,
    actor: SettingsAuditActor = {
      actorType: "system"
    }
  ): Promise<PublicSettings> {
    const patch = updatePublicSettingsSchema.parse(input);
    const keys = Object.keys(patch) as Array<keyof UpdatePublicSettings>;

    if (keys.length === 0) {
      return this.getPublicSettings();
    }

    const previous = await this.getPublicSettings();
    const setClauses = keys.map((key, index) => `${fieldToColumn[key]} = $${index + 1}`);
    const values = keys.map((key) => patch[key]);

    await this.database.pool.query(
      `
        update app_settings
        set ${setClauses.join(", ")}, updated_at = now()
        where id = true
      `,
      values
    );

    const next = await this.getPublicSettings();
    await this.recordSettingsAudit(previous, next, keys, actor);
    return next;
  }

  private async getSettingsRow(): Promise<SettingsRow> {
    const result = await this.database.pool.query<SettingsRow>(
      "select * from app_settings where id = true"
    );
    const row = result.rows[0];
    if (!row) {
      throw new Error("app_settings singleton row is missing");
    }
    return row;
  }

  private async recordSettingsAudit(
    previous: PublicSettings,
    next: PublicSettings,
    changedKeys: Array<keyof UpdatePublicSettings>,
    actor: SettingsAuditActor
  ): Promise<void> {
    await this.database.pool.query(
      `
        insert into app_audit_events (id, event_type, actor_type, actor_id, ip_address, summary, metadata, created_at)
        values ($1, 'settings.updated', $2, $3, $4, $5, $6, now())
      `,
      [
        randomUUID(),
        actor.actorType,
        actor.actorId ?? null,
        actor.ipAddress ?? null,
        `Updated settings: ${changedKeys.join(", ")}`,
        {
          changedKeys,
          previous: pickChanged(previous, changedKeys),
          next: pickChanged(next, changedKeys)
        }
      ]
    );
  }
}

function mapSettingsRow(row: SettingsRow): PublicSettings {
  return publicSettingsSchema.parse({
    defaultMaxExecutionHours: row.default_max_execution_hours,
    defaultMaxWorkerTurns: row.default_max_worker_turns,
    defaultRetryLimit: row.default_retry_limit,
    loginFailuresBeforeBan: row.login_failures_before_ban,
    minFreeMemoryMb: row.min_free_memory_mb,
    minAvailableMemoryPercent: row.min_available_memory_percent,
    minFreeDiskMb: row.min_free_disk_mb,
    maxCpuUsagePercent: row.max_cpu_usage_percent,
    maxLoadAverage: row.max_load_average === null ? null : Number(row.max_load_average),
    memoryRecheckIntervalSeconds: row.memory_recheck_interval_seconds,
    resourceRecheckIntervalSeconds: row.resource_recheck_interval_seconds,
    staleHeartbeatSeconds: row.stale_heartbeat_seconds,
    workerPollIntervalSeconds: row.worker_poll_interval_seconds,
    codexTurnTimeoutSeconds: row.codex_turn_timeout_seconds,
    buildTimeoutSeconds: row.build_timeout_seconds,
    testTimeoutSeconds: row.test_timeout_seconds,
    mcpToolTimeoutSeconds: row.mcp_tool_timeout_seconds,
    exportTimeoutSeconds: row.export_timeout_seconds,
    emulatorTimeoutSeconds: row.emulator_timeout_seconds,
    emailNotificationsEnabled: row.email_notifications_enabled,
    smtpConfigured: row.smtp_secret_id !== null
  });
}

function pickChanged(settings: PublicSettings, keys: Array<keyof UpdatePublicSettings>) {
  return Object.fromEntries(keys.map((key) => [key, settings[key]]));
}
