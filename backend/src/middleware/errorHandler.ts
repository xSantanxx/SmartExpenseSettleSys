import type { NextFunction, Request, Response } from "express";
import { BalanceError } from "../domain/balances.js";
import { MoneyError } from "../domain/money.js";
import { SettlementError } from "../domain/settlement.js";
import { AppError } from "../errors/AppError.js";

interface ErrorBody {
  error: {
    message: string;
    code?: string;
  };
}

/**
 * Centralized error handler — last middleware in the stack.
 * Domain validation errors → 400. Unknown errors → 500 without leaking internals.
 */
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof AppError) {
    const body: ErrorBody = {
      error: { message: err.message, code: err.code },
    };
    res.status(err.statusCode).json(body);
    return;
  }

  if (
    err instanceof MoneyError ||
    err instanceof BalanceError ||
    err instanceof SettlementError
  ) {
    res.status(400).json({
      error: { message: err.message, code: "VALIDATION_ERROR" },
    });
    return;
  }

  // Postgres unique violation
  if (isPgError(err) && err.code === "23505") {
    res.status(409).json({
      error: { message: "Resource already exists", code: "CONFLICT" },
    });
    return;
  }

  // Postgres check / trigger membership violations
  if (isPgError(err) && (err.code === "23514" || err.code === "P0001")) {
    res.status(400).json({
      error: {
        message: err.message.split("\n")[0] ?? "Invalid data",
        code: "CONSTRAINT_VIOLATION",
      },
    });
    return;
  }

  console.error("Unhandled error:", err);
  res.status(500).json({
    error: { message: "Internal server error", code: "INTERNAL" },
  });
}

function isPgError(err: unknown): err is { code: string; message: string } {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    typeof (err as { code: unknown }).code === "string"
  );
}
