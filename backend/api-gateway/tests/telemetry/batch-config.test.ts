import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveTelemetryBatchMaxEvents } from "../../src/config/env";

describe("resolveTelemetryBatchMaxEvents", () => {
  it("defaults to 50 when unset", () => {
    assert.equal(resolveTelemetryBatchMaxEvents(undefined), 50);
    assert.equal(resolveTelemetryBatchMaxEvents(""), 50);
    assert.equal(resolveTelemetryBatchMaxEvents("  "), 50);
  });

  it("accepts integers in 1..100", () => {
    assert.equal(resolveTelemetryBatchMaxEvents("1"), 1);
    assert.equal(resolveTelemetryBatchMaxEvents("100"), 100);
    assert.equal(resolveTelemetryBatchMaxEvents("25"), 25);
  });

  it("fails closed on invalid values", () => {
    assert.throws(() => resolveTelemetryBatchMaxEvents("0"), /TELEMETRY_BATCH_MAX_EVENTS/);
    assert.throws(() => resolveTelemetryBatchMaxEvents("101"), /TELEMETRY_BATCH_MAX_EVENTS/);
    assert.throws(() => resolveTelemetryBatchMaxEvents("1.5"), /TELEMETRY_BATCH_MAX_EVENTS/);
    assert.throws(() => resolveTelemetryBatchMaxEvents("abc"), /TELEMETRY_BATCH_MAX_EVENTS/);
  });
});
