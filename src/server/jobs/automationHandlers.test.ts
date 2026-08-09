import { describe, expect, it, vi } from "vitest";

import type { CodexRunnerService } from "../codex/runner/service.js";
import type { ProjectDetail, ProjectService } from "../projects/service.js";
import { createAutomationJobHandlers } from "./automationHandlers.js";
import type { JobSummary } from "./service.js";

const projectId = "11111111-1111-4111-8111-111111111111";

describe("automation job handlers", () => {
  it("records a supervisor prompt and enqueues a worker turn", async () => {
    const recordSupervisorPrompt = vi.fn().mockResolvedValue(undefined);
    const enqueue = vi.fn().mockResolvedValue(job({ id: "worker-job-1", jobType: "worker_turn" }));
    const handlers = createAutomationJobHandlers({
      projectService: {
        getProjectDetail: vi.fn().mockResolvedValue(projectDetail()),
        recordSupervisorPrompt
      } as Partial<ProjectService> as ProjectService,
      codexRunnerService: {} as CodexRunnerService,
      jobEnqueuer: {
        enqueue
      }
    });

    const result = await handlers.supervisor_turn!(job({ jobType: "supervisor_turn" }));

    const promptCall = recordSupervisorPrompt.mock.calls[0];
    const enqueueCall = enqueue.mock.calls[0];
    const promptMetadata = promptCall?.[2] as Record<string, unknown>;
    const enqueueInput = enqueueCall?.[0] as {
      projectId: string;
      jobType: string;
      metadata: Record<string, unknown>;
    };

    expect(promptCall?.[0]).toBe(projectId);
    expect(typeof promptCall?.[1]).toBe("string");
    expect(promptMetadata.source).toBe("progress_gate");
    expect(typeof promptMetadata.wordCount).toBe("number");
    expect(enqueueInput.projectId).toBe(projectId);
    expect(enqueueInput.jobType).toBe("worker_turn");
    expect(typeof enqueueInput.metadata.prompt).toBe("string");
    expect(enqueueInput.metadata.supervisorJobId).toBe("job-1");
    expect(result.summary).toContain("Queued worker turn");
  });

  it("runs Codex with the worker prompt stored in job metadata", async () => {
    const run = vi.fn().mockResolvedValue({
      runId: "run-1",
      status: "succeeded",
      exitCode: 0,
      finalMessageArtifactId: "artifact-1"
    });
    const enqueue = vi.fn().mockResolvedValue(job({ id: "supervisor-job-2", jobType: "supervisor_turn" }));
    const handlers = createAutomationJobHandlers({
      projectService: {
        evaluateAndApplyCompletionGate: vi.fn().mockResolvedValue({
          status: "running"
        })
      } as Partial<ProjectService> as ProjectService,
      codexRunnerService: {
        run
      } as Partial<CodexRunnerService> as CodexRunnerService,
      jobEnqueuer: {
        enqueue
      }
    });

    const result = await handlers.worker_turn!(
      job({
        jobType: "worker_turn",
        metadata: {
          prompt: "Implement the next roadmap item."
        }
      })
    );

    expect(run).toHaveBeenCalledWith({
      projectId,
      role: "worker",
      prompt: "Implement the next roadmap item."
    });
    expect(enqueue).toHaveBeenCalledWith({
      projectId,
      jobType: "supervisor_turn",
      priority: 10,
      metadata: {
        previousWorkerJobId: "job-1",
        previousWorkerRunId: "run-1"
      }
    });
    expect(result.metadata).toMatchObject({
      runId: "run-1",
      exitCode: 0,
      finalMessageArtifactId: "artifact-1",
      completionStatus: "running",
      nextSupervisorJobId: "supervisor-job-2"
    });
  });

  it("does not enqueue another supervisor turn after a terminal completion gate", async () => {
    const enqueue = vi.fn();
    const handlers = createAutomationJobHandlers({
      projectService: {
        evaluateAndApplyCompletionGate: vi.fn().mockResolvedValue({
          status: "production_ready_user_action_required"
        })
      } as Partial<ProjectService> as ProjectService,
      codexRunnerService: {
        run: vi.fn().mockResolvedValue({
          runId: "run-1",
          status: "succeeded",
          exitCode: 0,
          finalMessageArtifactId: "artifact-1"
        })
      } as Partial<CodexRunnerService> as CodexRunnerService,
      jobEnqueuer: {
        enqueue
      }
    });

    const result = await handlers.worker_turn!(
      job({
        jobType: "worker_turn",
        metadata: {
          prompt: "Summarize release readiness."
        }
      })
    );

    expect(enqueue).not.toHaveBeenCalled();
    expect(result.metadata).toMatchObject({
      completionStatus: "production_ready_user_action_required",
      nextSupervisorJobId: null
    });
  });
});

function job(overrides: Partial<JobSummary> = {}): JobSummary {
  return {
    id: "job-1",
    projectId,
    runId: null,
    jobType: "supervisor_turn",
    status: "queued",
    priority: 10,
    attempts: 0,
    maxAttempts: 1,
    lockedBy: null,
    heartbeatAt: null,
    timeoutAt: null,
    staleAfter: null,
    resourceWaitReason: null,
    scheduledAt: "2026-08-09T00:00:00.000Z",
    startedAt: null,
    finishedAt: null,
    errorSummary: null,
    metadata: {},
    ...overrides
  };
}

function projectDetail(): ProjectDetail {
  return {
    id: projectId,
    projectName: "Demo Project",
    appName: "Demo App",
    packageName: "kr.example.demo",
    projectType: "new",
    repositoryUrl: "ssh://git@example.com/demo.git",
    projectDir: "/tmp/demo",
    status: "running",
    currentPhase: "product definition",
    maxExecutionHours: 24,
    maxWorkerTurns: 200,
    remoteReachable: true,
    currentVersion: "0.1.0+260809001",
    lastCommitSha: null,
    lastPushedCommitSha: null,
    latestWorkerResponse: null,
    createdAt: "2026-08-09T00:00:00.000Z",
    updatedAt: "2026-08-09T00:00:00.000Z",
    progress: {
      totalGates: 1,
      completedGates: 0,
      percent: 0,
      gates: [
        {
          key: "mvp_written",
          label: "MVP written",
          phase: "product definition",
          status: "pending",
          weight: 1,
          evidenceArtifactId: null,
          updatedAt: "2026-08-09T00:00:00.000Z"
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
    finalStatusSummary: "Automation is running."
  };
}
