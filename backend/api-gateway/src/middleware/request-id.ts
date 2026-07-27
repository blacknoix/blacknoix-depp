import { randomUUID } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const REQUEST_ID_HEADER = "x-request-id";

/**
 * Inbound request IDs come from untrusted clients, so they are only reused when
 * they look like a sane correlation ID. Anything else is discarded in favour of
 * a freshly generated UUID. This keeps arbitrary client input out of log lines
 * and out of the response header.
 */
const MAX_REQUEST_ID_LENGTH = 128;
const SAFE_REQUEST_ID = /^[A-Za-z0-9_-]+$/;

function isUsableRequestId(value: string | undefined): value is string {
  if (typeof value !== "string") {
    return false;
  }

  const trimmed = value.trim();

  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_REQUEST_ID_LENGTH &&
    SAFE_REQUEST_ID.test(trimmed)
  );
}

/**
 * Assigns a correlation ID to every request.
 *
 * Registered first in the middleware chain so that every downstream middleware,
 * route handler, and error response can reference req.requestId.
 */
export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.get(REQUEST_ID_HEADER);

  req.requestId = isUsableRequestId(incoming) ? incoming.trim() : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, req.requestId);

  next();
}
