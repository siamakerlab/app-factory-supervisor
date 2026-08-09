import type { FastifyInstance } from "fastify";

import type { CodexAuthService } from "./auth.js";

export function registerCodexAuthRoutes(server: FastifyInstance, codexAuthService: CodexAuthService): void {
  server.get("/api/codex/auth", async () => codexAuthService.getStatus());

  server.post("/api/codex/auth/device/start", async () => codexAuthService.startDeviceLogin());

  server.post("/api/codex/auth/device/cancel", () => ({
    login: codexAuthService.cancelDeviceLogin()
  }));
}
