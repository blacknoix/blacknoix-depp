/**
 * Narrow operator jump/filter/lookup commands for the app shell.
 *
 * Explicit set + deterministic entity lookup — not a search platform.
 * Findings filter actions resolve via findingsPath(); lookups use concrete URLs.
 */

import type { OperatorSession } from "../auth/session";
import type { SharedFindingView } from "../api/findings";
import type { AgentInventoryItem } from "../agents/types";
import { freshnessLabel } from "../agents/types";
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
import { HEARTBEAT_FRESHNESS_VALUES } from "../routing/agentsUrlState";
import { agentsPath, findingsPath } from "../routing/crossLinks";
import {
  buildEntityLookupResults,
  type LookupEntity,
} from "./entityLookup";

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
    }
  | {
      id: string;
      kind: "lookup";
      entity: LookupEntity;
      label: string;
      keywords: readonly string[];
      to: string;
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

const QUEUE_COMMANDS: readonly OperatorCommand[] = [
  {
    id: "filter.queue.mine",
    kind: "findings-filter",
    label: "Findings · queue Mine",
    keywords: ["findings", "queue", "mine", "owner", "assigned"],
    filters: { ownerScope: "me" },
  },
  {
    id: "filter.queue.unowned_open",
    kind: "findings-filter",
    label: "Findings · queue Unowned open",
    keywords: ["findings", "queue", "unowned", "open", "unassigned"],
    filters: { ownerScope: "none", status: "open" },
  },
];

const AGENT_FRESHNESS_COMMANDS: readonly OperatorCommand[] =
  HEARTBEAT_FRESHNESS_VALUES.map((freshness) => ({
    id: `agents.freshness.${freshness}`,
    kind: "nav" as const,
    label: `Agents · ${freshnessLabel(freshness).toLowerCase()}`,
    keywords: ["agents", "freshness", "heartbeat", freshness],
    to: agentsPath({ freshness }),
  }));

const AGENT_OPEN_FINDINGS_COMMAND: OperatorCommand = {
  id: "agents.openFindings",
  kind: "nav",
  label: "Agents · with open findings",
  keywords: ["agents", "open", "findings", "inventory"],
  to: agentsPath({ hasOpenFindings: true }),
};

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
  agents?: readonly AgentInventoryItem[];
}): OperatorCommand[] {
  const local = loadSavedViews(opts.session, opts.storage ?? localStorage);
  return [
    ...NAV_COMMANDS,
    ...STATUS_COMMANDS,
    ...RULE_COMMANDS,
    ...QUEUE_COMMANDS,
    ...AGENT_FRESHNESS_COMMANDS,
    AGENT_OPEN_FINDINGS_COMMAND,
    ...sharedViewCommands(opts.sharedViews ?? []),
    ...localViewCommands(local),
  ];
}

/**
 * Merge entity lookup hits (ranked) ahead of static command substring matches.
 * Lookup requires a non-empty query; empty query keeps the static catalog.
 */
export function resolveJumpMatches(opts: {
  commands: readonly OperatorCommand[];
  query: string;
  agents?: readonly AgentInventoryItem[];
}): OperatorCommand[] {
  const lookups = buildEntityLookupResults(
    opts.query,
    opts.agents ?? [],
  ).map(
    (hit): OperatorCommand => ({
      id: hit.id,
      kind: "lookup",
      entity: hit.entity,
      label: hit.label,
      keywords: [hit.entity, hit.label],
      to: hit.to,
    }),
  );
  const staticMatches = filterOperatorCommands(opts.commands, opts.query);
  const lookupIds = new Set(lookups.map((c) => c.id));
  return [...lookups, ...staticMatches.filter((c) => !lookupIds.has(c.id))];
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

/** Resolve a command to a navigable path. */
export function commandTargetPath(command: OperatorCommand): string {
  if (command.kind === "nav" || command.kind === "lookup") {
    return command.to;
  }
  return findingsPath(command.filters);
}

export function commandKindLabel(command: OperatorCommand): string {
  switch (command.kind) {
    case "nav":
      return "Navigate";
    case "saved-view":
      return command.scope === "shared" ? "Shared view" : "Local view";
    case "lookup":
      return command.entity === "agent" ? "Agent" : "Finding";
    case "findings-filter":
      return "Filter";
  }
}
