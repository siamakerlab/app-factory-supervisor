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
