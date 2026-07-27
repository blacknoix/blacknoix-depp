import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseTelemetryBatchV1, parseTelemetryEventV1 } from "../../src/telemetry/contract";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    agentId: AGENT_ID,
    eventType: "heartbeat",
    occurredAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("parseTelemetryEventV1", () => {
  it("accepts a minimal valid heartbeat", () => {
    const result = parseTelemetryEventV1(validBody());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.event.schemaVersion, 1);
    assert.equal(result.event.agentId, AGENT_ID);
    assert.equal(result.event.eventType, "heartbeat");
    assert.deepEqual(result.event.payload, {});
  });

  it("accepts agent.started and agent.stopped with a small payload", () => {
    for (const eventType of ["agent.started", "agent.stopped"] as const) {
      const result = parseTelemetryEventV1(
        validBody({ eventType, payload: { reason: "ok" } }),
      );
      assert.equal(result.ok, true);
      if (!result.ok) return;
      assert.equal(result.event.eventType, eventType);
      assert.deepEqual(result.event.payload, { reason: "ok" });
    }
  });

  it("rejects a non-object body", () => {
    const result = parseTelemetryEventV1([]);
    assert.equal(result.ok, false);
  });

  it("rejects tenant identity fields in the body", () => {
    for (const key of ["tenantId", "tenant_id", "tid"]) {
      const result = parseTelemetryEventV1(validBody({ [key]: AGENT_ID }));
      assert.equal(result.ok, false);
      if (!result.ok) {
        assert.match(result.message, /tenant identity/i);
      }
    }
  });

  it("rejects unknown top-level fields", () => {
    const result = parseTelemetryEventV1(validBody({ severity: "high" }));
    assert.equal(result.ok, false);
  });

  it("rejects unsupported schemaVersion", () => {
    assert.equal(parseTelemetryEventV1(validBody({ schemaVersion: 2 })).ok, false);
    assert.equal(parseTelemetryEventV1(validBody({ schemaVersion: "1" })).ok, false);
  });

  it("rejects non-UUID agentId", () => {
    assert.equal(
      parseTelemetryEventV1(validBody({ agentId: "not-a-uuid" })).ok,
      false,
    );
  });

  it("rejects unknown eventType", () => {
    assert.equal(
      parseTelemetryEventV1(validBody({ eventType: "malware.detected" })).ok,
      false,
    );
  });

  it("rejects occurredAt too far in the future", () => {
    const future = new Date(Date.now() + 10 * 60_000).toISOString();
    assert.equal(
      parseTelemetryEventV1(validBody({ occurredAt: future })).ok,
      false,
    );
  });

  it("rejects occurredAt too far in the past", () => {
    const past = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
    assert.equal(parseTelemetryEventV1(validBody({ occurredAt: past })).ok, false);
  });

  it("rejects array payloads and deep nesting", () => {
    assert.equal(
      parseTelemetryEventV1(validBody({ payload: [] })).ok,
      false,
    );
    assert.equal(
      parseTelemetryEventV1(
        validBody({ payload: { a: { b: { c: 1 } } } }),
      ).ok,
      false,
    );
  });

  it("rejects oversized payloads", () => {
    const big = "x".repeat(5 * 1024);
    assert.equal(
      parseTelemetryEventV1(validBody({ payload: { note: big } })).ok,
      false,
    );
  });
});

describe("parseTelemetryBatchV1", () => {
  const opts = { agentId: AGENT_ID, maxEvents: 50 };

  function validEvent(overrides: Record<string, unknown> = {}) {
    return {
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: new Date().toISOString(),
      ...overrides,
    };
  }

  it("accepts a multi-event batch and binds agentId", () => {
    const result = parseTelemetryBatchV1(
      {
        events: [
          validEvent({ eventType: "heartbeat" }),
          validEvent({ eventType: "agent.started" }),
        ],
      },
      opts,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.events.length, 2);
    assert.equal(result.events[0].agentId, AGENT_ID);
    assert.equal(result.events[1].eventType, "agent.started");
  });

  it("rejects empty or oversized batches", () => {
    assert.equal(
      parseTelemetryBatchV1({ events: [] }, opts).ok,
      false,
    );
    assert.equal(
      parseTelemetryBatchV1(
        {
          events: Array.from({ length: 3 }, () => validEvent()),
        },
        { agentId: AGENT_ID, maxEvents: 2 },
      ).ok,
      false,
    );
  });

  it("is all-or-nothing: one bad event fails the batch", () => {
    const result = parseTelemetryBatchV1(
      {
        events: [
          validEvent(),
          validEvent({ eventType: "malware.detected" }),
        ],
      },
      opts,
    );
    assert.equal(result.ok, false);
    if (!result.ok) {
      assert.match(result.message, /^events\[1\]:/);
    }
  });

  it("rejects tenantId on the batch envelope and agent mismatch", () => {
    assert.equal(
      parseTelemetryBatchV1(
        { tenantId: AGENT_ID, events: [validEvent()] },
        opts,
      ).ok,
      false,
    );
    const mismatch = parseTelemetryBatchV1(
      {
        events: [
          validEvent({
            agentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          }),
        ],
      },
      opts,
    );
    assert.equal(mismatch.ok, false);
    if (!mismatch.ok) {
      assert.match(mismatch.message, /agent identity mismatch/i);
    }
  });
});
