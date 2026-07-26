/**
 * Local saved views for Findings filters.
 *
 * Persists only status / ruleId / agentId — never findingId selection.
 * Storage is browser-local and tenant-scoped (bearer uses a single bucket).
 * Tenant shared views live on the backend (`/v1/findings/views`) and coexist;
 * this module does not sync or migrate local views.
 * Cross-product views, folders, and favorites remain deferred.
 */

import type { OperatorSession } from "../auth/session";
import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type CorrelationRuleId,
  type FindingStatus,
  type FindingsFilters,
} from "./types";
import { filtersEqual } from "../routing/findingsUrlState";

export const SAVED_VIEWS_VERSION = 1 as const;
export const SAVED_VIEWS_MAX = 8;
export const SAVED_VIEW_NAME_MAX = 40;

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SavedFindingView {
  id: string;
  name: string;
  filters: FindingsFilters;
  createdAt: string;
}

export interface SavedViewsStore {
  version: typeof SAVED_VIEWS_VERSION;
  views: SavedFindingView[];
}

export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function savedViewsStorageKey(session: OperatorSession): string {
  if (session.kind === "tenant") {
    return `depp.findings.savedViews.v1.tenant.${session.tenantId}`;
  }
  // Bearer sessions lack a client-side tenant id today — single local bucket.
  return "depp.findings.savedViews.v1.bearer";
}

function isStatus(value: unknown): value is FindingStatus {
  return (
    typeof value === "string" &&
    (FINDING_STATUSES as readonly string[]).includes(value)
  );
}

function isRuleId(value: unknown): value is CorrelationRuleId {
  return (
    typeof value === "string" &&
    (CORRELATION_RULE_IDS as readonly string[]).includes(value)
  );
}

/** Normalize + validate filter payload; drops unknown / invalid fields. */
export function sanitizeSavedFilters(
  raw: unknown,
): FindingsFilters | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return null;
  }
  const record = raw as Record<string, unknown>;
  // Fail closed if obsolete keys that imply a different model show up.
  if ("findingId" in record) {
    return null;
  }

  const filters: FindingsFilters = {};

  if ("status" in record && record.status !== undefined) {
    if (!isStatus(record.status)) {
      return null;
    }
    filters.status = record.status;
  }
  if ("ruleId" in record && record.ruleId !== undefined) {
    if (!isRuleId(record.ruleId)) {
      return null;
    }
    filters.ruleId = record.ruleId;
  }
  if ("agentId" in record && record.agentId !== undefined) {
    if (typeof record.agentId !== "string" || !UUID.test(record.agentId)) {
      return null;
    }
    filters.agentId = record.agentId.trim().toLowerCase();
  }

  return filters;
}

function sanitizeView(raw: unknown): SavedFindingView | null {
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
  if (name.length === 0 || name.length > SAVED_VIEW_NAME_MAX) {
    return null;
  }
  if (typeof record.createdAt !== "string") {
    return null;
  }
  const created = new Date(record.createdAt);
  if (Number.isNaN(created.getTime())) {
    return null;
  }
  const filters = sanitizeSavedFilters(record.filters);
  if (!filters) {
    return null;
  }
  return {
    id: record.id.trim().toLowerCase(),
    name,
    filters,
    createdAt: created.toISOString(),
  };
}

export function parseSavedViewsStore(raw: string | null): SavedViewsStore {
  if (!raw) {
    return { version: SAVED_VIEWS_VERSION, views: [] };
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return { version: SAVED_VIEWS_VERSION, views: [] };
    }
    const record = parsed as Record<string, unknown>;
    if (record.version !== SAVED_VIEWS_VERSION) {
      return { version: SAVED_VIEWS_VERSION, views: [] };
    }
    if (!Array.isArray(record.views)) {
      return { version: SAVED_VIEWS_VERSION, views: [] };
    }
    const views: SavedFindingView[] = [];
    for (const item of record.views) {
      const view = sanitizeView(item);
      if (view) {
        views.push(view);
      }
      if (views.length >= SAVED_VIEWS_MAX) {
        break;
      }
    }
    return { version: SAVED_VIEWS_VERSION, views };
  } catch {
    return { version: SAVED_VIEWS_VERSION, views: [] };
  }
}

