import pg from "pg";

import type { AppConfig } from "../config.js";

const { Pool } = pg;

export type Database = {
  pool: pg.Pool;
  close: () => Promise<void>;
  ping: () => Promise<void>;
};

export function createDatabase(config: AppConfig): Database {
  const pool = new Pool({
    connectionString: config.DATABASE_URL
  });

  return {
    pool,
    close: () => pool.end(),
    ping: async () => {
      const client = await pool.connect();
      try {
        await client.query("select 1");
      } finally {
        client.release();
      }
    }
  };
}
