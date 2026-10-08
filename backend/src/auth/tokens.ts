import jwt from "jsonwebtoken";
import { config } from "../config.js";
import { unauthorized } from "../errors/AppError.js";

export interface AccessTokenPayload {
  sub: string; // user id
  email: string;
}

export function signAccessToken(userId: string, email: string): string {
  const payload: AccessTokenPayload = { sub: userId, email };
  return jwt.sign(payload, config.jwtSecret(), {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  try {
    const decoded = jwt.verify(token, config.jwtSecret());
    if (
      typeof decoded !== "object" ||
      decoded === null ||
      typeof decoded.sub !== "string" ||
      typeof (decoded as { email?: unknown }).email !== "string"
    ) {
      throw unauthorized("Invalid authentication token");
    }
    return {
      sub: decoded.sub,
      email: (decoded as { email: string }).email,
    };
  } catch (err) {
    if (err && typeof err === "object" && "statusCode" in err) {
      throw err;
    }
    throw unauthorized("Invalid or expired authentication token");
  }
}
