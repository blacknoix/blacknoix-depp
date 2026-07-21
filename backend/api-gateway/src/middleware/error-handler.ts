import type { NextFunction, Request, Response } from "express";
import { SERVICE_NAME, writeLogLine } from "../lib/log";

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

interface ClientErrorShape {
  statusCode: number;
  code: string;
  message: string;
}

/**
 * body-parser tags its failures with a `type` string and an HTTP `status`.
 *
 * We map the known types explicitly and always substitute our own message:
 * body-parser's text leaks internals (its parse error names the exact byte
 * offset, e.g. "Expected property name or '}' in JSON at position 1").
 */
const BODY_PARSER_ERRORS: Record<string, ClientErrorShape> = {
  "entity.parse.failed": {
    statusCode: 400,
    code: "INVALID_JSON",
    message: "Request body is not valid JSON",
  },
  "entity.too.large": {
    statusCode: 413,
    code: "PAYLOAD_TOO_LARGE",
    message: "Request body is too large",
  },
  "encoding.unsupported": {
    statusCode: 415,
    code: "UNSUPPORTED_ENCODING",
    message: "Request body encoding is not supported",
  },
  "charset.unsupported": {
    statusCode: 415,
    code: "UNSUPPORTED_CHARSET",
    message: "Request body charset is not supported",
  },
};

/**
 * Classifies a non-AppError as a client error where possible.
 *
 * The status-based fallback is deliberate: without it, any body-parser error
 * type we have not enumerated would be reported as a 500, turning a client
 * mistake into an apparent server fault and an error-level log line.
 */
function asClientError(err: unknown): ClientErrorShape | undefined {
  if (typeof err !== "object" || err === null) {
    return undefined;
  }

  const candidate = err as { type?: unknown; status?: unknown };

  if (typeof candidate.type === "string") {
    const mapped = BODY_PARSER_ERRORS[candidate.type];

    if (mapped) {
      return mapped;
    }
  }

  const status = candidate.status;

  if (typeof status === "number" && status >= 400 && status <= 499) {
    return {
      statusCode: status,
      code: "REQUEST_INVALID",
      message: "Request could not be processed",
    };
  }

  return undefined;
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
  } else {
    const clientError = asClientError(err);

    if (clientError) {
      statusCode = clientError.statusCode;
      code = clientError.code;
      message = clientError.message;
    }
  }

  if (statusCode >= 500) {
    const described = describeError(err);

    writeLogLine({
      timestamp: new Date().toISOString(),
      level: "error",
      service: SERVICE_NAME,
      event: "unhandled_error",
      requestId: req.requestId,
      ...(req.principal ? { tenantId: req.principal.tenantId } : {}),
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
