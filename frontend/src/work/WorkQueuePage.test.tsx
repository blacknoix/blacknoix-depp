import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Outlet,
  Route,
  Routes,
} from "react-router-dom";

import type { Finding } from "../findings/types";
import { WorkQueuePage } from "./WorkQueuePage";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

const TENANT = "11111111-1111-4111-8111-111111111111";
const USER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const FINDING_ACTION = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const FINDING_DUE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const FINDING_MINE = "ffffffff-ffff-4fff-8fff-ffffffffffff";
const FINDING_UNOWNED = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

function jsonOk(data: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => ({ ok: true, data, requestId: "r" }),
  } as Response;
}

function finding(
  partial: Partial<Finding> & Pick<Finding, "id" | "title">,
): Finding {
  return {
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleId: "agent.lifecycle_churn",
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
    ...partial,
  };
}

function OutletSession({
  session,
}: {
  session: { kind: "tenant"; tenantId: string; userId?: string };
}) {
  return <Outlet context={{ session }} />;
}

function stubWorkQueueFetch(opts?: {
  actionNeeded?: Array<{ findingId: string; title: string; at?: string }>;
  dueReminders?: Array<{ findingId: string; title: string; at?: string }>;
  mine?: Finding[];
  unowned?: Finding[];
}) {
  const actionNeeded = (opts?.actionNeeded ?? []).map((row) => ({
    kind: "finding.action_needed" as const,
    findingId: row.findingId,
    title: row.title,
    status: "acknowledged" as const,
    ruleId: "agent.lifecycle_churn",
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    at: row.at ?? "2026-03-01T10:00:00.000Z",
  }));
  const dueReminders = (opts?.dueReminders ?? []).map((row) => ({
    kind: "finding.reminder_due" as const,
    findingId: row.findingId,
    title: row.title,
    status: "acknowledged" as const,
    ruleId: "agent.lifecycle_churn",
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    at: row.at ?? "2026-03-01T11:00:00.000Z",
  }));
  const mine = opts?.mine ?? [];
  const unowned = opts?.unowned ?? [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.includes("/v1/findings/attention/dismiss") && method === "POST") {
        const body = JSON.parse(String(init?.body ?? "{}"));
        return jsonOk({
          findingId: body.findingId,
          kind: body.kind,
          conditionAt: body.conditionAt,
        });
      }

      if (url.includes("/v1/findings/attention")) {
        return jsonOk({
          generatedAt: "2026-03-01T12:00:00.000Z",
          since: "2026-02-28T12:00:00.000Z",
          maxLookbackHours: 24,
          openCount: 2,
          activeSuppressionCount: 0,
          truncated: false,
          items: [],
          reminders: { quietHours: 24, truncated: false, items: [] },
          dueReminders: { truncated: false, items: dueReminders },
          actionNeeded: {
            overdueHours: 4,
            escalationQuietHours: 48,
            truncated: false,
            items: actionNeeded,
          },
        });
      }

      if (url.includes("/v1/findings?")) {
        const parsed = new URL(url, "http://local.test");
        const ownerScope = parsed.searchParams.get("ownerScope");
        if (ownerScope === "me") {
          return jsonOk({ findings: mine });
        }
        if (ownerScope === "none") {
          return jsonOk({ findings: unowned });
        }
        return jsonOk({ findings: [] });
      }

      return jsonOk({});
    }),
  );
}

