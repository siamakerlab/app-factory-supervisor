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
  server.addHook("onRequest", async (request, reply) => {
    reply.header("x-content-type-options", "nosniff");
    reply.header("x-frame-options", "DENY");
    reply.header("referrer-policy", "no-referrer");
    reply.header("permissions-policy", "camera=(), microphone=(), geolocation=()");
    reply.header(
      "content-security-policy",
      [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "frame-ancestors 'none'",
        "form-action 'self'"
      ].join("; ")
    );
    if (request.url.startsWith("/api/")) {
      reply.header("cache-control", "no-store");
    }
  });
  server.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith("/api/") || !unsafeHttpMethods.has(request.method)) {
      return;
    }
    const origin = request.headers.origin ?? originFromReferer(request.headers.referer);
    if (!origin) {
      return;
    }
    if (!allowedRequestOrigins(request.headers.host).has(origin)) {
      return reply.code(403).send({
        error: "csrf_origin_rejected"
      });
    }
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

const unsafeHttpMethods = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function originFromReferer(referer: string | undefined): string | null {
  if (!referer) {
    return null;
  }
  try {
    return new URL(referer).origin;
  } catch {
    return null;
  }
}

function allowedRequestOrigins(host: string | undefined): Set<string> {
  if (!host) {
    return new Set();
  }
  return new Set([`http://${host}`, `https://${host}`]);
}
