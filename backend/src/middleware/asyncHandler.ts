import type { NextFunction, Request, RequestHandler, Response } from "express";

/**
 * Wraps async route handlers so rejected promises reach the error middleware
 * instead of becoming silent "UnhandledPromiseRejection" crashes.
 */
export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req, res, next) => {
    void fn(req, res, next).catch(next);
  };
}
