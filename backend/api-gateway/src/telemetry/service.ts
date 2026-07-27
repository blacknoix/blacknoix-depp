import { logLifecycle } from "../lib/log";
import type { CorrelationService } from "../correlation/service";
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
   */
  ingest(tenantId: string, event: TelemetryEventV1): Promise<IngestOutcome>;

  /**
   * All-or-nothing batch insert in a single tenant transaction.
   * Caller must have already validated the event list.
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
   * Optional post-ingest correlation. When present, runs after a successful
   * insert; failures are logged and never fail the ingest response.
   */
  correlation?: CorrelationService;
}

export type { TelemetryAgentSummary, TelemetryEventRow, TelemetryQueryResult };

export function createTelemetryService(
  deps: TelemetryServiceDeps,
): TelemetryService {
  const { telemetry, correlation } = deps;

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
