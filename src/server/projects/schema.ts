import { z } from "zod";

const packageNameSchema = z
  .string()
  .trim()
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "package name must be a valid Android package");

export const createProjectSchema = z.object({
  projectName: z.string().trim().min(2).max(80),
  appName: z.string().trim().min(2).max(80),
  packageName: packageNameSchema,
  userAppPlan: z.string().trim().min(10).max(4000),
  projectType: z.enum(["new", "existing"]),
  repositoryUrl: z.string().trim().min(3).max(1000),
  globalGitUserName: z.string().trim().min(2).max(120),
  globalGitUserEmail: z.string().trim().email().max(200),
  maxExecutionHours: z.number().int().min(1).max(720).optional(),
  maxWorkerTurns: z.number().int().min(1).max(2000).optional()
});

export type CreateProjectInput = z.infer<typeof createProjectSchema>;

export const commitUnitWorkSchema = z.object({
  unitType: z.string().trim().min(2).max(80),
  scope: z.string().trim().min(2).max(160),
  verificationTier: z.enum(["T0", "T1", "T2", "T3", "T4"]).optional(),
  summary: z.string().trim().max(1000).optional()
});

export const pushPhaseSchema = z.object({
  phase: z.string().trim().min(2).max(120),
  summary: z.string().trim().max(1000).optional()
});

export const updateChecklistItemSchema = z.object({
  status: z.enum(["needed", "provided", "pass", "failed", "blocked"]),
  lastValidation: z.string().trim().max(1000).optional()
});

export const queueSupervisorInstructionSchema = z.object({
  instruction: z.string().trim().min(1).max(4000),
  attachmentArtifactId: z.string().uuid().nullable().optional(),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  applyAfterCurrentWorkerRun: z.boolean().default(true)
});
