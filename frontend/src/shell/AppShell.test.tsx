import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import { App } from "../App";
import { ComingSoonPage } from "./ComingSoonPage";
import { isNavActive, OPERATOR_NAV } from "./nav";
import { OperatorShell } from "./OperatorShell";

afterEach(() => {
  cleanup();
  sessionStorage.clear();
  vi.unstubAllGlobals();
  window.history.pushState({}, "", "/");
});

const TENANT = "11111111-1111-4111-8111-111111111111";

describe("nav helpers", () => {
  it("marks findings and agents as live destinations", () => {
    expect(OPERATOR_NAV.map((n) => n.id)).toEqual(["findings", "agents"]);
    expect(OPERATOR_NAV.every((n) => n.kind === "live")).toBe(true);
    expect(isNavActive("/findings", "/findings")).toBe(true);
    expect(isNavActive("/agents", "/findings")).toBe(false);
  });
});

describe("OperatorShell", () => {
  it("renders session context, primary nav, and active Findings link", () => {
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
  });

  it("keeps shell structure present on a narrow viewport", () => {
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
      screen.getByRole("heading", { level: 1, name: "Findings" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Findings/i })).toHaveAttribute(
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
