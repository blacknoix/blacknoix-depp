/**
 * Work queue page — composition of existing Findings / Attention semantics.
 *
 * Not an inbox, analytics dashboard, SLA board, or case-management product.
 * Deferred: live updates, Findings-list multi-select, charts, queue balancing,
 * generic mass-edit.
 */

import type { AttentionItem } from "../api/findings";
import type { Finding } from "../findings/types";
import { findingsPath } from "../routing/crossLinks";
import { attentionItemPath } from "../shell/attentionLinks";

/** Soft cap per section so the page stays scannable. */
export const WORK_QUEUE_SECTION_LIMIT = 8;

export type WorkQueueSectionId =
  | "action_needed"
  | "reminders_due"
  | "mine"
  | "unowned_open";

export interface WorkQueueSectionDef {
  id: WorkQueueSectionId;
  title: string;
  description: string;
  /** Owner-aware sections fail closed without operator identity. */
  requiresOperatorIdentity: boolean;
  /** Findings list filter for “View all”. */
  queuePath: string;
}

/**
 * Fixed priority order: escalated follow-ups first, then soft due,
 * then owned queue, then unowned intake.
 */
export const WORK_QUEUE_SECTIONS: readonly WorkQueueSectionDef[] = [
  {
    id: "action_needed",
    title: "Action needed",
    description:
      "Overdue explicit reminders and long-quiet owned findings (Attention escalation).",
    requiresOperatorIdentity: true,
    queuePath: findingsPath({ ownerScope: "me" }),
  },
  {
    id: "reminders_due",
    title: "Reminders due",
    description: "Explicit revisit reminders that are due but not yet overdue.",
    requiresOperatorIdentity: true,
    queuePath: findingsPath({ ownerScope: "me" }),
  },
  {
    id: "mine",
    title: "Mine",
    description: "Findings currently assigned to you.",
    requiresOperatorIdentity: true,
    queuePath: findingsPath({ ownerScope: "me" }),
  },
  {
    id: "unowned_open",
    title: "Unowned open",
    description: "Open findings with no owner — intake for claiming.",
    requiresOperatorIdentity: false,
    queuePath: findingsPath({ ownerScope: "none", status: "open" }),
  },
] as const;

export function capWorkQueueItems<T>(items: T[]): {
  items: T[];
  truncated: boolean;
} {
  return {
    items: items.slice(0, WORK_QUEUE_SECTION_LIMIT),
    truncated: items.length > WORK_QUEUE_SECTION_LIMIT,
  };
}

export function findingWorkQueuePath(finding: Finding): string {
  if (finding.ownerUserId) {
    return findingsPath({
      ownerScope: "me",
      findingId: finding.id,
    });
  }
  return findingsPath({
    ownerScope: "none",
    status: "open",
    findingId: finding.id,
  });
}

export function attentionWorkQueuePath(item: AttentionItem): string | null {
  return attentionItemPath(item);
}
