import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { parseCreateSharedFindingViewBody } from "../../src/findings-views/contract";

describe("parseCreateSharedFindingViewBody", () => {
  it("accepts valid filters and rejects findingId / tenant / bad enums", () => {
    const ok = parseCreateSharedFindingViewBody({
      name: " Open churn ",
      filters: {
        status: "open",
        ruleId: "agent.lifecycle_churn",
        agentId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      },
    });
    assert.equal(ok.ok, true);
    if (!ok.ok) return;
    assert.equal(ok.input.name, "Open churn");
    assert.deepEqual(ok.input.filters, {
      status: "open",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });

    assert.equal(
      parseCreateSharedFindingViewBody({
        name: "x",
        filters: { findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" },
      }).ok,
      false,
    );
    assert.equal(
      parseCreateSharedFindingViewBody({
        name: "x",
        tenantId: "11111111-1111-4111-8111-111111111111",
        filters: {},
      }).ok,
      false,
    );
    assert.equal(
      parseCreateSharedFindingViewBody({
        name: "x",
        filters: { status: "nope" },
      }).ok,
      false,
    );
  });
});
