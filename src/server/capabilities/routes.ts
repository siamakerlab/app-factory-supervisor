import type { FastifyInstance } from "fastify";

import type { CapabilityService } from "./service.js";

export function registerCapabilityRoutes(
  server: FastifyInstance,
  capabilityService: CapabilityService
): void {
  server.get("/api/capabilities/status", async () => capabilityService.getStatus());

  server.post("/api/capabilities/install", async () => capabilityService.install());
}
