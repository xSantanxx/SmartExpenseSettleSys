import { getPool } from "../db/pool.js";
import type { UserRow } from "../db/types.js";
import { hashPassword, verifyPassword } from "../auth/password.js";
import { signAccessToken } from "../auth/tokens.js";
import { badRequest, conflict, unauthorized } from "../errors/AppError.js";
import type { PublicUser } from "./users.js";

export interface AuthResult {
  user: PublicUser;
  token: string;
}

function toPublic(row: UserRow): PublicUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    createdAt: row.created_at.toISOString(),
  };
}

function validateCredentials(email: unknown, password: unknown, displayName?: unknown) {
  if (typeof email !== "string" || !email.trim()) {
    throw badRequest("email is required");
  }
  if (typeof password !== "string" || password.length < 8) {
    throw badRequest("password must be at least 8 characters");
  }
  if (displayName !== undefined) {
    if (typeof displayName !== "string" || !displayName.trim()) {
      throw badRequest("displayName is required");
    }
  }
}

/**
 * Register a new account.
 * Password is bcrypt-hashed before insert — plaintext never hits the DB.
 */
export async function register(input: {
  email: string;
  displayName: string;
  password: string;
}): Promise<AuthResult> {
  validateCredentials(input.email, input.password, input.displayName);

  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  const passwordHash = await hashPassword(input.password);

  try {
    const result = await getPool().query<UserRow>(
      `INSERT INTO users (email, password_hash, display_name)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [email, passwordHash, displayName]
    );
    const user = toPublic(result.rows[0]);
    const token = signAccessToken(user.id, user.email);
    return { user, token };
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code: string }).code === "23505"
    ) {
      throw conflict("A user with that email already exists");
    }
    throw err;
  }
}

/**
 * Login with email + password.
 * Same error for bad email and bad password so attackers cannot enumerate accounts.
 */
export async function login(input: {
  email: string;
  password: string;
}): Promise<AuthResult> {
  validateCredentials(input.email, input.password);

  const email = input.email.trim().toLowerCase();
  const result = await getPool().query<UserRow>(
    `SELECT * FROM users WHERE email = $1`,
    [email]
  );

  const generic = unauthorized("Invalid email or password");

  if (result.rowCount === 0) {
    // Still burn a bcrypt compare-ish delay? Optional. Keep simple for portfolio.
    throw generic;
  }

  const row = result.rows[0];
  const ok = await verifyPassword(input.password, row.password_hash);
  if (!ok) {
    throw generic;
  }

  const user = toPublic(row);
  return { user, token: signAccessToken(user.id, user.email) };
}
