import { createHash } from "node:crypto";

import { logLifecycle } from "../lib/log";
import type { CorrelationFindingsRepository } from "../correlation/repository";
import {
  isCorrelationRuleId,
  type CorrelationRuleId,
} from "../correlation/rules";
import {
  THREAT_EVENT_KIND,
  type ThreatEventEnvelope,
  type ThreatSeverity,
} from "./envelope";
import type { FinalitySeam } from "./finality";
import type { GossipSeam } from "./gossip";
import type { DeviceIdentityRepository } from "./device-identity-repository";
import { materializeFindingAfterFinality, proofFromFinalitySuccess } from "./materializer";
import {
  assertBridgeEvidenceClean,
  assertSignedEvidenceClean,
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
} from "./provenance";
import type { ThreatEventsRepository } from "./repository";
import { verifyThreatEventSignature } from "./signature";

export interface ThreatDetectionCandidate {
  ruleId: CorrelationRuleId;
  title: string;
  severity: ThreatSeverity;
  evidence: Record<string, unknown>;
  windowStart: Date;
  windowEnd: Date;
  windowBucket: Date;
}

export type SubmitThreatEventOutcome =
  | { ok: true; status: "created"; threatEventId: string; findingId: string }
  | {
      ok: true;
      status: "upgraded";
      threatEventId: string;
      findingId: string;
    }
  | { ok: true; status: "deduped" }
  | {
      ok: false;
      status:
        | "rejected"
        | "analyst_review"
        | "no_identity"
        | "identity_inactive"
        | "identity_revoked"
        | "tenant_mismatch"
        | "agent_mismatch"
        | "invalid_signature"
        | "unknown_rule"
        | "bridge_disabled"
        | "provenance_rejected";
      reason: string;
      threatEventId?: string;
    };

export interface ThreatEventService {
  /**
   * Transitional correlation bridge fallback (ADR-0005). Active identity
   * required; placeholder signature. Finality-gated materializer with
   * detection_source=bridge_correlation. Disabled globally or per tenant.
   */
  submitFromDetection(
    tenantId: string,
    agentId: string,
    candidate: ThreatDetectionCandidate,
    at?: Date,
  ): Promise<SubmitThreatEventOutcome>;

  /**
   * Primary agent-signed THREATEVENT path: Ed25519 verify, then finality-gated
   * materializer with detection_source=agent_signed. May upgrade an existing
   * bridge_correlation finding for the same dedup key.
   */
  submitSigned(
    tenantId: string,
    agentId: string,
    envelope: ThreatEventEnvelope,
    at?: Date,
  ): Promise<SubmitThreatEventOutcome>;
}

export interface ThreatEventServiceDeps {
  deviceIdentities: DeviceIdentityRepository;
  threatEvents: ThreatEventsRepository;
  findings: CorrelationFindingsRepository;
  finality: FinalitySeam;
  gossip: GossipSeam;
  now?: () => Date;
  /**
   * Global bridge gate. When false, submitFromDetection is a no-op for all
   * tenants. Defaults to true. Env: CORRELATION_BRIDGE_ENABLED.
   */
  correlationBridgeEnabled?: boolean;
  /**
   * Tenants for which bridge fallback is disabled while signed remains on.
   * Env: CORRELATION_BRIDGE_DISABLED_TENANTS. Ignored when global is false.
   */
  correlationBridgeDisabledTenants?: ReadonlySet<string>;
  /**
   * Optional override for tests. When set, replaces global+tenant resolution.
   */
  isCorrelationBridgeEnabledForTenant?: (tenantId: string) => boolean;
}

/**
 * Deterministic non-secret placeholder signature for the correlation bridge
 * until detection itself is agent-signed. Not cryptographic proof.
 */
export function buildDevBridgeSignature(
  tenantId: string,
  agentId: string,
  ruleId: string,
  windowBucket: Date,
): string {
  return createHash("sha256")
    .update(
      `depp-dev-bridge|${tenantId}|${agentId}|${ruleId}|${windowBucket.toISOString()}`,
    )
    .digest("base64url");
}

