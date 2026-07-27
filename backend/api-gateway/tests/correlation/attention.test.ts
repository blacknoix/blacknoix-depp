import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleActionNeeded,
  assembleAttentionDigest,
  assembleOwnershipReminders,
  ATTENTION_ITEMS_MAX,
  ATTENTION_MAX_LOOKBACK_HOURS,
  ESCALATION_QUIET_HOURS,
  filterDismissedAttentionItems,
  isAttentionItemDismissed,
  parseAttentionSinceQuery,
  parseDismissAttentionBody,
  partitionDueReminders,
  partitionOwnershipReminders,
  reminderQuietBefore,
  REMINDER_ITEMS_MAX,
  REMINDER_OVERDUE_HOURS,
  REMINDER_QUIET_HOURS,
  resolveAttentionSince,
  toAttentionDismissalMap,
  type AttentionItem,
} from "../../src/correlation/attention";

const FINDING_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FINDING_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const AGENT = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function item(
  overrides: Partial<AttentionItem> & Pick<AttentionItem, "kind" | "findingId" | "at">,
): AttentionItem {
  return {
    title: "Agent lifecycle churn",
    status: "open",
    ruleId: "agent.lifecycle_churn",
    agentId: AGENT,
    ...overrides,
  };
}

describe("parseAttentionSinceQuery", () => {
  it("accepts missing since and rejects tenant / bad timestamps / unknown keys", () => {
    assert.deepEqual(parseAttentionSinceQuery({}), { ok: true, since: null });
    assert.equal(parseAttentionSinceQuery({ tenantId: "x" }).ok, false);
    assert.equal(parseAttentionSinceQuery({ since: "not-a-date" }).ok, false);
    assert.equal(parseAttentionSinceQuery({ since: "", hours: "1" }).ok, false);
    assert.equal(parseAttentionSinceQuery({ hours: "24" }).ok, false);

    const ok = parseAttentionSinceQuery({
      since: "2026-03-01T11:00:00.000Z",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.since?.toISOString(), "2026-03-01T11:00:00.000Z");
    }
  });
});

describe("resolveAttentionSince", () => {
  it("clamps to max lookback and future times", () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    const floor = new Date(
      generatedAt.getTime() - ATTENTION_MAX_LOOKBACK_HOURS * 60 * 60 * 1000,
    );

    assert.equal(
      resolveAttentionSince(
        new Date("2026-02-01T00:00:00.000Z"),
        generatedAt,
      ).toISOString(),
      floor.toISOString(),
    );
    assert.equal(
      resolveAttentionSince(
        new Date("2026-03-01T18:00:00.000Z"),
        generatedAt,
      ).toISOString(),
      generatedAt.toISOString(),
    );
    assert.equal(
      resolveAttentionSince(
        new Date("2026-03-01T10:00:00.000Z"),
        generatedAt,
      ).toISOString(),
      "2026-03-01T10:00:00.000Z",
    );
  });
});

describe("assembleAttentionDigest", () => {
  it("merges newest-first and caps items", () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    const since = new Date("2026-03-01T00:00:00.000Z");
    const created = item({
      kind: "finding.created",
      findingId: FINDING_A,
      at: new Date("2026-03-01T11:00:00.000Z"),
    });
    const changed = item({
      kind: "finding.status_changed",
      findingId: FINDING_B,
      status: "acknowledged",
      at: new Date("2026-03-01T11:30:00.000Z"),
    });

    const digest = assembleAttentionDigest(generatedAt, since, {
      created: [created],
      statusChanged: [changed],
      openCount: 3,
      activeSuppressionCount: 1,
      sourceTruncated: false,
    });

    assert.equal(digest.items.length, 2);
    assert.equal(digest.items[0].findingId, FINDING_B);
    assert.equal(digest.items[1].findingId, FINDING_A);
    assert.equal(digest.openCount, 3);
    assert.equal(digest.activeSuppressionCount, 1);
    assert.equal(digest.truncated, false);
    assert.equal(digest.maxLookbackHours, ATTENTION_MAX_LOOKBACK_HOURS);
    assert.equal(digest.reminders.items.length, 0);
    assert.equal(digest.reminders.quietHours, 24);
    assert.equal(digest.dueReminders.items.length, 0);
    assert.equal(digest.actionNeeded.items.length, 0);
    assert.equal(digest.actionNeeded.overdueHours, REMINDER_OVERDUE_HOURS);
    assert.equal(
      digest.actionNeeded.escalationQuietHours,
      ESCALATION_QUIET_HOURS,
    );
  });

  it("marks truncated when over the item cap", () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    const since = new Date("2026-03-01T00:00:00.000Z");
    const created: AttentionItem[] = [];
    for (let i = 0; i < ATTENTION_ITEMS_MAX + 2; i += 1) {
      created.push(
        item({
          kind: "finding.created",
          findingId: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
          at: new Date(generatedAt.getTime() - i * 1000),
        }),
      );
    }

    const digest = assembleAttentionDigest(generatedAt, since, {
      created,
      statusChanged: [],
      openCount: 0,
      activeSuppressionCount: 0,
      sourceTruncated: false,
    });
    assert.equal(digest.items.length, ATTENTION_ITEMS_MAX);
    assert.equal(digest.truncated, true);
  });
});

describe("assembleOwnershipReminders", () => {
  it("caps reminders and preserves quietHours", () => {
    const items: AttentionItem[] = [];
    for (let i = 0; i < REMINDER_ITEMS_MAX + 1; i += 1) {
      items.push(
        item({
          kind: "finding.needs_revisit",
          findingId: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
          at: new Date(`2026-02-28T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z`),
        }),
      );
    }
    const reminders = assembleOwnershipReminders(items, false);
    assert.equal(reminders.items.length, REMINDER_ITEMS_MAX);
    assert.equal(reminders.truncated, true);
    assert.equal(reminders.quietHours, REMINDER_QUIET_HOURS);
  });
});

