import { describe, expect, it } from "vitest";

import type { OperatorSession } from "../auth/session";
import { saveCurrentFilters, type StorageLike } from "../findings/savedViews";
import {
  buildOperatorCommands,
  commandTargetPath,
  filterOperatorCommands,
} from "./commands";

const session: OperatorSession = {
  kind: "tenant",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

function memoryStorage(): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem(key) {
      return data[key] ?? null;
    },
    setItem(key, value) {
      data[key] = value;
    },
    removeItem(key) {
      delete data[key];
    },
  };
}

describe("buildOperatorCommands / filterOperatorCommands", () => {
  it("includes nav, status, rule, and saved-view commands", () => {
    const storage = memoryStorage();
    saveCurrentFilters({
      session,
      name: "Open churn",
      filters: { status: "open", ruleId: "agent.lifecycle_churn" },
      storage,
      now: new Date("2026-03-01T12:00:00.000Z"),
    });

    const commands = buildOperatorCommands({ session, storage });
    expect(commands.some((c) => c.id === "nav.work")).toBe(true);
    expect(commands.some((c) => c.id === "nav.findings")).toBe(true);
    expect(commands.some((c) => c.id === "nav.agents")).toBe(true);
    expect(commands.some((c) => c.id === "agents.freshness.stale")).toBe(true);
    expect(commands.some((c) => c.id === "agents.openFindings")).toBe(true);
    expect(
      commandTargetPath(
        commands.find((c) => c.id === "agents.freshness.stale")!,
      ),
    ).toBe("/agents?freshness=stale");
    expect(commands.some((c) => c.id === "filter.status.open")).toBe(true);
    expect(
      commands.some((c) => c.id === "filter.rule.agent.lifecycle_churn"),
    ).toBe(true);
    expect(
      commands.some(
        (c) => c.kind === "saved-view" && c.label.includes("Open churn"),
      ),
    ).toBe(true);
  });

  it("includes shared views when provided", () => {
    const commands = buildOperatorCommands({
      session,
      storage: memoryStorage(),
      sharedViews: [
        {
          id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
          name: "Tenant open",
          filters: { status: "open" },
          createdAt: "2026-03-01T12:00:00.000Z",
          createdByUserId: null,
        },
        {
          id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          name: "Obsolete",
          filters: { ruleId: "gone.rule" as never },
          createdAt: "2026-03-01T12:00:00.000Z",
          createdByUserId: null,
        },
      ],
    });
    const shared = commands.find((c) => c.id === "shared.bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
    expect(shared?.kind).toBe("saved-view");
    if (shared?.kind === "saved-view") {
      expect(shared.scope).toBe("shared");
      expect(commandTargetPath(shared)).toBe("/findings?status=open");
    }
    expect(
      commands.some((c) => c.id === "shared.cccccccc-cccc-4ccc-8ccc-cccccccccccc"),
    ).toBe(false);
  });

  it("filters by substring and reports no matches", () => {
    const commands = buildOperatorCommands({
      session,
      storage: memoryStorage(),
    });
    expect(filterOperatorCommands(commands, "agents")[0]?.id).toBe(
      "nav.agents",
    );
    expect(filterOperatorCommands(commands, "zzzz-none")).toEqual([]);
  });
});

describe("commandTargetPath", () => {
  it("maps findings filters to URL without findingId", () => {
    expect(
      commandTargetPath({
        id: "filter.status.open",
        kind: "findings-filter",
        label: "x",
        keywords: [],
        filters: { status: "open" },
      }),
    ).toBe("/findings?status=open");
    expect(
      commandTargetPath({
        id: "saved.x",
        kind: "saved-view",
        label: "x",
        keywords: [],
        filters: {
          status: "open",
          ruleId: "agent.lifecycle_churn",
        },
        viewId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        scope: "shared",
      }),
    ).toBe("/findings?status=open&ruleId=agent.lifecycle_churn");
    expect(
      commandTargetPath({
        id: "nav.agents",
        kind: "nav",
        label: "Agents",
        keywords: [],
        to: "/agents",
      }),
    ).toBe("/agents");
  });
});
