/**
 * Bounded investigation timeline — recent context around an agent or finding.
 *
 * Composes finding lifecycle markers + telemetry already available to the
 * operator console. Not a search index, event browser, or audit log.
 */

import { findingsPath } from "../routing/crossLinks";
import type { AgentActivityEvent } from "../agents/types";
import type { Finding } from "../findings/types";

/** Explicit wall-clock window shared by Agents and Findings detail. */
export const INVESTIGATION_TIMELINE_HOURS = 24;

/** Hard cap after merge (newest first). */
export const INVESTIGATION_TIMELINE_MAX_ITEMS = 25;

export type TimelineItemKind =
  | "finding.created"
  | "finding.status_changed"
  | "telemetry.event";

export interface TimelineItem {
  id: string;
  kind: TimelineItemKind;
  at: string;
  title: string;
  subtitle: string;
  /** Navigate into Findings when the item is finding-backed; null for telemetry. */
  href: string | null;
}

export interface ComposeTimelineInput {
  /** Inclusive window start (ISO). Prefer the same `since` sent to telemetry. */
  since: string;
  findings: Finding[];
  /** False when the findings source failed — items omitted, not treated as empty. */
  findingsAvailable: boolean;
  telemetryEvents: AgentActivityEvent[];
  /** False when telemetry failed — items omitted, not treated as empty. */
  telemetryAvailable: boolean;
  maxItems?: number;
}

export interface ComposeTimelineResult {
  items: TimelineItem[];
  truncated: boolean;
  since: string;
  windowHours: number;
}

const KIND_TIEBREAK: Record<TimelineItemKind, number> = {
  "finding.status_changed": 0,
  "finding.created": 1,
  "telemetry.event": 2,
};

export function timelineKindLabel(kind: TimelineItemKind): string {
  switch (kind) {
    case "finding.created":
      return "Finding created";
    case "finding.status_changed":
      return "Status changed";
    case "telemetry.event":
      return "Telemetry";
  }
}

/**
 * Builds a newest-first timeline from available sources.
 * Same finding may contribute both created and status-changed (honest dual events).
 * Does not invent intermediate status history — only latest statusChangedAt.
 */
export function composeInvestigationTimeline(
  input: ComposeTimelineInput,
): ComposeTimelineResult {
  const maxItems = input.maxItems ?? INVESTIGATION_TIMELINE_MAX_ITEMS;
  const sinceMs = Date.parse(input.since);
  if (Number.isNaN(sinceMs)) {
    return {
      items: [],
      truncated: false,
      since: input.since,
      windowHours: INVESTIGATION_TIMELINE_HOURS,
    };
  }

  const items: TimelineItem[] = [];

  if (input.findingsAvailable) {
    for (const finding of input.findings) {
      const createdMs = Date.parse(finding.createdAt);
      if (!Number.isNaN(createdMs) && createdMs >= sinceMs) {
        items.push({
          id: `finding.created:${finding.id}:${finding.createdAt}`,
          kind: "finding.created",
          at: finding.createdAt,
          title: finding.title,
          subtitle: `${timelineKindLabel("finding.created")} · ${finding.ruleId}`,
          href: findingsPath({
            agentId: finding.agentId,
            status: finding.status,
            findingId: finding.id,
          }),
        });
      }

      if (finding.statusChangedAt) {
        const changedMs = Date.parse(finding.statusChangedAt);
        if (!Number.isNaN(changedMs) && changedMs >= sinceMs) {
          items.push({
            id: `finding.status_changed:${finding.id}:${finding.statusChangedAt}`,
            kind: "finding.status_changed",
            at: finding.statusChangedAt,
            title: finding.title,
            subtitle: `Status → ${finding.status} · ${finding.ruleId}`,
            href: findingsPath({
              agentId: finding.agentId,
              status: finding.status,
              findingId: finding.id,
            }),
          });
        }
      }
    }
  }

  if (input.telemetryAvailable) {
    for (const event of input.telemetryEvents) {
      const atMs = Date.parse(event.occurredAt);
      if (Number.isNaN(atMs) || atMs < sinceMs) {
        continue;
      }
      items.push({
        id: `telemetry.event:${event.id}`,
        kind: "telemetry.event",
        at: event.occurredAt,
        title: event.eventType,
        subtitle: timelineKindLabel("telemetry.event"),
        href: null,
      });
    }
  }

  items.sort((a, b) => {
    const byTime = Date.parse(b.at) - Date.parse(a.at);
    if (byTime !== 0) {
      return byTime;
    }
    const byKind = KIND_TIEBREAK[a.kind] - KIND_TIEBREAK[b.kind];
    if (byKind !== 0) {
      return byKind;
    }
    return a.id.localeCompare(b.id);
  });

  const truncated = items.length > maxItems;
  return {
    items: items.slice(0, maxItems),
    truncated,
    since: input.since,
    windowHours: INVESTIGATION_TIMELINE_HOURS,
  };
}

export function timelineSinceIso(
  now: Date = new Date(),
  windowHours: number = INVESTIGATION_TIMELINE_HOURS,
): string {
  return new Date(now.getTime() - windowHours * 60 * 60 * 1000).toISOString();
}
