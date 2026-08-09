import cors from "@fastify/cors";
import Fastify from "fastify";

import { loadConfig } from "./config.js";

export async function buildServer() {
  const config = loadConfig();
  const server = Fastify({
    logger: {
      level: config.NODE_ENV === "development" ? "debug" : "info"
    }
  });

  await server.register(cors, {
    origin: false
  });

  server.get("/health", () => ({
    status: "ok",
    service: "app-factory-supervisor"
  }));

  return server;
}
