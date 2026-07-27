import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";

import { App } from "../App";
import { ComingSoonPage } from "./ComingSoonPage";
import { isNavActive, OPERATOR_NAV } from "./nav";
import { OperatorShell } from "./OperatorShell";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  localStorage.clear();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

const TENANT = "11111111-1111-4111-8111-111111111111";

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data, requestId: "r" }),
  } as Response;
}

function stubOperatorShellFetch(opts?: {
  attentionItems?: Array<{
    kind:
      | "finding.created"
      | "finding.status_changed"
      | "finding.needs_revisit"
      | "finding.reminder_due"
      | "finding.action_needed";
    findingId: string;
    title: string;
    status: string;
    ruleId: string;
    agentId: string;
    at: string;
  }>;
  reminderItems?: Array<{
    kind: "finding.needs_revisit";
    findingId: string;
    title: string;
    status: string;
    ruleId: string;
    agentId: string;
    at: string;
  }>;
  dueItems?: Array<{
    kind: "finding.reminder_due";
    findingId: string;
    title: string;
    status: string;
    ruleId: string;
    agentId: string;
    at: string;
  }>;
  actionNeededItems?: Array<{
    kind: "finding.action_needed";
    findingId: string;
    title: string;
    status: string;
    ruleId: string;
    agentId: string;
    at: string;
  }>;
  agents?: Array<{
    id: string;
    name: string;
    createdAt: string;
    lastHeartbeatAt: string | null;
    openFindingsCount: number;
    heartbeatFreshness: "recent" | "stale" | "unknown";
  }>;
}) {
  const items = opts?.attentionItems ?? [];
  const reminders = opts?.reminderItems ?? [];
  const dueReminders = opts?.dueItems ?? [];
  const actionNeeded = opts?.actionNeededItems ?? [];
  const agents = opts?.agents ?? [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/v1/findings/attention")) {
        return jsonOk({
          generatedAt: "2026-03-01T12:00:00.000Z",
          since: "2026-02-28T12:00:00.000Z",
          maxLookbackHours: 24,
          openCount: items.length,
          activeSuppressionCount: 0,
          truncated: false,
          items,
          reminders: {
            quietHours: 24,
            truncated: false,
            items: reminders,
          },
          dueReminders: {
            truncated: false,
            items: dueReminders,
          },
          actionNeeded: {
            overdueHours: 4,
            escalationQuietHours: 48,
            truncated: false,
            items: actionNeeded,
          },
        });
      }
      if (url.includes("/v1/findings/views")) {
        return jsonOk({ views: [] });
      }
      if (url.includes("/v1/work/views")) {
        return jsonOk({ views: [] });
      }
      if (url.includes("/v1/agents")) {
        return jsonOk({ agents });
      }
      return jsonOk({});
    }),
  );
}

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location-probe">
      {location.pathname}
      {location.search}
    </div>
  );
}
describe("nav helpers", () => {
  it("marks work, findings, and agents as live destinations", () => {
    expect(OPERATOR_NAV.map((n) => n.id)).toEqual(["work", "findings", "agents"]);
    expect(OPERATOR_NAV.every((n) => n.kind === "live")).toBe(true);
    expect(isNavActive("/work", "/work")).toBe(true);
    expect(isNavActive("/findings", "/findings")).toBe(true);
    expect(isNavActive("/agents", "/findings")).toBe(false);
  });
});

