/**
 * ADR-0005 detection provenance.
 *
 * Property name on findings: detection_source.
 * Bridge path MUST use bridge_correlation exclusively.
 * Signed path MUST use agent_signed and MUST NEVER use bridge_correlation.
 */

export const DETECTION_SOURCE_BRIDGE = "bridge_correlation" as const;
export const DETECTION_SOURCE_AGENT_SIGNED = "agent_signed" as const;
export const DETECTION_SOURCE_LEGACY = "legacy_unspecified" as const;

export type DetectionSourceWrite =
  | typeof DETECTION_SOURCE_BRIDGE
  | typeof DETECTION_SOURCE_AGENT_SIGNED;

export type DetectionSource =
  | DetectionSourceWrite
  | typeof DETECTION_SOURCE_LEGACY;

/** Evidence keys that claim cryptographic / signed detection (forbidden on bridge). */
export const SIGNED_DETECTION_EVIDENCE_MARKERS = [
  "signatureVerified",
  "ed25519Verified",
  "signatureValid",
  "verifiedSignature",
  "ed25519_verified",
  "signature_verified",
] as const;

export type ProvenanceCheckResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Bridge evidence must not carry signed-detection markers or a conflicting
 * detection_source label. Provenance is persisted on the finding column.
 */
export function assertBridgeEvidenceClean(
  evidence: Record<string, unknown>,
): ProvenanceCheckResult {
  if (Object.prototype.hasOwnProperty.call(evidence, "detection_source")) {
    const value = evidence.detection_source;
    if (value !== DETECTION_SOURCE_BRIDGE) {
      return {
        ok: false,
        reason:
          "bridge evidence must not carry a non-bridge detection_source label",
      };
    }
  }

  for (const key of SIGNED_DETECTION_EVIDENCE_MARKERS) {
    if (
      Object.prototype.hasOwnProperty.call(evidence, key) &&
      evidence[key] !== false &&
      evidence[key] !== null &&
      evidence[key] !== undefined
    ) {
      return {
        ok: false,
        reason: `bridge evidence must not include signed-detection marker "${key}"`,
      };
    }
  }

  return { ok: true };
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
  path: "bridge" | "signed",
  detectionSource: DetectionSourceWrite,
): ProvenanceCheckResult {
  if (path === "bridge" && detectionSource !== DETECTION_SOURCE_BRIDGE) {
    return {
      ok: false,
      reason: "bridge materializer requires detection_source bridge_correlation",
    };
  }
  if (path === "signed" && detectionSource === DETECTION_SOURCE_BRIDGE) {
    return {
      ok: false,
      reason: "signed materializer must never use bridge_correlation",
    };
  }
  if (path === "signed" && detectionSource !== DETECTION_SOURCE_AGENT_SIGNED) {
    return {
      ok: false,
      reason: "signed materializer requires detection_source agent_signed",
    };
  }
  return { ok: true };
}
