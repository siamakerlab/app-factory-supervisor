import type { FastifyInstance } from "fastify";

import type { CodexCompatibilityService } from "./compatibility.js";

export function registerCodexRoutes(
  server: FastifyInstance,
  codexCompatibilityService: CodexCompatibilityService
): void {
  server.get("/api/codex/compatibility", async () => codexCompatibilityService.getLatestReview());

  server.post("/api/codex/compatibility/run", async () => codexCompatibilityService.runReview());

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
