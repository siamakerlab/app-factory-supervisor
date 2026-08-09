import { buildServer } from "./app.js";
import { loadConfig } from "./config.js";
import { createDatabase } from "./db/client.js";
import { runMigrations } from "./db/migrate.js";
import { ensureRuntimeDirectories, getRuntimePaths } from "./runtime/paths.js";

const config = loadConfig();
const database = createDatabase(config);
const readiness = {
  migrated: false
};
const server = await buildServer(readiness);

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