describe("reminderQuietBefore", () => {
  it("subtracts the fixed quiet window", () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    assert.equal(
      reminderQuietBefore(generatedAt).toISOString(),
      "2026-02-28T12:00:00.000Z",
    );
  });
});

describe("partitionDueReminders", () => {
  it("splits soft due from overdue escalation without duplicates", () => {
    const overdueBefore = new Date("2026-03-01T08:00:00.000Z");
    const soft = item({
      kind: "finding.reminder_due",
      findingId: FINDING_A,
      at: new Date("2026-03-01T10:00:00.000Z"),
    });
    const overdue = item({
      kind: "finding.reminder_due",
      findingId: FINDING_B,
      at: new Date("2026-03-01T06:00:00.000Z"),
    });

    const partitioned = partitionDueReminders([soft, overdue], overdueBefore);
    assert.equal(partitioned.softDue.length, 1);
    assert.equal(partitioned.softDue[0].findingId, FINDING_A);
    assert.equal(partitioned.softDue[0].kind, "finding.reminder_due");
    assert.equal(partitioned.overdue.length, 1);
    assert.equal(partitioned.overdue[0].findingId, FINDING_B);
    assert.equal(partitioned.overdue[0].kind, "finding.action_needed");
  });
});

describe("partitionOwnershipReminders", () => {
  it("splits soft quiet from long-quiet escalation and respects excludes", () => {
    const escalationBefore = new Date("2026-02-27T12:00:00.000Z");
    const soft = item({
      kind: "finding.needs_revisit",
      findingId: FINDING_A,
      at: new Date("2026-02-28T12:00:00.000Z"),
    });
    const escalated = item({
      kind: "finding.needs_revisit",
      findingId: FINDING_B,
      at: new Date("2026-02-26T12:00:00.000Z"),
    });
    const alreadyOverdue = item({
      kind: "finding.needs_revisit",
      findingId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      at: new Date("2026-02-25T12:00:00.000Z"),
    });

    const partitioned = partitionOwnershipReminders(
      [soft, escalated, alreadyOverdue],
      escalationBefore,
      new Set([alreadyOverdue.findingId]),
    );
    assert.equal(partitioned.softQuiet.length, 1);
    assert.equal(partitioned.softQuiet[0].findingId, FINDING_A);
    assert.equal(partitioned.softQuiet[0].kind, "finding.needs_revisit");
    assert.equal(partitioned.escalatedQuiet.length, 1);
    assert.equal(partitioned.escalatedQuiet[0].findingId, FINDING_B);
    assert.equal(partitioned.escalatedQuiet[0].kind, "finding.action_needed");
  });
});

describe("assembleActionNeeded", () => {
  it("caps items and preserves escalation constants", () => {
    const items: AttentionItem[] = [];
    for (let i = 0; i < 21; i += 1) {
      items.push(
        item({
          kind: "finding.action_needed",
          findingId: `dddddddd-dddd-4ddd-8ddd-${String(i).padStart(12, "0")}`,
          at: new Date(`2026-02-28T${String(10 + (i % 10)).padStart(2, "0")}:00:00.000Z`),
        }),
      );
    }
    const action = assembleActionNeeded(items, false);
    assert.equal(action.items.length, 20);
    assert.equal(action.truncated, true);
    assert.equal(action.overdueHours, REMINDER_OVERDUE_HOURS);
    assert.equal(action.escalationQuietHours, ESCALATION_QUIET_HOURS);
  });
});

describe("dismiss-until-change", () => {
  it("hides dismissed items until condition_at advances or kind changes", () => {
    const conditionAt = new Date("2026-02-28T12:00:00.000Z");
    const dismissed = item({
      kind: "finding.action_needed",
      findingId: FINDING_A,
      at: conditionAt,
    });
    const advanced = item({
      kind: "finding.action_needed",
      findingId: FINDING_A,
      at: new Date("2026-03-01T12:00:00.000Z"),
    });
    const otherKind = item({
      kind: "finding.needs_revisit",
      findingId: FINDING_A,
      at: conditionAt,
    });

    const map = toAttentionDismissalMap([
      {
        findingId: FINDING_A,
        kind: "finding.action_needed",
        conditionAt,
      },
    ]);

    assert.equal(isAttentionItemDismissed(dismissed, map), true);
    assert.equal(isAttentionItemDismissed(advanced, map), false);
    assert.equal(isAttentionItemDismissed(otherKind, map), false);
    assert.deepEqual(filterDismissedAttentionItems([dismissed, advanced], map), [
      advanced,
    ]);
  });

  it("parses dismiss body and rejects bad kinds / identity fields", () => {
    const ok = parseDismissAttentionBody({
      findingId: FINDING_A,
      kind: "finding.action_needed",
      conditionAt: "2026-02-28T12:00:00.000Z",
    });
    assert.equal(ok.ok, true);
    if (ok.ok) {
      assert.equal(ok.dismiss.findingId, FINDING_A);
      assert.equal(ok.dismiss.kind, "finding.action_needed");
      assert.equal(
        ok.dismiss.conditionAt.toISOString(),
        "2026-02-28T12:00:00.000Z",
      );
    }

    assert.equal(
      parseDismissAttentionBody({
        findingId: FINDING_A,
        kind: "finding.created",
        conditionAt: "2026-02-28T12:00:00.000Z",
      }).ok,
      false,
    );
    assert.equal(
      parseDismissAttentionBody({
        findingId: FINDING_A,
        kind: "finding.action_needed",
        conditionAt: "2026-02-28T12:00:00.000Z",
        tenantId: "x",
      }).ok,
      false,
    );
  });
});
