/**
 * rule.auth_failure_burst.v1 — deterministic auth-failure burst alert.
 *
 * Window buckets are derived from event occurredAt only (never server now()).
 * Default threshold is a module constant (no config framework in this slice).
 */

export const AUTH_FAILURE_BURST_RULE_ID = "rule.auth_failure_burst.v1" as const;

/** Fixed 5-minute UTC window for auth-failure burst evaluation. */
export const AUTH_FAILURE_BURST_WINDOW_MS = 5 * 60 * 1000;

/** Default threshold: raise exactly one alert at this count in the bucket. */
export const AUTH_FAILURE_BURST_THRESHOLD = 5;

export const AUTH_FAILURE_EVENT_TYPE = "auth_failure" as const;

export function floorToAuthFailureWindowBucket(occurredAt: Date): Date {
  const ms = occurredAt.getTime();
  if (!Number.isFinite(ms)) {
    throw new Error("occurredAt must be a finite timestamp");
  }
  return new Date(
    Math.floor(ms / AUTH_FAILURE_BURST_WINDOW_MS) * AUTH_FAILURE_BURST_WINDOW_MS,
  );
}

export function authFailureWindowBounds(bucket: Date): {
  windowStart: Date;
  windowEnd: Date;
} {
  const windowStart = bucket;
  const windowEnd = new Date(bucket.getTime() + AUTH_FAILURE_BURST_WINDOW_MS);
  return { windowStart, windowEnd };
}
