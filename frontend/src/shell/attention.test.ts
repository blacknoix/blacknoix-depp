import { describe, expect, it } from "vitest";

import type { AttentionItem } from "../api/findings";
import { attentionItemPath, attentionKindLabel } from "./attentionLinks";
import {
  attentionSeenStorageKey,
  clearAttentionSeenAt,
  loadAttentionSeenAt,
  markAttentionSeenAt,
  type StorageLike,
} from "./attentionSeen";

const session = {
  kind: "tenant" as const,
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

describe("attentionSeen", () => {
  it("persists and fails closed on corrupt values", () => {
    const storage = memoryStorage();
    expect(loadAttentionSeenAt(session, storage)).toBeNull();

    const marked = markAttentionSeenAt(
      session,
      "2026-03-01T12:00:00.000Z",
      storage,
    );
    expect(marked.ok).toBe(true);
    expect(loadAttentionSeenAt(session, storage)).toBe(
      "2026-03-01T12:00:00.000Z",
    );
    expect(attentionSeenStorageKey(session)).toContain(session.tenantId);

    storage.setItem(attentionSeenStorageKey(session), "{not-json");
    expect(loadAttentionSeenAt(session, storage)).toBeNull();

    storage.setItem(
      attentionSeenStorageKey(session),
      JSON.stringify({ version: 1, seenAt: "bogus" }),
    );
    expect(loadAttentionSeenAt(session, storage)).toBeNull();

    clearAttentionSeenAt(session, storage);
    expect(loadAttentionSeenAt(session, storage)).toBeNull();
  });
});

describe("attentionItemPath", () => {
  it("builds Findings URL context and rejects obsolete rule ids", () => {
    const item: AttentionItem = {
      kind: "finding.created",
      findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Agent lifecycle churn",
      status: "open",
      ruleId: "agent.lifecycle_churn",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: "2026-03-01T12:00:00.000Z",
    };
    expect(attentionItemPath(item)).toBe(
      "/findings?status=open&ruleId=agent.lifecycle_churn&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(attentionKindLabel("finding.created")).toBe("New finding");
    expect(
      attentionItemPath({ ...item, ruleId: "gone.rule" }),
    ).toBeNull();
  });

  it("routes ownership reminders into Mine with finding selection", () => {
    const item: AttentionItem = {
      kind: "finding.needs_revisit",
      findingId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      title: "Quiet owned finding",
      status: "acknowledged",
      ruleId: "agent.heartbeat_silence",
      agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      at: "2026-02-28T12:00:00.000Z",
    };
    expect(attentionItemPath(item)).toBe(
      "/findings?ownerScope=me&findingId=dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    );
    expect(attentionKindLabel("finding.needs_revisit")).toBe("Needs revisit");
  });
});
