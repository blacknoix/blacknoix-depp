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
  vi.restoreAllMocks();
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

function jsonErr(status: number, code: string, message: string): Response {
  return {
    ok: false,
    status,
    json: async () => ({
      ok: false,
      error: { code, message },
      requestId: "r",
    }),
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

function emptyAttention() {
  return {
    generatedAt: "2026-03-01T12:00:00.000Z",
    since: "2026-02-28T12:00:00.000Z",
    maxLookbackHours: 24,
    openCount: 0,
    activeSuppressionCount: 0,
    truncated: false,
    items: [],
    reminders: { quietHours: 24, truncated: false, items: [] },
    dueReminders: { truncated: false, items: [] },
    actionNeeded: {
      overdueHours: 4,
      escalationQuietHours: 48,
      truncated: false,
      items: [],
    },
  };
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
          ...emptyAttention(),
          openCount: 2,
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
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /Bulk actions/i }),
    ).not.toBeInTheDocument();
  });

  it("selects findings and bulk-claims, then refreshes Unowned / Mine", async () => {
    const user = userEvent.setup();
    const patches: Array<{ id: string; body: unknown }> = [];
    let unowned = [finding({ id: FINDING_UNOWNED, title: "Claim me" })];
    let mine: Finding[] = [];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/v1/findings/") && method === "PATCH") {
          const id = url.split("/v1/findings/")[1]?.split("?")[0] ?? "";
          const body = JSON.parse(String(init?.body ?? "{}"));
          patches.push({ id, body });
          if (body.claimOwner === true && id === FINDING_UNOWNED) {
            const claimed = finding({
              id: FINDING_UNOWNED,
              title: "Claim me",
              ownerUserId: USER,
            });
            unowned = [];
            mine = [claimed];
            return jsonOk({ finding: claimed });
          }
          return jsonErr(400, "BAD_REQUEST", "unexpected");
        }

        if (url.includes("/v1/findings/attention")) {
          return jsonOk(emptyAttention());
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

    renderWithShell({ kind: "tenant", tenantId: TENANT, userId: USER });

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: /Select Claim me/i }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("checkbox", { name: /Select Claim me/i }),
    );
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Claim to me/i }));

    await waitFor(() => {
      expect(patches).toEqual([
        { id: FINDING_UNOWNED, body: { claimOwner: true } },
      ]);
    });

    await waitFor(() => {
      expect(screen.getByText(/Claim to me: 1 updated/i)).toBeInTheDocument();
    });

    const unownedSection = document.querySelector(
      '[data-section="unowned_open"]',
    ) as HTMLElement;
    expect(
      within(unownedSection).getByText(/Nothing here/i),
    ).toBeInTheDocument();

    const mineSection = document.querySelector(
      '[data-section="mine"]',
    ) as HTMLElement;
    expect(
      within(mineSection).getByRole("link", { name: /Claim me/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("region", { name: /Bulk actions/i }),
    ).not.toBeInTheDocument();
  });

  it("reports partial bulk resolve failure and keeps failed selection", async () => {
    const user = userEvent.setup();
    vi.spyOn(window, "confirm").mockReturnValue(true);

    let mineState = [
      finding({
        id: FINDING_MINE,
        title: "Resolve ok",
        ownerUserId: USER,
        status: "acknowledged",
      }),
      finding({
        id: FINDING_ACTION,
        title: "Resolve fail",
        ownerUserId: USER,
        status: "acknowledged",
      }),
    ];

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();

        if (url.includes("/v1/findings/") && method === "PATCH") {
          const id = url.split("/v1/findings/")[1]?.split("?")[0] ?? "";
          if (id === FINDING_MINE) {
            mineState = mineState.filter((f) => f.id !== FINDING_MINE);
            return jsonOk({
              finding: finding({
                id: FINDING_MINE,
                title: "Resolve ok",
                ownerUserId: USER,
                status: "resolved",
              }),
            });
          }
          return jsonErr(409, "CONFLICT", "invalid status transition");
        }

        if (url.includes("/v1/findings/attention")) {
          return jsonOk({
            ...emptyAttention(),
            openCount: mineState.length,
          });
        }

        if (url.includes("/v1/findings?")) {
          const parsed = new URL(url, "http://local.test");
          if (parsed.searchParams.get("ownerScope") === "me") {
            return jsonOk({ findings: mineState });
          }
          return jsonOk({ findings: [] });
        }

        return jsonOk({});
      }),
    );

    renderWithShell({ kind: "tenant", tenantId: TENANT, userId: USER });

    await waitFor(() => {
      expect(
        screen.getByRole("checkbox", { name: /Select Resolve ok/i }),
      ).toBeInTheDocument();
    });

    await user.click(
      screen.getByRole("checkbox", { name: /Select Resolve ok/i }),
    );
    await user.click(
      screen.getByRole("checkbox", { name: /Select Resolve fail/i }),
    );
    await user.click(screen.getByRole("button", { name: /Mark resolved/i }));

    await waitFor(() => {
      expect(
        screen.getByText(/Mark resolved: 1 of 2 updated. 1 failed/i),
      ).toBeInTheDocument();
    });

    expect(
      screen.getByRole("checkbox", { name: /Select Resolve fail/i }),
    ).toBeChecked();
    expect(
      screen.queryByRole("checkbox", { name: /Select Resolve ok/i }),
    ).not.toBeInTheDocument();
    expect(window.confirm).toHaveBeenCalled();
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
            ...emptyAttention(),
            openCount: 1,
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
      expect(
        screen.getByRole("link", { name: /Escalated churn/i }),
      ).toBeInTheDocument();
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
      expect(
        screen.queryByRole("link", { name: /Escalated churn/i }),
      ).not.toBeInTheDocument();
    });
  });
});
