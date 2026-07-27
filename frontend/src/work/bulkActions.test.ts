import { describe, expect, it } from "vitest";

import {
  collectVisibleFindingIds,
  formatBulkActionMessage,
  isBulkFindingId,
  MAX_BULK_SELECTION,
  orderedBulkIds,
  patchForBulkAction,
  pruneBulkSelection,
  summarizeBulkResults,
  toggleBulkSelection,
} from "./bulkActions";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const C = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

describe("bulkActions helpers", () => {
  it("maps the tiny shared action set onto existing PATCH bodies", () => {
    expect(patchForBulkAction("claim")).toEqual({ claimOwner: true });
    expect(patchForBulkAction("clear_owner")).toEqual({ ownerUserId: null });
    expect(patchForBulkAction("resolve")).toEqual({ status: "resolved" });
  });

  it("toggles selection, rejects invalid ids, and caps at the soft max", () => {
    expect(isBulkFindingId("not-a-uuid")).toBe(false);
    expect(toggleBulkSelection(new Set(), "not-a-uuid").size).toBe(0);

    let selected = toggleBulkSelection(new Set(), A);
    expect([...selected]).toEqual([A]);
    selected = toggleBulkSelection(selected, A);
    expect(selected.size).toBe(0);

    selected = new Set(
      Array.from({ length: MAX_BULK_SELECTION }, (_, i) =>
        `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
      ),
    );
    expect(selected.size).toBe(MAX_BULK_SELECTION);
    const blocked = toggleBulkSelection(selected, B);
    expect(blocked.has(B)).toBe(false);
    expect(blocked.size).toBe(MAX_BULK_SELECTION);
  });

  it("prunes selection to currently visible findings and orders ids", () => {
    const selected = new Set([A, B, C]);
    const pruned = pruneBulkSelection(selected, new Set([A, C]));
    expect([...pruned].sort()).toEqual([A, C]);
    expect(orderedBulkIds(new Set([C, A]))).toEqual([A, C]);
  });

  it("summarizes partial failures honestly", () => {
    const summary = summarizeBulkResults("resolve", [
      { findingId: A, ok: true },
      { findingId: B, ok: false, error: "CONFLICT: bad transition" },
      { findingId: C, ok: true },
    ]);
    expect(summary.succeeded).toEqual([A, C]);
    expect(summary.failed).toHaveLength(1);
    expect(formatBulkActionMessage(summary)).toBe(
      "Mark resolved: 2 of 3 updated. 1 failed.",
    );
  });

  it("collects visible finding ids across Work sections", () => {
    const ids = collectVisibleFindingIds({
      actionNeeded: [{ findingId: A }],
      remindersDue: [{ findingId: B }],
      mine: [{ id: C }],
      unownedOpen: [{ id: "not-valid" }],
    });
    expect([...ids].sort()).toEqual([A, B, C].sort());
  });
});