describe("OperatorShell", () => {
  it("renders session context, primary nav, and active Findings link", async () => {
    stubOperatorShellFetch();
    render(
      <MemoryRouter initialEntries={["/findings"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "tenant", tenantId: TENANT }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route path="findings" element={<div>Findings content</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toBeInTheDocument();
    });

    expect(screen.getByLabelText("Session context")).toHaveTextContent(TENANT);
    expect(
      screen.getByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();

    const findings = screen.getByRole("link", { name: /Findings/i });
    expect(findings).toHaveAttribute("aria-current", "page");
    expect(findings.className).toContain("is-active");

    const agents = screen.getByRole("link", { name: /Agents/i });
    expect(agents.className).not.toContain("is-soon");
    expect(screen.getByText("Findings content")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Jump to/i }),
    ).toBeInTheDocument();
  });

  it("navigates and applies findings filters through the jump bar URL path", async () => {
    const user = userEvent.setup();
    stubOperatorShellFetch();
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "tenant", tenantId: TENANT }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route
              path="agents"
              element={
                <>
                  <div>Agents page</div>
                  <LocationProbe />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Agents page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Jump to/i }));
    expect(
      screen.getByRole("dialog", {
        name: /Jump to destination, lookup, or filter/i,
      }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("option", { name: /Go to Findings/i }));
    expect(screen.getByText("Findings page")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Jump to/i }));
    await user.type(screen.getByLabelText(/Filter actions/i), "status open");
    await user.click(
      screen.getByRole("option", { name: /Findings · status open/i }),
    );
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/findings?status=open",
    );
  });

  it("looks up an agent by name prefix and a finding by exact id", async () => {
    const user = userEvent.setup();
    const agentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    const findingId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    stubOperatorShellFetch({
      agents: [
        {
          id: agentId,
          name: "edge-west",
          createdAt: "2026-03-01T12:00:00.000Z",
          lastHeartbeatAt: "2026-03-01T11:58:00.000Z",
          openFindingsCount: 1,
          heartbeatFreshness: "recent",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/findings"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "tenant", tenantId: TENANT }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route
              path="agents"
              element={
                <>
                  <div>Agents page</div>
                  <LocationProbe />
                </>
              }
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Jump to/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Filter actions/i)).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/Filter actions/i), "edge-w");
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: /Agent · edge-west/i }),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("option", { name: /Agent · edge-west/i }),
    );
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      `/agents?agentId=${agentId}`,
    );

    await user.click(screen.getByRole("button", { name: /Jump to/i }));
    await user.type(screen.getByLabelText(/Filter actions/i), findingId);
    await waitFor(() => {
      expect(
        screen.getByRole("option", { name: new RegExp(`Finding · ${findingId}`, "i") }),
      ).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("option", {
        name: new RegExp(`Finding · ${findingId}`, "i"),
      }),
    );
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      `/findings?findingId=${findingId}`,
    );
  });

  it("shows no-match state and applies a saved view path", async () => {
    const user = userEvent.setup();
    stubOperatorShellFetch();
    const { saveCurrentFilters } = await import("../findings/savedViews");
    saveCurrentFilters({
      session: { kind: "tenant", tenantId: TENANT },
      name: "Open churn",
      filters: { status: "open", ruleId: "agent.lifecycle_churn" },
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    render(
      <MemoryRouter initialEntries={["/findings"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "tenant", tenantId: TENANT }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route path="agents" element={<div>Agents page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("button", { name: /Jump to/i }));
    await user.type(screen.getByLabelText(/Filter actions/i), "zzzz-none");
    expect(
      screen.getByText(/No matching agents, findings, or actions/i),
    ).toBeInTheDocument();

    await user.clear(screen.getByLabelText(/Filter actions/i));
    await user.type(screen.getByLabelText(/Filter actions/i), "Open churn");
    await user.click(
      screen.getByRole("option", { name: /Local view · Open churn/i }),
    );
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/findings?status=open&ruleId=agent.lifecycle_churn",
    );
    expect(screen.getByTestId("location-probe").textContent).not.toContain(
      "findingId",
    );
  });

  it("opens attention items into Findings URL context and marks caught up", async () => {
    const user = userEvent.setup();
    stubOperatorShellFetch({
      attentionItems: [
        {
          kind: "finding.created",
          findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Agent lifecycle churn",
          status: "open",
          ruleId: "agent.lifecycle_churn",
          agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          at: "2026-03-01T11:30:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "tenant", tenantId: TENANT }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route path="agents" element={<div>Agents page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toHaveTextContent(
        "1",
      );
    });

    await user.click(screen.getByRole("button", { name: /Attention/i }));
    expect(
      screen.getByRole("dialog", { name: /Attention digest/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/New finding/i)).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Agent lifecycle churn/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/findings?status=open&ruleId=agent.lifecycle_churn&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );

    await user.click(screen.getByRole("button", { name: /Attention/i }));
    await user.click(screen.getByRole("button", { name: /Mark caught up/i }));
    await waitFor(() => {
      expect(
        localStorage.getItem(`depp.attention.seen.v1.tenant.${TENANT}`),
      ).toContain("2026-03-01T12:00:00.000Z");
    });
  });

  it("opens ownership reminders into Mine Findings context", async () => {
    const user = userEvent.setup();
    const USER = "22222222-2222-4222-8222-222222222222";
    stubOperatorShellFetch({
      reminderItems: [
        {
          kind: "finding.needs_revisit",
          findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          title: "Quiet owned finding",
          status: "open",
          ruleId: "agent.heartbeat_silence",
          agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          at: "2026-02-28T10:00:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{
                  kind: "tenant",
                  tenantId: TENANT,
                  userId: USER,
                }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route path="agents" element={<div>Agents page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toHaveTextContent(
        "1",
      );
    });

    await user.click(screen.getByRole("button", { name: /Attention/i }));
    expect(
      screen.getByRole("heading", { name: /Needs revisit/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Quiet owned finding/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Quiet owned finding/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/findings?ownerScope=me&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
  });

  it("opens Action needed escalation into Mine Findings context", async () => {
    const user = userEvent.setup();
    const USER = "22222222-2222-4222-8222-222222222222";
    stubOperatorShellFetch({
      actionNeededItems: [
        {
          kind: "finding.action_needed",
          findingId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          title: "Overdue revisit",
          status: "open",
          ruleId: "agent.lifecycle_churn",
          agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          at: "2026-02-27T10:00:00.000Z",
        },
      ],
    });

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{
                  kind: "tenant",
                  tenantId: TENANT,
                  userId: USER,
                }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route
              path="findings"
              element={
                <>
                  <div>Findings page</div>
                  <LocationProbe />
                </>
              }
            />
            <Route path="agents" element={<div>Agents page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toHaveTextContent(
        "1",
      );
    });

    await user.click(screen.getByRole("button", { name: /Attention/i }));
    expect(
      screen.getByRole("heading", { name: /^Action needed$/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Overdue revisit/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: /Overdue revisit/i }));
    expect(screen.getByTestId("location-probe")).toHaveTextContent(
      "/findings?ownerScope=me&findingId=eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
    );
  });

  it("dismisses an Action needed item until refresh filters it out", async () => {
    const user = userEvent.setup();
    const USER = "22222222-2222-4222-8222-222222222222";
    let dismissed = false;
    const actionItem = {
      kind: "finding.action_needed" as const,
      findingId: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Overdue revisit",
      status: "open",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: "2026-02-27T10:00:00.000Z",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/v1/findings/attention/dismiss") && method === "POST") {
          dismissed = true;
          return jsonOk({
            findingId: actionItem.findingId,
            kind: actionItem.kind,
            conditionAt: actionItem.at,
          });
        }
        if (url.includes("/v1/findings/attention")) {
          return jsonOk({
            generatedAt: "2026-03-01T12:00:00.000Z",
            since: "2026-02-28T12:00:00.000Z",
            maxLookbackHours: 24,
            openCount: 1,
            activeSuppressionCount: 0,
            truncated: false,
            items: [],
            reminders: { quietHours: 24, truncated: false, items: [] },
            dueReminders: { truncated: false, items: [] },
            actionNeeded: {
              overdueHours: 4,
              escalationQuietHours: 48,
              truncated: false,
              items: dismissed ? [] : [actionItem],
            },
          });
        }
        if (url.includes("/v1/findings/views")) {
          return jsonOk({ views: [] });
        }
        if (url.includes("/v1/work/views")) {
          return jsonOk({ views: [] });
        }
        if (url.includes("/v1/agents")) {
          return jsonOk({ agents: [] });
        }
        return jsonOk({});
      }),
    );

    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{
                  kind: "tenant",
                  tenantId: TENANT,
                  userId: USER,
                }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route path="agents" element={<div>Agents page</div>} />
            <Route path="findings" element={<div>Findings page</div>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toHaveTextContent(
        "1",
      );
    });
    await user.click(screen.getByRole("button", { name: /Attention/i }));
    expect(
      screen.getByRole("link", { name: /Overdue revisit/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Dismiss$/i }));
    await waitFor(() => {
      expect(
        screen.queryByRole("link", { name: /Overdue revisit/i }),
      ).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(/Dismissed until this finding's attention condition changes/i),
    ).toBeInTheDocument();
  });

  it("keeps shell structure present on a narrow viewport", async () => {
    stubOperatorShellFetch();
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      value: 480,
    });

    const { container } = render(
      <MemoryRouter initialEntries={["/findings"]}>
        <Routes>
          <Route
            element={
              <OperatorShell
                session={{ kind: "bearer", accessToken: "tokentokentokenxx" }}
                onSignOut={() => undefined}
              />
            }
          >
            <Route path="findings" element={<p>ok</p>} />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Attention/i })).toBeInTheDocument();
    });

    expect(container.querySelector(".app-shell")).toBeTruthy();
    expect(container.querySelector(".shell-nav")).toBeTruthy();
    expect(screen.getByLabelText("Session context")).toHaveTextContent(
      "bearer session",
    );
  });
});

