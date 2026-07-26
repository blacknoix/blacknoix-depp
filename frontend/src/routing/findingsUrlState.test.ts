import { describe, expect, it } from "vitest";

import {
  filtersEqual,
  hasActiveFilters,
  parseFindingsSearchParams,
  serializeFindingsSearchParams,
} from "./findingsUrlState";

describe("parseFindingsSearchParams", () => {
  it("parses valid filters and selection", () => {
    const state = parseFindingsSearchParams(
      new URLSearchParams(
        "status=open&ruleId=agent.lifecycle_churn&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      ),
    );
    expect(state.filters).toEqual({
      status: "open",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(state.findingId).toBe("dddddddd-dddd-4ddd-8ddd-dddddddddddd");
    expect(state.invalid).toEqual({
      agentId: false,
      findingId: false,
      status: false,
      ruleId: false,
    });
  });

  it("fails closed on malformed enums and ids", () => {
    const state = parseFindingsSearchParams(
      new URLSearchParams(
        "status=nope&ruleId=not.a.rule&agentId=bad&findingId=also-bad",
      ),
    );
    expect(state.filters).toEqual({});
    expect(state.findingId).toBeNull();
    expect(state.invalid).toEqual({
      agentId: true,
      findingId: true,
      status: true,
      ruleId: true,
    });
  });
});

describe("serializeFindingsSearchParams", () => {
  it("omits empty filters and preserves order of meaningful params", () => {
    const params = serializeFindingsSearchParams({
      filters: {
        status: "acknowledged",
        ruleId: "agent.heartbeat_burst",
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      },
      findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    });
    expect(params.toString()).toBe(
      "status=acknowledged&ruleId=agent.heartbeat_burst&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(
      serializeFindingsSearchParams({ filters: {}, findingId: null }).toString(),
    ).toBe("");
  });
});

describe("filtersEqual / hasActiveFilters", () => {
  it("compares and detects active filters", () => {
    expect(filtersEqual({ status: "open" }, { status: "open" })).toBe(true);
    expect(filtersEqual({ status: "open" }, {})).toBe(false);
    expect(hasActiveFilters({})).toBe(false);
    expect(hasActiveFilters({ ruleId: "agent.lifecycle_churn" })).toBe(true);
  });
});
