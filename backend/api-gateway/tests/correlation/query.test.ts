import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FINDINGS_QUERY_MAX_LIMIT,
  OPERATOR_NOTE_MAX_LENGTH,
  parseFindingsQueryV1,
  parsePatchFindingBody,
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

  it("parses ownerScope work queues and rejects raw ownerUserId", () => {
    const USER = "22222222-2222-4222-8222-222222222222";
    const mine = parseFindingsQueryV1(
      { ownerScope: "me" },
      { principalUserId: USER },
    );
    assert.equal(mine.ok, true);
    if (!mine.ok) return;
    assert.equal(mine.query.ownerScope, "me");
    assert.equal(mine.query.ownerUserId, USER);

    assert.equal(
      parseFindingsQueryV1({ ownerScope: "me" }).ok,
      false,
    );
    assert.equal(
      parseFindingsQueryV1(
        { ownerScope: "me" },
        { principalAgentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      ).ok,
      false,
    );

    const none = parseFindingsQueryV1({ ownerScope: "none", status: "open" });
    assert.equal(none.ok, true);
    if (!none.ok) return;
    assert.equal(none.query.ownerScope, "none");
    assert.equal(none.query.status, "open");

    assert.equal(
      parseFindingsQueryV1({ ownerUserId: USER }).ok,
      false,
    );
  });
});

describe("parsePatchFindingBody", () => {
  const USER = "22222222-2222-4222-8222-222222222222";

  it("accepts status-only patches", () => {
    const result = parsePatchFindingBody({ status: "acknowledged" });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.patch.status, "acknowledged");
    assert.equal("ownerUserId" in result.patch, false);
  });

  it("accepts claim, clear, and reassignment ownerUserId", () => {
    const claim = parsePatchFindingBody({ claimOwner: true });
    assert.equal(claim.ok, true);
    if (!claim.ok) return;
    assert.equal(claim.patch.claimOwner, true);

    const clear = parsePatchFindingBody({ ownerUserId: null });
    assert.equal(clear.ok, true);
    if (!clear.ok) return;
    assert.equal(clear.patch.ownerUserId, null);

    const assign = parsePatchFindingBody({ ownerUserId: USER });
    assert.equal(assign.ok, true);
    if (!assign.ok) return;
    assert.equal(assign.patch.ownerUserId, USER);
  });

  it("trims notes, clears empty, and bounds length", () => {
    const note = parsePatchFindingBody({ operatorNote: "  hello  " });
    assert.equal(note.ok, true);
    if (!note.ok) return;
    assert.equal(note.patch.operatorNote, "hello");

    const empty = parsePatchFindingBody({ operatorNote: "   " });
    assert.equal(empty.ok, true);
    if (!empty.ok) return;
    assert.equal(empty.patch.operatorNote, null);

    const tooLong = parsePatchFindingBody({
      operatorNote: "x".repeat(OPERATOR_NOTE_MAX_LENGTH + 1),
    });
    assert.equal(tooLong.ok, false);
  });

  it("accepts remindAt set and clear", () => {
    const set = parsePatchFindingBody({
      remindAt: "2026-03-01T12:00:00.000Z",
    });
    assert.equal(set.ok, true);
    if (!set.ok) return;
    assert.ok(set.patch.remindAt instanceof Date);
    assert.equal(set.patch.remindAt!.toISOString(), "2026-03-01T12:00:00.000Z");

    const clear = parsePatchFindingBody({ remindAt: null });
    assert.equal(clear.ok, true);
    if (!clear.ok) return;
    assert.equal(clear.patch.remindAt, null);
  });

  it("rejects invalid remindAt timestamps", () => {
    assert.equal(
      parsePatchFindingBody({ remindAt: "not-a-timestamp" }).ok,
      false,
    );
    assert.equal(parsePatchFindingBody({ remindAt: "" }).ok, false);
  });

  it("rejects empty body and unknown fields", () => {
    assert.equal(parsePatchFindingBody({}).ok, false);
    assert.equal(parsePatchFindingBody({ assignee: USER }).ok, false);
    assert.equal(
      parsePatchFindingBody({ status: "open", tenantId: "x" }).ok,
      false,
    );
  });
});
