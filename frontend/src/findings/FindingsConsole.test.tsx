import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { SessionGate } from "../auth/SessionGate";
import { FindingsConsoleView } from "./FindingsConsole";
import type { Finding, FindingsDashboard, FindingsFilters, Suppression } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const TENANT = "11111111-1111-4111-8111-111111111111";

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
  evidence: {
    threshold: 6,
    totalInWindow: 8,
    countsByEventType: { "agent.started": 4, "agent.stopped": 4 },
    sampleEventIds: ["ffffffff-ffff-4fff-8fff-ffffffffffff"],
  },
  windowStart: "2026-03-01T11:50:00.000Z",
  windowEnd: "2026-03-01T12:00:00.000Z",
  createdAt: "2026-03-01T12:00:00.000Z",
};

function jsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => ({ ok: true, data, requestId: "req-1" }),
  } as unknown as Response;
}

function mockConsoleApis(opts?: {
  findings?: Finding[];
  suppressions?: Suppression[];
  dashboard?: FindingsDashboard;
}) {
  const findings = opts?.findings ?? [finding];
  const suppressions = opts?.suppressions ?? [];
  const dash = opts?.dashboard ?? dashboard;

  const fetchMock = vi.fn(
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/v1/findings/views") && method === "GET") {
        return jsonResponse({ views: [] });
      }
      if (url.includes("/v1/findings/dashboard")) {
        return jsonResponse(dash);
      }
      if (url.includes("/v1/findings/suppressions") && method === "GET") {
        return jsonResponse({
          suppressions: suppressions.filter((s) => !s.clearedAt),
        });
      }
      if (url.includes("/v1/findings/suppressions") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          ruleId: string;
          until: string;
        };
        const created: Suppression = {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          ruleId: body.ruleId,
          startsAt: "2026-03-01T12:00:00.000Z",
          endsAt: body.until,
          createdAt: "2026-03-01T12:00:00.000Z",
          createdByUserId: null,
          clearedAt: null,
          clearedByUserId: null,
        };
        suppressions.push(created);
        return jsonResponse({ suppression: created }, 201);
      }
      if (url.includes("/v1/findings/suppressions/") && method === "DELETE") {
        const id = url.split("/").pop()!;
        const idx = suppressions.findIndex((s) => s.id === id);
        if (idx >= 0) {
          suppressions[idx] = {
            ...suppressions[idx],
            clearedAt: "2026-03-01T13:00:00.000Z",
          };
          return jsonResponse({ suppression: suppressions[idx] });
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({
            ok: false,
            error: { code: "FINDINGS_NOT_FOUND", message: "missing" },
            requestId: "req-x",
          }),
        } as unknown as Response;
      }
      if (url.includes("/v1/findings/") && method === "PATCH") {
        const body = JSON.parse(String(init?.body ?? "{}")) as {
          status: Finding["status"];
        };
        const id = url.split("/").pop()!;
        const idx = findings.findIndex((f) => f.id === id);
        if (idx < 0) {
          return {
            ok: false,
            status: 404,
            json: async () => ({
              ok: false,
              error: { code: "FINDINGS_NOT_FOUND", message: "missing" },
              requestId: "req-x",
            }),
          } as unknown as Response;
        }
        findings[idx] = { ...findings[idx], status: body.status };
        return jsonResponse({ finding: findings[idx] });
      }
      if (url.includes("/v1/findings?")) {
        const parsed = new URL(url, "http://local.test");
        let list = [...findings];
        const status = parsed.searchParams.get("status");
        const ruleId = parsed.searchParams.get("ruleId");
        if (status) {
          list = list.filter((f) => f.status === status);
        }
        if (ruleId) {
          list = list.filter((f) => f.ruleId === ruleId);
        }
        return jsonResponse({
          findings: list,
          page: { limit: 50, offset: 0, returned: list.length },
        });
      }
      if (url.includes("/v1/telemetry/events")) {
        const agentId =
          new URL(url, "http://local.test").searchParams.get("agentId") ??
          "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        return jsonResponse({
          events: [
            {
              id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
              agentId,
              schemaVersion: 1,
              eventType: "heartbeat",
              occurredAt: new Date().toISOString(),
              ingestedAt: new Date().toISOString(),
              payload: { status: "ok" },
            },
          ],
          summary: {
            agentId,
            lastSeenAt: new Date().toISOString(),
            lastHeartbeatAt: new Date().toISOString(),
            countsByEventType: { heartbeat: 1 },
            totalInWindow: 1,
          },
          page: { limit: 20, offset: 0, returned: 1 },
        });
      }

      return {
        ok: false,
        status: 404,
        json: async () => ({
          ok: false,
          error: { code: "NOT_FOUND", message: url },
          requestId: "req-x",
        }),
      } as unknown as Response;
    },
  );

  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("SessionGate", () => {
  it("fails closed on invalid tenant and connects on valid UUID", async () => {
    const user = userEvent.setup();
    const onConnect = vi.fn();
    render(<SessionGate onConnect={onConnect} />);

    await user.type(screen.getByLabelText(/Tenant UUID/i), "not-a-uuid");
    await user.click(screen.getByRole("button", { name: /Open console/i }));
    expect(onConnect).not.toHaveBeenCalled();
    expect(screen.getByRole("alert")).toHaveTextContent(/UUID/);

    await user.clear(screen.getByLabelText(/Tenant UUID/i));
    await user.type(screen.getByLabelText(/Tenant UUID/i), TENANT);
    await user.click(screen.getByRole("button", { name: /Open console/i }));
    expect(onConnect).toHaveBeenCalledWith({
      kind: "tenant",
      tenantId: TENANT,
    });
  });
});

