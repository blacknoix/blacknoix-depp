/**
 * Narrow operator jump/filter commands for the app shell.
 *
 * Explicit set only — not a plugin registry or search platform.
 * Findings actions always resolve to URL paths via findingsPath().
 */

import type { OperatorSession } from "../auth/session";
import type { SharedFindingView } from "../api/findings";
import {
  loadSavedViews,
  sanitizeSavedFilters,
  type SavedFindingView,
  type StorageLike,
} from "../findings/savedViews";
import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type FindingsFilters,
} from "../findings/types";
import { findingsPath } from "../routing/crossLinks";

export type OperatorCommand =
  | {
      id: string;
      kind: "nav";
      label: string;
      keywords: readonly string[];
      to: string;
    }
  | {
      id: string;
      kind: "findings-filter";
      label: string;
      keywords: readonly string[];
      filters: FindingsFilters;
    }
  | {
      id: string;
      kind: "saved-view";
      label: string;
      keywords: readonly string[];
      filters: FindingsFilters;
      viewId: string;
      scope: "local" | "shared";
    };

const NAV_COMMANDS: readonly OperatorCommand[] = [
  {
    id: "nav.findings",
    kind: "nav",
    label: "Go to Findings",
    keywords: ["findings", "triage", "alerts"],
    to: "/findings",
  },
  {
    id: "nav.agents",
    kind: "nav",
    label: "Go to Agents",
    keywords: ["agents", "inventory", "heartbeat"],
    to: "/agents",
  },
] as const;

const STATUS_COMMANDS: readonly OperatorCommand[] = FINDING_STATUSES.map(
  (status) => ({
    id: `filter.status.${status}`,
    kind: "findings-filter" as const,
    label: `Findings · status ${status}`,
    keywords: ["findings", "status", status, "filter"],
    filters: { status },
  }),
);

const RULE_COMMANDS: readonly OperatorCommand[] = CORRELATION_RULE_IDS.map(
  (ruleId) => ({
    id: `filter.rule.${ruleId}`,
    kind: "findings-filter" as const,
    label: `Findings · rule ${ruleId}`,
    keywords: ["findings", "rule", ruleId, "filter"],
    filters: { ruleId },
  }),
);

function localViewCommands(
  views: readonly SavedFindingView[],
): OperatorCommand[] {
  return views.map((view) => ({
    id: `local.${view.id}`,
    kind: "saved-view" as const,
    label: `Local view · ${view.name}`,
    keywords: ["saved", "view", "local", view.name, "findings"],
    filters: view.filters,
    viewId: view.id,
    scope: "local" as const,
  }));
}

function sharedViewCommands(
  views: readonly SharedFindingView[],
): OperatorCommand[] {
  return views.flatMap((view) => {
    const filters = sanitizeSavedFilters(view.filters);
    if (!filters) {
      return [];
    }
    return [
      {
        id: `shared.${view.id}`,
        kind: "saved-view" as const,
        label: `Shared view · ${view.name}`,
        keywords: ["saved", "view", "shared", "tenant", view.name, "findings"],
        filters,
        viewId: view.id,
        scope: "shared" as const,
      },
    ];
  });
}

export function buildOperatorCommands(opts: {
  session: OperatorSession;
  storage?: StorageLike;
  sharedViews?: readonly SharedFindingView[];
}): OperatorCommand[] {
  const local = loadSavedViews(opts.session, opts.storage ?? localStorage);
  return [
    ...NAV_COMMANDS,
    ...STATUS_COMMANDS,
    ...RULE_COMMANDS,
    ...sharedViewCommands(opts.sharedViews ?? []),
    ...localViewCommands(local),
  ];
}

/** Case-insensitive substring match over label + keywords. Not fuzzy search. */
export function filterOperatorCommands(
  commands: readonly OperatorCommand[],
  query: string,
): OperatorCommand[] {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    return [...commands];
  }
  return commands.filter((command) => {
    if (command.label.toLowerCase().includes(q)) {
      return true;
    }
    return command.keywords.some((kw) => kw.toLowerCase().includes(q));
  });
}

/** Resolve a command to a navigable path. Findings actions never carry findingId. */
export function commandTargetPath(command: OperatorCommand): string {
  if (command.kind === "nav") {
    return command.to;
  }
  return findingsPath(command.filters);
}
