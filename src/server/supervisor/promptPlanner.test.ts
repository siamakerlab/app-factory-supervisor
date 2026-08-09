import { describe, expect, it } from "vitest";

import type { ProjectDetail } from "../projects/service.js";
import { planNextWorkerPrompt } from "./promptPlanner.js";

describe("planNextWorkerPrompt", () => {
  it("may answer with a single worker option letter", () => {
    const prompt = planNextWorkerPrompt(
      project({
        latestWorkerResponse: "A. Continue implementation\nB. Run review"
      })
    );

    expect(prompt.prompt).toBe("A");
    expect(prompt.source).toBe("worker_option");
    expect(prompt.wordCount).toBe(1);
    expect(prompt.lifecycleArea).toBeNull();
  });

  it("may answer with a single option letter from structured worker output", () => {
    const prompt = planNextWorkerPrompt(
      project({
        latestWorkerResponse: JSON.stringify({
          taskType: "implementation",
          summary: "Done",
          changedFiles: [],
          verification: "T1 pass",
          blockers: [],
          nextActions: [],
          suggestedOptions: [
            { option: "B", prompt: "Review the implementation" },
            { option: "C", prompt: "Run tests" }
          ]
        })
      })
    );

    expect(prompt.prompt).toBe("B");
    expect(prompt.source).toBe("worker_option");
    expect(prompt.wordCount).toBe(1);
  });

  it("can read option-prefixed next actions from structured worker output", () => {
    const prompt = planNextWorkerPrompt(
      project({
        latestWorkerResponse: JSON.stringify({
          nextActions: ["C. Run focused verification"]
        })
      })
    );

    expect(prompt.prompt).toBe("C");
    expect(prompt.source).toBe("worker_option");
  });

  it("keeps generated worker prompts under 300 words", () => {
    const prompt = planNextWorkerPrompt(
      project({
        supervisorInstructions: [
          {
            id: "instruction-1",
            instruction: Array.from({ length: 500 }, () => "word").join(" "),
            attachmentArtifactId: null,
            priority: "high",
            applyAfterCurrentWorkerRun: true,
            status: "queued",
            createdAt: new Date(0).toISOString(),
            consideredAt: null
          }
        ]
      })
    );

    expect(prompt.wordCount).toBeLessThanOrEqual(300);
    expect(prompt.usesQueuedInstructionId).toBe("instruction-1");
  });

  it("uses lifecycle templates for pending progress gates", () => {
    const prompt = planNextWorkerPrompt(project({}));

    expect(prompt.source).toBe("progress_gate");
    expect(prompt.lifecycleArea).toBe("implementation");
    expect(prompt.taskType).toBe("implementation");
    expect(prompt.verificationTier).toBe("T2");
  });
});

function project(patch: Partial<ProjectDetail>): ProjectDetail {
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
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    progress: {
      totalGates: 1,
      completedGates: 0,
      percent: 0,
      gates: [
        {
          key: "core_features",
          label: "Core features",
          phase: "implementation",
          status: "pending",
          weight: 1,
          evidenceArtifactId: null,
          updatedAt: new Date(0).toISOString()
        }
      ]
    },
    timeline: [],
    currentSupervisorPrompt: null,
    verification: {
      overallStatus: "unknown",
      latestTier: null,
      recent: []
    },
    userRequiredItems: [],
    supervisorInstructions: [],
    recentArtifacts: [],
    recentExports: [],
    finalStatusSummary: "Project is running.",
    ...patch
  };
}
