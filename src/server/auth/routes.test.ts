import Fastify from "fastify";
import { describe, expect, it } from "vitest";

import type { AuthService } from "./service.js";
import { registerAuthRoutes } from "./routes.js";
import { loadConfig } from "../config.js";

describe("auth route guard", () => {
  it("allows frontend routes before admin setup but blocks protected APIs", async () => {
    const authService = {
      isAdminConfigured: () => Promise.resolve(false),
      getSession: () => Promise.resolve(null)
    } as Partial<AuthService> as AuthService;
    const server = Fastify();
    registerAuthRoutes(server, authService, loadConfig({ NODE_ENV: "test" }));
    server.get("/", () => ({ ok: true }));
    server.get("/api/private", () => ({ ok: true }));

    const page = await server.inject({
      method: "GET",
      url: "/"
    });
    const api = await server.inject({
      method: "GET",
      url: "/api/private"
    });

    expect(page.statusCode).toBe(200);
    expect(page.json()).toEqual({ ok: true });
    expect(api.statusCode).toBe(428);
    expect(api.json()).toEqual({ error: "setup_required" });
  });
});
