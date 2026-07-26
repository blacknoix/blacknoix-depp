import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { AgentsConsoleView } from "./AgentsConsole";
import {
  agentsReducer,
  initialAgentsState,
} from "./useAgentsConsole";
import type { AgentInventoryItem, AgentRecentActivity } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const agent: AgentInventoryItem = {
  id: AGENT_ID,
  name: "edge-1",
  createdAt: "2026-03-01T12:00:00.000Z",
  lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
  openFindingsCount: 1,
  heartbeatFreshness: "recent",
};

const activityPayload = {
  events: [
    {
      id: EVENT_ID,
      agentId: AGENT_ID,
      schemaVersion: 1,
      eventType: "heartbeat",
      occurredAt: "2026-03-01T11:58:00.000Z",
      ingestedAt: "2026-03-01T11:58:01.000Z",
      payload: { status: "ok" },
    },
  ],
  summary: {
    agentId: AGENT_ID,
    lastSeenAt: "2026-03-01T11:58:01.000Z",
    lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
    countsByEventType: { heartbeat: 1 },
    totalInWindow: 1,
  },
  page: { limit: 20, offset: 0, returned: 1 },
};

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data, requestId: "r" }),
  } as unknown as Response;
}

function jsonErr(status: number, code: string, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({
      ok: false,
      error: { code, message },
      requestId: "r",
    }),
  } as unknown as Response;
}

describe("agentsReducer", () => {
  it("loads inventory and clears selection when the agent disappears", () => {
    let state = agentsReducer(initialAgentsState, { type: "load_start" });
    state = agentsReducer(state, {
      type: "load_success",
      agents: [agent],
    });
    state = agentsReducer(state, { type: "select", id: AGENT_ID });
    state = agentsReducer(state, {
      type: "load_success",
      agents: [],
    });
    expect(state.selectedId).toBeNull();
    expect(state.agents).toHaveLength(0);
    expect(state.recentActivity).toBeNull();
  });

  it("keeps findings when activity fails (sectional)", () => {
    let state = agentsReducer(initialAgentsState, {
      type: "select",
      id: AGENT_ID,
    });
    state = agentsReducer(state, {
      type: "findings_success",
      findings: [
        {
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          agentId: AGENT_ID,
          ruleId: "agent.lifecycle_churn",
          title: "Agent lifecycle churn",
          severity: "medium",
          status: "open",
          statusChangedAt: null,
          statusChangedByUserId: null,
          evidence: {},
          windowStart: "2026-03-01T11:50:00.000Z",
          windowEnd: "2026-03-01T12:00:00.000Z",
          createdAt: "2026-03-01T12:00:00.000Z",
        },
      ],
    });
    state = agentsReducer(state, {
      type: "activity_error",
      message: "TELEMETRY_UNAVAILABLE: down",
    });
    expect(state.findingsPhase).toBe("ready");
    expect(state.relatedFindings).toHaveLength(1);
    expect(state.activityPhase).toBe("error");
    expect(state.recentActivity).toBeNull();
  });

  it("stores recent activity independently of findings", () => {
    const activity: AgentRecentActivity = {
      windowHours: 24,
      since: "2026-02-28T12:00:00.000Z",
      events: [
        {
          id: EVENT_ID,
          eventType: "heartbeat",
          occurredAt: "2026-03-01T11:58:00.000Z",
        },
      ],
      summary: {
        agentId: AGENT_ID,
        lastSeenAt: "2026-03-01T11:58:01.000Z",
        lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
        countsByEventType: { heartbeat: 1 },
        totalInWindow: 1,
      },
    };
    let state = agentsReducer(initialAgentsState, {
      type: "select",
      id: AGENT_ID,
    });
    state = agentsReducer(state, {
      type: "activity_success",
      activity,
    });
    state = agentsReducer(state, {
      type: "findings_error",
      message: "FINDINGS_UNAVAILABLE: down",
    });
    expect(state.activityPhase).toBe("ready");
    expect(state.recentActivity?.events).toHaveLength(1);
    expect(state.findingsPhase).toBe("error");
  });
});

