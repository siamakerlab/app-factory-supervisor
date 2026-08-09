import { createDatabase, type Database } from "./client.js";
import { migrations } from "./migrations.js";
import { loadConfig } from "../config.js";

export async function runMigrations(database?: Database): Promise<void> {
  const config = loadConfig();
  const ownedDatabase = database ?? createDatabase(config);
  try {
    await applyMigrations(ownedDatabase);
  } finally {
    if (!database) {
      await ownedDatabase.close();
    }
  }
}

export async function applyMigrations(database: Database): Promise<void> {
  const client = await database.pool.connect();
  try {
    await client.query("begin");
    await client.query(`
      create table if not exists schema_migrations (
        id text primary key,
        description text not null,
        applied_at timestamptz not null default now()
      )
    `);

    for (const migration of migrations) {
      const existing = await client.query("select id from schema_migrations where id = $1", [
        migration.id
      ]);
      if (existing.rowCount === 0) {
        await client.query(migration.sql);
        await client.query("insert into schema_migrations (id, description) values ($1, $2)", [
          migration.id,
          migration.description
        ]);
      }
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await runMigrations();
}
