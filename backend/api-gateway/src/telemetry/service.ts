import { logLifecycle } from "../lib/log";
import type { CorrelationService } from "../correlation/service";
import type { AlertsRepository } from "../alerts/repository";
import type { TelemetryEventV1 } from "./contract";
import type { TelemetryQueryV1 } from "./query";
import type {
  TelemetryAgentSummary,
  TelemetryEventRow,
  TelemetryQueryResult,
  TelemetryRepository,
} from "./repository";

export interface IngestedTelemetry {
  id: string;
  ingestedAt: Date;
}

export type IngestOutcome =
  | { ok: true; event: IngestedTelemetry }
  | { ok: false; reason: "agent_not_found" };

export type IngestBatchOutcome =
  | { ok: true; events: IngestedTelemetry[] }
  | { ok: false; reason: "agent_not_found" };

export type QueryOutcome =
  | { ok: true; result: TelemetryQueryResult }
  | { ok: false; reason: "agent_not_found" };

export interface TelemetryService {
  /**
   * Persists a validated v1 event under the authenticated tenant.
   *
   * tenantId must come from the gateway principal. The event's agentId is
   * checked for existence in that tenant; unknown or cross-tenant agents
   * collapse to agent_not_found (non-oracular).
   *
   * Single-event auth_failure uses a same-transaction path that may raise
   * rule.auth_failure_burst.v1. Failures on that path propagate (non-2xx).
   * Batch ingest does not participate in the new rule.
   */
  ingest(tenantId: string, event: TelemetryEventV1): Promise<IngestOutcome>;

  /**
   * All-or-nothing batch insert in a single tenant transaction.
   * Caller must have already validated the event list.
   * Does not run rule.auth_failure_burst.v1 (slice: single-event path only).
   */
  ingestBatch(
    tenantId: string,
    events: readonly TelemetryEventV1[],
  ): Promise<IngestBatchOutcome>;

  /**
   * Lists recent events and a tiny operator summary for one agent.
   * Unknown/cross-tenant agents return agent_not_found (mapped to empty
   * non-oracular response at the route).
   */
  query(
    tenantId: string,
    query: TelemetryQueryV1,
  ): Promise<QueryOutcome>;
}

export interface TelemetryServiceDeps {
  telemetry: TelemetryRepository;
  /**
   * Optional post-ingest correlation (legacy findings path). When present,
   * runs after a successful insert; failures are logged and never fail the
   * ingest response. Untouched by auth-failure burst alerts.
   */
  correlation?: CorrelationService;
  /**
   * Same-TX auth_failure burst evaluation (telemetry-to-auditable-alert-v1).
   * Used only by single-event ingest when eventType is auth_failure.
   */
  authFailureAlerts?: AlertsRepository;
}

export type { TelemetryAgentSummary, TelemetryEventRow, TelemetryQueryResult };

export function createTelemetryService(
  deps: TelemetryServiceDeps,
): TelemetryService {
  const { telemetry, correlation, authFailureAlerts } = deps;

  async function runCorrelationSafe(
    tenantId: string,
    agentId: string,
  ): Promise<void> {
    if (!correlation) {
      return;
    }
    try {
      await correlation.evaluateAfterIngest(tenantId, agentId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const name = err instanceof Error ? err.name : "Error";
      logLifecycle("error", "correlation_eval_failed", {
        tenantId,
        agentId,
        errorName: name,
        errorMessage: message,
      });
    }
  }

  async function ingestBatch(
    tenantId: string,
    events: readonly TelemetryEventV1[],
  ): Promise<IngestBatchOutcome> {
    if (typeof tenantId !== "string" || tenantId.trim() === "") {
      throw new Error("ingestBatch requires a non-empty tenantId");
    }
    if (events.length === 0) {
      throw new Error("ingestBatch requires at least one event");
    }

    // All events in a batch share one agent principal; check once.
    const agentId = events[0].agentId;
    for (const event of events) {
      if (event.agentId !== agentId) {
        throw new Error("ingestBatch requires a single agentId");
      }
    }

    const exists = await telemetry.agentExists(tenantId, agentId);
    if (!exists) {
      return { ok: false, reason: "agent_not_found" };
    }

    const inserted = await telemetry.insertEvents(
      tenantId,
      events.map((event) => ({
        agentId: event.agentId,
        schemaVersion: event.schemaVersion,
        eventType: event.eventType,
        occurredAt: event.occurredAt,
        payload: event.payload,
      })),
    );

    await runCorrelationSafe(tenantId, agentId);

    return { ok: true, events: inserted };
  }

  return {
    async ingest(tenantId, event) {
      if (
        event.eventType === "auth_failure" &&
        authFailureAlerts !== undefined
      ) {
        if (typeof tenantId !== "string" || tenantId.trim() === "") {
          throw new Error("ingest requires a non-empty tenantId");
        }

        const exists = await telemetry.agentExists(tenantId, event.agentId);
        if (!exists) {
          return { ok: false, reason: "agent_not_found" };
        }

        // Same-TX event + optional alert + audit. Errors propagate to the route.
        const inserted = await authFailureAlerts.ingestAuthFailureAndEvaluate(
          tenantId,
          {
            agentId: event.agentId,
            schemaVersion: event.schemaVersion,
            occurredAt: event.occurredAt,
            payload: event.payload,
          },
        );

        // Legacy post-ingest correlation remains best-effort and separate.
        await runCorrelationSafe(tenantId, event.agentId);

        return { ok: true, event: inserted };
      }

      const batch = await ingestBatch(tenantId, [event]);
      if (!batch.ok) {
        return batch;
      }
      return { ok: true, event: batch.events[0] };
    },

    ingestBatch,

    async query(tenantId, query) {
      if (typeof tenantId !== "string" || tenantId.trim() === "") {
        throw new Error("query requires a non-empty tenantId");
      }

      const exists = await telemetry.agentExists(tenantId, query.agentId);
      if (!exists) {
        return { ok: false, reason: "agent_not_found" };
      }

      const result = await telemetry.queryAgentEvents(tenantId, query);
      return { ok: true, result };
    },
  };
}
