import { describe, expect, it } from "vitest";

import type { OperatorSession } from "../auth/session";
import {
  deleteSavedWorkView,
  describeWorkSections,
  loadSavedWorkViews,
  sanitizeWorkViewDefinition,
  saveCurrentWorkView,
  validateWorkDefinitionForApply,
  workSavedViewsStorageKey,
  type StorageLike,
} from "../work/savedWorkViews";

const session: OperatorSession = {
  kind: "tenant",
  tenantId: "11111111-1111-4111-8111-111111111111",
};

const sessionWithUser: OperatorSession = {
  ...session,
  userId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
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

describe("savedWorkViews", () => {
  it("sanitizes sections and rejects ownerScope / findingId", () => {
    expect(
      sanitizeWorkViewDefinition({
        sections: ["unowned_open", "mine"],
      }),
    ).toEqual({ sections: ["mine", "unowned_open"] });
    expect(
      sanitizeWorkViewDefinition({
        sections: ["mine"],
        ownerScope: "me",
      }),
    ).toBeNull();
    expect(
      sanitizeWorkViewDefinition({
        sections: ["mine"],
        findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      }),
    ).toBeNull();
    expect(sanitizeWorkViewDefinition({ sections: ["nope"] })).toBeNull();
  });

  it("requires identity when applying identity-only views", () => {
    expect(
      validateWorkDefinitionForApply(session, {
        sections: ["mine", "action_needed"],
      }).ok,
    ).toBe(false);
    expect(
      validateWorkDefinitionForApply(sessionWithUser, {
        sections: ["mine", "action_needed"],
      }).ok,
    ).toBe(true);
    expect(
      validateWorkDefinitionForApply(session, {
        sections: ["unowned_open"],
      }).ok,
    ).toBe(true);
  });

  it("persists local views without selection state and coexists by key", () => {
    const storage = memoryStorage();
    const saved = saveCurrentWorkView({
      session,
      name: "Intake",
      definition: { sections: ["unowned_open"] },
      storage,
      now: new Date("2026-03-01T12:00:00.000Z"),
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) {
      return;
    }
    expect(saved.view.definition).toEqual({ sections: ["unowned_open"] });
    expect(describeWorkSections(saved.view.definition.sections)).toBe(
      "Unowned open",
    );
    expect(storage.data[workSavedViewsStorageKey(session)]).not.toMatch(
      /findingId/,
    );
    expect(loadSavedWorkViews(session, storage)).toHaveLength(1);

    const removed = deleteSavedWorkView({
      session,
      id: saved.view.id,
      storage,
    });
    expect(removed.ok).toBe(true);
    expect(loadSavedWorkViews(session, storage)).toHaveLength(0);
  });

  it("drops obsolete local store entries on load", () => {
    const storage = memoryStorage();
    storage.setItem(
      workSavedViewsStorageKey(session),
      JSON.stringify({
        version: 1,
        views: [
          {
            id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
            name: "Obsolete",
            definition: { sections: ["gone"] },
            createdAt: "2026-03-01T12:00:00.000Z",
          },
          {
            id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
            name: "Good",
            definition: { sections: ["mine"] },
            createdAt: "2026-03-01T12:00:00.000Z",
          },
        ],
      }),
    );
    expect(loadSavedWorkViews(session, storage).map((v) => v.name)).toEqual([
      "Good",
    ]);
  });
});
