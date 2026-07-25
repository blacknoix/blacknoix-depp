import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  evaluateCountRule,
  evaluateHeartbeatSilence,
  floorToWindowBucket,
  HEARTBEAT_BURST_RULE,
  LIFECYCLE_CHURN_RULE,
  SILENCE_THRESHOLD_MS,
} from "../../src/correlation/rules";
import type { TelemetryWindowSummary } from "../../src/telemetry/repository";

function summary(
  overrides: Partial<TelemetryWindowSummary> & { total: number },
): TelemetryWindowSummary {
  return {
    countsByType: {},
    oldestOccurredAt: null,
    newestOccurredAt: null,
    sampleEventIds: [],
    ...overrides,
  };
}

describe("floorToWindowBucket", () => {
  it("aligns to epoch multiples of the window", () => {
    const windowMs = 60_000;
    const at = new Date("2026-03-01T12:00:30.000Z");
    assert.equal(
      floorToWindowBucket(at, windowMs).toISOString(),
      "2026-03-01T12:00:00.000Z",
    );
  });
});

describe("evaluateCountRule — agent.lifecycle_churn", () => {
  const windowEnd = new Date("2026-03-01T12:10:00.000Z");

  it("fires at or above threshold", () => {
    const candidate = evaluateCountRule(
      LIFECYCLE_CHURN_RULE,
      summary({
        total: 6,
        countsByType: { "agent.started": 3, "agent.stopped": 3 },
        sampleEventIds: ["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"],
        oldestOccurredAt: new Date("2026-03-01T12:01:00.000Z"),
        newestOccurredAt: new Date("2026-03-01T12:09:00.000Z"),
      }),
      windowEnd,
    );

    assert.ok(candidate);
    assert.equal(candidate.ruleId, "agent.lifecycle_churn");
    assert.equal(candidate.severity, "medium");
    assert.equal(candidate.evidence.totalInWindow, 6);
    assert.deepEqual(candidate.evidence.countsByEventType, {
      "agent.started": 3,
      "agent.stopped": 3,
    });
    assert.equal(
      candidate.windowStart.toISOString(),
      "2026-03-01T12:00:00.000Z",
    );
  });

  it("does not fire below threshold", () => {
    const candidate = evaluateCountRule(
      LIFECYCLE_CHURN_RULE,
      summary({
        total: 5,
        countsByType: { "agent.started": 3, "agent.stopped": 2 },
      }),
      windowEnd,
    );
    assert.equal(candidate, null);
  });
});

describe("evaluateCountRule — agent.heartbeat_burst", () => {
  const windowEnd = new Date("2026-03-01T12:00:30.000Z");

  it("fires at or above threshold", () => {
    const candidate = evaluateCountRule(
      HEARTBEAT_BURST_RULE,
      summary({
        total: 30,
        countsByType: { heartbeat: 30 },
        oldestOccurredAt: new Date("2026-03-01T12:00:00.000Z"),
        newestOccurredAt: new Date("2026-03-01T12:00:29.000Z"),
      }),
      windowEnd,
    );

    assert.ok(candidate);
    assert.equal(candidate.ruleId, "agent.heartbeat_burst");
    assert.equal(candidate.evidence.totalInWindow, 30);
    assert.equal(
      candidate.windowStart.toISOString(),
      "2026-03-01T11:59:30.000Z",
    );
  });

  it("does not fire below threshold", () => {
    const candidate = evaluateCountRule(
      HEARTBEAT_BURST_RULE,
      summary({ total: 29, countsByType: { heartbeat: 29 } }),
      windowEnd,
    );
    assert.equal(candidate, null);
  });
});

describe("evaluateHeartbeatSilence", () => {
  const now = new Date("2026-03-01T12:10:00.000Z");

  it("fires when the last heartbeat is at or beyond the threshold", () => {
    const lastHeartbeatAt = new Date("2026-03-01T12:05:00.000Z");
    const candidate = evaluateHeartbeatSilence({ lastHeartbeatAt, now });
    assert.ok(candidate);
    assert.equal(candidate.ruleId, "agent.heartbeat_silence");
    assert.equal(candidate.evidence.silenceThresholdMs, SILENCE_THRESHOLD_MS);
    assert.equal(
      candidate.evidence.lastHeartbeatAt,
      lastHeartbeatAt.toISOString(),
    );
    assert.equal(candidate.evidence.ageMs, SILENCE_THRESHOLD_MS);
    assert.equal(
      candidate.windowStart.toISOString(),
      "2026-03-01T12:05:00.000Z",
    );
    assert.equal(
      floorToWindowBucket(candidate.windowStart, SILENCE_THRESHOLD_MS).toISOString(),
      candidate.windowBucket.toISOString(),
    );
  });

  it("does not fire when a recent heartbeat exists", () => {
    const candidate = evaluateHeartbeatSilence({
      lastHeartbeatAt: new Date("2026-03-01T12:06:00.000Z"),
      now,
    });
    assert.equal(candidate, null);
  });

  it("does not fire when the agent has never heartbeated", () => {
    const candidate = evaluateHeartbeatSilence({
      lastHeartbeatAt: null,
      now,
    });
    assert.equal(candidate, null);
  });
});
