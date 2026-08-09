import type { FastifyInstance, FastifyReply } from "fastify";
import { z, ZodError } from "zod";

import type { CodexRunnerService } from "./service.js";

const runCodexSchema = z.object({
  projectId: z.string().uuid(),
  role: z.enum(["supervisor", "worker"]),
  prompt: z.string().min(1).max(20_000),
  executable: z.string().min(1).max(500).optional()
});

export function registerCodexRunnerRoutes(
  server: FastifyInstance,
  codexRunnerService: CodexRunnerService
): void {
  server.post("/api/codex/runner/command", async (request, reply) => {
    try {
      const body = runCodexSchema.parse(request.body);
      return await codexRunnerService.buildCommand(body);
    } catch (error) {
      return handleRunnerError(error, reply);
    }
  });

  server.post("/api/codex/runner/run", async (request, reply) => {
    try {
      const body = runCodexSchema.parse(request.body);
      return await codexRunnerService.run(body);
    } catch (error) {
      return handleRunnerError(error, reply);
    }
  });
}

function handleRunnerError(error: unknown, reply: FastifyReply) {
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: "invalid_codex_runner_request",
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
