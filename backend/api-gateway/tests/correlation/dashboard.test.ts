import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleFindingsDashboard,
  DASHBOARD_RECENT_HOURS,
  emptyRuleCounts,
  emptyStatusCounts,
} from "../../src/correlation/dashboard";

describe("assembleFindingsDashboard", () => {
  it("zero-fills known statuses and rule ids on empty raw counts", () => {
    const generatedAt = new Date("2026-03-01T12:00:00.000Z");
    const dashboard = assembleFindingsDashboard(generatedAt, {
      statusCounts: [],
      ruleCounts: [],
      recentCreatedCount: 0,
      recentChangedCount: 0,
      activeSuppressionCount: 0,
    });

    assert.equal(dashboard.windowHours, DASHBOARD_RECENT_HOURS);
    assert.deepEqual(dashboard.countsByStatus, emptyStatusCounts());
    assert.deepEqual(dashboard.countsByRuleId, emptyRuleCounts());
    assert.equal(dashboard.recentCreatedCount, 0);
    assert.equal(dashboard.recentChangedCount, 0);
    assert.equal(dashboard.activeSuppressionCount, 0);
  });

  it("merges known aggregates and ignores unknown keys", () => {
    const dashboard = assembleFindingsDashboard(
      new Date("2026-03-01T12:00:00.000Z"),
      {
        statusCounts: [
          { status: "open", count: 2 },
          { status: "ghost", count: 9 },
        ],
        ruleCounts: [
          { ruleId: "agent.lifecycle_churn", count: 3 },
          { ruleId: "malware.x", count: 4 },
        ],
        recentCreatedCount: 5,
        recentChangedCount: 1,
        activeSuppressionCount: 2,
      },
    );

    assert.equal(dashboard.countsByStatus.open, 2);
    assert.equal(dashboard.countsByStatus.acknowledged, 0);
    assert.equal(dashboard.countsByStatus.resolved, 0);
    assert.equal(dashboard.countsByRuleId["agent.lifecycle_churn"], 3);
    assert.equal(dashboard.countsByRuleId["agent.heartbeat_burst"], 0);
    assert.equal(dashboard.countsByRuleId["agent.heartbeat_silence"], 0);
    assert.equal(dashboard.recentCreatedCount, 5);
    assert.equal(dashboard.recentChangedCount, 1);
    assert.equal(dashboard.activeSuppressionCount, 2);
  });
});
