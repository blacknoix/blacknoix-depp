import { describe, expect, it } from "vitest";

import { buildFindingsListPath } from "../api/findings";
import { authHeaders } from "../api/client";
import { parseBearerToken, parseTenantId } from "../auth/session";
import {
  consoleReducer,
  initialConsoleState,
} from "../findings/useFindingsConsole";
import { allowedTransitions } from "../findings/types";
import type { Finding, FindingsDashboard, Suppression } from "../findings/types";

describe("session parsing", () => {
  it("accepts UUIDs and rejects non-UUIDs / agent-shaped tokens", () => {
    expect(parseTenantId("11111111-1111-4111-8111-111111111111")).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(parseTenantId("tenant-dev")).toBeUndefined();
    expect(parseBearerToken("a".repeat(20))).toBeTruthy();
    expect(parseBearerToken("agent:secret")).toBeUndefined();
  });
});

describe("authHeaders", () => {
  it("never includes x-agent-id", () => {
    expect(
      authHeaders({
        kind: "tenant",
        tenantId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({ "x-tenant-id": "11111111-1111-4111-8111-111111111111" });
    expect(
      authHeaders({ kind: "bearer", accessToken: "tokentokentoken" }),
    ).toEqual({ Authorization: "Bearer tokentokentoken" });
  });
});

describe("buildFindingsListPath", () => {
  it("encodes status, rule, and agent filters", () => {
    expect(
      buildFindingsListPath({
        agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        status: "open",
        ruleId: "agent.lifecycle_churn",
      }),
    ).toBe(
      "/v1/findings?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa&status=open&ruleId=agent.lifecycle_churn&limit=50&offset=0",
    );
  });
});

describe("allowedTransitions", () => {
  it("matches backend lifecycle edges", () => {
    expect(allowedTransitions("open")).toEqual(["acknowledged", "resolved"]);
    expect(allowedTransitions("resolved")).toEqual(["open"]);
  });
});

const dashboard: FindingsDashboard = {
  generatedAt: "2026-03-01T12:00:00.000Z",
  window: { hours: 24 },
  countsByStatus: { open: 1, acknowledged: 0, resolved: 0 },
  countsByRuleId: {
    "agent.lifecycle_churn": 1,
    "agent.heartbeat_burst": 0,
    "agent.heartbeat_silence": 0,
  },
  recentCreatedCount: 1,
  recentChangedCount: 0,
  activeSuppressionCount: 0,
};

const finding: Finding = {
  id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  ruleId: "agent.lifecycle_churn",
  title: "Agent lifecycle churn",
  severity: "medium",
  status: "open",
  statusChangedAt: null,
  statusChangedByUserId: null,
  ownerUserId: null,
  ownerChangedAt: null,
  ownerChangedByUserId: null,
  operatorNote: null,
  operatorNoteUpdatedAt: null,
  operatorNoteUpdatedByUserId: null,
  evidence: {},
  windowStart: "2026-03-01T11:50:00.000Z",
  windowEnd: "2026-03-01T12:00:00.000Z",
  createdAt: "2026-03-01T12:00:00.000Z",
};

describe("consoleReducer", () => {
  it("loads data and clears selection when filters change", () => {
    let state = consoleReducer(initialConsoleState, { type: "load_start" });
    expect(state.load).toBe("loading");

    state = consoleReducer(state, {
      type: "load_success",
      dashboard,
      findings: [finding],
      suppressions: [],
    });
    expect(state.load).toBe("ready");
    expect(state.data.findings).toHaveLength(1);

    state = consoleReducer(state, {
      type: "select",
      id: finding.id,
    });
    state = consoleReducer(state, {
      type: "set_filters",
      filters: { status: "open" },
    });
    expect(state.selectedId).toBeNull();
    expect(state.filters.status).toBe("open");
  });

  it("records mutation errors without dropping loaded data", () => {
    let state = consoleReducer(initialConsoleState, {
      type: "load_success",
      dashboard,
      findings: [finding],
      suppressions: [] as Suppression[],
    });
    state = consoleReducer(state, { type: "mutation_start" });
    state = consoleReducer(state, {
      type: "mutation_error",
      message: "FINDINGS_INVALID: bad",
    });
    expect(state.mutation).toBe("error");
    expect(state.data.findings).toHaveLength(1);
  });
});