describe("AgentsConsoleView", () => {
  it("renders inventory, recent activity, and related findings", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent] });
        }
        if (url.includes("/v1/telemetry/events")) {
          expect(url).toMatch(/since=/);
          expect(url).toMatch(/limit=20/);
          return jsonOk(activityPayload);
        }
        if (url.includes("/v1/findings?")) {
          return jsonOk({
            findings: [
              {
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                agentId: AGENT_ID,
                ruleId: "agent.lifecycle_churn",
                title: "Agent lifecycle churn",
                severity: "medium",
                status: "open",
                statusChangedAt: null,
                statusChangedByUserId: null,
                evidence: {},
                windowStart: "2026-03-01T11:50:00.000Z",
                windowEnd: "2026-03-01T12:00:00.000Z",
                createdAt: "2026-03-01T12:00:00.000Z",
              },
            ],
            page: { limit: 10, offset: 0, returned: 1 },
          });
        }
        return jsonErr(404, "NOT_FOUND", url);
      }),
    );

    render(
      <MemoryRouter>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("edge-1")).toBeInTheDocument();
    });
    expect(screen.getAllByText(/Recent heartbeat/i).length).toBeGreaterThan(0);
    expect(
      screen.getByText(/Select an agent to inspect/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edge-1/i }));
    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("heading", { name: /Recent activity \(last 24 hours\)/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/1 event in window/i)).toBeInTheDocument();
    expect(screen.getByText("heartbeat")).toBeInTheDocument();
    expect(screen.queryByText(/"status"/)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open findings \(1\)/i }),
    ).toHaveAttribute(
      "href",
      "/findings?status=open&agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(
      screen.getByRole("link", { name: /All findings for agent/i }),
    ).toHaveAttribute(
      "href",
      "/findings?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    expect(
      screen.getByRole("button", { name: /Clear focus/i }),
    ).toBeInTheDocument();
  });

  it("shows empty activity when the 24h window has no events", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent] });
        }
        if (url.includes("/v1/telemetry/events")) {
          return jsonOk({
            events: [],
            summary: {
              agentId: AGENT_ID,
              lastSeenAt: null,
              lastHeartbeatAt: null,
              countsByEventType: {},
              totalInWindow: 0,
            },
            page: { limit: 20, offset: 0, returned: 0 },
          });
        }
        if (url.includes("/v1/findings?")) {
          return jsonOk({
            findings: [],
            page: { limit: 10, offset: 0, returned: 0 },
          });
        }
        return jsonErr(404, "NOT_FOUND", url);
      }),
    );

    render(
      <MemoryRouter>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("edge-1")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /edge-1/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/No telemetry in the last 24 hours/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/No findings for this agent/i)).toBeInTheDocument();
  });

  it("keeps findings visible when telemetry fails sectionally", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent] });
        }
        if (url.includes("/v1/telemetry/events")) {
          return jsonErr(503, "TELEMETRY_UNAVAILABLE", "down");
        }
        if (url.includes("/v1/findings?")) {
          return jsonOk({
            findings: [
              {
                id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
                agentId: AGENT_ID,
                ruleId: "agent.lifecycle_churn",
                title: "Still visible finding",
                severity: "medium",
                status: "open",
                statusChangedAt: null,
                statusChangedByUserId: null,
                evidence: {},
                windowStart: "2026-03-01T11:50:00.000Z",
                windowEnd: "2026-03-01T12:00:00.000Z",
                createdAt: "2026-03-01T12:00:00.000Z",
              },
            ],
            page: { limit: 10, offset: 0, returned: 1 },
          });
        }
        return jsonErr(404, "NOT_FOUND", url);
      }),
    );

    render(
      <MemoryRouter>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("edge-1")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /edge-1/i }));
    await waitFor(() => {
      expect(screen.getByText("Still visible finding")).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/TELEMETRY_UNAVAILABLE/);
  });

  it("shows empty and error states for inventory", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonOk({ agents: [] })),
    );

    const { rerender } = render(
      <MemoryRouter>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/No agents registered/i),
      ).toBeInTheDocument();
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonErr(503, "AGENTS_UNAVAILABLE", "down")),
    );

    rerender(
      <MemoryRouter>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: "22222222-2222-4222-8222-222222222222" }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/AGENTS_UNAVAILABLE/);
    });
  });

  it("filters inventory via URL and drops focus when selection no longer matches", async () => {
    const user = userEvent.setup();
    const staleAgent: AgentInventoryItem = {
      id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      name: "edge-stale",
      createdAt: "2026-03-01T12:00:00.000Z",
      lastHeartbeatAt: "2026-02-28T12:00:00.000Z",
      openFindingsCount: 0,
      heartbeatFreshness: "stale",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent, staleAgent] });
        }
        if (url.includes("/v1/telemetry/events")) {
          return jsonOk({
            ...activityPayload,
            events: [],
            summary: {
              ...activityPayload.summary,
              totalInWindow: 0,
              countsByEventType: {},
            },
            page: { limit: 20, offset: 0, returned: 0 },
          });
        }
        if (url.includes("/v1/findings?")) {
          return jsonOk({
            findings: [],
            page: { limit: 10, offset: 0, returned: 0 },
          });
        }
        return jsonErr(404, "NOT_FOUND", url);
      }),
    );

    render(
      <MemoryRouter initialEntries={[`/agents?agentId=${AGENT_ID}`]}>
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Focused agent/i)).toBeInTheDocument();
    });

    await user.selectOptions(screen.getByLabelText("Freshness"), "stale");
    await waitFor(() => {
      expect(screen.queryByText(/Focused agent/i)).not.toBeInTheDocument();
    });
    expect(
      screen.queryByRole("button", { name: /edge-1/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /edge-stale/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Select an agent to inspect/i),
    ).toBeInTheDocument();
  });

  it("keeps a conflicting deep-link selection visible with a filter warning", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent] });
        }
        if (url.includes("/v1/telemetry/events")) {
          return jsonOk({
            ...activityPayload,
            events: [],
            summary: {
              ...activityPayload.summary,
              totalInWindow: 0,
              countsByEventType: {},
            },
            page: { limit: 20, offset: 0, returned: 0 },
          });
        }
        if (url.includes("/v1/findings?")) {
          return jsonOk({
            findings: [],
            page: { limit: 10, offset: 0, returned: 0 },
          });
        }
        return jsonErr(404, "NOT_FOUND", url);
      }),
    );

    render(
      <MemoryRouter
        initialEntries={[`/agents?freshness=stale&agentId=${AGENT_ID}`]}
      >
        <AgentsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/hidden by the current filters/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "edge-1" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Clear focus/i }),
    ).toBeInTheDocument();
  });
});
