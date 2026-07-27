import type { TelemetryEventV1 } from "./contract";
import type { TelemetryRepository } from "./repository";

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
}

export interface TelemetryServiceDeps {
  telemetry: TelemetryRepository;
}

export function createTelemetryService(
  deps: TelemetryServiceDeps,
): TelemetryService {
  const { telemetry } = deps;

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
  };
}
