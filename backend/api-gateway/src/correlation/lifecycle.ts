/**
 * Finding status lifecycle — explicit transitions only.
 *
 * Deferred: status history table, assignment, comments.
 */

export const FINDING_STATUSES = ["open", "acknowledged", "resolved"] as const;

export type FindingStatus = (typeof FINDING_STATUSES)[number];

const ALLOWED: Readonly<Record<FindingStatus, readonly FindingStatus[]>> = {
  open: ["acknowledged", "resolved"],
  acknowledged: ["resolved", "open"],
  resolved: ["open"],
};

export function isFindingStatus(value: string): value is FindingStatus {
  return (FINDING_STATUSES as readonly string[]).includes(value);
}

export type TransitionResult =
  | { ok: true; kind: "noop" }
  | { ok: true; kind: "transition" }
  | { ok: false; message: string };

/**
 * Validates a status change. Same status → idempotent noop.
 * Illegal edges (e.g. resolved → acknowledged) fail closed.
 */
export function assertFindingTransition(
  from: FindingStatus,
  to: FindingStatus,
): TransitionResult {
  if (from === to) {
    return { ok: true, kind: "noop" };
  }

  if (!ALLOWED[from].includes(to)) {
    return {
      ok: false,
      message: `transition from ${from} to ${to} is not allowed`,
    };
  }

  return { ok: true, kind: "transition" };
}
