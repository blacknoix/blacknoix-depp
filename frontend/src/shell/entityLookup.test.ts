import { describe, expect, it } from "vitest";

import type { AgentInventoryItem } from "../agents/types";
import { buildEntityLookupResults } from "./entityLookup";
import {
  buildOperatorCommands,
  commandTargetPath,
  resolveJumpMatches,
} from "./commands";

const agents: AgentInventoryItem[] = [
  {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    name: "edge-west",
    createdAt: "2026-03-01T12:00:00.000Z",
    lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
    openFindingsCount: 1,
    heartbeatFreshness: "recent",
  },
  {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "edge-east",
    createdAt: "2026-03-01T12:00:00.000Z",
    lastHeartbeatAt: null,
    openFindingsCount: 0,
    heartbeatFreshness: "unknown",
  },
];

describe("buildEntityLookupResults", () => {
  it("returns nothing for empty or too-short queries", () => {
    expect(buildEntityLookupResults("", agents)).toEqual([]);
    expect(buildEntityLookupResults("e", agents)).toEqual([]);
  });

  it("ranks exact agent id and name ahead of prefixes", () => {
    const byId = buildEntityLookupResults(
      "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      agents,
    );
    expect(byId).toHaveLength(1);
    expect(byId[0].entity).toBe("agent");
    expect(byId[0].to).toBe(
      "/agents?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );

    const byName = buildEntityLookupResults("edge-west", agents);
    expect(byName[0].label).toBe("Agent · edge-west");

    const byPrefix = buildEntityLookupResults("edge-", agents);
    expect(byPrefix.map((r) => r.label)).toEqual([
      "Agent · edge-east",
      "Agent · edge-west",
    ]);
  });

  it("matches agent id prefixes and offers finding UUID when not an agent", () => {
    const prefix = buildEntityLookupResults("aaaaaaaa", agents);
    expect(prefix).toHaveLength(1);
    expect(prefix[0].entity).toBe("agent");

    const findingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const finding = buildEntityLookupResults(findingId, agents);
    expect(finding).toHaveLength(1);
    expect(finding[0].entity).toBe("finding");
    expect(finding[0].to).toBe(`/findings?findingId=${findingId}`);
  });

  it("does not invent fuzzy or title search", () => {
    expect(buildEntityLookupResults("west-edge", agents)).toEqual([]);
    expect(buildEntityLookupResults("lifecycle", agents)).toEqual([]);
  });
});

describe("resolveJumpMatches", () => {
  it("puts lookup hits before static command matches", () => {
    const commands = buildOperatorCommands({
      session: {
        kind: "tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const matches = resolveJumpMatches({
      commands,
      query: "edge-w",
      agents,
    });
    expect(matches[0]?.kind).toBe("lookup");
    if (matches[0]?.kind === "lookup") {
      expect(matches[0].entity).toBe("agent");
      expect(commandTargetPath(matches[0])).toBe(
        "/agents?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      );
    }
  });

  it("keeps static catalog when query is empty", () => {
    const commands = buildOperatorCommands({
      session: {
        kind: "tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
      },
    });
    const matches = resolveJumpMatches({
      commands,
      query: "",
      agents,
    });
    expect(matches.some((c) => c.id === "nav.findings")).toBe(true);
    expect(matches.every((c) => c.kind !== "lookup")).toBe(true);
  });
});
