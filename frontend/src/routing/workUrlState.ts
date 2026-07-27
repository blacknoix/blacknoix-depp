/**
 * URL-backed Work section visibility.
 *
 * /work?sections=mine,unowned_open
 * /work?sections=all
 *
 * Precedence for effective sections (see resolveWorkLandingSections):
 * 1. Explicit URL sections (including sections=all)
 * 2. Tenant default shared view (bare /work only — kind=unset)
 * 3. Product fallback = all sections
 *
 * Selection / findingId never ride this URL.
 */

import {
  WORK_QUEUE_SECTIONS,
  type WorkQueueSectionId,
} from "../work/workQueue";

export type WorkSectionsState =
  | {
      kind: "unset";
      /** Provisional product sections while tenant default may still apply. */
      sections: readonly WorkQueueSectionId[];
      invalidSections: false;
    }
  | {
      kind: "explicit";
      sections: readonly WorkQueueSectionId[];
      invalidSections: boolean;
    };

export type WorkLandingSource = "url" | "tenant_default" | "product";

const ALL_SECTION_IDS: readonly WorkQueueSectionId[] =
  WORK_QUEUE_SECTIONS.map((s) => s.id);

const SECTION_SET = new Set<string>(ALL_SECTION_IDS);

export function isWorkQueueSectionId(
  value: string,
): value is WorkQueueSectionId {
  return SECTION_SET.has(value);
}

export function canonicalizeWorkSections(
  sections: readonly WorkQueueSectionId[],
): WorkQueueSectionId[] {
  const set = new Set(sections);
  return ALL_SECTION_IDS.filter((id) => set.has(id));
}

export function parseWorkSearchParams(
  params: URLSearchParams,
): WorkSectionsState {
  if (!params.has("sections")) {
    return {
      kind: "unset",
      sections: ALL_SECTION_IDS,
      invalidSections: false,
    };
  }

  const raw = params.get("sections") ?? "";
  const trimmed = raw.trim();
  if (trimmed === "" || trimmed === "all") {
    return {
      kind: "explicit",
      sections: ALL_SECTION_IDS,
      invalidSections: trimmed === "",
    };
  }

  const tokens = trimmed
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0);

  const valid: WorkQueueSectionId[] = [];
  let sawInvalid = false;
  for (const token of tokens) {
    if (isWorkQueueSectionId(token)) {
      valid.push(token);
    } else {
      sawInvalid = true;
    }
  }

  const sections = canonicalizeWorkSections(valid);
  if (sections.length === 0) {
    return {
      kind: "explicit",
      sections: ALL_SECTION_IDS,
      invalidSections: true,
    };
  }

  return { kind: "explicit", sections, invalidSections: sawInvalid };
}

export function serializeWorkSearchParams(input: {
  sections: readonly WorkQueueSectionId[];
}): URLSearchParams {
  const params = new URLSearchParams();
  const sections = canonicalizeWorkSections(input.sections);
  const isAll =
    sections.length === ALL_SECTION_IDS.length &&
    ALL_SECTION_IDS.every((id, i) => sections[i] === id);
  // Always write sections so bare /work stays reserved for "unset"
  // (tenant-default eligible). Product all uses the compact sentinel.
  params.set("sections", isAll ? "all" : sections.join(","));
  return params;
}

export function workPath(opts?: {
  sections?: readonly WorkQueueSectionId[];
}): string {
  if (!opts?.sections) {
    return "/work";
  }
  const params = serializeWorkSearchParams({ sections: opts.sections });
  const qs = params.toString();
  return qs ? `/work?${qs}` : "/work";
}

export function sectionsEqual(
  a: readonly WorkQueueSectionId[],
  b: readonly WorkQueueSectionId[],
): boolean {
  const left = canonicalizeWorkSections(a);
  const right = canonicalizeWorkSections(b);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((id, i) => id === right[i]);
}

export function allWorkSections(): readonly WorkQueueSectionId[] {
  return ALL_SECTION_IDS;
}

export function toggleWorkSection(
  current: readonly WorkQueueSectionId[],
  id: WorkQueueSectionId,
): WorkQueueSectionId[] {
  const set = new Set(canonicalizeWorkSections(current));
  if (set.has(id)) {
    set.delete(id);
  } else {
    set.add(id);
  }
  const next = canonicalizeWorkSections([...set]);
  // Fail closed: never leave the page with zero sections.
  return next.length > 0 ? next : [...ALL_SECTION_IDS];
}

/**
 * Resolve landing sections for a Work URL against an optional tenant default.
 * Does not mutate URL — caller writes when source is tenant_default or product
 * on an unset URL.
 */
export function resolveWorkLandingSections(input: {
  url: WorkSectionsState;
  tenantDefault: {
    viewId: string;
    name: string;
    sections: readonly WorkQueueSectionId[];
  } | null;
}): {
  sections: WorkQueueSectionId[];
  source: WorkLandingSource;
  tenantDefaultName: string | null;
  shouldWriteUrl: boolean;
} {
  if (input.url.kind === "explicit") {
    return {
      sections: [...input.url.sections],
      source: "url",
      tenantDefaultName: null,
      shouldWriteUrl: false,
    };
  }

  if (input.tenantDefault && input.tenantDefault.sections.length > 0) {
    return {
      sections: canonicalizeWorkSections(input.tenantDefault.sections),
      source: "tenant_default",
      tenantDefaultName: input.tenantDefault.name,
      shouldWriteUrl: true,
    };
  }

  return {
    sections: [...ALL_SECTION_IDS],
    source: "product",
    tenantDefaultName: null,
    shouldWriteUrl: true,
  };
}
