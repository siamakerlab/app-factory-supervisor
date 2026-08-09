import type { FastifyInstance } from "fastify";

import type { SetupService } from "./service.js";

export function registerSetupRoutes(server: FastifyInstance, setupService: SetupService): void {
  server.get("/api/setup/status", async () => setupService.getStatus());

  server.post("/api/setup/environment/verify", async () => setupService.verifyEnvironment());

  server.post("/api/setup/ssh-key", async () => setupService.ensureSshKey());
}
