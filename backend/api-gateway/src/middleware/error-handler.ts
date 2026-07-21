import type { NextFunction, Request, Response } from "express";
import { SERVICE_NAME, writeLogLine } from "./logger";

/**
 * A failure the API is allowed to describe to the caller.
 *
 * Anything that is not an AppError is treated as unexpected and reported as a
 * generic 500, so internal details never cross the wire.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(code: string, statusCode: number, message: string) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;

    Error.captureStackTrace?.(this, AppError);
  }
}

export interface ErrorResponseBody {
  ok: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

/** body-parser tags malformed JSON payloads with this type. */
function isJsonParseError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { type?: unknown }).type === "entity.parse.failed"
  );
}

function describeError(err: unknown): { name: string; message: string } {
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }

  return { name: "UnknownError", message: String(err) };
}

/**
 * Centralized JSON error handler. Registered last.
 *
 * Every error response uses the same envelope so clients can rely on one shape.
 * 5xx responses carry a fixed generic message; the real error is written to the
 * server log only. Stack traces are never returned, in any environment.
 */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // Headers already flushed: nothing safe to do but let Express tear down.
  if (res.headersSent) {
    next(err);
    return;
  }

  let statusCode = 500;
  let code = "INTERNAL_ERROR";
  let message = "An unexpected error occurred";

  if (err instanceof AppError) {
    statusCode = err.statusCode;
    code = err.code;
    message = err.message;
  } else if (isJsonParseError(err)) {
    statusCode = 400;
    code = "INVALID_JSON";
    message = "Request body is not valid JSON";
  }

  if (statusCode >= 500) {
    const described = describeError(err);

    writeLogLine({
      timestamp: new Date().toISOString(),
      level: "error",
      service: SERVICE_NAME,
      event: "unhandled_error",
      requestId: req.requestId,
      ...(req.tenantId ? { tenantId: req.tenantId } : {}),
      errorName: described.name,
      errorMessage: described.message,
    });
  }

  const body: ErrorResponseBody = {
    ok: false,
    error: { code, message },
    requestId: req.requestId,
  };

  res.status(statusCode).json(body);
}
