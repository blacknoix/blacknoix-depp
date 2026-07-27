import { describe, expect, it } from "vitest";

import type { AttentionItem } from "../api/findings";
import type { Finding } from "../findings/types";
import {
  attentionWorkQueuePath,
  capWorkQueueItems,
  findingWorkQueuePath,
  WORK_QUEUE_SECTION_LIMIT,
  WORK_QUEUE_SECTIONS,
} from "./workQueue";

function finding(
  overrides: Partial<Finding> & Pick<Finding, "id">,
): Finding {
  return {
    agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    ruleId: "agent.lifecycle_churn",
    title: overrides.id,
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
    ...overrides,
  };
}

describe("WORK_QUEUE_SECTIONS", () => {
  it("orders Action needed → Reminders due → Mine → Unowned open", () => {
    expect(WORK_QUEUE_SECTIONS.map((s) => s.id)).toEqual([
      "action_needed",
      "reminders_due",
      "mine",
      "unowned_open",
    ]);
  });

  it("marks owner-aware sections and leaves Unowned open open without identity", () => {
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "action_needed")
        ?.requiresOperatorIdentity,
    ).toBe(true);
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "reminders_due")
        ?.requiresOperatorIdentity,
    ).toBe(true);
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "mine")?.requiresOperatorIdentity,
    ).toBe(true);
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "unowned_open")
        ?.requiresOperatorIdentity,
    ).toBe(false);
  });

  it("routes section headers into Findings queue URLs", () => {
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "mine")?.queuePath,
    ).toBe("/findings?ownerScope=me");
    expect(
      WORK_QUEUE_SECTIONS.find((s) => s.id === "unowned_open")?.queuePath,
    ).toBe("/findings?status=open&ownerScope=none");
  });
});

describe("capWorkQueueItems", () => {
  it("caps at the section limit and reports truncation", () => {
    const items = Array.from({ length: WORK_QUEUE_SECTION_LIMIT + 2 }, (_, i) => i);
    const capped = capWorkQueueItems(items);
    expect(capped.items).toHaveLength(WORK_QUEUE_SECTION_LIMIT);
    expect(capped.truncated).toBe(true);
  });
});

describe("findingWorkQueuePath / attentionWorkQueuePath", () => {
  it("opens owned findings in Mine context", () => {
    expect(
      findingWorkQueuePath(
        finding({
          id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
          ownerUserId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        }),
      ),
    ).toBe(
      "/findings?ownerScope=me&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
  });

  it("opens unowned findings in Unowned open context", () => {
    expect(
      findingWorkQueuePath(
        finding({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }),
      ),
    ).toBe(
      "/findings?status=open&ownerScope=none&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
  });

  it("maps Action needed into Mine Findings URL", () => {
    const item: AttentionItem = {
      kind: "finding.action_needed",
      findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Escalated",
      status: "acknowledged",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: "2026-03-01T12:00:00.000Z",
    };
    expect(attentionWorkQueuePath(item)).toBe(
      "/findings?ownerScope=me&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
  });
});
