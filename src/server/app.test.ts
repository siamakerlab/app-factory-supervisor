import { describe, expect, it } from "vitest";

import { buildServer } from "./app.js";
import type { AuthService, SessionUser } from "./auth/service.js";

describe("server health", () => {
  it("returns starting before migrations are ready", async () => {
    const server = await buildServer({
      readiness: {
        migrated: false
      }
    });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({
      status: "starting",
      service: "app-factory-supervisor",
      checks: {
        migrations: "pending"
      }
    });
  });

  it("returns ready after migrations are complete", async () => {
    const server = await buildServer({
      readiness: {
        migrated: true
      }
    });
    const response = await server.inject({
      method: "GET",
      url: "/health"
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "ready",
      service: "app-factory-supervisor",
      checks: {
        migrations: "pass"
      }
    });
  });
});

describe("auth/session integration", () => {
  it("sets a session cookie on login and resolves the authenticated session", async () => {
    const sessionUser: SessionUser = {
      userId: "user-1",
      adminId: "admin",
      sessionId: "session-1",
      expiresAt: new Date("2026-08-10T00:00:00.000Z").toISOString()
    };
    const authService = {
      isAdminConfigured: () => Promise.resolve(true),
      login: () =>
        Promise.resolve({
          ok: true as const,
          token: "session-token",
          user: sessionUser
        }),
      getSession: (token: string | undefined) =>
        Promise.resolve(token === "session-token" ? sessionUser : null)
    } as Partial<AuthService> as AuthService;
    const server = await buildServer({
      readiness: {
        migrated: true
      },
      authService
    });

    const login = await server.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        adminId: "admin",
        password: "correct horse battery staple"
      }
    });
    const cookie = login.headers["set-cookie"];

    expect(login.statusCode).toBe(200);
    expect(cookie).toContain("afs_session=session-token");

    const session = await server.inject({
      method: "GET",
      url: "/api/auth/session",
      headers: {
        cookie: Array.isArray(cookie) ? cookie[0] ?? "" : cookie ?? ""
      }
    });

    expect(session.statusCode).toBe(200);
    expect(session.json()).toEqual({
      user: sessionUser
    });
  });
});
