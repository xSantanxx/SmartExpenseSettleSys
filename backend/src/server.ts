import { createApp } from "./app.js";
import { getPool } from "./db/pool.js";

const port = Number(process.env.PORT ?? 3001);

async function main() {
  // Fail fast if DATABASE_URL is missing / unreachable.
  const pool = getPool();
  await pool.query("SELECT 1");

  const app = createApp();
  app.listen(port, () => {
    console.log(`API listening on http://localhost:${port}`);
    console.log("Auth: Authorization: Bearer <jwt>  (see POST /auth/login)");
  });
}

main().catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});
