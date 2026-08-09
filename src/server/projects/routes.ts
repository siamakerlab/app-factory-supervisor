import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { GitAutomationService } from "./gitAutomation.js";
import { commitUnitWorkSchema, createProjectSchema, pushPhaseSchema } from "./schema.js";
import type { ProjectService } from "./service.js";

export function registerProjectRoutes(
  server: FastifyInstance,
  projectService: ProjectService,
  gitAutomationService: GitAutomationService
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
