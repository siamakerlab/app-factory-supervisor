import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import { createProjectSchema } from "./schema.js";
import type { ProjectService } from "./service.js";

export function registerProjectRoutes(server: FastifyInstance, projectService: ProjectService): void {
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
}
