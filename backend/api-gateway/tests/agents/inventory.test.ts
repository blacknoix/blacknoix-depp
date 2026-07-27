import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { deriveHeartbeatFreshness } from "../../src/agents/inventory";

const NOW = new Date("2026-03-01T12:00:00.000Z");
const STALE_MS = 5 * 60 * 1000;

describe("deriveHeartbeatFreshness", () => {
  it("returns unknown when there is no heartbeat", () => {
    assert.equal(deriveHeartbeatFreshness(null, NOW, STALE_MS), "unknown");
  });

  it("returns recent inside the silence threshold and stale beyond it", () => {
    assert.equal(
      deriveHeartbeatFreshness(
        new Date("2026-03-01T11:56:00.000Z"),
        NOW,
        STALE_MS,
      ),
      "recent",
    );
    assert.equal(
      deriveHeartbeatFreshness(
        new Date("2026-03-01T11:54:00.000Z"),
        NOW,
        STALE_MS,
      ),
      "stale",
    );
  });
});
