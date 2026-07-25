import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  parseTelemetryQueryV1,
  TELEMETRY_QUERY_DEFAULT_LIMIT,
  TELEMETRY_QUERY_MAX_LIMIT,
  TELEMETRY_QUERY_MAX_OFFSET,
} from "../../src/telemetry/query";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("parseTelemetryQueryV1", () => {
  it("requires agentId for a human (non-agent) principal", () => {
    const result = parseTelemetryQueryV1({});
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /agentId is required/);
  });

  it("scopes an agent principal to itself without requiring query agentId", () => {
    const result = parseTelemetryQueryV1({}, { principalAgentId: AGENT_ID });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.query.agentId, AGENT_ID);
    assert.equal(result.query.limit, TELEMETRY_QUERY_DEFAULT_LIMIT);
    assert.equal(result.query.offset, 0);
  });

  it("rejects agentId mismatch for an agent principal", () => {
    const result = parseTelemetryQueryV1(
      { agentId: OTHER_AGENT },
      { principalAgentId: AGENT_ID },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, "agent identity mismatch");
  });

  it("rejects tenant identity in the query string", () => {
    for (const key of ["tenantId", "tenant_id", "tid"]) {
      const result = parseTelemetryQueryV1(
        { [key]: "11111111-1111-4111-8111-111111111111", agentId: AGENT_ID },
      );
      assert.equal(result.ok, false);
      if (result.ok) return;
      assert.match(result.message, /tenant identity/);
    }
  });

  it("rejects invalid eventType", () => {
    const result = parseTelemetryQueryV1({
      agentId: AGENT_ID,
      eventType: "correlation.hit",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /eventType/);
  });

  it("rejects inverted and oversized time windows", () => {
    const since = "2026-01-10T00:00:00.000Z";
    const untilEarlier = "2026-01-01T00:00:00.000Z";
    const untilTooWide = "2026-03-01T00:00:00.000Z";

    const inverted = parseTelemetryQueryV1({
      agentId: AGENT_ID,
      since,
      until: untilEarlier,
    });
    assert.equal(inverted.ok, false);
    if (inverted.ok) return;
    assert.match(inverted.message, /until must be greater/);

    const wide = parseTelemetryQueryV1({
      agentId: AGENT_ID,
      since,
      until: untilTooWide,
    });
    assert.equal(wide.ok, false);
    if (wide.ok) return;
    assert.match(wide.message, /30 days/);
  });

  it("enforces limit and offset bounds", () => {
    assert.equal(
      parseTelemetryQueryV1({ agentId: AGENT_ID, limit: "0" }).ok,
      false,
    );
    assert.equal(
      parseTelemetryQueryV1({
        agentId: AGENT_ID,
        limit: String(TELEMETRY_QUERY_MAX_LIMIT + 1),
      }).ok,
      false,
    );
    assert.equal(
      parseTelemetryQueryV1({ agentId: AGENT_ID, offset: "-1" }).ok,
      false,
    );
    assert.equal(
      parseTelemetryQueryV1({
        agentId: AGENT_ID,
        offset: String(TELEMETRY_QUERY_MAX_OFFSET + 1),
      }).ok,
      false,
    );

    const ok = parseTelemetryQueryV1({
      agentId: AGENT_ID,
      limit: "10",
      offset: "5",
      eventType: "heartbeat",
      since: "2026-01-01T00:00:00.000Z",
      until: "2026-01-02T00:00:00.000Z",
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.query.limit, 10);
    assert.equal(ok.query.offset, 5);
    assert.equal(ok.query.eventType, "heartbeat");
  });
});