describe("FindingsConsole", () => {
  it("renders summary, list, empty detail, then selection and status mutation", async () => {
    const user = userEvent.setup();
    mockConsoleApis();

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });

    const summary = screen.getByLabelText("Findings summary");
    expect(within(summary).getByText("Open").previousElementSibling).toHaveTextContent(
      "1",
    );

    expect(
      screen.getByText(/Select a finding to inspect/i),
    ).toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: /Agent lifecycle churn/i }),
    );
    expect(
      screen.getByRole("heading", { name: /What this means/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/10-minute window meet or exceed a count threshold of 6/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/8 \/ 6/i)).toBeInTheDocument();
    expect(screen.getByText(/None active/i)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Open agent/i }),
    ).toHaveAttribute(
      "href",
      "/agents?agentId=aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    );
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: /Recent context \(last 24 hours\)/i }),
      ).toBeInTheDocument();
    });
    expect(screen.getByText("heartbeat")).toBeInTheDocument();
    expect(
      screen.queryByText(/ffffffff-ffff-4fff-8fff-ffffffffffff/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Mark acknowledged/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Finding 1 of 1/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Previous$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Next$/i })).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /Mark acknowledged/i }));
    await waitFor(() => {
      expect(screen.getAllByText("acknowledged").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it("advances selection when a status change removes the finding from the filter", async () => {
    const user = userEvent.setup();
    const first: Finding = {
      ...finding,
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "First open finding",
    };
    const second: Finding = {
      ...finding,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      title: "Second open finding",
      evidence: {},
    };
    mockConsoleApis({ findings: [first, second] });

    render(
      <MemoryRouter initialEntries={["/findings?status=open"]}>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("First open finding")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /First open finding/i }),
    );
    expect(screen.getByText(/Finding 1 of 2/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mark acknowledged/i }));
    await waitFor(() => {
      expect(
        screen.getByRole("heading", { name: "Second open finding" }),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/advanced to the next finding/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/Finding 1 of 1/i)).toBeInTheDocument();
  });

  it("supports previous/next navigation across the filtered list", async () => {
    const user = userEvent.setup();
    mockConsoleApis({
      findings: [
        { ...finding, id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", title: "Alpha" },
        {
          ...finding,
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          title: "Beta",
          evidence: {},
        },
      ],
    });

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Alpha")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: /Alpha/i }));
    expect(screen.getByText(/Finding 1 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Next$/i }));
    expect(
      screen.getByRole("heading", { name: "Beta" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Finding 2 of 2/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^Previous$/i }));
    expect(
      screen.getByRole("heading", { name: "Alpha" }),
    ).toBeInTheDocument();
  });

  it("shows active rule snooze context on the selected finding", async () => {
    const user = userEvent.setup();
    mockConsoleApis({
      suppressions: [
        {
          id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
          ruleId: "agent.lifecycle_churn",
          startsAt: "2020-01-01T00:00:00.000Z",
          endsAt: "2099-01-01T00:00:00.000Z",
          createdAt: "2020-01-01T00:00:00.000Z",
          createdByUserId: null,
          clearedAt: null,
          clearedByUserId: null,
        },
      ],
    });

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /Agent lifecycle churn/i }),
    );
    expect(screen.getByText(/Active until/i)).toBeInTheDocument();
    expect(
      screen.getByText(/skips new findings for this rule/i),
    ).toBeInTheDocument();
  });

  it("filters the list and supports snooze create/clear", async () => {
    const user = userEvent.setup();
    const suppressions: Suppression[] = [];
    mockConsoleApis({ suppressions });

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });

    expect(
      screen.getByRole("search", { name: /Findings filters/i }),
    ).toBeInTheDocument();

    const statusFilter = screen.getByLabelText("Status");
    await user.selectOptions(statusFilter, "resolved");
    await waitFor(() => {
      expect(screen.getByText(/No findings match/i)).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /Clear filters/i })).toBeInTheDocument();

    await user.selectOptions(statusFilter, "");
    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("button", { name: /agent\.lifecycle_churn · 24h/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/until/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Clear$/i }));
    await waitFor(() => {
      expect(screen.getByText(/No uncleared snoozes/i)).toBeInTheDocument();
    });
  });

  it("applies shareable status/rule URL filters and fails closed on invalid ones", async () => {
    mockConsoleApis();

    const { unmount } = render(
      <MemoryRouter
        initialEntries={[
          "/findings?status=open&ruleId=agent.lifecycle_churn",
        ]}
      >
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Status")).toHaveValue("open");
    expect(screen.getByLabelText("Rule")).toHaveValue("agent.lifecycle_churn");
    unmount();

    render(
      <MemoryRouter initialEntries={["/findings?status=bogus&ruleId=nope"]}>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByText(/Invalid status in the URL/i),
      ).toBeInTheDocument();
    });
    expect(
      screen.getByText(/Invalid rule id in the URL/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Status")).toHaveValue("");
    expect(screen.getByLabelText("Rule")).toHaveValue("");
  });

  it("saves and applies a local filter view without persisting findingId", async () => {
    const user = userEvent.setup();
    mockConsoleApis();

    render(
      <MemoryRouter
        initialEntries={[
          "/findings?status=open&ruleId=agent.lifecycle_churn&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        ]}
      >
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /Mark acknowledged/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByLabelText(/This browser only/i));
    await user.type(screen.getByLabelText(/Saved view name/i), "Open churn");
    await user.click(
      screen.getByRole("button", { name: /Save current filters/i }),
    );
    await waitFor(() => {
      expect(screen.getByText(/Saved locally “Open churn”/i)).toBeInTheDocument();
    });

    const stored = localStorage.getItem(
      `depp.findings.savedViews.v1.tenant.${TENANT}`,
    );
    expect(stored).toBeTruthy();
    expect(stored).not.toMatch(/findingId/);

    await user.click(screen.getByRole("button", { name: /Clear filters/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Status")).toHaveValue("");
    });

    await user.click(screen.getByRole("button", { name: /^Open churn$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Status")).toHaveValue("open");
    });
    expect(screen.getByLabelText("Rule")).toHaveValue("agent.lifecycle_churn");
    expect(screen.getByText(/Applied local “Open churn”/i)).toBeInTheDocument();
  });

  it("creates and applies a shared tenant view through the URL", async () => {
    const user = userEvent.setup();
    const shared: Array<{
      id: string;
      name: string;
      filters: FindingsFilters;
      createdAt: string;
      createdByUserId: string | null;
    }> = [];

    const base = mockConsoleApis();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/v1/findings/views") && method === "GET") {
          return jsonResponse({ views: [...shared] });
        }
        if (url.includes("/v1/findings/views") && method === "POST") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            name: string;
            filters: FindingsFilters;
          };
          const created = {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: body.name,
            filters: body.filters,
            createdAt: "2026-03-01T12:00:00.000Z",
            createdByUserId: null,
          };
          shared.push(created);
          return jsonResponse({ view: created }, 201);
        }
        return base(input, init);
      }),
    );

    render(
      <MemoryRouter initialEntries={["/findings?status=open"]}>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });

    await user.type(screen.getByLabelText(/Saved view name/i), "Tenant open");
    await user.click(
      screen.getByRole("button", { name: /Save current filters/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByText(/Shared “Tenant open” with this tenant/i),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /Clear filters/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Status")).toHaveValue("");
    });

    await user.click(screen.getByRole("button", { name: /^Tenant open$/i }));
    await waitFor(() => {
      expect(screen.getByLabelText("Status")).toHaveValue("open");
    });
    expect(
      screen.getByText(/Applied shared “Tenant open”/i),
    ).toBeInTheDocument();
  });

  it("keeps obsolete shared views visible but refuses unsafe apply", async () => {
    const user = userEvent.setup();
    const base = mockConsoleApis();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/v1/findings/views") && method === "GET") {
          return jsonResponse({
            views: [
              {
                id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
                name: "Legacy rule",
                filters: { ruleId: "gone.rule" },
                createdAt: "2026-03-01T12:00:00.000Z",
                createdByUserId: null,
              },
            ],
          });
        }
        return base(input, init);
      }),
    );

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: /^Legacy rule$/i }),
      ).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Legacy rule$/i }));
    await waitFor(() => {
      expect(
        screen.getByText(/obsolete or invalid filters/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByLabelText("Rule")).toHaveValue("");
  });

  it("shows a load error banner when the API fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        status: 503,
        json: async () => ({
          ok: false,
          error: { code: "FINDINGS_UNAVAILABLE", message: "down" },
          requestId: "r",
        }),
      })),
    );

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      const banners = screen.getAllByRole("alert");
      expect(
        banners.some((el) => /FINDINGS_UNAVAILABLE/.test(el.textContent ?? "")),
      ).toBe(true);
    });
  });

  it("keeps finding markers when agent telemetry fails sectionally", async () => {
    const user = userEvent.setup();
    const createdAt = new Date().toISOString();
    const recent: Finding = {
      ...finding,
      createdAt,
      windowStart: createdAt,
      windowEnd: createdAt,
    };
    const findings = [recent];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/v1/telemetry/events")) {
          return {
            ok: false,
            status: 503,
            json: async () => ({
              ok: false,
              error: { code: "TELEMETRY_UNAVAILABLE", message: "down" },
              requestId: "r",
            }),
          } as unknown as Response;
        }
        if (url.includes("/v1/findings/views") && method === "GET") {
          return jsonResponse({ views: [] });
        }
        if (url.includes("/v1/findings/dashboard")) {
          return jsonResponse(dashboard);
        }
        if (url.includes("/v1/findings/suppressions") && method === "GET") {
          return jsonResponse({ suppressions: [] });
        }
        if (url.includes("/v1/findings?")) {
          return jsonResponse({
            findings,
            page: { limit: 50, offset: 0, returned: findings.length },
          });
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({
            ok: false,
            error: { code: "NOT_FOUND", message: url },
            requestId: "r",
          }),
        } as unknown as Response;
      }),
    );

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /Agent lifecycle churn/i }),
    );
    await waitFor(() => {
      expect(
        screen.getByRole("link", {
          name: /Finding created: Agent lifecycle churn/i,
        }),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("alert")).toHaveTextContent(/TELEMETRY_UNAVAILABLE/);
  });

  it("claims ownership and saves a current operator note", async () => {
    const user = userEvent.setup();
    const USER = "22222222-2222-4222-8222-222222222222";
    let owner: string | null = null;
    let note: string | null = null;
    const findings = [{ ...finding }];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/v1/telemetry/events")) {
          return jsonResponse({
            events: [],
            summary: {
              agentId: finding.agentId,
              lastSeenAt: null,
              lastHeartbeatAt: null,
              countsByEventType: {},
              totalInWindow: 0,
            },
            page: { limit: 20, offset: 0, returned: 0 },
          });
        }
        if (url.includes("/v1/findings/views") && method === "GET") {
          return jsonResponse({ views: [] });
        }
        if (url.includes("/v1/findings/dashboard")) {
          return jsonResponse(dashboard);
        }
        if (url.includes("/v1/findings/suppressions") && method === "GET") {
          return jsonResponse({ suppressions: [] });
        }
        if (url.includes("/v1/findings/") && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as {
            claimOwner?: boolean;
            ownerUserId?: string | null;
            operatorNote?: string | null;
          };
          if (body.claimOwner) {
            owner = USER;
          }
          if ("ownerUserId" in body) {
            owner = body.ownerUserId ?? null;
          }
          if ("operatorNote" in body) {
            note = body.operatorNote ?? null;
          }
          findings[0] = {
            ...findings[0],
            ownerUserId: owner,
            ownerChangedAt: owner ? new Date().toISOString() : null,
            ownerChangedByUserId: owner ? USER : null,
            operatorNote: note,
            operatorNoteUpdatedAt: note ? new Date().toISOString() : null,
            operatorNoteUpdatedByUserId: note ? USER : null,
          };
          return jsonResponse({ finding: findings[0] });
        }
        if (url.includes("/v1/findings?")) {
          return jsonResponse({
            findings,
            page: { limit: 50, offset: 0, returned: findings.length },
          });
        }
        return {
          ok: false,
          status: 404,
          json: async () => ({
            ok: false,
            error: { code: "NOT_FOUND", message: url },
            requestId: "r",
          }),
        } as unknown as Response;
      }),
    );

    render(
      <MemoryRouter>
        <FindingsConsoleView
          session={{ kind: "tenant", tenantId: TENANT, userId: USER }}
        />
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });
    await user.click(
      screen.getByRole("button", { name: /Agent lifecycle churn/i }),
    );
    expect(
      screen.getByRole("heading", { name: /Investigation intent/i }),
    ).toBeInTheDocument();
    expect(screen.getByText("Unassigned")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^Claim$/i }));
    await waitFor(() => {
      expect(screen.getByText(USER)).toBeInTheDocument();
    });

    await user.clear(screen.getByLabelText(/Current note/i));
    await user.type(
      screen.getByLabelText(/Current note/i),
      "Likely maintenance window",
    );
    await user.click(screen.getByRole("button", { name: /Save note/i }));
    await waitFor(() => {
      expect(screen.getByLabelText(/Current note/i)).toHaveValue(
        "Likely maintenance window",
      );
    });
  });
});
