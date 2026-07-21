import type { NextFunction, Request, Response } from "express";
import { SERVICE_NAME, writeLogLine, type LogLevel } from "../lib/log";

function levelForStatus(statusCode: number): LogLevel {
  if (statusCode >= 500) {
    return "error";
  }

  if (statusCode >= 400) {
    return "warn";
  }

  return "info";
}

/**
 * Emits one structured log line per request, on response completion.
 *
 * Deliberately logs only the route path — never headers, bodies, query strings,
 * or cookies. Those are the places credentials and sensitive telemetry end up.
 *
 * Registered before express.json() so that durationMs includes body-parse time
 * and malformed-body requests are still logged. tenantId is resolved by the
 * time the response finishes, regardless of this ordering.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  // Captured up front: routers mutate req.url during dispatch.
  const method = req.method;
  const path = req.path;

  res.on("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

    writeLogLine({
      timestamp: new Date().toISOString(),
      level: levelForStatus(res.statusCode),
      service: SERVICE_NAME,
      method,
      path,
      statusCode: res.statusCode,
      durationMs: Math.round(durationMs * 1000) / 1000,
      requestId: req.requestId,
      ...(req.tenantId ? { tenantId: req.tenantId } : {}),
    });
  });

  next();
}
