/**
 * Minimal Findings work queues derived from ownership + status.
 *
 * Queues are URL filter presets — not a separate queue subsystem.
 * Deferred: assign-to-others, balancing, SLA, notifications, live updates.
 */

import type { FindingsFilters, FindingsOwnerScope } from "./types";

export type FindingsQueueId = "mine" | "unowned_open";

export interface FindingsQueueDefinition {
  id: FindingsQueueId;
  label: string;
  /** Filters applied when the queue is selected. */
  filters: FindingsFilters;
  /** Mine requires operator identity on the session. */
  requiresOperatorIdentity: boolean;
}

export const FINDINGS_QUEUES: readonly FindingsQueueDefinition[] = [
  {
    id: "mine",
    label: "Mine",
    filters: { ownerScope: "me" },
    requiresOperatorIdentity: true,
  },
  {
    id: "unowned_open",
    label: "Unowned open",
    filters: { ownerScope: "none", status: "open" },
    requiresOperatorIdentity: false,
  },
] as const;

/**
 * Which built-in queue matches the current filters.
 * Mine matches any status under ownerScope=me.
 * Unowned open requires ownerScope=none and status=open.
 */
export function activeFindingsQueue(
  filters: FindingsFilters,
): FindingsQueueId | null {
  if (filters.ownerScope === "me") {
    return "mine";
  }
  if (filters.ownerScope === "none" && filters.status === "open") {
    return "unowned_open";
  }
  return null;
}

/**
 * Apply a queue preset while preserving agentId / ruleId.
 */
export function applyFindingsQueue(
  current: FindingsFilters,
  queueId: FindingsQueueId,
): FindingsFilters {
  const queue = FINDINGS_QUEUES.find((q) => q.id === queueId);
  if (!queue) {
    return current;
  }
  const next: FindingsFilters = { ...queue.filters };
  if (current.agentId) {
    next.agentId = current.agentId;
  }
  if (current.ruleId) {
    next.ruleId = current.ruleId;
  }
  return next;
}

/** Drop ownerScope (and status when it was the unowned-open pair). */
export function clearFindingsQueue(current: FindingsFilters): FindingsFilters {
  const wasUnownedOpen =
    current.ownerScope === "none" && current.status === "open";
  const next: FindingsFilters = {};
  if (current.status && !wasUnownedOpen) {
    next.status = current.status;
  }
  if (current.agentId) {
    next.agentId = current.agentId;
  }
  if (current.ruleId) {
    next.ruleId = current.ruleId;
  }
  return next;
}

export function isFindingsOwnerScope(
  value: unknown,
): value is FindingsOwnerScope {
  return value === "me" || value === "none";
}
