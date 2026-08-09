import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import cors from "@fastify/cors";
import cookie from "@fastify/cookie";
import fastifyStatic from "@fastify/static";
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

  const webDistDir = resolve(config.WEB_DIST_DIR);
  if (existsSync(webDistDir)) {
    await server.register(fastifyStatic, {
      root: webDistDir,
      prefix: "/"
    });

    server.setNotFoundHandler(async (request, reply) => {
      if (request.method === "GET" && !request.url.startsWith("/api/")) {
        return reply.type("text/html").send(await readFile(join(webDistDir, "index.html")));
      }

      return reply.code(404).send({
        error: "not_found"
      });
    });
  }

  return server;
}
