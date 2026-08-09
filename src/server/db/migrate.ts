import { createDatabase, type Database } from "./client.js";
import { loadConfig } from "../config.js";

export async function runMigrations(database?: Database): Promise<void> {
  // Phase 2 owns real Drizzle migrations. Phase 1 verifies DB connectivity during startup.
  if (database) {
    await database.ping();
    return;
  }

  const config = loadConfig();
  const ownedDatabase = createDatabase(config);
  try {
    await ownedDatabase.ping();
  } finally {
    await ownedDatabase.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
}