export function createThreatEventService(
  deps: ThreatEventServiceDeps,
): ThreatEventService {
  const {
    deviceIdentities,
    threatEvents,
    findings,
    finality,
    gossip,
  } = deps;
  const now = deps.now ?? (() => new Date());
  const correlationBridgeEnabled = deps.correlationBridgeEnabled ?? true;
  const correlationBridgeDisabledTenants =
    deps.correlationBridgeDisabledTenants ?? new Set<string>();

  function bridgeEnabledForTenant(tenantId: string): boolean {
    if (deps.isCorrelationBridgeEnabledForTenant) {
      return deps.isCorrelationBridgeEnabledForTenant(tenantId);
    }
    if (!correlationBridgeEnabled) {
      return false;
    }
    return !correlationBridgeDisabledTenants.has(tenantId);
  }

  async function persistThroughFinality(
    tenantId: string,
    agentId: string,
    envelope: ThreatEventEnvelope,
    identityStatus: "pending" | "active" | "revoked",
    at: Date,
    path: "bridge" | "signed",
  ): Promise<SubmitThreatEventOutcome> {
    const detectionSource =
      path === "bridge"
        ? DETECTION_SOURCE_BRIDGE
        : DETECTION_SOURCE_AGENT_SIGNED;

    const inserted = await threatEvents.insertPending(tenantId, {
      agentId,
      deviceIdentityId: envelope.deviceIdentityId,
      detectionRuleId: envelope.detectionRuleId,
      title: envelope.title,
      severity: envelope.severity,
      evidence: envelope.evidence,
      windowStart: envelope.windowStart,
      windowEnd: envelope.windowEnd,
      windowBucket: envelope.windowBucket,
      occurredAt: envelope.occurredAt,
      signature: envelope.signature,
      signedAt: envelope.signedAt,
      detectionSource,
    });

    if (!inserted.ok) {
      return { ok: true, status: "deduped" };
    }

    const event = inserted.event;
    await gossip.publish(envelope);

    const outcome = await finality.finalize({
      id: event.id,
      tenantId,
      agentId,
      deviceIdentityId: envelope.deviceIdentityId,
      finalityState: event.finalityState,
      envelope,
      deviceStatus: identityStatus,
    });

    if (!outcome.ok) {
      await threatEvents.transitionFinality(tenantId, event.id, outcome.state, {
        reason: outcome.reason,
        at,
      });
      logLifecycle("info", "threat_event_finality_failed", {
        tenantId,
        agentId,
        threatEventId: event.id,
        state: outcome.state,
        reason: outcome.reason,
        detection_source: detectionSource,
      });
      return {
        ok: false,
        status: outcome.state,
        reason: outcome.reason,
        threatEventId: event.id,
      };
    }

    const finalityProof = proofFromFinalitySuccess(event.id, outcome);
    if (!finalityProof) {
      return {
        ok: false,
        status: "rejected",
        reason: "finality proof could not be issued",
        threatEventId: event.id,
      };
    }

    // Sole detection finding insert/upgrade site (ADR-0005).
    const materialized = await materializeFindingAfterFinality(findings, {
      tenantId,
      agentId,
      ruleId: envelope.detectionRuleId as CorrelationRuleId,
      title: envelope.title,
      severity: envelope.severity,
      evidence: envelope.evidence,
      windowStart: envelope.windowStart,
      windowEnd: envelope.windowEnd,
      windowBucket: envelope.windowBucket,
      detectionSource,
      path,
      threatEventId: event.id,
      finalityProof,
    });

    if (!materialized.ok) {
      await threatEvents.transitionFinality(tenantId, event.id, "rejected", {
        reason: materialized.reason,
        at,
      });
      return {
        ok: false,
        status: "provenance_rejected",
        reason: materialized.reason,
        threatEventId: event.id,
      };
    }

    if ("deduped" in materialized) {
      await threatEvents.transitionFinality(tenantId, event.id, "finalized", {
        at,
      });
      return { ok: true, status: "deduped" };
    }

    const findingId = materialized.findingId;
    await threatEvents.transitionFinality(tenantId, event.id, "finalized", {
      at,
      findingId,
    });

    if (materialized.upgraded === true) {
      logLifecycle("info", "threat_event_finalized_finding_upgraded", {
        tenantId,
        agentId,
        threatEventId: event.id,
        findingId,
        ruleId: envelope.detectionRuleId,
        detection_source: detectionSource,
        from: DETECTION_SOURCE_BRIDGE,
        to: DETECTION_SOURCE_AGENT_SIGNED,
      });
      return {
        ok: true,
        status: "upgraded",
        threatEventId: event.id,
        findingId,
      };
    }

    logLifecycle("info", "threat_event_finalized_finding_created", {
      tenantId,
      agentId,
      threatEventId: event.id,
      findingId,
      ruleId: envelope.detectionRuleId,
      detection_source: detectionSource,
    });

    return {
      ok: true,
      status: "created",
      threatEventId: event.id,
      findingId,
    };
  }

  return {
    async submitFromDetection(tenantId, agentId, candidate, at = now()) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("submitFromDetection requires a non-empty tenantId");
      }
      if (typeof agentId !== "string" || agentId.trim() === "") {
        throw new Error("submitFromDetection requires a non-empty agentId");
      }

      if (!bridgeEnabledForTenant(tenantId)) {
        logLifecycle("info", "correlation_bridge_disabled_skip", {
          tenantId,
          agentId,
          ruleId: candidate.ruleId,
        });
        return {
          ok: false,
          status: "bridge_disabled",
          reason: "correlation bridge is disabled",
        };
      }

      // Signed correlation is primary: do not invent a weaker bridge row when
      // an agent_signed finding already covers this key.
      const existing = await findings.findFindingByDedupKey(tenantId, {
        agentId,
        ruleId: candidate.ruleId,
        windowBucket: candidate.windowBucket,
      });
      if (existing?.detectionSource === DETECTION_SOURCE_AGENT_SIGNED) {
        logLifecycle("info", "correlation_bridge_skipped_signed_primary", {
          tenantId,
          agentId,
          ruleId: candidate.ruleId,
          findingId: existing.id,
          detection_source: existing.detectionSource,
        });
        return { ok: true, status: "deduped" };
      }

      const evidenceCheck = assertBridgeEvidenceClean(candidate.evidence);
      if (!evidenceCheck.ok) {
        logLifecycle("warn", "bridge_provenance_rejected", {
          tenantId,
          agentId,
          reason: evidenceCheck.reason,
        });
        return {
          ok: false,
          status: "provenance_rejected",
          reason: evidenceCheck.reason,
        };
      }

      const identity = await deviceIdentities.findByAgentId(tenantId, agentId);
      if (!identity) {
        logLifecycle("warn", "threat_event_no_device_identity", {
          tenantId,
          agentId,
          ruleId: candidate.ruleId,
        });
        return {
          ok: false,
          status: "no_identity",
          reason: "active device identity is required",
        };
      }
      if (identity.status === "revoked") {
        return {
          ok: false,
          status: "identity_revoked",
          reason: "device identity is revoked",
        };
      }
      if (identity.status !== "active") {
        return {
          ok: false,
          status: "identity_inactive",
          reason: `device identity status is ${identity.status}`,
        };
      }

      const signature = buildDevBridgeSignature(
        tenantId,
        agentId,
        candidate.ruleId,
        candidate.windowBucket,
      );

      const envelope: ThreatEventEnvelope = {
        kind: THREAT_EVENT_KIND,
        tenantId,
        agentId,
        deviceIdentityId: identity.id,
        detectionRuleId: candidate.ruleId,
        title: candidate.title,
        severity: candidate.severity,
        evidence: candidate.evidence,
        windowStart: candidate.windowStart,
        windowEnd: candidate.windowEnd,
        windowBucket: candidate.windowBucket,
        occurredAt: at,
        signature,
        signedAt: at,
      };

      return persistThroughFinality(
        tenantId,
        agentId,
        envelope,
        identity.status,
        at,
        "bridge",
      );
    },

    async submitSigned(tenantId, agentId, envelope, at = now()) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("submitSigned requires a non-empty tenantId");
      }
      if (typeof agentId !== "string" || agentId.trim() === "") {
        throw new Error("submitSigned requires a non-empty agentId");
      }

      if (envelope.tenantId !== tenantId) {
        return {
          ok: false,
          status: "tenant_mismatch",
          reason: "envelope tenantId does not match principal",
        };
      }
      if (envelope.agentId !== agentId) {
        return {
          ok: false,
          status: "agent_mismatch",
          reason: "envelope agentId does not match principal",
        };
      }

      const evidenceCheck = assertSignedEvidenceClean(envelope.evidence);
      if (!evidenceCheck.ok) {
        return {
          ok: false,
          status: "provenance_rejected",
          reason: evidenceCheck.reason,
        };
      }

      const identity = await deviceIdentities.findById(
        tenantId,
        envelope.deviceIdentityId,
      );
      if (!identity) {
        return {
          ok: false,
          status: "no_identity",
          reason: "device identity not found",
        };
      }
      if (identity.agentId !== agentId) {
        return {
          ok: false,
          status: "agent_mismatch",
          reason: "device identity is not bound to this agent",
        };
      }
      if (identity.status === "revoked") {
        return {
          ok: false,
          status: "identity_revoked",
          reason: "device identity is revoked",
        };
      }
      if (identity.status !== "active") {
        return {
          ok: false,
          status: "identity_inactive",
          reason: `device identity status is ${identity.status}`,
        };
      }

      if (!isCorrelationRuleId(envelope.detectionRuleId)) {
        return {
          ok: false,
          status: "unknown_rule",
          reason: "detectionRuleId is not a known correlation rule",
        };
      }

      const verified = verifyThreatEventSignature(
        identity.publicKeyEd25519,
        envelope,
      );
      if (!verified.ok) {
        logLifecycle("warn", "threat_event_signature_rejected", {
          tenantId,
          agentId,
          deviceIdentityId: identity.id,
          reason: verified.reason,
        });
        return {
          ok: false,
          status: "invalid_signature",
          reason: verified.reason,
        };
      }

      return persistThroughFinality(
        tenantId,
        agentId,
        envelope,
        identity.status,
        at,
        "signed",
      );
    },
  };
}
