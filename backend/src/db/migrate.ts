/**
 * Tiny SQL migrator — runs backend/db/migrations/*.sql in sorted order.
 * Tracks applied files in schema_migrations so re-runs are safe.
 *
 * Why not Prisma/Knex yet? Raw SQL makes every constraint visible for
 * interviews. We can adopt a heavier tool later if the schema grows.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pgConnectionOptions } from "./pgConfig.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.resolve(__dirname, "../../db/migrations");

async function migrate(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required (see backend/.env.example)");
  }

  const client = new pg.Client(pgConnectionOptions(databaseUrl));
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
      const already = await client.query(
        `SELECT 1 FROM schema_migrations WHERE filename = $1`,
        [filename]
      );
      if (already.rowCount && already.rowCount > 0) {
        console.log(`skip  ${filename}`);
        continue;
      }

      const sql = await readFile(path.join(MIGRATIONS_DIR, filename), "utf8");
      console.log(`apply ${filename}`);
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

    console.log("Migrations complete.");
  } finally {
    await client.end();
  }
}

migrate().catch((err) => {
  console.error(err);
  process.exit(1);
});
