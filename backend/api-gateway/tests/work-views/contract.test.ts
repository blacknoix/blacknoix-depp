import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  canonicalizeWorkSections,
  parseCreateSharedWorkViewBody,
} from "../../src/work-views/contract";

describe("parseCreateSharedWorkViewBody", () => {
  it("accepts a valid section allowlist and canonicalizes order", () => {
    const parsed = parseCreateSharedWorkViewBody({
      name: " Intake ",
      definition: {
        sections: ["unowned_open", "mine", "unowned_open"],
      },
    });
    assert.equal(parsed.ok, true);
    if (!parsed.ok) {
      return;
    }
    assert.equal(parsed.input.name, "Intake");
    assert.deepEqual(parsed.input.definition.sections, [
      "mine",
      "unowned_open",
    ]);
  });

  it("rejects findingId, ownerScope, and empty/invalid sections", () => {
    assert.equal(
      parseCreateSharedWorkViewBody({
        name: "Bad",
        definition: { sections: ["mine"], findingId: "x" },
      }).ok,
      false,
    );
    assert.equal(
      parseCreateSharedWorkViewBody({
        name: "Bad",
        definition: { sections: ["mine"], ownerScope: "me" },
      }).ok,
      false,
    );
    assert.equal(
      parseCreateSharedWorkViewBody({
        name: "Bad",
        definition: { sections: [] },
      }).ok,
      false,
    );
    assert.equal(
      parseCreateSharedWorkViewBody({
        name: "Bad",
        definition: { sections: ["not_a_section"] },
      }).ok,
      false,
    );
  });

  it("rejects tenant id in body", () => {
    const parsed = parseCreateSharedWorkViewBody({
      name: "X",
      tenantId: "11111111-1111-4111-8111-111111111111",
      definition: { sections: ["mine"] },
    });
    assert.equal(parsed.ok, false);
  });
});

describe("canonicalizeWorkSections", () => {
  it("keeps fixed Work page order", () => {
    assert.deepEqual(
      canonicalizeWorkSections(["unowned_open", "action_needed", "mine"]),
      ["action_needed", "mine", "unowned_open"],
    );
  });
});
