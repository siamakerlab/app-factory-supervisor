import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";

import type { SettingsService } from "./service.js";

export function registerSettingsRoutes(
  server: FastifyInstance,
  settingsService: SettingsService
): void {
  server.get("/api/settings", async () => settingsService.getPublicSettings());

  server.put("/api/settings", async (request, reply) => {
    try {
      return await settingsService.updatePublicSettings(request.body, {
        actorType: "admin",
        ipAddress: request.ip
      });
    } catch (error) {
      if (error instanceof ZodError) {
        return reply.code(400).send({
          error: "invalid_settings",
          issues: error.issues
        });
      }
      throw error;
    }
  });
}
