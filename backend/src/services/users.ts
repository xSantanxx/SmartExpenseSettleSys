import { getPool } from "../db/pool.js";
import { notFound } from "../errors/AppError.js";
import type { UserRow } from "../db/types.js";

export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  createdAt: string;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
  };
}

export async function getUserById(id: string): Promise<PublicUser> {
  const result = await getPool().query<UserRow>(
    `SELECT * FROM users WHERE id = $1`,
    [id]
  );
  if (result.rowCount === 0) {
    throw notFound("User not found");
  }
  return toPublic(result.rows[0]);
}
