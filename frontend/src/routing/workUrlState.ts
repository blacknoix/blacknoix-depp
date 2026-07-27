/**
 * URL-backed Work section visibility.
 *
 * /work?sections=action_needed,mine,unowned_open
 *
 * Missing / empty / fully-invalid → all default sections (fail closed to the
 * known Work home, not to an empty page).
 * Selection / findingId never ride this URL.
 */

import {
  WORK_QUEUE_SECTIONS,
  type WorkQueueSectionId,
} from "../work/workQueue";

export type WorkSectionsState = {
  sections: readonly WorkQueueSectionId[];
  /** True when the URL had a sections param that contributed zero valid ids. */
  invalidSections: boolean;
};

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
  const raw = params.get("sections");
  if (raw === null || raw.trim() === "") {
    return { sections: ALL_SECTION_IDS, invalidSections: false };
  }

  const tokens = raw
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
    return { sections: ALL_SECTION_IDS, invalidSections: true };
  }

  return { sections, invalidSections: sawInvalid };
}

export function serializeWorkSearchParams(input: {
  sections: readonly WorkQueueSectionId[];
}): URLSearchParams {
  const params = new URLSearchParams();
  const sections = canonicalizeWorkSections(input.sections);
  const isDefault =
    sections.length === ALL_SECTION_IDS.length &&
    ALL_SECTION_IDS.every((id, i) => sections[i] === id);
  if (!isDefault && sections.length > 0) {
    params.set("sections", sections.join(","));
  }
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
