import { describe, expect, it } from "vitest";

import type { ProjectDetail, ProgressGateSummary } from "../projects/service.js";
import { evaluateCompletionGate } from "./completionGate.js";

describe("evaluateCompletionGate", () => {
  it("marks production ready only from gates and evidence, with user actions separated", () => {
    const result = evaluateCompletionGate({
      project: project({
        progress: {
          totalGates: 2,
          completedGates: 1,
          percent: 50,
          gates: [
            gate("core_features", "Core features", "pass"),
            gate("external_user_actions", "External actions", "pending")
          ]
        }
      }),
      runCounts: { workerTurns: 10, failedRuns: 0 },
      jobCounts: { failedJobs: 0, staleJobs: 0 },
      now: new Date("2026-08-08T12:00:00Z")
    });

    expect(result.status).toBe("production_ready_user_action_required");
    expect(result.productionReady).toBe(true);
    expect(result.remainingUserActions.map((item) => item.key)).toContain("api_keys");
  });

  it("does not rely on worker final response when gates remain", () => {
    const result = evaluateCompletionGate({
      project: project({ latestWorkerResponse: "Everything is done." }),
      runCounts: { workerTurns: 10, failedRuns: 0 },
      jobCounts: { failedJobs: 0, staleJobs: 0 },
      now: new Date("2026-08-08T12:00:00Z")
    });

    expect(result.status).toBe("running");
    expect(result.productionReady).toBe(false);
  });

  it("returns budget exhausted before final readiness", () => {
    const result = evaluateCompletionGate({
      project: project({ maxWorkerTurns: 2 }),
      runCounts: { workerTurns: 2, failedRuns: 0 },
      jobCounts: { failedJobs: 0, staleJobs: 0 },
      now: new Date("2026-08-09T00:00:00Z")
    });

    expect(result.status).toBe("budget_exhausted");
  });
});

function gate(key: string, label: string, status: ProgressGateSummary["status"]): ProgressGateSummary {
  return {
    key,
    label,
    phase: "implementation",
    status,
    weight: 1,
    evidenceArtifactId: null,
    updatedAt: new Date(0).toISOString()
  };
}

function project(patch: Partial<ProjectDetail> = {}): ProjectDetail {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    projectName: "Demo",
    appName: "Demo",
    packageName: "com.example.demo",
    projectType: "new",
    repositoryUrl: "ssh://example/demo.git",
    projectDir: "/tmp/demo",
    status: "running",
    currentPhase: "implementation",
    maxExecutionHours: 24,
    maxWorkerTurns: 200,
    remoteReachable: true,
    currentVersion: "0.1.0",
    lastCommitSha: null,
    lastPushedCommitSha: null,
    latestWorkerResponse: null,
    createdAt: "2026-08-08T00:00:00.000Z",
    updatedAt: "2026-08-08T00:00:00.000Z",
    progress: {
      totalGates: 2,
      completedGates: 0,
      percent: 0,
      gates: [
        gate("core_features", "Core features", "pending"),
        gate("external_user_actions", "External actions", "pending")
      ]
    },
    timeline: [],
    currentSupervisorPrompt: null,
    verification: {
      overallStatus: "pass",
      latestTier: "T4",
      recent: []
    },
    userRequiredItems: [
      {
        key: "api_keys",
        label: "API keys",
        status: "needed",
        requiredForProduction: true,
        canContinueWithoutIt: false,
        secret: true,
        lastValidation: null,
        updatedAt: new Date(0).toISOString()
      }
    ],
    supervisorInstructions: [],
    recentArtifacts: [{ id: "a1", runId: null, artifactType: "build", path: "/tmp/a", sizeBytes: 1, redacted: false, createdAt: new Date(0).toISOString() }],
    recentExports: [],
    finalStatusSummary: "Running.",
    ...patch
  };
}
