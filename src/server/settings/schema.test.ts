import { describe, expect, it } from "vitest";

import { updatePublicSettingsSchema } from "./schema.js";

describe("settings validation", () => {
  it("accepts safe settings updates", () => {
    expect(
      updatePublicSettingsSchema.parse({
        defaultMaxExecutionHours: 24,
        defaultMaxWorkerTurns: 200,
        defaultRetryLimit: 1,
        minFreeMemoryMb: 2048,
        minFreeDiskMb: 10240,
        maxCpuUsagePercent: null,
        maxLoadAverage: null,
        workerPollIntervalSeconds: 300
      })
    ).toEqual({
      defaultMaxExecutionHours: 24,
      defaultMaxWorkerTurns: 200,
      defaultRetryLimit: 1,
      minFreeMemoryMb: 2048,
      minFreeDiskMb: 10240,
      maxCpuUsagePercent: null,
      maxLoadAverage: null,
      workerPollIntervalSeconds: 300
    });
  });

  it("rejects unsafe execution, resource, timeout, polling, and retry values", () => {
    expect(() =>
      updatePublicSettingsSchema.parse({
        defaultMaxExecutionHours: 0,
        defaultRetryLimit: 99,
        minFreeMemoryMb: 1,
        minFreeDiskMb: 1,
        maxCpuUsagePercent: 101,
        workerPollIntervalSeconds: 1,
        codexTurnTimeoutSeconds: 1
      })
    ).toThrow();
  });

  it("does not allow secret identifiers in the public settings API", () => {
    expect(() =>
      updatePublicSettingsSchema.parse({
        smtpSecretId: "00000000-0000-0000-0000-000000000000"
      })
    ).toThrow();
  });
});
