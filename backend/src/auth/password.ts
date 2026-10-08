import bcrypt from "bcryptjs";
import { config } from "../config.js";

/**
 * Hash a plaintext password.
 * Uses bcryptjs (pure JS) so Render/Linux deploys don't need native bcrypt builds.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, config.bcryptRounds());
}

/**
 * Compare plaintext to stored hash.
 * Uses bcrypt's constant-time compare — do not reimplement with ===.
 */
export async function verifyPassword(
  plaintext: string,
  passwordHash: string
): Promise<boolean> {
  // Reject legacy Stage-3 plaintext markers if any remain in an old DB.
  if (passwordHash.startsWith("plaintext-pending-stage6:")) {
    return false;
  }
  return bcrypt.compare(plaintext, passwordHash);
}
