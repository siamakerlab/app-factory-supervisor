import { buildServer } from "./app.js";
import { AuthService } from "./auth/service.js";
import { registerCapabilityRoutes } from "./capabilities/routes.js";
import { CapabilityService } from "./capabilities/service.js";
import { CodexCompatibilityService } from "./codex/compatibility.js";
import { CodexDocsIndexService } from "./codex/docs.js";
import { registerCodexRoutes } from "./codex/routes.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { ensureRuntimeDirectories, getRuntimePaths } from "./runtime/paths.js";
import { registerFail2banRoutes } from "./security/fail2ban/routes.js";
import { registerSetupRoutes } from "./setup/routes.js";
import { SetupService } from "./setup/service.js";
import { SettingsService } from "./settings/service.js";
import { registerToolchainRoutes } from "./toolchain/routes.js";
import { ToolchainService } from "./toolchain/service.js";

const config = loadConfig();
const database = createDatabase(config);
const readiness = {
  migrated: false
};
const settingsService = new SettingsService(database);
const authService = new AuthService(database, config);
const setupService = new SetupService(database, config);
const codexCompatibilityService = new CodexCompatibilityService(database, config);
const codexDocsIndexService = new CodexDocsIndexService(database, config);
const toolchainService = new ToolchainService(database, config);
const capabilityService = new CapabilityService(database, config);
const server = await buildServer({
  readiness,
  authService,
  settingsService
});
registerFail2banRoutes(server, database);
registerSetupRoutes(server, setupService);
registerCodexRoutes(server, codexCompatibilityService, codexDocsIndexService);
registerToolchainRoutes(server, toolchainService);
registerCapabilityRoutes(server, capabilityService);

await ensureRuntimeDirectories(getRuntimePaths(config));
await runMigrations(database);
readiness.migrated = true;

const shutdown = async () => {
  await server.close();
  await database.close();
};

process.once("SIGTERM", () => {
  void shutdown().then(() => process.exit(0));
});

process.once("SIGINT", () => {
  void shutdown().then(() => process.exit(0));
});

await server.listen({
  host: config.APP_HOST,
  port: config.APP_PORT
});
