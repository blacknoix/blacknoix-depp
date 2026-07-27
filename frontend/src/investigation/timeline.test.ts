import { describe, expect, it } from "vitest";

import type { AgentActivityEvent } from "../agents/types";
import type { Finding } from "../findings/types";
import {
  composeInvestigationTimeline,
  timelineSinceIso,
  INVESTIGATION_TIMELINE_MAX_ITEMS,
} from "./timeline";

const AGENT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const NOW = new Date("2026-03-01T12:00:00.000Z");
const SINCE = timelineSinceIso(NOW, 24);

function finding(partial: Partial<Finding> & Pick<Finding, "id" | "title">): Finding {
  return {
    agentId: AGENT,
    ruleId: "agent.lifecycle_churn",
    severity: "medium",
    status: "open",
    statusChangedAt: null,
    statusChangedByUserId: null,
    ownerUserId: null,
    ownerChangedAt: null,
    ownerChangedByUserId: null,
    operatorNote: null,
    operatorNoteUpdatedAt: null,
    operatorNoteUpdatedByUserId: null,
    evidence: {},
    windowStart: "2026-03-01T11:00:00.000Z",
    windowEnd: "2026-03-01T12:00:00.000Z",
    createdAt: "2026-03-01T11:30:00.000Z",
    ...partial,
  };
}

function telem(
  partial: Partial<AgentActivityEvent> & Pick<AgentActivityEvent, "id" | "eventType">,
): AgentActivityEvent {
  return {
    occurredAt: "2026-03-01T11:45:00.000Z",
    ...partial,
  };
}

describe("composeInvestigationTimeline", () => {
  it("orders newest-first and mixes finding + telemetry kinds", () => {
    const result = composeInvestigationTimeline({
      since: SINCE,
      findingsAvailable: true,
      telemetryAvailable: true,
      findings: [
        finding({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Churn",
          createdAt: "2026-03-01T11:20:00.000Z",
          status: "acknowledged",
          statusChangedAt: "2026-03-01T11:50:00.000Z",
        }),
      ],
      telemetryEvents: [
        telem({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          eventType: "heartbeat",
          occurredAt: "2026-03-01T11:40:00.000Z",
        }),
      ],
    });

    expect(result.items.map((i) => i.kind)).toEqual([
      "finding.status_changed",
      "telemetry.event",
      "finding.created",
    ]);
    expect(result.items[0].subtitle).toMatch(/Status → acknowledged/);
    expect(result.items[0].href).toContain("findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(result.items[1].href).toBeNull();
  });

  it("drops markers and events outside the since window", () => {
    const result = composeInvestigationTimeline({
      since: SINCE,
      findingsAvailable: true,
      telemetryAvailable: true,
      findings: [
        finding({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Old",
          createdAt: "2026-02-01T12:00:00.000Z",
          statusChangedAt: "2026-02-01T13:00:00.000Z",
          status: "resolved",
        }),
      ],
      telemetryEvents: [
        telem({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          eventType: "heartbeat",
          occurredAt: "2026-02-28T10:00:00.000Z",
        }),
      ],
    });
    expect(result.items).toHaveLength(0);
  });

  it("omits a failed source without treating it as empty data", () => {
    const result = composeInvestigationTimeline({
      since: SINCE,
      findingsAvailable: false,
      telemetryAvailable: true,
      findings: [
        finding({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Should not appear",
          createdAt: "2026-03-01T11:30:00.000Z",
        }),
      ],
      telemetryEvents: [
        telem({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          eventType: "agent.started",
        }),
      ],
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("telemetry.event");
  });

  it("caps items and reports truncated", () => {
    const events = Array.from({ length: INVESTIGATION_TIMELINE_MAX_ITEMS + 3 }, (_, i) =>
      telem({
        id: `eeeeeeee-eeee-4eee-8eee-eeeeeeeeee${String(i).padStart(2, "0")}`,
        eventType: "heartbeat",
        occurredAt: new Date(NOW.getTime() - i * 60_000).toISOString(),
      }),
    );
    const result = composeInvestigationTimeline({
      since: SINCE,
      findingsAvailable: true,
      telemetryAvailable: true,
      findings: [],
      telemetryEvents: events,
    });
    expect(result.items).toHaveLength(INVESTIGATION_TIMELINE_MAX_ITEMS);
    expect(result.truncated).toBe(true);
    expect(result.items[0].at >= result.items[1].at).toBe(true);
  });

  it("fails closed on invalid since", () => {
    const result = composeInvestigationTimeline({
      since: "not-a-date",
      findingsAvailable: true,
      telemetryAvailable: true,
      findings: [
        finding({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "X",
        }),
      ],
      telemetryEvents: [
        telem({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          eventType: "heartbeat",
        }),
      ],
    });
    expect(result.items).toHaveLength(0);
  });
});
