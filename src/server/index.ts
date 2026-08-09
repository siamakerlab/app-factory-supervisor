import { buildServer } from "./app.js";
import { registerArtifactRoutes } from "./artifacts/routes.js";
import { ArtifactService } from "./artifacts/service.js";
import { AuthService } from "./auth/service.js";
import { registerCapabilityRoutes } from "./capabilities/routes.js";
import { CapabilityService } from "./capabilities/service.js";
import { CodexAuthService } from "./codex/auth.js";
import { registerCodexAuthRoutes } from "./codex/authRoutes.js";
import { CodexCompatibilityService } from "./codex/compatibility.js";
import { CodexDocsIndexService } from "./codex/docs.js";
import { CodexHookService } from "./codex/hooks.js";
import { registerCodexRoutes } from "./codex/routes.js";
import { registerCodexRunnerRoutes } from "./codex/runner/routes.js";
import { CodexRunnerService } from "./codex/runner/service.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { registerProjectExportRoutes } from "./exports/routes.js";
import { ProjectExportService } from "./exports/service.js";
import { createAutomationJobHandlers } from "./jobs/automationHandlers.js";
import { registerJobRoutes } from "./jobs/routes.js";
import { JobService } from "./jobs/service.js";
import { registerNotificationRoutes } from "./notifications/routes.js";
import { NotificationService } from "./notifications/service.js";
import { GitAutomationService } from "./projects/gitAutomation.js";
import { registerProjectRoutes } from "./projects/routes.js";
import { ProjectService } from "./projects/service.js";
import { ensureRuntimeDirectories, getRuntimePaths } from "./runtime/paths.js";
import { registerFail2banRoutes } from "./security/fail2ban/routes.js";
import { registerSecurityIsolationRoutes } from "./security/isolation/routes.js";
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
const settingsService = new SettingsService(database, config);
const artifactService = new ArtifactService(database, config);
const projectExportService = new ProjectExportService(database, config);
const notificationService = new NotificationService(database, config);
const authService = new AuthService(database, config);
const setupService = new SetupService(database, config);
const codexAuthService = new CodexAuthService(config);
const codexCompatibilityService = new CodexCompatibilityService(database, config);
const codexDocsIndexService = new CodexDocsIndexService(database, config);
const codexHookService = new CodexHookService(database, config);
const codexRunnerService = new CodexRunnerService(database, config);
const toolchainService = new ToolchainService(database, config);
const capabilityService = new CapabilityService(database, config);
const projectService = new ProjectService(database, config);
const gitAutomationService = new GitAutomationService(database, config);
const jobService = new JobService(database, config.APP_PROJECTS_DIR);
jobService.setHandlers(
  createAutomationJobHandlers({
    projectService,
    codexRunnerService,
    jobEnqueuer: jobService
  })
);
const server = await buildServer({
  readiness,
  authService,
  settingsService
});
registerFail2banRoutes(server, database);
registerSecurityIsolationRoutes(server, config);
registerSetupRoutes(server, setupService);
registerCodexAuthRoutes(server, codexAuthService);
registerCodexRoutes(server, codexCompatibilityService, codexDocsIndexService, codexHookService);
registerCodexRunnerRoutes(server, codexRunnerService);
registerToolchainRoutes(server, toolchainService);
registerCapabilityRoutes(server, capabilityService);
registerProjectRoutes(server, projectService, gitAutomationService, notificationService, jobService, setupService);
registerArtifactRoutes(server, artifactService);
registerProjectExportRoutes(server, projectExportService);
registerJobRoutes(server, jobService);
registerNotificationRoutes(server, notificationService);

await ensureRuntimeDirectories(getRuntimePaths(config));
await runMigrations(database);
await jobService.recoverStaleJobs();
readiness.migrated = true;

const jobRunnerTimer = setInterval(() => {
  void jobService.tick().catch((error: unknown) => {
    server.log.error({ error }, "job runner tick failed");
  });
}, 60_000);

const workerPollTimer = setInterval(() => {
  void codexHookService.pollActiveWorkerState().catch((error: unknown) => {
    server.log.error({ error }, "worker state fallback poll failed");
  });
}, 300_000);

const shutdown = async () => {
  clearInterval(jobRunnerTimer);
  clearInterval(workerPollTimer);
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
