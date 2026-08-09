import type { FastifyInstance } from "fastify";

import type { NotificationService } from "./service.js";

export function registerNotificationRoutes(
  server: FastifyInstance,
  notificationService: NotificationService
): void {
  server.post("/api/notifications/test-email", async () => notificationService.sendTestEmail());
}
