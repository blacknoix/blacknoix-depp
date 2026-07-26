import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleAttentionDigest,
  ATTENTION_ITEMS_MAX,
  ATTENTION_MAX_LOOKBACK_HOURS,
  parseAttentionSinceQuery,
  resolveAttentionSince,
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
