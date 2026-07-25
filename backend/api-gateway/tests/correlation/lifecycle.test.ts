import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assertFindingTransition } from "../../src/correlation/lifecycle";

describe("assertFindingTransition", () => {
  it("allows the documented edges", () => {
    assert.deepEqual(assertFindingTransition("open", "acknowledged"), {
      ok: true,
      kind: "transition",
    });
    assert.deepEqual(assertFindingTransition("open", "resolved"), {
      ok: true,
      kind: "transition",
    });
    assert.deepEqual(assertFindingTransition("acknowledged", "resolved"), {
      ok: true,
      kind: "transition",
    });
    assert.deepEqual(assertFindingTransition("acknowledged", "open"), {
      ok: true,
      kind: "transition",
    });
    assert.deepEqual(assertFindingTransition("resolved", "open"), {
      ok: true,
      kind: "transition",
    });
  });

  it("treats same-status as an idempotent noop", () => {
    for (const status of ["open", "acknowledged", "resolved"] as const) {
      assert.deepEqual(assertFindingTransition(status, status), {
        ok: true,
        kind: "noop",
      });
    }
  });

  it("rejects forbidden transitions", () => {
    const result = assertFindingTransition("resolved", "acknowledged");
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.match(result.message, /not allowed/);
  });
});
