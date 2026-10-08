/**
 * Integration-test database harness.
 *
 * Starts an embedded PostgreSQL (no Docker required), applies migrations,
 * and points the app pool at it. Shared across the vitest file via
 * `beforeAll` / `afterAll`.
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import EmbeddedPostgres from "embedded-postgres";
import pg from "pg";
import { closePool, resetPool } from "../db/pool.js";

const execFileAsync = promisify(execFile);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

export interface TestDb {
  connectionString: string;
  /** Truncate all app tables between tests (keeps schema). */
  resetData: () => Promise<void>;
  stop: () => Promise<void>;
}

let shared: TestDb | null = null;
let startPromise: Promise<TestDb> | null = null;

export async function getTestDb(): Promise<TestDb> {
  if (shared) return shared;
  if (!startPromise) {
    startPromise = startTestDb();
  }
  shared = await startPromise;
  return shared;
}

async function startTestDb(): Promise<TestDb> {
  // Faster bcrypt in tests (still exercises real hashing).
  process.env.BCRYPT_ROUNDS ??= "4";
  process.env.JWT_SECRET ??= "test-jwt-secret-sess";

  const databaseDir = await mkdtemp(path.join(tmpdir(), "sess-test-pg-"));
  // Pick an ephemeral port to avoid clashing with a local Postgres.
  const port = 55000 + Math.floor(Math.random() * 1000);

  const postgres = new EmbeddedPostgres({
    databaseDir,
    user: "sess",
    password: "sess",
    port,
    persistent: false,
  });

  await postgres.initialise();
  await postgres.start();
  await postgres.createDatabase("smart_expense_test");

  const connectionString = `postgres://sess:sess@127.0.0.1:${port}/smart_expense_test`;

  // Apply migrations with a one-off client before the app pool is created.
  const client = new pg.Client({ connectionString });
  await client.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename   TEXT PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const filename of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      await client.query("BEGIN");
      try {
        await client.query(sql);
        await client.query(
          `INSERT INTO schema_migrations (filename) VALUES ($1)`,
          [filename]
        );
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      }
    }
  } finally {
    await client.end();
  }

  await resetPool(connectionString);

  return {
    connectionString,
    async resetData() {
      const pool = await resetPool(connectionString);
      // TRUNCATE ... CASCADE clears dependents; restart identity for cleanliness.
      await pool.query(`
        TRUNCATE TABLE
          settlements,
          expense_participants,
          expenses,
          group_members,
          friendships,
          groups,
          users
        RESTART IDENTITY CASCADE;
      `);
    },
    async stop() {
      await closePool();
      try {
        await postgres.stop();
      } catch {
        // Best-effort; fall through to wiping the data dir.
        try {
          await execFileAsync("pkill", ["-f", databaseDir]);
        } catch {
          /* ignore */
        }
      }
      await rm(databaseDir, { recursive: true, force: true });
      shared = null;
      startPromise = null;
    },
  };
}