function renderWithShell(session: {
  kind: "tenant";
  tenantId: string;
  userId?: string;
}) {
  return render(
    <MemoryRouter initialEntries={["/work"]}>
      <Routes>
        <Route element={<OutletSession session={session} />}>
          <Route path="work" element={<WorkQueuePage />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("WorkQueuePage", () => {
  it("renders sections in priority order with Findings deep links", async () => {
    stubWorkQueueFetch({
      actionNeeded: [{ findingId: FINDING_ACTION, title: "Escalated churn" }],
      dueReminders: [{ findingId: FINDING_DUE, title: "Due reminder" }],
      mine: [
        finding({
          id: FINDING_MINE,
          title: "My finding",
          ownerUserId: USER,
          status: "acknowledged",
        }),
      ],
      unowned: [finding({ id: FINDING_UNOWNED, title: "Claim me" })],
    });

    renderWithShell({ kind: "tenant", tenantId: TENANT, userId: USER });

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Work" })).toBeInTheDocument();
    });

    const ordered = document.querySelectorAll("[data-section]");
    expect([...ordered].map((el) => el.getAttribute("data-section"))).toEqual([
      "action_needed",
      "reminders_due",
      "mine",
      "unowned_open",
    ]);

    expect(
      screen.getByRole("link", { name: /Escalated churn/i }),
    ).toHaveAttribute(
      "href",
      `/findings?ownerScope=me&findingId=${FINDING_ACTION}`,
    );
    expect(
      screen.getByRole("link", { name: /Due reminder/i }),
    ).toHaveAttribute(
      "href",
      `/findings?ownerScope=me&findingId=${FINDING_DUE}`,
    );
    expect(
      screen.getByRole("link", { name: /My finding/i }),
    ).toHaveAttribute(
      "href",
      `/findings?ownerScope=me&findingId=${FINDING_MINE}`,
    );
    expect(
      screen.getByRole("link", { name: /Claim me/i }),
    ).toHaveAttribute(
      "href",
      `/findings?status=open&ownerScope=none&findingId=${FINDING_UNOWNED}`,
    );
  });

  it("fails closed on owner-aware sections without operator identity", async () => {
    stubWorkQueueFetch({
      actionNeeded: [{ findingId: FINDING_ACTION, title: "Hidden action" }],
      dueReminders: [{ findingId: FINDING_DUE, title: "Hidden due" }],
      mine: [
        finding({
          id: FINDING_MINE,
          title: "Hidden mine",
          ownerUserId: USER,
        }),
      ],
      unowned: [finding({ id: FINDING_UNOWNED, title: "Visible unowned" })],
    });

    renderWithShell({ kind: "tenant", tenantId: TENANT });

    await waitFor(() => {
      expect(screen.getByText(/Visible unowned/i)).toBeInTheDocument();
    });

    expect(
      screen.getByText(/Operator identity is required/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Hidden action/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hidden due/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Hidden mine/i)).not.toBeInTheDocument();

    const actionSection = document.querySelector(
      '[data-section="action_needed"]',
    ) as HTMLElement;
    expect(
      within(actionSection).getByText(
        /Unavailable without operator identity/i,
      ),
    ).toBeInTheDocument();
  });

  it("dismisses Action needed until condition changes and reloads", async () => {
    const user = userEvent.setup();
    const dismissed: unknown[] = [];
    let actionItems = [
      { findingId: FINDING_ACTION, title: "Escalated churn" },
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (
          url.includes("/v1/findings/attention/dismiss") &&
          method === "POST"
        ) {
          const body = JSON.parse(String(init?.body ?? "{}"));
          dismissed.push(body);
          actionItems = [];
          return jsonOk({
            findingId: body.findingId,
            kind: body.kind,
            conditionAt: body.conditionAt,
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
              items: actionItems.map((row) => ({
                kind: "finding.action_needed" as const,
                findingId: row.findingId,
                title: row.title,
                status: "acknowledged" as const,
                ruleId: "agent.lifecycle_churn",
                agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                at: "2026-03-01T10:00:00.000Z",
              })),
            },
          });
        }

        if (url.includes("/v1/findings?")) {
          return jsonOk({ findings: [] });
        }

        return jsonOk({});
      }),
    );

    renderWithShell({ kind: "tenant", tenantId: TENANT, userId: USER });

    await waitFor(() => {
      expect(screen.getByText(/Escalated churn/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole("button", { name: /^Dismiss$/i }));

    await waitFor(() => {
      expect(dismissed).toEqual([
        {
          findingId: FINDING_ACTION,
          kind: "finding.action_needed",
          conditionAt: "2026-03-01T10:00:00.000Z",
        },
      ]);
    });

    await waitFor(() => {
      expect(screen.queryByText(/Escalated churn/i)).not.toBeInTheDocument();
    });
    expect(
      screen.getByText(
        /Dismissed until this finding's attention condition changes/i,
      ),
    ).toBeInTheDocument();
  });
});
