/**
 * ADR-0005: the sole sanctioned insert/upgrade of correlation_findings for
 * detection materialization. Finality is enforced intrinsically via
 * FinalizedEventProof — not solely by caller ordering.
 *
 * Provenance is monotonic: bridge_correlation may upgrade to agent_signed for
 * the same dedup key; agent_signed never downgrades.
 */

import type { CorrelationFindingsRepository } from "../correlation/repository";
import type { CorrelationRuleId } from "../correlation/rules";
import { logLifecycle } from "../lib/log";
import type { FinalityOutcome } from "./finality";
import {
  assertMaterializerProvenance,
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
  type DetectionSourceWrite,
} from "./provenance";
import type { ThreatSeverity } from "./envelope";

/**
 * Opaque proof that FinalitySeam.finalize() returned success for this event.
 * Only construct via {@link proofFromFinalitySuccess}.
 */
export interface FinalizedEventProof {
  readonly kind: "finality_success";
  readonly threatEventId: string;
  readonly state: "finalized";
}

/**
 * Issue a materializer proof from a successful finality outcome.
 * Returns undefined when finality did not succeed — fail closed.
 */
export function proofFromFinalitySuccess(
  threatEventId: string,
  outcome: FinalityOutcome,
): FinalizedEventProof | undefined {
  if (!outcome.ok || outcome.state !== "finalized") {
    return undefined;
  }
  return {
    kind: "finality_success",
    threatEventId,
    state: "finalized",
  };
}

export function isFinalizedEventProof(
  value: unknown,
): value is FinalizedEventProof {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const proof = value as Record<string, unknown>;
  return (
    proof.kind === "finality_success" &&
    proof.state === "finalized" &&
    typeof proof.threatEventId === "string" &&
    proof.threatEventId.trim() !== ""
  );
}

export interface MaterializeFindingInput {
  tenantId: string;
  agentId: string;
  ruleId: CorrelationRuleId;
  title: string;
  severity: ThreatSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
  /**
   * Provenance for this materialization. Must match `path`.
   * bridge → bridge_correlation; signed → agent_signed.
   */
  detectionSource: DetectionSourceWrite;
  /** Which ingress path is materializing — used to fail closed on cross-label. */
  path: "bridge" | "signed";
  threatEventId: string;
  /**
   * Intrinsic finality gate: must be issued by proofFromFinalitySuccess for
   * this threatEventId. Absent / mismatched proof → no insert.
   */
  finalityProof: FinalizedEventProof;
}

export type MaterializeFindingResult =
  | { ok: true; findingId: string; upgraded?: false }
  | { ok: true; findingId: string; upgraded: true }
  | { ok: true; deduped: true }
  | { ok: false; reason: string };

/**
 * Single finality-gated materializer. Do not call from correlation/telemetry
 * routes. Inserts only when finalityProof attests finalize() succeeded.
 * On same-key conflict, signed path may upgrade bridge_correlation → agent_signed.
 */
export async function materializeFindingAfterFinality(
  findings: CorrelationFindingsRepository,
  input: MaterializeFindingInput,
): Promise<MaterializeFindingResult> {
  if (
    !isFinalizedEventProof(input.finalityProof) ||
    input.finalityProof.threatEventId !== input.threatEventId
  ) {
    logLifecycle("error", "finding_materializer_finality_proof_rejected", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      threatEventId: input.threatEventId,
      path: input.path,
    });
    return {
      ok: false,
      reason: "finality proof required before finding materialization",
    };
  }

  const provenance = assertMaterializerProvenance(
    input.path,
    input.detectionSource,
  );
  if (!provenance.ok) {
    logLifecycle("error", "finding_materializer_provenance_rejected", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      path: input.path,
      detectionSource: input.detectionSource,
      reason: provenance.reason,
      threatEventId: input.threatEventId,
    });
    return { ok: false, reason: provenance.reason };
  }

  const findingId = await findings.insertFindingIgnoreDup(input.tenantId, {
    agentId: input.agentId,
    ruleId: input.ruleId,
    title: input.title,
    severity: input.severity,
    evidence: input.evidence,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
    windowBucket: input.windowBucket,
    detectionSource: input.detectionSource,
  });

  if (findingId) {
    logLifecycle("info", "finding_materialized_after_finality", {
      tenantId: input.tenantId,
      agentId: input.agentId,
      findingId,
      threatEventId: input.threatEventId,
      ruleId: input.ruleId,
      detection_source: input.detectionSource,
      path: input.path,
    });
    return { ok: true, findingId };
  }

  // Same-key conflict: signed may upgrade bridge → agent_signed (monotonic).
  if (
    input.path === "signed" &&
    input.detectionSource === DETECTION_SOURCE_AGENT_SIGNED
  ) {
    const upgradedId = await findings.upgradeDetectionSourceMonotonic(
      input.tenantId,
      {
        agentId: input.agentId,
        ruleId: input.ruleId,
        windowBucket: input.windowBucket,
        from: DETECTION_SOURCE_BRIDGE,
        to: DETECTION_SOURCE_AGENT_SIGNED,
      },
    );

    if (upgradedId) {
      logLifecycle("info", "finding_detection_source_upgraded", {
        tenantId: input.tenantId,
        agentId: input.agentId,
        findingId: upgradedId,
        threatEventId: input.threatEventId,
        ruleId: input.ruleId,
        windowBucket: input.windowBucket.toISOString(),
        from: DETECTION_SOURCE_BRIDGE,
        to: DETECTION_SOURCE_AGENT_SIGNED,
        detection_source: DETECTION_SOURCE_AGENT_SIGNED,
        path: input.path,
      });
      return { ok: true, findingId: upgradedId, upgraded: true };
    }
  }

  return { ok: true, deduped: true };
}
