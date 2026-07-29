import { logLifecycle } from "../lib/log";
import type { CorrelationFindingsRepository } from "../correlation/repository";
import {
  isCorrelationRuleId,
  type CorrelationRuleId,
} from "../correlation/rules";
import type { ThreatEventEnvelope } from "./envelope";
import type { FinalitySeam } from "./finality";
import type { GossipSeam } from "./gossip";
import type { DeviceIdentityRepository } from "./device-identity-repository";
import {
  materializeFindingAfterFinality,
  proofFromFinalitySuccess,
} from "./materializer";
import {
  assertSignedEvidenceClean,
  DETECTION_SOURCE_AGENT_SIGNED,
  DETECTION_SOURCE_BRIDGE,
} from "./provenance";
import type { ThreatEventsRepository } from "./repository";
import { verifyThreatEventSignature } from "./signature";

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
        | "provenance_rejected";
      reason: string;
      threatEventId?: string;
    };

export interface ThreatEventService {
  /**
   * Sole live THREATEVENT path (ADR-0005 final deletion): Ed25519 verify, then
   * finality-gated materializer with detection_source=agent_signed. May upgrade
   * a historical bridge_correlation finding for the same dedup key.
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
}

export function createThreatEventService(
  deps: ThreatEventServiceDeps,
): ThreatEventService {
  const { deviceIdentities, threatEvents, findings, finality, gossip } = deps;
  const now = deps.now ?? (() => new Date());

  return {
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

      const detectionSource = DETECTION_SOURCE_AGENT_SIGNED;

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
        deviceStatus: identity.status,
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
    },
  };
}
