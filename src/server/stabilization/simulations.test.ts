import { describe, expect, it } from "vitest";

import {
  maxMissedStopHookDelaySeconds,
  operationTimeoutSeconds,
  projectExportIncludesRelativePath,
  restartRecoveryDecision,
  simulateStubCodexProject,
  terminalStatusHasEvidence
} from "./simulations.js";

describe("MVP stabilization simulations", () => {
  it("runs a deterministic 200-turn stub project without duplicate worker starts", () => {
    const result = simulateStubCodexProject(200, 200);

    expect(result.supervisorPrompts).toBe(200);
    expect(result.workerRuns).toBe(200);
    expect(result.duplicateWorkerStarts).toBe(false);
    expect(result.exhaustedBudget).toBe(false);
  });

  it("flags worker budget exhaustion without starting extra runs", () => {
    const result = simulateStubCodexProject(201, 200);

    expect(result.workerRuns).toBe(200);
    expect(result.exhaustedBudget).toBe(true);
    expect(result.duplicateWorkerStarts).toBe(false);
  });

  it("recovers restart states deterministically", () => {
    const now = new Date("2026-08-09T00:10:00.000Z");

    expect(
      restartRecoveryDecision(
        {
          status: "queued",
          staleAfter: null,
          timeoutAt: null
        },
        now
      )
    ).toEqual({ status: "queued", reason: "unchanged" });
    expect(
      restartRecoveryDecision(
        {
          status: "running",
          staleAfter: new Date("2026-08-09T00:09:59.000Z"),
          timeoutAt: null
        },
        now
      )
    ).toEqual({ status: "stale", reason: "stale_deadline" });
    expect(
      restartRecoveryDecision(
        {
          status: "running",
          staleAfter: null,
          timeoutAt: new Date("2026-08-09T00:09:59.000Z")
        },
        now
      )
    ).toEqual({ status: "stale", reason: "timeout_deadline" });
  });

  it("bounds missed Stop hook recovery by the configured poll interval", () => {
    expect(maxMissedStopHookDelaySeconds(300)).toBe(300);
  });

  it("uses explicit timeout policies for long-running operations", () => {
    const settings = {
      codexTurnTimeoutSeconds: 3600,
      buildTimeoutSeconds: 1800,
      testTimeoutSeconds: 1200,
      mcpToolTimeoutSeconds: 120,
      exportTimeoutSeconds: 900,
      emulatorTimeoutSeconds: 3600
    };

    expect(operationTimeoutSeconds("codex_turn", settings)).toBe(3600);
    expect(operationTimeoutSeconds("gradle_build", settings)).toBe(1800);
    expect(operationTimeoutSeconds("mcp_tool", settings)).toBe(120);
    expect(operationTimeoutSeconds("project_export", settings)).toBe(900);
  });

  it("keeps keystores in full project ZIP export scope", () => {
    expect(projectExportIncludesRelativePath("keystores/release.jks")).toBe(true);
    expect(projectExportIncludesRelativePath("../app-data/secrets/key.txt")).toBe(false);
  });

  it("rejects terminal statuses without evidence", () => {
    expect(
      terminalStatusHasEvidence({
        terminal: true,
        status: "production_ready_user_action_required",
        evidenceCount: 0
      })
    ).toBe(false);
    expect(
      terminalStatusHasEvidence({
        terminal: true,
        status: "production_ready_user_action_required",
        evidenceCount: 2
      })
    ).toBe(true);
  });
});
