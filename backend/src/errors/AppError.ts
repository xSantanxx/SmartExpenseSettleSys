/**
 * Typed HTTP errors for the API.
 * Controllers throw these; the central error middleware maps them to responses.
 * Never put stack traces or DB internals in `message` — that stays server-side.
 */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly code?: string
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function badRequest(message: string, code?: string): AppError {
  return new AppError(400, message, code);
}

export function unauthorized(message = "Authentication required"): AppError {
  return new AppError(401, message, "UNAUTHENTICATED");
}

export function forbidden(message = "You do not have access to this resource"): AppError {
  return new AppError(403, message, "FORBIDDEN");
}

export function notFound(message = "Resource not found"): AppError {
  return new AppError(404, message, "NOT_FOUND");
}

export function conflict(message: string): AppError {
  return new AppError(409, message, "CONFLICT");
}
