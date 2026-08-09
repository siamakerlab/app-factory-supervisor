import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  APP_HOST: z.string().default("0.0.0.0"),
  APP_PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z
    .string()
    .min(1)
    .default("postgres://app_factory:app_factory@localhost:5432/app_factory_supervisor"),
  APP_DATA_DIR: z.string().min(1).default("./data"),
  APP_PROJECTS_DIR: z.string().min(1).default("./projects"),
  SESSION_COOKIE_NAME: z.string().min(1).default("afs_session"),
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
