import { describe, expect, it } from "vitest";

import {
  activeFindingsQueue,
  applyFindingsQueue,
  clearFindingsQueue,
} from "./queues";

describe("findings queues", () => {
  it("detects mine and unowned_open", () => {
    expect(activeFindingsQueue({ ownerScope: "me" })).toBe("mine");
    expect(activeFindingsQueue({ ownerScope: "me", status: "open" })).toBe(
      "mine",
    );
    expect(
      activeFindingsQueue({ ownerScope: "none", status: "open" }),
    ).toBe("unowned_open");
    expect(activeFindingsQueue({ ownerScope: "none" })).toBeNull();
    expect(activeFindingsQueue({ status: "open" })).toBeNull();
  });

  it("applies presets while preserving agent/rule context", () => {
    expect(
      applyFindingsQueue(
        { agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", status: "resolved" },
        "unowned_open",
      ),
    ).toEqual({
      ownerScope: "none",
      status: "open",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(
      applyFindingsQueue(
        { ruleId: "agent.lifecycle_churn", status: "open" },
        "mine",
      ),
    ).toEqual({
      ownerScope: "me",
      ruleId: "agent.lifecycle_churn",
    });
  });

  it("clears queue fields coherently", () => {
    expect(
      clearFindingsQueue({ ownerScope: "none", status: "open" }),
    ).toEqual({});
    expect(clearFindingsQueue({ ownerScope: "me", status: "open" })).toEqual({
      status: "open",
    });
    expect(
      clearFindingsQueue({
        ownerScope: "me",
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }),
    ).toEqual({ agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" });
  });
});
