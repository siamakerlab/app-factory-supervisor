import cors from "@fastify/cors";
import Fastify from "fastify";

import { loadConfig } from "./config.js";
import type { SettingsService } from "./settings/service.js";
import { registerSettingsRoutes } from "./settings/routes.js";

export type ReadinessState = {
  migrated: boolean;
};

export type ServerDependencies = {
  readiness?: ReadinessState;
  settingsService?: SettingsService;
};

export async function buildServer(dependencies: ServerDependencies = {}) {
  const config = loadConfig();
  const readiness = dependencies.readiness ?? { migrated: false };
  const server = Fastify({
    logger: {
      level: config.NODE_ENV === "development" ? "debug" : "info"
    }
  });

  await server.register(cors, {
    origin: false
  });

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

  if (dependencies.settingsService) {
    registerSettingsRoutes(server, dependencies.settingsService);
  }

  return server;
}
