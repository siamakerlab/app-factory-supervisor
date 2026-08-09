import type { FastifyInstance } from "fastify";

import type { ToolchainService } from "./service.js";

export function registerToolchainRoutes(
  server: FastifyInstance,
  toolchainService: ToolchainService
): void {
  server.get("/api/toolchain/status", async () => toolchainService.getStatus());

  server.post("/api/toolchain/install", async () => toolchainService.install());
}
