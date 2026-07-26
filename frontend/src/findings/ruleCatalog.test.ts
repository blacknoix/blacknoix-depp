import { describe, expect, it } from "vitest";

import {
  ruleCatalogEntry,
  summarizeEvidence,
} from "./ruleCatalog";

describe("ruleCatalog", () => {
  it("returns honest catalog entries for known rules", () => {
    const churn = ruleCatalogEntry("agent.lifecycle_churn");
    expect(churn?.summary).toMatch(/10-minute/);
    expect(churn?.summary).toMatch(/6/);
    expect(ruleCatalogEntry("unknown.rule")).toBeNull();
  });

  it("summarizes count-rule evidence without sample ids", () => {
    const facts = summarizeEvidence({
      threshold: 6,
      totalInWindow: 8,
      countsByEventType: { "agent.started": 4, "agent.stopped": 4 },
      sampleEventIds: ["should-not-appear"],
    });
    expect(facts).toEqual(
      expect.arrayContaining([
        { label: "Count vs threshold", value: "8 / 6" },
        {
          label: "Counts by type",
          value: "agent.started: 4 · agent.stopped: 4",
        },
      ]),
    );
    expect(facts.some((f) => f.value.includes("should-not-appear"))).toBe(
      false,
    );
  });

  it("summarizes silence evidence", () => {
    const facts = summarizeEvidence({
      silenceThresholdMs: 5 * 60 * 1000,
      ageMs: 12 * 60 * 1000,
      lastHeartbeatAt: "2026-03-01T11:48:00.000Z",
    });
    expect(facts.map((f) => f.label)).toEqual([
      "Silence threshold",
      "Heartbeat age at eval",
      "Last heartbeat (evidence)",
    ]);
  });
});
