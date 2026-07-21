/**
 * Structured logging primitives for api-gateway.
 *
 * Everything this service writes to stdout goes through here, so the stream
 * stays uniformly parseable as one JSON object per line. Nothing should call
 * console.log directly.
 */

export const SERVICE_NAME = "api-gateway";

export type LogLevel = "info" | "warn" | "error";

/**
 * Writes a single structured JSON line to stdout.
 *
 * Values pass through JSON.stringify, so control characters are escaped rather
 * than able to forge additional log entries.
 */
export function writeLogLine(entry: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(entry)}\n`);
}

/**
 * Logs a process lifecycle event (startup, shutdown, signal handling).
 *
 * Separate from request logging: these carry an `event` name and no HTTP fields.
 */
export function logLifecycle(
  level: LogLevel,
  event: string,
  fields: Record<string, unknown> = {},
): void {
  writeLogLine({
    timestamp: new Date().toISOString(),
    level,
    service: SERVICE_NAME,
    event,
    ...fields,
  });
}
