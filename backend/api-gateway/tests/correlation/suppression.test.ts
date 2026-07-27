import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  isSuppressionActive,
  parseSuppressionWindow,
  SUPPRESSION_MAX_DURATION_MS,
} from "../../src/correlation/suppression";

const NOW = new Date("2026-03-01T12:00:00.000Z");

describe("parseSuppressionWindow", () => {
  it("accepts a valid future until with a known ruleId", () => {
    const result = parseSuppressionWindow(
      {
        ruleId: "agent.lifecycle_churn",
        until: "2026-03-01T13:00:00.000Z",
      },
      NOW,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.window.ruleId, "agent.lifecycle_churn");
    assert.equal(result.window.startsAt.toISOString(), NOW.toISOString());
    assert.equal(
      result.window.endsAt.toISOString(),
      "2026-03-01T13:00:00.000Z",
    );
  });

  it("rejects unknown ruleId, past until, inverted window, and oversized span", () => {
    assert.equal(
      parseSuppressionWindow({ ruleId: "malware.x", until: "2026-03-01T13:00:00.000Z" }, NOW)
        .ok,
      false,
    );
    assert.equal(
      parseSuppressionWindow(
        { ruleId: "agent.lifecycle_churn", until: "2026-03-01T11:00:00.000Z" },
        NOW,
      ).ok,
      false,
    );
    assert.equal(
      parseSuppressionWindow(
        {
          ruleId: "agent.lifecycle_churn",
          startsAt: "2026-03-02T00:00:00.000Z",
          until: "2026-03-01T13:00:00.000Z",
        },
        NOW,
      ).ok,
      false,
    );
    const tooLong = new Date(NOW.getTime() + SUPPRESSION_MAX_DURATION_MS + 1);
    assert.equal(
      parseSuppressionWindow(
        {
          ruleId: "agent.lifecycle_churn",
          until: tooLong.toISOString(),
        },
        NOW,
      ).ok,
      false,
    );
  });
});

describe("isSuppressionActive", () => {
  it("is active only inside an uncleared window", () => {
    const row = {
      startsAt: new Date("2026-03-01T11:00:00.000Z"),
      endsAt: new Date("2026-03-01T13:00:00.000Z"),
      clearedAt: null as Date | null,
    };
    assert.equal(isSuppressionActive(row, NOW), true);
    assert.equal(
      isSuppressionActive(row, new Date("2026-03-01T14:00:00.000Z")),
      false,
    );
    assert.equal(
      isSuppressionActive({ ...row, clearedAt: NOW }, NOW),
      false,
    );
  });
});
