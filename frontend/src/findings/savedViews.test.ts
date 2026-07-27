import { afterEach, describe, expect, it } from "vitest";

import type { OperatorSession } from "../auth/session";
import {
  createSavedView,
  loadSavedViews,
  parseSavedViewsStore,
  sanitizeSavedFilters,
  saveCurrentFilters,
  savedViewsStorageKey,
  sessionCanApplyOwnerScopeMe,
  validateFiltersForApply,
  type StorageLike,
} from "./savedViews";

const session: OperatorSession = {
  kind: "tenant",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

function memoryStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem(key: string) {
      return data[key] ?? null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    },
    removeItem(key: string) {
      delete data[key];
    },
  };
}

afterEach(() => {
  // no shared localStorage in node by default for these unit tests
});

describe("sanitizeSavedFilters", () => {
  it("accepts known filter fields and rejects findingId", () => {
    expect(
      sanitizeSavedFilters({
        status: "open",
        ruleId: "agent.lifecycle_churn",
        agentId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA",
      }),
    ).toEqual({
      status: "open",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    });
    expect(
      sanitizeSavedFilters({
        status: "open",
        findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
    ).toBeNull();
    expect(sanitizeSavedFilters({ status: "nope" })).toBeNull();
    expect(sanitizeSavedFilters({ ruleId: "obsolete.rule" })).toBeNull();
  });

  it("accepts ownerScope me|none and rejects unsupported values", () => {
    expect(sanitizeSavedFilters({ ownerScope: "me" })).toEqual({
      ownerScope: "me",
    });
    expect(
      sanitizeSavedFilters({ ownerScope: "none", status: "open" }),
    ).toEqual({ ownerScope: "none", status: "open" });
    expect(sanitizeSavedFilters({ ownerScope: "everyone" })).toBeNull();
  });
});

describe("validateFiltersForApply", () => {
  it("requires operator identity for ownerScope=me", () => {
    expect(
      validateFiltersForApply(session, { ownerScope: "me" }).ok,
    ).toBe(false);
    expect(
      validateFiltersForApply(
        { ...session, userId: "22222222-2222-4222-8222-222222222222" },
        { ownerScope: "me" },
      ).ok,
    ).toBe(true);
    expect(
      validateFiltersForApply(
        { kind: "bearer", accessToken: "x".repeat(24) },
        { ownerScope: "me" },
      ).ok,
    ).toBe(true);
    expect(
      validateFiltersForApply(session, { ownerScope: "none", status: "open" })
        .ok,
    ).toBe(true);
    expect(sessionCanApplyOwnerScopeMe(session)).toBe(false);
  });
});

describe("parseSavedViewsStore", () => {
  it("drops corrupt, wrong-version, and obsolete entries", () => {
    expect(parseSavedViewsStore("not-json")).toEqual({
      version: 1,
      views: [],
    });
    expect(
      parseSavedViewsStore(
        JSON.stringify({ version: 99, views: [{ name: "x" }] }),
      ),
    ).toEqual({ version: 1, views: [] });

    const store = parseSavedViewsStore(
      JSON.stringify({
        version: 1,
        views: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "Good",
            createdAt: "2026-03-01T12:00:00.000Z",
            filters: { status: "open" },
          },
          {
            id: "not-a-uuid",
            name: "Bad id",
            createdAt: "2026-03-01T12:00:00.000Z",
            filters: { status: "open" },
          },
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Obsolete rule",
            createdAt: "2026-03-01T12:00:00.000Z",
            filters: { ruleId: "gone.rule" },
          },
        ],
      }),
    );
    expect(store.views).toHaveLength(1);
    expect(store.views[0].name).toBe("Good");
  });
});

describe("saveCurrentFilters", () => {
  it("persists filters without findingId and rejects duplicates", () => {
    const storage = memoryStorage();
    const first = saveCurrentFilters({
      session,
      name: " Open churn ",
      filters: {
        status: "open",
        ruleId: "agent.lifecycle_churn",
      },
      storage,
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const loaded = loadSavedViews(session, storage);
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe("Open churn");
    expect(loaded[0].filters).toEqual({
      status: "open",
      ruleId: "agent.lifecycle_churn",
    });
    expect("findingId" in loaded[0].filters).toBe(false);
    expect(storage.data[savedViewsStorageKey(session)]).not.toMatch(
      /findingId/,
    );

    const dup = saveCurrentFilters({
      session,
      name: "Again",
      filters: {
        status: "open",
        ruleId: "agent.lifecycle_churn",
      },
      storage,
    });
    expect(dup.ok).toBe(false);
    expect(dup.views).toHaveLength(1);
  });

  it("persists ownerScope work-queue filters without findingId", () => {
    const storage = memoryStorage();
    const result = saveCurrentFilters({
      session,
      name: "Mine",
      filters: { ownerScope: "me" },
      storage,
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.view.filters).toEqual({ ownerScope: "me" });
    expect(loadSavedViews(session, storage)[0].filters).toEqual({
      ownerScope: "me",
    });
  });

  it("createSavedView never copies findingId from a polluted object", () => {
    const polluted = {
      status: "open" as const,
      findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    };
    expect(
      sanitizeSavedFilters(polluted as unknown as Record<string, unknown>),
    ).toBeNull();
    expect(
      createSavedView({
        name: "x",
        filters: { status: "open" },
        id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      })?.filters,
    ).toEqual({ status: "open" });
  });
});