export function loadSavedViews(
  session: OperatorSession,
  storage: StorageLike = localStorage,
): SavedFindingView[] {
  try {
    return parseSavedViewsStore(
      storage.getItem(savedViewsStorageKey(session)),
    ).views;
  } catch {
    return [];
  }
}

export function persistSavedViews(
  session: OperatorSession,
  views: SavedFindingView[],
  storage: StorageLike = localStorage,
): { ok: true } | { ok: false; message: string } {
  const store: SavedViewsStore = {
    version: SAVED_VIEWS_VERSION,
    views: views.slice(0, SAVED_VIEWS_MAX),
  };
  try {
    storage.setItem(savedViewsStorageKey(session), JSON.stringify(store));
    return { ok: true };
  } catch {
    return { ok: false, message: "Could not persist saved views in this browser." };
  }
}

export function normalizeViewName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if (name.length === 0 || name.length > SAVED_VIEW_NAME_MAX) {
    return null;
  }
  return name;
}

export function createSavedView(input: {
  name: string;
  filters: FindingsFilters;
  now?: Date;
  id?: string;
}): SavedFindingView | null {
  const name = normalizeViewName(input.name);
  if (!name) {
    return null;
  }
  // Never persist selection — copy only known filter fields.
  const filters = sanitizeSavedFilters({
    ...(input.filters.status ? { status: input.filters.status } : {}),
    ...(input.filters.ruleId ? { ruleId: input.filters.ruleId } : {}),
    ...(input.filters.agentId ? { agentId: input.filters.agentId } : {}),
  });
  if (!filters) {
    return null;
  }
  const id =
    input.id ??
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `00000000-0000-4000-8000-${String(Date.now()).padStart(12, "0").slice(-12)}`);
  if (!UUID.test(id)) {
    return null;
  }
  return {
    id: id.toLowerCase(),
    name,
    filters,
    createdAt: (input.now ?? new Date()).toISOString(),
  };
}

export type SaveViewResult =
  | { ok: true; views: SavedFindingView[]; view: SavedFindingView }
  | { ok: false; message: string; views: SavedFindingView[] };

export function saveCurrentFilters(opts: {
  session: OperatorSession;
  name: string;
  filters: FindingsFilters;
  storage?: StorageLike;
  now?: Date;
}): SaveViewResult {
  const storage = opts.storage ?? localStorage;
  const current = loadSavedViews(opts.session, storage);
  const view = createSavedView({
    name: opts.name,
    filters: opts.filters,
    now: opts.now,
  });
  if (!view) {
    return {
      ok: false,
      message: `Name must be 1–${SAVED_VIEW_NAME_MAX} characters.`,
      views: current,
    };
  }
  if (current.some((v) => filtersEqual(v.filters, view.filters))) {
    return {
      ok: false,
      message: "A saved view with these filters already exists.",
      views: current,
    };
  }
  if (current.length >= SAVED_VIEWS_MAX) {
    return {
      ok: false,
      message: `At most ${SAVED_VIEWS_MAX} saved views are allowed.`,
      views: current,
    };
  }
  const views = [...current, view];
  const persisted = persistSavedViews(opts.session, views, storage);
  if (!persisted.ok) {
    return { ok: false, message: persisted.message, views: current };
  }
  return { ok: true, views, view };
}

export function deleteSavedView(opts: {
  session: OperatorSession;
  id: string;
  storage?: StorageLike;
}): { ok: true; views: SavedFindingView[] } | { ok: false; message: string; views: SavedFindingView[] } {
  const storage = opts.storage ?? localStorage;
  const current = loadSavedViews(opts.session, storage);
  const views = current.filter((v) => v.id !== opts.id);
  if (views.length === current.length) {
    return { ok: false, message: "Saved view not found.", views: current };
  }
  const persisted = persistSavedViews(opts.session, views, storage);
  if (!persisted.ok) {
    return { ok: false, message: persisted.message, views: current };
  }
  return { ok: true, views };
}

export function describeFilters(filters: FindingsFilters): string {
  const parts: string[] = [];
  if (filters.status) {
    parts.push(`status=${filters.status}`);
  }
  if (filters.ruleId) {
    parts.push(`rule=${filters.ruleId}`);
  }
  if (filters.agentId) {
    parts.push(`agent=${filters.agentId.slice(0, 8)}…`);
  }
  return parts.length > 0 ? parts.join(" · ") : "All findings";
}
