import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import { registerAuthRoutes } from "./auth/routes.js";
import type { AuthService } from "./auth/service.js";
import type { SettingsService } from "./settings/service.js";
import { registerSettingsRoutes } from "./settings/routes.js";

export type ReadinessState = {
  migrated: boolean;
};

export type ServerDependencies = {
  readiness?: ReadinessState;
  authService?: AuthService;
  settingsService?: SettingsService;
};

export async function buildServer(dependencies: ServerDependencies = {}) {
  const config = loadConfig();
  const readiness = dependencies.readiness ?? { migrated: false };
  const server = Fastify({
    trustProxy: config.TRUST_PROXY,
    logger: {
      level: config.NODE_ENV === "development" ? "debug" : "info"
    }
  });

  await server.register(cors, {
    origin: false
  });
  await server.register(cookie);

  server.get("/health", (_request, reply) => {
    const statusCode = readiness.migrated ? 200 : 503;
    return reply.code(statusCode).send({
      status: readiness.migrated ? "ready" : "starting",
      service: "app-factory-supervisor",
      checks: {
        migrations: readiness.migrated ? "pass" : "pending"
      }
    });
  });

  if (dependencies.authService) {
    registerAuthRoutes(server, dependencies.authService, config);
  }

  if (dependencies.settingsService) {
    registerSettingsRoutes(server, dependencies.settingsService);
  }

  return server;
}
