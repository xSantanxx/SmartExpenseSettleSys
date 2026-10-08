import type { Request } from "express";
import { badRequest } from "../errors/AppError.js";

/** Express 5 types params as `string | string[]`; we always want a single string. */
export function param(req: Request, name: string): string {
  const value = req.params[name];
  if (typeof value !== "string" || value.length === 0) {
    throw badRequest(`Missing route parameter: ${name}`);
  }
  return value;
}