describe("ComingSoonPage", () => {
  it("states clearly that the surface is not implemented", () => {
    render(
      <ComingSoonPage title="Agents" description="Reserved for enrollment." />,
    );
    expect(screen.getByRole("status")).toHaveTextContent(/not implemented/i);
    expect(screen.getByRole("heading", { name: "Agents" })).toBeInTheDocument();
  });
});

describe("App routing + auth gate", () => {
  it("shows the session gate when unauthenticated", () => {
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /Findings console/i }),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Primary")).not.toBeInTheDocument();
  });

  it("routes authenticated operators into the shell and navigates to Agents", async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes("/dashboard")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                generatedAt: "2026-03-01T12:00:00.000Z",
                window: { hours: 24 },
                countsByStatus: { open: 0, acknowledged: 0, resolved: 0 },
                countsByRuleId: {
                  "agent.lifecycle_churn": 0,
                  "agent.heartbeat_burst": 0,
                  "agent.heartbeat_silence": 0,
                },
                recentCreatedCount: 0,
                recentChangedCount: 0,
                activeSuppressionCount: 0,
              },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/suppressions")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: { suppressions: [] },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/v1/findings/views")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: { views: [] },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/v1/work/views")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: { views: [] },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/v1/findings/attention")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                generatedAt: "2026-03-01T12:00:00.000Z",
                since: "2026-02-28T12:00:00.000Z",
                maxLookbackHours: 24,
                openCount: 0,
                activeSuppressionCount: 0,
                truncated: false,
                items: [],
                reminders: {
                  quietHours: 24,
                  truncated: false,
                  items: [],
                },
                dueReminders: {
                  truncated: false,
                  items: [],
                },
                actionNeeded: {
                  overdueHours: 4,
                  escalationQuietHours: 48,
                  truncated: false,
                  items: [],
                },
              },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/v1/agents")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: { agents: [] },
              requestId: "r",
            }),
          } as Response;
        }
        if (url.includes("/v1/telemetry/events")) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              ok: true,
              data: {
                events: [],
                summary: {
                  agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                  lastSeenAt: null,
                  lastHeartbeatAt: null,
                  countsByEventType: {},
                  totalInWindow: 0,
                },
                page: { limit: 20, offset: 0, returned: 0 },
              },
              requestId: "r",
            }),
          } as Response;
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            data: {
              findings: [],
              page: { limit: 50, offset: 0, returned: 0 },
            },
            requestId: "r",
          }),
        } as Response;
      }),
    );

    render(<App />);

    await user.type(screen.getByLabelText(/Tenant UUID/i), TENANT);
    await user.click(screen.getByRole("button", { name: /Open console/i }));

    expect(
      await screen.findByRole("navigation", { name: "Primary" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { level: 1, name: "Work" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /^Work$/i })).toHaveAttribute(
      "aria-current",
      "page",
    );

    await user.click(screen.getByRole("link", { name: /Agents/i }));
    expect(
      await screen.findByRole("heading", { level: 1, name: "Agents" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Agents/i })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(
      screen.getByText(/No agents registered/i),
    ).toBeInTheDocument();
  });
});
