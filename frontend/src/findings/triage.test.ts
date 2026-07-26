import { describe, expect, it } from "vitest";

import {
  adjacentFindingId,
  resolvePostMutationSelection,
  selectionPosition,
} from "./triage";
import type { Finding } from "./types";

function finding(id: string, status: Finding["status"] = "open"): Finding {
  return {
    id,
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleId: "agent.lifecycle_churn",
    title: id,
    severity: "medium",
    status,
    statusChangedAt: null,
    statusChangedByUserId: null,
    evidence: {},
    windowStart: "2026-03-01T11:50:00.000Z",
    windowEnd: "2026-03-01T12:00:00.000Z",
    createdAt: "2026-03-01T12:00:00.000Z",
  };
}

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa01";
const B = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa02";
const C = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaa03";

describe("resolvePostMutationSelection", () => {
  it("keeps selection when the finding remains visible", () => {
    const list = [finding(A), finding(B)];
    expect(
      resolvePostMutationSelection({
        previousFindings: list,
        previousSelectedId: A,
        nextFindings: list,
      }),
    ).toBe(A);
  });

  it("advances to the next surviving neighbor when current leaves the filter", () => {
    expect(
      resolvePostMutationSelection({
        previousFindings: [finding(A), finding(B), finding(C)],
        previousSelectedId: A,
        nextFindings: [finding(B), finding(C)],
      }),
    ).toBe(B);
  });

  it("falls back to the previous neighbor, then clears", () => {
    expect(
      resolvePostMutationSelection({
        previousFindings: [finding(A), finding(B)],
        previousSelectedId: B,
        nextFindings: [finding(A)],
      }),
    ).toBe(A);
    expect(
      resolvePostMutationSelection({
        previousFindings: [finding(A)],
        previousSelectedId: A,
        nextFindings: [],
      }),
    ).toBeNull();
  });
});

describe("adjacentFindingId / selectionPosition", () => {
  it("navigates within bounds and reports position", () => {
    const list = [finding(A), finding(B), finding(C)];
    expect(adjacentFindingId(list, B, -1)).toBe(A);
    expect(adjacentFindingId(list, B, 1)).toBe(C);
    expect(adjacentFindingId(list, A, -1)).toBeNull();
    expect(adjacentFindingId(list, C, 1)).toBeNull();
    expect(selectionPosition(list, B)).toEqual({ index: 2, total: 3 });
  });
});
