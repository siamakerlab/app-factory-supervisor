import cors from "@fastify/cors";
import Fastify from "fastify";

import { loadConfig } from "./config.js";

export type ReadinessState = {
  migrated: boolean;
};

export async function buildServer(readiness: ReadinessState = { migrated: false }) {
  const config = loadConfig();
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

  return server;
}
