import type { CorrelationRuleId } from "./rules";
import { isCorrelationRuleId } from "./rules";

/**
 * Snooze window bounds. Max 30 days — long enough for ops, short enough to
 * prevent accidental permanent mutes without a separate policy product.
 */
export const SUPPRESSION_MAX_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export interface SuppressionWindowInput {
  ruleId: CorrelationRuleId;
  startsAt: Date;
  endsAt: Date;
}

export type ParseSuppressionResult =
  | { ok: true; window: SuppressionWindowInput }
  | { ok: false; message: string };

/**
 * Pure validation for a snooze create request.
 * `now` is injected so tests can freeze time.
 */
export function parseSuppressionWindow(
  raw: {
    ruleId?: unknown;
    until?: unknown;
    startsAt?: unknown;
  },
  now: Date,
): ParseSuppressionResult {
  if (typeof raw.ruleId !== "string" || !isCorrelationRuleId(raw.ruleId)) {
    return { ok: false, message: "ruleId must be a known correlation rule" };
  }

  if (typeof raw.until !== "string" || raw.until.trim() === "") {
    return { ok: false, message: "until must be an ISO-8601 timestamp" };
  }

  const endsAt = new Date(raw.until);
  if (Number.isNaN(endsAt.getTime())) {
    return { ok: false, message: "until must be a valid timestamp" };
  }

  let startsAt = now;
  if (raw.startsAt !== undefined) {
    if (typeof raw.startsAt !== "string" || raw.startsAt.trim() === "") {
      return { ok: false, message: "startsAt must be an ISO-8601 timestamp" };
    }
    startsAt = new Date(raw.startsAt);
    if (Number.isNaN(startsAt.getTime())) {
      return { ok: false, message: "startsAt must be a valid timestamp" };
    }
  }

  if (endsAt.getTime() <= startsAt.getTime()) {
    return { ok: false, message: "until must be after startsAt" };
  }

  if (endsAt.getTime() - startsAt.getTime() > SUPPRESSION_MAX_DURATION_MS) {
    return {
      ok: false,
      message: "suppression window exceeds maximum of 30 days",
    };
  }

  // Reject windows that already ended relative to now (noop snooze).
  if (endsAt.getTime() <= now.getTime()) {
    return { ok: false, message: "until must be in the future" };
  }

  return {
    ok: true,
    window: {
      ruleId: raw.ruleId,
      startsAt,
      endsAt,
    },
  };
}

/** Active when uncleared and now is within [startsAt, endsAt). */
export function isSuppressionActive(
  row: { startsAt: Date; endsAt: Date; clearedAt: Date | null },
  now: Date,
): boolean {
  if (row.clearedAt !== null) {
    return false;
  }
  const t = now.getTime();
  return t >= row.startsAt.getTime() && t < row.endsAt.getTime();
}
