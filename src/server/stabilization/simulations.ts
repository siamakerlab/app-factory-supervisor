import type { JobStatus } from "../jobs/service.js";
import type { PublicSettings } from "../settings/schema.js";

export type StubTurnSimulation = {
  requestedTurns: number;
  supervisorPrompts: number;
  workerRuns: number;
  duplicateWorkerStarts: boolean;
  exhaustedBudget: boolean;
};

export type RestartJobState = {
  status: JobStatus;
  staleAfter: Date | null;
  timeoutAt: Date | null;
};

export type RestartRecoveryDecision = {
  status: JobStatus;
  reason: "unchanged" | "stale_deadline" | "timeout_deadline";
};

export type OperationTimeoutKind =
  | "codex_turn"
  | "gradle_build"
  | "test"
  | "mcp_tool"
  | "project_export"
  | "emulator";

export function simulateStubCodexProject(
  requestedTurns: number,
  maxWorkerTurns: number
): StubTurnSimulation {
  const runKeys = new Set<string>();
  const turnsToRun = Math.min(requestedTurns, maxWorkerTurns);
  let duplicateWorkerStarts = false;

  for (let turn = 1; turn <= turnsToRun; turn += 1) {
    const key = `worker:${turn}`;
    if (runKeys.has(key)) {
      duplicateWorkerStarts = true;
    }
    runKeys.add(key);
  }

  return {
    requestedTurns,
    supervisorPrompts: turnsToRun,
    workerRuns: runKeys.size,
    duplicateWorkerStarts,
    exhaustedBudget: requestedTurns > maxWorkerTurns
  };
}

export function restartRecoveryDecision(
  job: RestartJobState,
  now: Date
): RestartRecoveryDecision {
  if (job.status !== "running") {
    return {
      status: job.status,
      reason: "unchanged"
    };
  }
  if (job.timeoutAt && job.timeoutAt.getTime() <= now.getTime()) {
    return {
      status: "stale",
      reason: "timeout_deadline"
    };
  }
  if (job.staleAfter && job.staleAfter.getTime() <= now.getTime()) {
    return {
      status: "stale",
      reason: "stale_deadline"
    };
  }
  return {
    status: "running",
    reason: "unchanged"
  };
}

export function maxMissedStopHookDelaySeconds(workerPollIntervalSeconds: number): number {
  return Math.max(30, workerPollIntervalSeconds);
}

export function operationTimeoutSeconds(
  kind: OperationTimeoutKind,
  settings: Pick<
    PublicSettings,
    | "codexTurnTimeoutSeconds"
    | "buildTimeoutSeconds"
    | "testTimeoutSeconds"
    | "mcpToolTimeoutSeconds"
    | "exportTimeoutSeconds"
    | "emulatorTimeoutSeconds"
  >
): number {
  switch (kind) {
    case "codex_turn":
      return settings.codexTurnTimeoutSeconds;
    case "gradle_build":
      return settings.buildTimeoutSeconds;
    case "test":
      return settings.testTimeoutSeconds;
    case "mcp_tool":
      return settings.mcpToolTimeoutSeconds;
    case "project_export":
      return settings.exportTimeoutSeconds;
    case "emulator":
      return settings.emulatorTimeoutSeconds;
  }
}

export function projectExportIncludesRelativePath(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, "/").replace(/^\/+/, "");
  return normalized.length > 0 && !normalized.startsWith("../");
}

export function terminalStatusHasEvidence(input: {
  terminal: boolean;
  evidenceCount: number;
  status: string;
}): boolean {
  if (!input.terminal) {
    return true;
  }
  return input.evidenceCount > 0 && input.status !== "running";
}
