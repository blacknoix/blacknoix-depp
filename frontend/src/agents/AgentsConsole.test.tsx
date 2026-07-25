import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { AgentsConsoleView } from "./AgentsConsole";
import {
  agentsReducer,
  initialAgentsState,
} from "./useAgentsConsole";
import type { AgentInventoryItem } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const agent: AgentInventoryItem = {
  id: AGENT_ID,
  name: "edge-1",
  createdAt: "2026-03-01T12:00:00.000Z",
  lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
  openFindingsCount: 1,
  heartbeatFreshness: "recent",
};

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data, requestId: "r" }),
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
  });
});

describe("AgentsConsoleView", () => {
  it("renders inventory, selection detail, and related findings", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [agent] });
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
        return {
          ok: false,
          status: 404,
          json: async () => ({
            ok: false,
            error: { code: "NOT_FOUND", message: url },
            requestId: "x",
          }),
        } as unknown as Response;
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
    expect(screen.getByText(/Recent heartbeat/i)).toBeInTheDocument();
    expect(
      screen.getByText(/Select an agent to inspect/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /edge-1/i }));
    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    expect(
      screen.getByRole("link", { name: /Open in Findings/i }),
    ).toHaveAttribute(
      "href",
      "/findings?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
  });

  it("shows empty and error states", async () => {
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
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error: { code: "AGENTS_UNAVAILABLE", message: "down" },
          requestId: "r",
        }),
      })),
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
});
