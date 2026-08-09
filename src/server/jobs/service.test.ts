import { describe, expect, it } from "vitest";

import {
  evaluateResourceSnapshot,
  failedJobStatus,
  timeoutSeconds,
  type JobResourceSettings,
  type ResourceReadings
} from "./service.js";

describe("job resource policy", () => {
  it("waits when memory, disk, CPU, or load thresholds are exceeded", () => {
    const snapshot = evaluateResourceSnapshot(
      readings({
        freeMb: 512,
        availableMb: 900,
        diskFreeMb: 400,
        cpuUsagePercent: 95,
        oneMinuteLoad: 12.5
      }),
      settings(),
      new Date("2026-08-09T00:00:00.000Z")
    );

    expect(snapshot.status).toBe("wait");
    expect(snapshot.waitReason).toContain("free memory 512MB below 2048MB");
    expect(snapshot.waitReason).toContain("available memory 9% below 15%");
    expect(snapshot.waitReason).toContain("free disk 400MB below 10240MB");
    expect(snapshot.waitReason).toContain("CPU usage 95% above 80%");
    expect(snapshot.waitReason).toContain("load average 12.50 above 8");
    expect(snapshot.nextCheckAt).toBe("2026-08-09T00:01:00.000Z");
  });

  it("passes when resource thresholds are satisfied", () => {
    const snapshot = evaluateResourceSnapshot(
      readings({
        freeMb: 4096,
        availableMb: 5000,
        diskFreeMb: 20480,
        cpuUsagePercent: 10,
        oneMinuteLoad: 1
      }),
      settings()
    );

    expect(snapshot.status).toBe("pass");
    expect(snapshot.waitReason).toBeNull();
    expect(snapshot.nextCheckAt).toBeNull();
  });

  it("uses the correct timeout deadline source per job type", () => {
    const policy = settings();

    expect(timeoutSeconds("supervisor_turn", policy)).toBe(3600);
    expect(timeoutSeconds("worker_turn", policy)).toBe(3600);
    expect(timeoutSeconds("verification", policy)).toBe(1800);
    expect(timeoutSeconds("project_export", policy)).toBe(1200);
    expect(timeoutSeconds("setup", policy)).toBe(900);
  });

  it("requeues failed jobs only while attempts remain", () => {
    expect(failedJobStatus(1, 3)).toBe("queued");
    expect(failedJobStatus(2, 3)).toBe("queued");
    expect(failedJobStatus(3, 3)).toBe("failed");
  });
});

function settings(): JobResourceSettings {
  return {
    min_free_memory_mb: 2048,
    min_available_memory_percent: 15,
    min_free_disk_mb: 10240,
    max_cpu_usage_percent: 80,
    max_load_average: "8",
    resource_recheck_interval_seconds: 60,
    stale_heartbeat_seconds: 180,
    codex_turn_timeout_seconds: 3600,
    build_timeout_seconds: 900,
    test_timeout_seconds: 1800,
    export_timeout_seconds: 1200,
    emulator_timeout_seconds: 3600
  };
}

function readings(input: {
  freeMb: number;
  availableMb: number;
  diskFreeMb: number;
  cpuUsagePercent: number;
  oneMinuteLoad: number;
}): ResourceReadings {
  return {
    memory: {
      totalMb: 10000,
      freeMb: input.freeMb,
      availableMb: input.availableMb
    },
    disk: {
      freeMb: input.diskFreeMb
    },
    cpuUsagePercent: input.cpuUsagePercent,
    oneMinuteLoad: input.oneMinuteLoad
  };
}
