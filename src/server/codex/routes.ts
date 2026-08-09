import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { CodexCompatibilityService } from "./compatibility.js";
import type { CodexDocsIndexService } from "./docs.js";
import type { CodexHookService } from "./hooks.js";

const docsSearchSchema = z.object({
  query: z.string().min(1).max(500)
});

const installHooksSchema = z.object({
  force: z.boolean().optional()
});

const stopHookSchema = z.object({
  source: z.string().max(200).optional(),
  projectId: z.string().uuid().nullable().optional(),
  runId: z.string().uuid().nullable().optional(),
  role: z.enum(["supervisor", "worker"]).nullable().optional(),
  event: z.string().max(100).optional()
});

export function registerCodexRoutes(
  server: FastifyInstance,
  codexCompatibilityService: CodexCompatibilityService,
  codexDocsIndexService: CodexDocsIndexService,
  codexHookService: CodexHookService
): void {
  server.get("/api/codex/compatibility", async () => codexCompatibilityService.getLatestReview());

  server.post("/api/codex/compatibility/run", async () => codexCompatibilityService.runReview());

  server.get("/api/codex/hooks/status", async () => codexHookService.getStatus());

  server.post("/api/codex/hooks/install", async (request, reply) => {
    try {
      const body = installHooksSchema.parse(request.body ?? {});
      return await codexHookService.installManagedHooks(body.force ?? false);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "invalid_hooks_install_request",
          issues: error.issues
        });
      }
      throw error;
    }
  });

  server.post("/api/codex/hooks/poll-worker-state", async () => codexHookService.pollActiveWorkerState());

  server.get("/api/codex/docs", async () => codexDocsIndexService.getStatus());

  server.post("/api/codex/docs/index", async () => codexDocsIndexService.runIndex());

  server.post("/api/codex/docs/search", async (request, reply) => {
    try {
      const body = docsSearchSchema.parse(request.body);
      return await codexDocsIndexService.search(body.query);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "invalid_docs_search",
          issues: error.issues
        });
      }
      throw error;
    }
  });

  server.post("/api/codex/hooks/stop", async (request, reply) => {
    try {
      const body = stopHookSchema.parse(request.body ?? {});
      const payload = {
        source: body.source ?? "codex_stop_hook",
        ipAddress: request.ip,
        bodyType: typeof request.body,
        ...(body.projectId !== undefined ? { projectId: body.projectId } : {}),
        ...(body.runId !== undefined ? { runId: body.runId } : {}),
        ...(body.role !== undefined ? { role: body.role } : {}),
        ...(body.event !== undefined ? { event: body.event } : {})
      };
      return await codexHookService.recordStopHookCallback(payload);
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          ok: false,
          error: "invalid_stop_hook_payload",
          issues: error.issues
        });
      }
      throw error;
    }
  });
}
