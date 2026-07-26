import { describe, expect, it } from "vitest";

import {
  agentsPath,
  findingsPath,
  parseUuidQueryParam,
} from "./crossLinks";

describe("parseUuidQueryParam", () => {
  it("treats missing/empty as absent", () => {
    expect(parseUuidQueryParam(null)).toEqual({ ok: true, present: false });
    expect(parseUuidQueryParam("")).toEqual({ ok: true, present: false });
  });

  it("accepts UUIDs and rejects malformed values", () => {
    expect(
      parseUuidQueryParam("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"),
    ).toEqual({
      ok: true,
      present: true,
      id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(parseUuidQueryParam("not-a-uuid")).toEqual({
      ok: false,
      present: true,
      raw: "not-a-uuid",
    });
  });
});

describe("cross-link path builders", () => {
  it("builds agents and findings paths with narrow params", () => {
    expect(agentsPath()).toBe("/agents");
    expect(agentsPath("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa")).toBe(
      "/agents?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(findingsPath()).toBe("/findings");
    expect(
      findingsPath({
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        status: "open",
        ruleId: "agent.lifecycle_churn",
      }),
    ).toBe(
      "/findings?status=open&ruleId=agent.lifecycle_churn&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
  });
});
