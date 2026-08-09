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
  WEB_DIST_DIR: z.string().min(1).default("./dist/web"),
  AUTH_LOG_PATH: z.string().min(1).default("./data/logs/auth.log"),
  CODEX_HOME_DIR: z.string().min(1).optional(),
  CODEX_SCHEMA_DIR: z.string().min(1).optional(),
  CODEX_COMPATIBILITY_REPORT_PATH: z.string().min(1).optional(),
  CODEX_SMOKE_DIR: z.string().min(1).optional(),
  DOCS_MCP_STORE_PATH: z.string().min(1).optional(),
  CODEX_DOCS_REPORT_PATH: z.string().min(1).optional(),
  TRUST_PROXY: z.coerce.boolean().default(false),
  SESSION_COOKIE_NAME: z.string().min(1).default("afs_session"),
  SESSION_COOKIE_SECURE: z.coerce.boolean().default(false),
  SESSION_TTL_DAYS: z.coerce.number().int().positive().default(7)
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  return envSchema.parse(env);
}
