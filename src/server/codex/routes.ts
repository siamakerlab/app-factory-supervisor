import type { FastifyInstance } from "fastify";
import { z, ZodError } from "zod";

import type { CodexCompatibilityService } from "./compatibility.js";
import type { CodexDocsIndexService } from "./docs.js";

const docsSearchSchema = z.object({
  query: z.string().min(1).max(500)
});

export function registerCodexRoutes(
  server: FastifyInstance,
  codexCompatibilityService: CodexCompatibilityService,
  codexDocsIndexService: CodexDocsIndexService
): void {
  server.get("/api/codex/compatibility", async () => codexCompatibilityService.getLatestReview());

  server.post("/api/codex/compatibility/run", async () => codexCompatibilityService.runReview());

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
    const accepted = await codexCompatibilityService.recordStopHookCallback({
      source: "codex_stop_hook",
      ipAddress: request.ip,
      bodyType: typeof request.body
    });
    if (!accepted) {
      return reply.code(500).send({
        ok: false
      });
    }
    return {
      ok: true
    };
  });
}
