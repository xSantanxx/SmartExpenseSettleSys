import type { ClientConfig, PoolConfig } from "pg";

/**
 * Neon (and most hosted Postgres) require TLS.
 * Local Docker usually does not.
 */
export function pgConnectionOptions(connectionString: string): PoolConfig & ClientConfig {
  const hosted =
    /neon\.tech|sslmode=require|render\.com|amazonaws\.com/i.test(
      connectionString
    ) || process.env.NODE_ENV === "production";

  return {
    connectionString,
    ssl: hosted ? { rejectUnauthorized: false } : undefined,
  };
}
