import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINDINGS_QUERY_MAX_LIMIT,
  parseFindingsQueryV1,
} from "../../src/correlation/query";

const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER_AGENT = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("parseFindingsQueryV1", () => {
  it("allows a human principal to list tenant-wide without agentId", () => {
    const result = parseFindingsQueryV1({});
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.query.agentId, undefined);
    assert.equal(result.query.limit, 50);
    assert.equal(result.query.offset, 0);
  });

  it("scopes an agent principal to itself", () => {
    const result = parseFindingsQueryV1({}, { principalAgentId: AGENT_ID });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.query.agentId, AGENT_ID);
  });

  it("rejects agentId mismatch for an agent principal", () => {
    const result = parseFindingsQueryV1(
      { agentId: OTHER_AGENT },
      { principalAgentId: AGENT_ID },
    );
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.message, "agent identity mismatch");
  });

  it("rejects tenant identity in the query string", () => {
    const result = parseFindingsQueryV1({
      tenantId: "11111111-1111-4111-8111-111111111111",
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /tenant identity/);
  });

  it("rejects unknown ruleId and out-of-bounds limit", () => {
    assert.equal(
      parseFindingsQueryV1({ ruleId: "malware.outbreak" }).ok,
      false,
    );
    assert.equal(
      parseFindingsQueryV1({
        limit: String(FINDINGS_QUERY_MAX_LIMIT + 1),
      }).ok,
      false,
    );
  });

  it("accepts a known ruleId and agentId filter", () => {
    const result = parseFindingsQueryV1({
      agentId: AGENT_ID,
      ruleId: "agent.lifecycle_churn",
      limit: "10",
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.query.agentId, AGENT_ID);
    assert.equal(result.query.ruleId, "agent.lifecycle_churn");
    assert.equal(result.query.limit, 10);

    const silence = parseFindingsQueryV1({
      ruleId: "agent.heartbeat_silence",
    });
    assert.equal(silence.ok, true);
    if (!silence.ok) return;
    assert.equal(silence.query.ruleId, "agent.heartbeat_silence");

    const byStatus = parseFindingsQueryV1({ status: "open" });
    assert.equal(byStatus.ok, true);
    if (!byStatus.ok) return;
    assert.equal(byStatus.query.status, "open");

    assert.equal(parseFindingsQueryV1({ status: "snoozed" }).ok, false);
  });
});
