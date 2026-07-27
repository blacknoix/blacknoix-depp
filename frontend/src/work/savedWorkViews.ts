/**
 * Local saved Work views (section allowlists).
 *
 * Persists sections only — never findingId / bulk selection / Attention cursor.
 * ownerScope is intentionally excluded (Work uses section ids for owner-relative
 * queues). Tenant shared views live on `/v1/work/views` and coexist.
 */

import {
  sessionHasOperatorIdentity,
  type OperatorSession,
} from "../auth/session";
import {
  allWorkSections,
  canonicalizeWorkSections,
  isWorkQueueSectionId,
} from "../routing/workUrlState";
import type { WorkQueueSectionId } from "./workQueue";

export const WORK_SAVED_VIEWS_VERSION = 1 as const;
export const WORK_SAVED_VIEWS_MAX = 8;
export const WORK_SAVED_VIEW_NAME_MAX = 40;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface WorkViewDefinition {
  sections: WorkQueueSectionId[];
}

export interface SavedWorkView {
  id: string;
  name: string;
  definition: WorkViewDefinition;
  createdAt: string;
}

export interface SavedWorkViewsStore {
  version: typeof WORK_SAVED_VIEWS_VERSION;
  views: SavedWorkView[];
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Sections that require operator identity to be useful. */
export const IDENTITY_REQUIRED_WORK_SECTIONS: readonly WorkQueueSectionId[] = [
  "action_needed",
  "reminders_due",
  "mine",
];

export function workSavedViewsStorageKey(session: OperatorSession): string {
  if (session.kind === "tenant") {
    return `depp.work.savedViews.v1.tenant.${session.tenantId}`;
  }
  return "depp.work.savedViews.v1.bearer";
}

export function sanitizeWorkViewDefinition(
  raw: unknown,
): WorkViewDefinition | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if ("findingId" in record || "ownerScope" in record || "ownerUserId" in record) {
    return null;
  }
  if (!("sections" in record) || !Array.isArray(record.sections)) {
    return null;
  }
  if (record.sections.length === 0) {
    return null;
  }

  const parsed: WorkQueueSectionId[] = [];
  for (const entry of record.sections) {
    if (typeof entry !== "string" || !isWorkQueueSectionId(entry)) {
      return null;
    }
    parsed.push(entry);
  }
  const sections = canonicalizeWorkSections(parsed);
  if (sections.length === 0) {
    return null;
  }
  return { sections };
}

function sanitizeView(raw: unknown): SavedWorkView | null {
  if (typeof raw !== "object" || raw === null) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  if (typeof record.id !== "string" || !UUID.test(record.id)) {
    return null;
  }
  if (typeof record.name !== "string") {
    return null;
  }
  const name = record.name.trim();
  if (name.length === 0 || name.length > WORK_SAVED_VIEW_NAME_MAX) {
    return null;
  }
  const definition = sanitizeWorkViewDefinition(record.definition);
  if (!definition) {
    return null;
  }
  if (typeof record.createdAt !== "string") {
    return null;
  }
  const created = new Date(record.createdAt);
  if (Number.isNaN(created.getTime())) {
    return null;
  }
  return {
    id: record.id.trim().toLowerCase(),
    name,
    definition,
    createdAt: created.toISOString(),
  };
}

function readStore(
  session: OperatorSession,
  storage: StorageLike,
): SavedWorkViewsStore {
  try {
    const raw = storage.getItem(workSavedViewsStorageKey(session));
    if (!raw) {
      return { version: WORK_SAVED_VIEWS_VERSION, views: [] };
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { version: WORK_SAVED_VIEWS_VERSION, views: [] };
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== WORK_SAVED_VIEWS_VERSION) {
      return { version: WORK_SAVED_VIEWS_VERSION, views: [] };
    }
    if (!Array.isArray(record.views)) {
      return { version: WORK_SAVED_VIEWS_VERSION, views: [] };
    }
    const views: SavedWorkView[] = [];
    for (const entry of record.views) {
      const view = sanitizeView(entry);
      if (view) {
        views.push(view);
      }
    }
    return { version: WORK_SAVED_VIEWS_VERSION, views };
  } catch {
    return { version: WORK_SAVED_VIEWS_VERSION, views: [] };
  }
}

