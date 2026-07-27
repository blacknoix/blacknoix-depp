/**
 * Create-body contract for POST /v1/work/views.
 *
 * Work views store a non-empty section allowlist only.
 * findingId / ownerScope / ownerUserId / selection are rejected.
 * ownerScope is intentionally excluded: Mine / Action needed / Reminders due
 * are the owner-relative Work sections; Unowned open is intake.
 */

export const WORK_SHARED_VIEW_NAME_MAX = 40;
export const WORK_SHARED_VIEWS_MAX_PER_TENANT = 32;

export const WORK_VIEW_SECTION_IDS = [
  "action_needed",
  "reminders_due",
  "mine",
  "unowned_open",
] as const;

export type WorkViewSectionId = (typeof WORK_VIEW_SECTION_IDS)[number];

export interface SharedWorkViewDefinition {
  sections: WorkViewSectionId[];
}

export interface CreateSharedWorkViewInput {
  name: string;
  definition: SharedWorkViewDefinition;
}

export type ParseCreateSharedWorkViewResult =
  | { ok: true; input: CreateSharedWorkViewInput }
  | { ok: false; message: string };

export function isWorkViewSectionId(value: string): value is WorkViewSectionId {
  return (WORK_VIEW_SECTION_IDS as readonly string[]).includes(value);
}

/** Canonical display/order for a section set (fixed Work page order). */
export function canonicalizeWorkSections(
  sections: readonly WorkViewSectionId[],
): WorkViewSectionId[] {
  const set = new Set(sections);
  return WORK_VIEW_SECTION_IDS.filter((id) => set.has(id));
}

function normalizeName(raw: unknown): string | null {
  if (typeof raw !== "string") {
    return null;
  }
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > WORK_SHARED_VIEW_NAME_MAX) {
    return null;
  }
  return name;
}

/**
 * Parses POST body: `{ name, definition: { sections: string[] } }`.
 * Also accepts `{ name, sections }` as a shorthand — rejected if both diverge.
 */
export function parseCreateSharedWorkViewBody(
  body: unknown,
): ParseCreateSharedWorkViewResult {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, message: "body must be a JSON object" };
  }
  const record = body as Record<string, unknown>;

  for (const key of Object.keys(record)) {
    if (key === "tenantId" || key === "tenant_id" || key === "tid") {
      return {
        ok: false,
        message: "tenant identity must not be supplied in the body",
      };
    }
  }

  const name = normalizeName(record.name);
  if (!name) {
    return {
      ok: false,
      message: `name must be 1–${WORK_SHARED_VIEW_NAME_MAX} characters`,
    };
  }

  let sectionsRaw: unknown;
  if ("definition" in record) {
    if (
      typeof record.definition !== "object" ||
      record.definition === null ||
      Array.isArray(record.definition)
    ) {
      return { ok: false, message: "definition must be an object" };
    }
    const definition = record.definition as Record<string, unknown>;
    if ("findingId" in definition) {
      return {
        ok: false,
        message: "findingId must not be stored on a Work view",
      };
    }
    if ("ownerScope" in definition || "ownerUserId" in definition) {
      return {
        ok: false,
        message:
          "ownerScope/ownerUserId must not be stored on a Work view; use sections",
      };
    }
    sectionsRaw = definition.sections;
  } else if ("sections" in record) {
    sectionsRaw = record.sections;
  } else {
    return { ok: false, message: "definition.sections is required" };
  }

  if (!Array.isArray(sectionsRaw) || sectionsRaw.length === 0) {
    return {
      ok: false,
      message: "sections must be a non-empty array of Work section ids",
    };
  }

  const parsed: WorkViewSectionId[] = [];
  for (const entry of sectionsRaw) {
    if (typeof entry !== "string" || !isWorkViewSectionId(entry)) {
      return {
        ok: false,
        message:
          "sections must only contain action_needed, reminders_due, mine, or unowned_open",
      };
    }
    parsed.push(entry);
  }

  const sections = canonicalizeWorkSections(parsed);
  if (sections.length === 0) {
    return { ok: false, message: "sections must include at least one section" };
  }

  return {
    ok: true,
    input: { name, definition: { sections } },
  };
}
