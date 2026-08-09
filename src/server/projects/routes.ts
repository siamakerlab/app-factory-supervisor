import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { GitAutomationService } from "./gitAutomation.js";
import type { JobService } from "../jobs/service.js";
import type { NotificationService } from "../notifications/service.js";
import { planNextWorkerPrompt } from "../supervisor/promptPlanner.js";
import {
  commitUnitWorkSchema,
  createProjectSchema,
  pushPhaseSchema,
  queueSupervisorInstructionSchema,
  updateChecklistItemSchema
} from "./schema.js";
import type { ProjectService } from "./service.js";

export function registerProjectRoutes(
  server: FastifyInstance,
  projectService: ProjectService,
  gitAutomationService: GitAutomationService,
  notificationService?: NotificationService,
  jobService?: JobService
): void {
  server.get("/api/projects", async () => ({
    projects: await projectService.listProjects()
  }));

  server.post("/api/projects", async (request, reply) => {
    try {
      const body = createProjectSchema.parse(request.body);
      return reply.code(201).send(await projectService.createProject(body));
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "invalid_project",
          issues: error.issues
        });
      }
      throw error;
    }
  });

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId",
    async (request, reply) => {
      const project = await projectService.getProjectDetail(request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return project;
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/status",
    async (request, reply) => {
      const project = await projectService.getProjectDetail(request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return project;
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/timeline",
    async (request, reply) => {
      const timeline = await projectService.getProjectTimeline(request.params.projectId);
      if (!timeline) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return { timeline };
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/checklist",
    async (request, reply) => {
      const checklist = await projectService.getProjectChecklist(request.params.projectId);
      if (!checklist) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return { checklist };
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/runs",
    async (request, reply) => {
      const runs = await projectService.getRunHistory(request.params.projectId);
      if (!runs) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return { runs };
    }
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/run/start",
    async (request, reply) => {
      const project = await projectService.getProjectDetail(request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      const nextPrompt = planNextWorkerPrompt(project);
      const job = jobService
        ? await jobService.enqueue({
            projectId: request.params.projectId,
            jobType: "supervisor_turn",
            priority: 10
          })
        : null;
      const startedProject = await projectService.startProjectRun(request.params.projectId);
      return reply.code(201).send({
        projectId: request.params.projectId,
        job,
        nextPrompt,
        project: startedProject ?? project
      });
    }
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/run/stop",
    async (request, reply) => {
      const project = await projectService.stopProjectRun(request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return project;
    }
  );

  server.put<{ Params: { projectId: string; itemKey: string } }>(
    "/api/projects/:projectId/checklist/:itemKey",
    async (request, reply) => {
      try {
        const body = updateChecklistItemSchema.parse(request.body);
        const project = await projectService.updateChecklistItem(
          request.params.projectId,
          request.params.itemKey,
          body
        );
        if (!project) {
          return reply.code(404).send({
            error: "checklist_item_not_found"
          });
        }
        return project;
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "invalid_checklist_item",
            issues: error.issues
          });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/supervisor/next-prompt",
    async (request, reply) => {
      const project = await projectService.getProjectDetail(request.params.projectId);
      if (!project) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      return planNextWorkerPrompt(project);
    }
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/completion-gate",
    async (request, reply) => {
      const result = await projectService.evaluateAndApplyCompletionGate(request.params.projectId);
      if (!result) {
        return reply.code(404).send({
          error: "project_not_found"
        });
      }
      const project = await projectService.getProjectDetail(request.params.projectId);
      const notification =
        project && notificationService
          ? await notificationService.sendTerminalProjectEmail({ project, completion: result })
          : { status: "skipped", summary: "Notification service unavailable." };
      return {
        ...result,
        notification
      };
    }
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/supervisor-instructions",
    async (request, reply) => {
      try {
        const body = queueSupervisorInstructionSchema.parse(request.body);
        const project = await projectService.queueSupervisorInstruction(request.params.projectId, {
          instruction: body.instruction,
          attachmentArtifactId: body.attachmentArtifactId ?? null,
          priority: body.priority,
          applyAfterCurrentWorkerRun: body.applyAfterCurrentWorkerRun,
          createdByUserId: request.sessionUser?.userId ?? null
        });
        if (!project) {
          return reply.code(404).send({
            error: "project_not_found"
          });
        }
        return reply.code(201).send(project);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "invalid_supervisor_instruction",
            issues: error.issues
          });
        }
        throw error;
      }
    }
  );

  server.get<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/git/events",
    async (request) => ({
      events: await gitAutomationService.getEvents(request.params.projectId)
    })
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/git/commit",
    async (request, reply) => {
      try {
        const body = commitUnitWorkSchema.parse(request.body);
        return await gitAutomationService.commitUnitWork(request.params.projectId, body);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "invalid_commit_request",
            issues: error.issues
          });
        }
        if (error instanceof Error && error.message === "project_not_found") {
          return reply.code(404).send({
            error: "project_not_found"
          });
        }
        throw error;
      }
    }
  );

  server.post<{ Params: { projectId: string } }>(
    "/api/projects/:projectId/git/push-phase",
    async (request, reply) => {
      try {
        const body = pushPhaseSchema.parse(request.body);
        return await gitAutomationService.pushPhase(request.params.projectId, body);
      } catch (error) {
        if (error instanceof ZodError) {
          return reply.code(400).send({
            error: "invalid_push_request",
            issues: error.issues
          });
        }
        if (error instanceof Error && error.message === "project_not_found") {
          return reply.code(404).send({
            error: "project_not_found"
          });
        }
        throw error;
      }
    }
  );
}
