import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { JobService } from "./service.js";

const enqueueJobSchema = z.object({
  projectId: z.string().uuid(),
  jobType: z.enum([
    "supervisor_turn",
    "worker_turn",
    "verification",
    "setup",
    "notification",
    "project_export"
  ]),
  priority: z.number().int().min(-100).max(100).optional(),
  maxAttempts: z.number().int().min(1).max(10).optional()
});

export function registerJobRoutes(server: FastifyInstance, jobService: JobService): void {
  server.get("/api/jobs/status", async () => jobService.getStatus());

  server.post("/api/jobs", async (request, reply) => {
    try {
      const body = enqueueJobSchema.parse(request.body);
      return reply.code(201).send(
        await jobService.enqueue({
          projectId: body.projectId,
          jobType: body.jobType,
          ...(body.priority !== undefined ? { priority: body.priority } : {}),
          ...(body.maxAttempts !== undefined ? { maxAttempts: body.maxAttempts } : {})
        })
      );
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "invalid_job",
          issues: error.issues
        });
      }
      throw error;
    }
  });

  server.post("/api/jobs/tick", async () => jobService.tick());

  server.post("/api/jobs/recover-stale", async () => ({
    staleJobs: await jobService.recoverStaleJobs()
  }));
}
