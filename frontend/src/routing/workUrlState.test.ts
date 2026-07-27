import { describe, expect, it } from "vitest";

import {
  allWorkSections,
  parseWorkSearchParams,
  serializeWorkSearchParams,
  toggleWorkSection,
  workPath,
} from "./workUrlState";

describe("workUrlState", () => {
  it("defaults to all sections when sections is missing", () => {
    const state = parseWorkSearchParams(new URLSearchParams());
    expect(state.sections).toEqual([...allWorkSections()]);
    expect(state.invalidSections).toBe(false);
  });

  it("parses and canonicalizes a section allowlist", () => {
    const state = parseWorkSearchParams(
      new URLSearchParams("sections=unowned_open,mine,unowned_open"),
    );
    expect(state.sections).toEqual(["mine", "unowned_open"]);
    expect(
      serializeWorkSearchParams({ sections: state.sections }).get("sections"),
    ).toBe("mine,unowned_open");
    expect(workPath({ sections: state.sections })).toBe(
      "/work?sections=mine%2Cunowned_open",
    );
  });

  it("fails closed to the default home when all tokens are invalid", () => {
    const state = parseWorkSearchParams(
      new URLSearchParams("sections=nope,also-bad"),
    );
    expect(state.sections).toEqual([...allWorkSections()]);
    expect(state.invalidSections).toBe(true);
  });

  it("never toggles down to an empty section set", () => {
    expect(toggleWorkSection(["mine"], "mine")).toEqual([
      ...allWorkSections(),
    ]);
  });
});
