import type { FastifyInstance } from "fastify";

import type { AppConfig } from "../../config.js";
import { getSecurityIsolationStatus } from "../isolation.js";

export function registerSecurityIsolationRoutes(server: FastifyInstance, config: AppConfig): void {
  server.get("/api/security/isolation", () => getSecurityIsolationStatus(config));
}
