import type { FinalityState, ThreatEventEnvelope } from "./envelope";

/**
 * Record presented to the finality seam after pending persistence.
 */
export interface FinalityCandidate {
  id: string;
  tenantId: string;
  agentId: string;
  deviceIdentityId: string;
  finalityState: FinalityState;
  envelope: ThreatEventEnvelope;
  /** Device identity must be active for finalize to succeed. */
  deviceStatus: "pending" | "active" | "revoked";
}

export type FinalityOutcome =
  | { ok: true; state: "finalized" }
  | {
      ok: false;
      state: "rejected" | "analyst_review";
      reason: string;
    };

/**
 * Validator-side finality seam. Real CometBFT is deferred.
 */
export interface FinalitySeam {
  finalize(candidate: FinalityCandidate): Promise<FinalityOutcome>;
}

/**
 * Dev / single-node finalizer: structural checks only (no ledger, no crypto).
 * Fail closed when identity is not active or signature is empty.
 */
export function createDevSingleNodeFinalizer(): FinalitySeam {
  return {
    async finalize(candidate) {
      if (candidate.finalityState !== "pending") {
        return {
          ok: false,
          state: "rejected",
          reason: `cannot finalize from state ${candidate.finalityState}`,
        };
      }
      if (candidate.deviceStatus !== "active") {
        return {
          ok: false,
          state: "rejected",
          reason: "device identity is not active",
        };
      }
      if (candidate.envelope.signature.trim().length === 0) {
        return {
          ok: false,
          state: "rejected",
          reason: "signature is required",
        };
      }
      if (candidate.envelope.tenantId !== candidate.tenantId) {
        return {
          ok: false,
          state: "rejected",
          reason: "tenant mismatch",
        };
      }
      if (candidate.envelope.agentId !== candidate.agentId) {
        return {
          ok: false,
          state: "rejected",
          reason: "agent mismatch",
        };
      }
      return { ok: true, state: "finalized" };
    },
  };
}
