import pg from "pg";

let pool: pg.Pool | null = null;

/**
 * Shared connection pool. One pool per process is enough for this monolith.
 * Call `getPool()` from services; call `closePool()` in tests / shutdown.
 */
export function getPool(databaseUrl = process.env.DATABASE_URL): pg.Pool {
  if (pool) return pool;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  pool = new pg.Pool({ connectionString: databaseUrl });
  return pool;
}

/** Replace the singleton pool (used by the integration-test harness). */
export async function resetPool(databaseUrl: string): Promise<pg.Pool> {
  await closePool();
  process.env.DATABASE_URL = databaseUrl;
  return getPool(databaseUrl);
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

/** @deprecated use getPool — kept so migrate.ts imports stay clear */
export function createPool(databaseUrl = process.env.DATABASE_URL): pg.Pool {
  return getPool(databaseUrl);
}
