import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { AgentsConsoleView } from "../agents/AgentsConsole";
import { FindingsConsoleView } from "../findings/FindingsConsole";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const AGENT_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const FINDING_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data, requestId: "r" }),
  } as unknown as Response;
}

function stubApis() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/agents")) {
        return jsonOk({
          agents: [
            {
              id: AGENT_ID,
              name: "edge-1",
              createdAt: "2026-03-01T12:00:00.000Z",
              lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
              openFindingsCount: 1,
              heartbeatFreshness: "recent",
            },
          ],
        });
      }
      if (url.includes("/v1/findings/dashboard")) {
        return jsonOk({
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
        });
      }
      if (url.includes("/v1/findings/suppressions")) {
        return jsonOk({ suppressions: [] });
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
      if (url.includes("/v1/findings/views")) {
        return jsonOk({ views: [] });
      }
      if (url.includes("/v1/findings?")) {
        return jsonOk({
          findings: [
            {
              id: FINDING_ID,
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
          page: { limit: 50, offset: 0, returned: 1 },
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
}

describe("cross-linking Findings ↔ Agents", () => {
  it("focuses an agent from ?agentId= and links through to findings", async () => {
    const user = userEvent.setup();
    stubApis();

    render(
      <MemoryRouter initialEntries={[`/agents?agentId=${AGENT_ID}`]}>
        <Routes>
          <Route
            path="/agents"
            element={
              <AgentsConsoleView
                session={{ kind: "tenant", tenantId: TENANT }}
              />
            }
          />
          <Route
            path="/findings"
            element={
              <FindingsConsoleView
                session={{ kind: "tenant", tenantId: TENANT }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText(/Focused agent/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("heading", { name: "edge-1" })).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Open findings \(1\)/i }));
    await waitFor(() => {
      expect(screen.getByText(/Filtered to agent/i)).toBeInTheDocument();
    });
    expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("open");
  });

  it("opens agent context from a finding and fails closed on invalid ids", async () => {
    stubApis();

    render(
      <MemoryRouter
        initialEntries={[`/findings?agentId=${AGENT_ID}&findingId=${FINDING_ID}`]}
      >
        <Routes>
          <Route
            path="/findings"
            element={
              <FindingsConsoleView
                session={{ kind: "tenant", tenantId: TENANT }}
              />
            }
          />
          <Route
            path="/agents"
            element={
              <AgentsConsoleView
                session={{ kind: "tenant", tenantId: TENANT }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Mark acknowledged/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("link", { name: /Open agent/i })).toHaveAttribute(
      "href",
      `/agents?agentId=${AGENT_ID}`,
    );
  });

  it("surfaces invalid agentId query params on Agents", async () => {
    stubApis();

    render(
      <MemoryRouter initialEntries={["/agents?agentId=not-a-uuid"]}>
        <Routes>
          <Route
            path="/agents"
            element={
              <AgentsConsoleView
                session={{ kind: "tenant", tenantId: TENANT }}
              />
            }
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/Invalid agent id/i);
    });
  });
});
