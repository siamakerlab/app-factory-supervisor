import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { ZodError } from "zod";

import type { AppConfig } from "../config.js";
import type { AuthService, SessionUser } from "./service.js";
import { changePasswordSchema, createAdminSchema, loginSchema } from "./schema.js";

declare module "fastify" {
  interface FastifyRequest {
    sessionUser?: SessionUser;
  }
}

const publicRoutes = new Set([
  "GET /health",
  "GET /api/setup/status",
  "POST /api/setup/admin",
  "POST /api/auth/login",
  "POST /api/codex/hooks/stop"
]);

export function registerAuthRoutes(
  server: FastifyInstance,
  authService: AuthService,
  config: AppConfig
): void {
  server.addHook("preHandler", async (request, reply) => {
    const routeKey = `${request.method} ${request.routeOptions.url}`;
    if (publicRoutes.has(routeKey)) {
      return;
    }

    const configured = await authService.isAdminConfigured();
    if (!configured) {
      return reply.code(428).send({
        error: "setup_required"
      });
    }

    if (request.routeOptions.url?.startsWith("/api/")) {
      const session = await authService.getSession(readSessionToken(request, config));
      if (!session) {
        return reply.code(401).send({
          error: "authentication_required"
        });
      }
      request.sessionUser = session;
    }
  });

  server.post("/api/setup/admin", async (request, reply) => {
    try {
      const body = createAdminSchema.parse(request.body);
      const user = await authService.createAdmin(body.adminId, body.password);
      return reply.code(201).send({
        adminId: user.adminId
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return sendValidationError(reply, error);
      }
      if (error instanceof Error && error.message === "admin_already_configured") {
        return reply.code(409).send({
          error: "admin_already_configured"
        });
      }
      throw error;
    }
  });

  server.post("/api/auth/login", async (request, reply) => {
    try {
      const body = loginSchema.parse(request.body);
      const loginContext: {
        ipAddress?: string;
        userAgent?: string;
      } = {
        ipAddress: request.ip
      };
      if (request.headers["user-agent"]) {
        loginContext.userAgent = request.headers["user-agent"];
      }
      const result = await authService.login(body.adminId, body.password, loginContext);
      if (!result.ok) {
        return reply.code(401).send({
          error: result.reason
        });
      }

      setSessionCookie(reply, config, result.token);
      return {
        user: result.user
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return sendValidationError(reply, error);
      }
      throw error;
    }
  });

  server.post("/api/auth/logout", async (request, reply) => {
    await authService.logout(readSessionToken(request, config));
    reply.clearCookie(config.SESSION_COOKIE_NAME, {
      path: "/"
    });
    return {
      ok: true
    };
  });

  server.get("/api/auth/session", (request) => ({
    user: request.sessionUser
  }));

  server.put("/api/auth/password", async (request, reply) => {
    try {
      const body = changePasswordSchema.parse(request.body);
      const sessionUser = request.sessionUser;
      if (!sessionUser) {
        return reply.code(401).send({
          error: "authentication_required"
        });
      }
      await authService.changePassword(sessionUser.userId, body.currentPassword, body.newPassword);
      reply.clearCookie(config.SESSION_COOKIE_NAME, {
        path: "/"
      });
      return {
        ok: true
      };
    } catch (error) {
      if (error instanceof ZodError) {
        return sendValidationError(reply, error);
      }
      if (error instanceof Error && error.message === "invalid_current_password") {
        return reply.code(400).send({
          error: "invalid_current_password"
        });
      }
      throw error;
    }
  });
}

function readSessionToken(request: FastifyRequest, config: AppConfig): string | undefined {
  const cookieValue = request.cookies[config.SESSION_COOKIE_NAME];
  if (cookieValue) {
    return cookieValue;
  }

  const authorization = request.headers.authorization;
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length);
  }

  return undefined;
}

function setSessionCookie(reply: FastifyReply, config: AppConfig, token: string): void {
  reply.setCookie(config.SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: config.SESSION_COOKIE_SECURE,
    path: "/",
    maxAge: config.SESSION_TTL_DAYS * 24 * 60 * 60
  });
}

function sendValidationError(reply: FastifyReply, error: ZodError) {
  return reply.code(400).send({
    error: "invalid_request",
    issues: error.issues
  });
}
