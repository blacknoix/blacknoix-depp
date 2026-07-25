import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SessionGate } from "../auth/SessionGate";
import { FindingsConsoleView } from "./FindingsConsole";
import type { Finding, FindingsDashboard, Suppression } from "./types";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
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
  evidence: {},
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
        const updated = { ...findings[0], status: body.status };
        findings[0] = updated;
        return jsonResponse({ finding: updated });
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
      <FindingsConsoleView
        session={{ kind: "tenant", tenantId: TENANT }}
      />,
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
      screen.getByRole("button", { name: /Mark acknowledged/i }),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Mark acknowledged/i }));
    await waitFor(() => {
      expect(screen.getAllByText("acknowledged").length).toBeGreaterThanOrEqual(
        1,
      );
    });
  });

  it("filters the list and supports snooze create/clear", async () => {
    const user = userEvent.setup();
    const suppressions: Suppression[] = [];
    mockConsoleApis({ suppressions });

    render(
      <FindingsConsoleView
        session={{ kind: "tenant", tenantId: TENANT }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("Agent lifecycle churn")).toBeInTheDocument();
    });

    const statusFilter = screen.getByLabelText("Status");
    await user.selectOptions(statusFilter, "resolved");
    await waitFor(() => {
      expect(screen.getByText(/No findings match/i)).toBeInTheDocument();
    });

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
      <FindingsConsoleView
        session={{ kind: "tenant", tenantId: TENANT }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByRole("alert")).toHaveTextContent(/FINDINGS_UNAVAILABLE/);
    });
  });
});
