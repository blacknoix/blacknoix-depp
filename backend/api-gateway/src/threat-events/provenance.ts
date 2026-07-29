/**
 * ADR-0005 detection provenance.
 *
 * Property name on findings: detection_source.
 * Live writes MUST use agent_signed only.
 * Historical bridge_correlation rows remain valid and readable; signed may
 * monotonically upgrade them. agent_signed never downgrades.
 */

export const DETECTION_SOURCE_BRIDGE = "bridge_correlation" as const;
export const DETECTION_SOURCE_AGENT_SIGNED = "agent_signed" as const;
export const DETECTION_SOURCE_LEGACY = "legacy_unspecified" as const;

/** Live write provenance (bridge write path deleted). */
export type DetectionSourceWrite = typeof DETECTION_SOURCE_AGENT_SIGNED;

export type DetectionSource =
  | typeof DETECTION_SOURCE_BRIDGE
  | typeof DETECTION_SOURCE_AGENT_SIGNED
  | typeof DETECTION_SOURCE_LEGACY;

export type ProvenanceCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * True when `from` → `to` is the only allowed provenance upgrade.
 */
export function isMonotonicDetectionSourceUpgrade(
  from: string,
  to: string,
): boolean {
  return from === DETECTION_SOURCE_BRIDGE && to === DETECTION_SOURCE_AGENT_SIGNED;
}

/**
 * Signed path must never claim bridge provenance in evidence.
 */
export function assertSignedEvidenceClean(
  evidence: Record<string, unknown>,
): ProvenanceCheckResult {
  if (
    Object.prototype.hasOwnProperty.call(evidence, "detection_source") &&
    evidence.detection_source === DETECTION_SOURCE_BRIDGE
  ) {
    return {
      ok: false,
      reason: "signed evidence must not claim bridge_correlation provenance",
    };
  }
  return { ok: true };
}

export function assertMaterializerProvenance(
  detectionSource: string,
): ProvenanceCheckResult {
  if (detectionSource === DETECTION_SOURCE_BRIDGE) {
    return {
      ok: false,
      reason: "signed materializer must never use bridge_correlation",
    };
  }
  if (detectionSource !== DETECTION_SOURCE_AGENT_SIGNED) {
    return {
      ok: false,
      reason: "signed materializer requires detection_source agent_signed",
    };
  }
  return { ok: true };
}
