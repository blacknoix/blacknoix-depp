import { describe, expect, it } from "vitest";

import type { Finding } from "../findings/types";
import {
  deriveWorkQueueMetrics,
  formatWorkMetricValue,
  UNOWNED_AGED_DAYS,
} from "./workAnalytics";

const NOW = new Date("2026-03-10T12:00:00.000Z");

function finding(
  partial: Partial<Finding> & Pick<Finding, "id" | "createdAt">,
): Finding {
  return {
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleId: "agent.lifecycle_churn",
    title: partial.id,
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
    windowStart: "2026-03-01T11:50:00.000Z",
    windowEnd: "2026-03-01T12:00:00.000Z",
    ...partial,
  };
}

describe("deriveWorkQueueMetrics", () => {
  it("derives section counts and unowned aging from Work sources", () => {
    const metrics = deriveWorkQueueMetrics({
      hasIdentity: true,
      actionNeeded: {
        items: [
          {
            kind: "finding.action_needed",
            findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            title: "A",
            status: "open",
            ruleId: "agent.lifecycle_churn",
            agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            at: "2026-03-01T00:00:00.000Z",
          },
        ],
        truncated: false,
        overdueHours: 4,
        escalationQuietHours: 48,
      },
      dueReminders: { items: [], truncated: false },
      reminders: { quietHours: 24 },
      mine: [
        finding({
          id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
          createdAt: "2026-03-09T12:00:00.000Z",
          ownerUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ],
      minePageFull: false,
      unownedOpen: [
        finding({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          createdAt: "2026-03-09T12:00:00.000Z",
        }),
        finding({
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          createdAt: "2026-02-01T12:00:00.000Z",
        }),
      ],
      unownedPageFull: false,
      now: NOW,
      generatedAt: NOW.toISOString(),
    });

    const byId = Object.fromEntries(
      metrics.metrics.map((m) => [m.id, m]),
    );
    expect(byId.action_needed.value).toBe(1);
    expect(byId.reminders_due.value).toBe(0);
    expect(byId.mine.value).toBe(1);
    expect(byId.unowned_open.value).toBe(2);
    expect(byId.unowned_aged.value).toBe(1);
    expect(byId.unowned_aged.label).toBe(`Unowned ≥${UNOWNED_AGED_DAYS}d`);
    expect(byId.action_needed.focusSection).toBe("action_needed");
    expect(byId.unowned_aged.focusSection).toBe("unowned_open");
  });

  it("fails closed on identity-aware metrics without operator identity", () => {
    const metrics = deriveWorkQueueMetrics({
      hasIdentity: false,
      actionNeeded: null,
      dueReminders: null,
      reminders: null,
      mine: [],
      minePageFull: false,
      unownedOpen: [
        finding({
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          createdAt: "2026-02-01T12:00:00.000Z",
        }),
      ],
      unownedPageFull: false,
      now: NOW,
    });

    const byId = Object.fromEntries(
      metrics.metrics.map((m) => [m.id, m]),
    );
    expect(byId.action_needed.value).toBeNull();
    expect(byId.reminders_due.value).toBeNull();
    expect(byId.mine.value).toBeNull();
    expect(byId.action_needed.focusSection).toBeNull();
    expect(byId.unowned_open.value).toBe(1);
    expect(byId.unowned_aged.value).toBe(1);
    expect(formatWorkMetricValue(byId.action_needed)).toBe("—");
    expect(formatWorkMetricValue(byId.unowned_open)).toBe("1");
  });

  it("marks truncated counts with a plus suffix", () => {
    const metrics = deriveWorkQueueMetrics({
      hasIdentity: true,
      actionNeeded: {
        items: [],
        truncated: true,
        overdueHours: 4,
        escalationQuietHours: 48,
      },
      dueReminders: { items: [], truncated: false },
      reminders: { quietHours: 24 },
      mine: [],
      minePageFull: true,
      unownedOpen: [],
      unownedPageFull: false,
      now: NOW,
    });
    const byId = Object.fromEntries(
      metrics.metrics.map((m) => [m.id, m]),
    );
    expect(formatWorkMetricValue(byId.action_needed)).toBe("0+");
    expect(formatWorkMetricValue(byId.mine)).toBe("0+");
  });
});
