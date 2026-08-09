import type { CodexRunnerService } from "../codex/runner/service.js";
import type { ProjectService } from "../projects/service.js";
import { planNextWorkerPrompt } from "../supervisor/promptPlanner.js";
import type { JobHandlers, JobSummary } from "./service.js";

type JobEnqueuer = {
  enqueue(input: {
    projectId: string;
    jobType: "worker_turn";
    priority?: number;
    maxAttempts?: number;
    metadata?: Record<string, unknown>;
  }): Promise<JobSummary>;
};

export function createAutomationJobHandlers(input: {
  projectService: ProjectService;
  codexRunnerService: CodexRunnerService;
  jobEnqueuer: JobEnqueuer;
}): JobHandlers {
  return {
    supervisor_turn: async (job) => {
      const project = await input.projectService.getProjectDetail(job.projectId);
      if (!project) {
        throw new Error("project_not_found");
      }
      const nextPrompt = planNextWorkerPrompt(project);
      await input.projectService.recordSupervisorPrompt(job.projectId, nextPrompt.prompt, {
        source: nextPrompt.source,
        lifecycleArea: nextPrompt.lifecycleArea,
        taskType: nextPrompt.taskType,
        verificationTier: nextPrompt.verificationTier,
        usesQueuedInstructionId: nextPrompt.usesQueuedInstructionId,
        wordCount: nextPrompt.wordCount
      });
      const workerJob = await input.jobEnqueuer.enqueue({
        projectId: job.projectId,
        jobType: "worker_turn",
        priority: Math.max(job.priority - 1, 0),
        metadata: {
          prompt: nextPrompt.prompt,
          supervisorJobId: job.id,
          promptSource: nextPrompt.source,
          verificationTier: nextPrompt.verificationTier
        }
      });
      return {
        summary: `Queued worker turn ${workerJob.id} from ${nextPrompt.source}.`,
        metadata: {
          workerJobId: workerJob.id,
          promptSource: nextPrompt.source,
          wordCount: nextPrompt.wordCount
        }
      };
    },
    worker_turn: async (job) => {
      const prompt = await resolveWorkerPrompt(job, input.projectService);
      const result = await input.codexRunnerService.run({
        projectId: job.projectId,
        role: "worker",
        prompt
      });
      if (result.status === "failed") {
        throw new Error(`worker_turn_failed:${result.exitCode ?? "unknown"}`);
      }
      return {
        summary: `Worker turn ${result.runId} completed.`,
        metadata: {
          runId: result.runId,
          exitCode: result.exitCode,
          finalMessageArtifactId: result.finalMessageArtifactId
        }
      };
    }
  };
}

async function resolveWorkerPrompt(
  job: JobSummary,
  projectService: ProjectService
): Promise<string> {
  if (typeof job.metadata.prompt === "string" && job.metadata.prompt.trim()) {
    return job.metadata.prompt;
  }
  const project = await projectService.getProjectDetail(job.projectId);
  if (!project) {
    throw new Error("project_not_found");
  }
  return planNextWorkerPrompt(project).prompt;
}
