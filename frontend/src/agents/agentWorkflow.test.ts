import { describe, expect, it } from "vitest";

import type { AgentInventoryItem } from "./types";
import type { Finding } from "../findings/types";
import {
  agentMatchesFilters,
  filterAgents,
  sortAgentsForInvestigation,
  sortRelatedFindings,
} from "./agentWorkflow";
import {
  parseAgentsSearchParams,
  serializeAgentsSearchParams,
} from "../routing/agentsUrlState";

const recent: AgentInventoryItem = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "edge-recent",
  createdAt: "2026-03-01T12:00:00.000Z",
  lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
  openFindingsCount: 0,
  heartbeatFreshness: "recent",
};

const stale: AgentInventoryItem = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  name: "edge-stale",
  createdAt: "2026-03-01T12:00:00.000Z",
  lastHeartbeatAt: "2026-02-28T12:00:00.000Z",
  openFindingsCount: 2,
  heartbeatFreshness: "stale",
};

const unknown: AgentInventoryItem = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  name: "edge-unknown",
  createdAt: "2026-03-01T12:00:00.000Z",
  lastHeartbeatAt: null,
  openFindingsCount: 1,
  heartbeatFreshness: "unknown",
};

describe("agentsUrlState", () => {
  it("parses filters and fails closed on invalid values", () => {
    const ok = parseAgentsSearchParams(
      new URLSearchParams(
        "freshness=stale&hasOpenFindings=1&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      ),
    );
    expect(ok.filters).toEqual({ freshness: "stale", hasOpenFindings: true });
    expect(ok.agentId).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(ok.invalid).toEqual({
      agentId: false,
      freshness: false,
      hasOpenFindings: false,
    });

    const bad = parseAgentsSearchParams(
      new URLSearchParams("freshness=online&hasOpenFindings=maybe&agentId=nope"),
    );
    expect(bad.filters).toEqual({});
    expect(bad.agentId).toBeNull();
    expect(bad.invalid).toEqual({
      agentId: true,
      freshness: true,
      hasOpenFindings: true,
    });
  });

  it("serializes only active filters", () => {
    expect(
      serializeAgentsSearchParams({
        filters: { freshness: "unknown", hasOpenFindings: true },
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      }).toString(),
    ).toBe(
      "freshness=unknown&hasOpenFindings=1&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(
      serializeAgentsSearchParams({
        filters: { hasOpenFindings: false },
        agentId: null,
      }).toString(),
    ).toBe("");
  });
});

describe("agentWorkflow", () => {
  it("filters by freshness and open findings", () => {
    expect(agentMatchesFilters(stale, { freshness: "stale" })).toBe(true);
    expect(agentMatchesFilters(recent, { freshness: "stale" })).toBe(false);
    expect(
      filterAgents([recent, stale, unknown], { hasOpenFindings: true }).map(
        (a) => a.id,
      ),
    ).toEqual([stale.id, unknown.id]);
  });

  it("orders inventory for investigation priority", () => {
    expect(
      sortAgentsForInvestigation([recent, unknown, stale]).map((a) => a.id),
    ).toEqual([stale.id, unknown.id, recent.id]);
  });

  it("orders related findings open-first", () => {
    const findings: Finding[] = [
      {
        id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        agentId: recent.id,
        ruleId: "agent.lifecycle_churn",
        title: "Resolved one",
        severity: "medium",
        status: "resolved",
        statusChangedAt: null,
        statusChangedByUserId: null,
        evidence: {},
        windowStart: "2026-03-01T11:50:00.000Z",
        windowEnd: "2026-03-01T12:00:00.000Z",
        createdAt: "2026-03-01T12:00:00.000Z",
      },
      {
        id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
        agentId: recent.id,
        ruleId: "agent.heartbeat_burst",
        title: "Open one",
        severity: "medium",
        status: "open",
        statusChangedAt: null,
        statusChangedByUserId: null,
        evidence: {},
        windowStart: "2026-03-01T11:50:00.000Z",
        windowEnd: "2026-03-01T12:00:00.000Z",
        createdAt: "2026-03-01T11:00:00.000Z",
      },
    ];
    expect(sortRelatedFindings(findings).map((f) => f.status)).toEqual([
      "open",
      "resolved",
    ]);
  });
});
