/**
 * Canonical THREATEVENT envelope (Phase 0/1 bridge toward TRD).
 *
 * Structural parse fails closed on missing identity, signature, or
 * tenant/agent fields. Agent-submitted envelopes are Ed25519-verified
 * (see signature.ts) before finality. CometBFT / libp2p remain deferred.
 */

export const THREAT_EVENT_KIND = "THREATEVENT" as const;

export const FINALITY_STATES = [
  "pending",
  "finalized",
  "rejected",
  "analyst_review",
] as const;

export type FinalityState = (typeof FINALITY_STATES)[number];

export const TERMINAL_FINALITY_STATES = [
  "finalized",
  "rejected",
  "analyst_review",
] as const;

export type TerminalFinalityState = (typeof TERMINAL_FINALITY_STATES)[number];

export type ThreatSeverity = "low" | "medium" | "high";

export interface ThreatEventEnvelope {
  kind: typeof THREAT_EVENT_KIND;
  tenantId: string;
  agentId: string;
  deviceIdentityId: string;
  detectionRuleId: string;
  title: string;
  severity: ThreatSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  occurredAt: Date;
  signature: string;
  signedAt: Date;
}

export type ParseThreatEventResult =
  | { ok: true; envelope: ThreatEventEnvelope }
  | { ok: false; message: string };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isSeverity(value: unknown): value is ThreatSeverity {
  return value === "low" || value === "medium" || value === "high";
}

function asDate(value: unknown, label: string): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value;
  }
  if (typeof value === "string" || typeof value === "number") {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) {
      return date;
    }
  }
  return null;
}

/**
 * Structural validation only. Cryptographic verify is
 * `verifyThreatEventSignature` after identity lookup.
 */
export function parseThreatEventEnvelope(
  raw: unknown,
): ParseThreatEventResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, message: "envelope must be an object" };
  }
  const body = raw as Record<string, unknown>;

  if (body.kind !== THREAT_EVENT_KIND) {
    return { ok: false, message: "kind must be THREATEVENT" };
  }

  const tenantId =
    typeof body.tenantId === "string" ? body.tenantId.trim() : "";
  const agentId = typeof body.agentId === "string" ? body.agentId.trim() : "";
  const deviceIdentityId =
    typeof body.deviceIdentityId === "string"
      ? body.deviceIdentityId.trim()
      : "";
  const detectionRuleId =
    typeof body.detectionRuleId === "string"
      ? body.detectionRuleId.trim()
      : "";
  const title = typeof body.title === "string" ? body.title.trim() : "";
  const signature =
    typeof body.signature === "string" ? body.signature.trim() : "";

  if (!UUID.test(tenantId)) {
    return { ok: false, message: "tenantId must be a UUID" };
  }
  if (!UUID.test(agentId)) {
    return { ok: false, message: "agentId must be a UUID" };
  }
  if (!UUID.test(deviceIdentityId)) {
    return { ok: false, message: "deviceIdentityId must be a UUID" };
  }
  if (detectionRuleId.length === 0) {
    return { ok: false, message: "detectionRuleId is required" };
  }
  if (title.length === 0) {
    return { ok: false, message: "title is required" };
  }
  if (!isSeverity(body.severity)) {
    return { ok: false, message: "severity must be low|medium|high" };
  }
  if (signature.length === 0) {
    return { ok: false, message: "signature is required" };
  }

  const evidence =
    typeof body.evidence === "object" &&
    body.evidence !== null &&
    !Array.isArray(body.evidence)
      ? (body.evidence as Record<string, unknown>)
      : null;
  if (!evidence) {
    return { ok: false, message: "evidence must be an object" };
  }

  const windowStart = asDate(body.windowStart, "windowStart");
  const windowEnd = asDate(body.windowEnd, "windowEnd");
  const windowBucket = asDate(body.windowBucket, "windowBucket");
  const occurredAt = asDate(body.occurredAt, "occurredAt");
  const signedAt = asDate(body.signedAt, "signedAt");
  if (!windowStart || !windowEnd || !windowBucket || !occurredAt || !signedAt) {
    return { ok: false, message: "timestamps must be valid dates" };
  }
  if (windowEnd.getTime() < windowStart.getTime()) {
    return { ok: false, message: "windowEnd must be >= windowStart" };
  }

  return {
    ok: true,
    envelope: {
      kind: THREAT_EVENT_KIND,
      tenantId,
      agentId,
      deviceIdentityId,
      detectionRuleId,
      title,
      severity: body.severity,
      evidence,
      windowStart,
      windowEnd,
      windowBucket,
      occurredAt,
      signature,
      signedAt,
    },
  };
}

export function isFinalityState(value: string): value is FinalityState {
  return (FINALITY_STATES as readonly string[]).includes(value);
}

/**
 * Allowed transitions: pending → finalized | rejected | analyst_review.
 * Same-state is idempotent; all other transitions fail closed.
 */
export function assertFinalityTransition(
  from: FinalityState,
  to: FinalityState,
): { ok: true } | { ok: false; message: string } {
  if (from === to) {
    return { ok: true };
  }
  if (from === "pending" && (TERMINAL_FINALITY_STATES as readonly string[]).includes(to)) {
    return { ok: true };
  }
  return {
    ok: false,
    message: `invalid finality transition ${from} → ${to}`,
  };
}