function writeStore(
  session: OperatorSession,
  storage: StorageLike,
  store: SavedWorkViewsStore,
): void {
  storage.setItem(workSavedViewsStorageKey(session), JSON.stringify(store));
}

export function loadSavedWorkViews(
  session: OperatorSession,
  storage: StorageLike = localStorage,
): SavedWorkView[] {
  return readStore(session, storage).views;
}

export function describeWorkSections(
  sections: readonly WorkQueueSectionId[],
): string {
  const labels: Record<WorkQueueSectionId, string> = {
    action_needed: "Action needed",
    reminders_due: "Reminders due",
    mine: "Mine",
    unowned_open: "Unowned open",
  };
  const ordered = canonicalizeWorkSections(sections);
  if (ordered.length === allWorkSections().length) {
    return "All sections";
  }
  return ordered.map((id) => labels[id]).join(" · ");
}

export function validateWorkDefinitionForApply(
  session: OperatorSession,
  definition: WorkViewDefinition,
): { ok: true } | { ok: false; message: string } {
  const hasIdentity = sessionHasOperatorIdentity(session);
  const identityOnly = definition.sections.every((id) =>
    (IDENTITY_REQUIRED_WORK_SECTIONS as readonly string[]).includes(id),
  );
  if (identityOnly && !hasIdentity) {
    return {
      ok: false,
      message:
        "This Work view only includes identity-dependent sections (Action needed, Reminders due, or Mine). Connect with an operator user UUID or JWT before applying it.",
    };
  }
  return { ok: true };
}

export function saveCurrentWorkView(input: {
  session: OperatorSession;
  name: string;
  definition: WorkViewDefinition;
  storage?: StorageLike;
  now?: Date;
}):
  | { ok: true; view: SavedWorkView; views: SavedWorkView[] }
  | { ok: false; message: string; views: SavedWorkView[] } {
  const storage = input.storage ?? localStorage;
  const store = readStore(input.session, storage);
  const name = input.name.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > WORK_SAVED_VIEW_NAME_MAX) {
    return {
      ok: false,
      message: `Name must be 1–${WORK_SAVED_VIEW_NAME_MAX} characters.`,
      views: store.views,
    };
  }
  const definition = sanitizeWorkViewDefinition(input.definition);
  if (!definition) {
    return {
      ok: false,
      message: "Work view sections are invalid.",
      views: store.views,
    };
  }
  if (store.views.length >= WORK_SAVED_VIEWS_MAX) {
    return {
      ok: false,
      message: `At most ${WORK_SAVED_VIEWS_MAX} local Work views are kept.`,
      views: store.views,
    };
  }
  if (
    store.views.some((v) => v.name.toLowerCase() === name.toLowerCase())
  ) {
    return {
      ok: false,
      message: "A local Work view with this name already exists.",
      views: store.views,
    };
  }

  const view: SavedWorkView = {
    id: crypto.randomUUID(),
    name,
    definition,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
  const views = [view, ...store.views];
  writeStore(input.session, storage, {
    version: WORK_SAVED_VIEWS_VERSION,
    views,
  });
  return { ok: true, view, views };
}

export function deleteSavedWorkView(input: {
  session: OperatorSession;
  id: string;
  storage?: StorageLike;
}):
  | { ok: true; views: SavedWorkView[] }
  | { ok: false; message: string; views: SavedWorkView[] } {
  const storage = input.storage ?? localStorage;
  const store = readStore(input.session, storage);
  const id = input.id.trim().toLowerCase();
  if (!store.views.some((v) => v.id === id)) {
    return {
      ok: false,
      message: "Local Work view not found.",
      views: store.views,
    };
  }
  const views = store.views.filter((v) => v.id !== id);
  writeStore(input.session, storage, {
    version: WORK_SAVED_VIEWS_VERSION,
    views,
  });
  return { ok: true, views };
}
