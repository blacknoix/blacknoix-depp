import type { NextFunction, Request, Response } from "express";
import { AppError } from "./error-handler";

/**
 * Terminal handler for unmatched routes. Registered after all routers and
 * before the error handler, so 404s flow through the same JSON envelope as
 * every other error.
 *
 * The message is intentionally generic: reflecting the requested path back to
 * the caller echoes unvalidated input into a response body for no benefit.
 */
export function notFound(_req: Request, _res: Response, next: NextFunction): void {
  next(new AppError("NOT_FOUND", 404, "Route not found"));
}
