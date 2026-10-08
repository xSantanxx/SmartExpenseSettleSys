import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken } from "../auth/tokens.js";
import { unauthorized } from "../errors/AppError.js";

/**
 * Authentication middleware (Stage 6).
 *
 * Expects: `Authorization: Bearer <jwt>`
 * On success sets `req.userId` (and `req.userEmail`).
 *
 * Authorization (can you touch *this group*?) is separate — see
 * `assertGroupMember` in services/membership.ts. AuthN ≠ AuthZ.
 */
declare global {
  namespace Express {
    interface Request {
      userId: string;
      userEmail?: string;
    }
  }
}

export function requireUser(
  req: Request,
  _res: Response,
  next: NextFunction
): void {
  const header = req.header("authorization");
  if (!header || !header.toLowerCase().startsWith("bearer ")) {
    next(
      unauthorized(
        "Missing or invalid Authorization header. Use: Bearer <token>"
      )
    );
    return;
  }

  const token = header.slice("bearer ".length).trim();
  if (!token) {
    next(unauthorized("Missing authentication token"));
    return;
  }

  try {
    const payload = verifyAccessToken(token);
    req.userId = payload.sub;
    req.userEmail = payload.email;
    next();
  } catch (err) {
    next(err);
  }
}
