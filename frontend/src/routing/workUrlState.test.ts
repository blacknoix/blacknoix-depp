import { describe, expect, it } from "vitest";

import {
  allWorkSections,
  parseWorkSearchParams,
  resolveWorkLandingSections,
  serializeWorkSearchParams,
  toggleWorkSection,
  workPath,
} from "./workUrlState";

describe("workUrlState", () => {
  it("marks missing sections as unset (tenant-default eligible)", () => {
    const state = parseWorkSearchParams(new URLSearchParams());
    expect(state.kind).toBe("unset");
    expect(state.sections).toEqual([...allWorkSections()]);
    expect(state.invalidSections).toBe(false);
  });

  it("treats sections=all as an explicit product-all URL", () => {
    const state = parseWorkSearchParams(new URLSearchParams("sections=all"));
    expect(state.kind).toBe("explicit");
    expect(state.sections).toEqual([...allWorkSections()]);
    expect(state.invalidSections).toBe(false);
    expect(
      serializeWorkSearchParams({ sections: state.sections }).get("sections"),
    ).toBe("all");
  });

  it("parses and canonicalizes a section allowlist", () => {
    const state = parseWorkSearchParams(
      new URLSearchParams("sections=unowned_open,mine,unowned_open"),
    );
    expect(state.kind).toBe("explicit");
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
    expect(state.kind).toBe("explicit");
    expect(state.sections).toEqual([...allWorkSections()]);
    expect(state.invalidSections).toBe(true);
  });

  it("never toggles down to an empty section set", () => {
    expect(toggleWorkSection(["mine"], "mine")).toEqual([
      ...allWorkSections(),
    ]);
  });

  it("keeps bare workPath for unset landing (tenant default eligible)", () => {
    expect(workPath()).toBe("/work");
  });
});

describe("resolveWorkLandingSections precedence", () => {
  const tenantDefault = {
    viewId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    name: "Intake",
    sections: ["unowned_open"] as const,
  };

  it("explicit URL wins over tenant default", () => {
    const resolved = resolveWorkLandingSections({
      url: parseWorkSearchParams(
        new URLSearchParams("sections=mine,action_needed"),
      ),
      tenantDefault,
    });
    expect(resolved.source).toBe("url");
    expect(resolved.sections).toEqual(["action_needed", "mine"]);
    expect(resolved.shouldWriteUrl).toBe(false);
    expect(resolved.tenantDefaultName).toBeNull();
  });

  it("explicit sections=all wins over tenant default", () => {
    const resolved = resolveWorkLandingSections({
      url: parseWorkSearchParams(new URLSearchParams("sections=all")),
      tenantDefault,
    });
    expect(resolved.source).toBe("url");
    expect(resolved.sections).toEqual([...allWorkSections()]);
    expect(resolved.shouldWriteUrl).toBe(false);
  });

  it("applies tenant default on unset URL", () => {
    const resolved = resolveWorkLandingSections({
      url: parseWorkSearchParams(new URLSearchParams()),
      tenantDefault,
    });
    expect(resolved.source).toBe("tenant_default");
    expect(resolved.sections).toEqual(["unowned_open"]);
    expect(resolved.shouldWriteUrl).toBe(true);
    expect(resolved.tenantDefaultName).toBe("Intake");
  });

  it("falls back to product all when unset and default missing/invalid", () => {
    const missing = resolveWorkLandingSections({
      url: parseWorkSearchParams(new URLSearchParams()),
      tenantDefault: null,
    });
    expect(missing.source).toBe("product");
    expect(missing.sections).toEqual([...allWorkSections()]);
    expect(missing.shouldWriteUrl).toBe(true);

    const emptySections = resolveWorkLandingSections({
      url: parseWorkSearchParams(new URLSearchParams()),
      tenantDefault: {
        viewId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        name: "Broken",
        sections: [],
      },
    });
    expect(emptySections.source).toBe("product");
    expect(emptySections.sections).toEqual([...allWorkSections()]);
  });
});
