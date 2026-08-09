import { z } from "zod";

export const publicSettingsSchema = z.object({
  defaultMaxExecutionHours: z.number().int().min(1).max(24 * 365),
  defaultMaxWorkerTurns: z.number().int().min(1).max(10000),
  defaultRetryLimit: z.number().int().min(0).max(10),
  loginFailuresBeforeBan: z.number().int().min(1).max(20),
  minFreeMemoryMb: z.number().int().min(128).max(1048576),
  minAvailableMemoryPercent: z.number().int().min(1).max(100),
  minFreeDiskMb: z.number().int().min(1024).max(104857600),
  maxCpuUsagePercent: z.number().int().min(1).max(100).nullable(),
  maxLoadAverage: z.number().positive().max(1024).nullable(),
  memoryRecheckIntervalSeconds: z.number().int().min(10).max(3600),
  resourceRecheckIntervalSeconds: z.number().int().min(10).max(3600),
  staleHeartbeatSeconds: z.number().int().min(30).max(86400),
  workerPollIntervalSeconds: z.number().int().min(30).max(86400),
  codexTurnTimeoutSeconds: z.number().int().min(60).max(86400),
  buildTimeoutSeconds: z.number().int().min(60).max(86400),
  testTimeoutSeconds: z.number().int().min(60).max(86400),
  mcpToolTimeoutSeconds: z.number().int().min(10).max(3600),
  exportTimeoutSeconds: z.number().int().min(60).max(86400),
  emulatorTimeoutSeconds: z.number().int().min(60).max(86400),
  emailNotificationsEnabled: z.boolean(),
  notificationRecipientEmail: z.string().email().nullable(),
  smtpConfigured: z.boolean()
});

export const updatePublicSettingsSchema = publicSettingsSchema
  .omit({
    smtpConfigured: true
  })
  .partial()
  .strict();

export type PublicSettings = z.infer<typeof publicSettingsSchema>;
export type UpdatePublicSettings = z.infer<typeof updatePublicSettingsSchema>;

export const smtpSettingsSchema = z.object({
  host: z.string().trim().min(1).max(300),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1).max(300),
  password: z.string().min(1).max(2000),
  fromEmail: z.string().trim().email().max(300),
  recipientEmail: z.string().trim().email().max(300)
});

export type SmtpSettingsInput = z.infer<typeof smtpSettingsSchema>;
