import { useEffect, useMemo } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import {
  parseAgentsSearchParams,
  serializeAgentsSearchParams,
  type AgentsFilters,
} from "../routing/agentsUrlState";
import {
  agentMatchesFilters,
  filterAgents,
  sortAgentsForInvestigation,
} from "./agentWorkflow";
import { AgentDetail } from "./AgentDetail";
import { AgentsList } from "./AgentsList";
import { useAgentsConsole } from "./useAgentsConsole";

export interface AgentsOutletContext {
  session: OperatorSession;
}

interface ViewProps {
  session: OperatorSession;
}

export function AgentsConsoleView({ session }: ViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const { state, selected, selectAgent } = useAgentsConsole(session);
  const busy = state.load === "loading";

  const urlState = useMemo(
    () => parseAgentsSearchParams(searchParams),
    [searchParams],
  );

  const visibleAgents = useMemo(
    () =>
      sortAgentsForInvestigation(
        filterAgents(state.agents, urlState.filters),
      ),
    [state.agents, urlState.filters],
  );

  useEffect(() => {
    if (!urlState.agentId) {
      selectAgent(null);
      return;
    }
    selectAgent(urlState.agentId);
  }, [urlState.agentId, selectAgent]);

  function writeUrl(next: {
    filters: AgentsFilters;
    agentId?: string | null;
  }) {
    const params = serializeAgentsSearchParams({
      filters: next.filters,
      agentId: next.agentId ?? null,
    });
    setSearchParams(params, { replace: true });
  }

  function onSelect(id: string) {
    writeUrl({ filters: urlState.filters, agentId: id });
  }

  function onFiltersChange(filters: AgentsFilters) {
    const keepSelection =
      urlState.agentId &&
      state.agents.some(
        (agent) =>
          agent.id === urlState.agentId &&
          agentMatchesFilters(agent, filters),
      )
        ? urlState.agentId
        : null;
    writeUrl({ filters, agentId: keepSelection });
  }

  function onClearFocus() {
    writeUrl({ filters: urlState.filters, agentId: null });
  }

  const invalidParts: string[] = [];
  if (urlState.invalid.agentId) {
    invalidParts.push("agent id");
  }
  if (urlState.invalid.freshness) {
    invalidParts.push("freshness");
  }
  if (urlState.invalid.hasOpenFindings) {
    invalidParts.push("hasOpenFindings");
  }

  const focusBanner =
    invalidParts.length > 0
      ? `Invalid ${invalidParts.join(", ")} in the URL — ignored.`
      : urlState.agentId &&
          state.load === "ready" &&
          !state.agents.some((a) => a.id === urlState.agentId)
        ? "Agent from the URL was not found in this tenant inventory."
        : urlState.agentId &&
            state.load === "ready" &&
            selected &&
            !agentMatchesFilters(selected, urlState.filters)
          ? "Focused agent is hidden by the current filters — clear filters or clear focus."
          : null;

  // Keep detail visible even when filters hide the list row, so operators can
  // clear focus / open Findings without losing context.
  const showDetail = selected;

  return (
    <div className="console">
      <header className="page-header">
        <h1>Agents</h1>
        <p className="muted">
          Inventory, heartbeat freshness, and agent-centric investigation. Not a
          device-management console — remote actions and enrollment UX are
          deferred.
        </p>
      </header>

      {state.load === "loading" && state.agents.length === 0 ? (
        <p className="banner" role="status">
          Loading agents…
        </p>
      ) : null}

      {state.load === "error" ? (
        <p className="banner error" role="alert">
          {state.loadError ?? "Failed to load agents"}
        </p>
      ) : null}

      {focusBanner ? (
        <p className="banner error" role="alert">
          {focusBanner}
        </p>
      ) : null}

      {showDetail ? (
        <p className="banner" role="status">
          Focused agent{" "}
          <span className="mono">{showDetail.name}</span>
          {showDetail.openFindingsCount > 0
            ? ` · ${showDetail.openFindingsCount} open finding${showDetail.openFindingsCount === 1 ? "" : "s"}`
            : ""}
        </p>
      ) : null}

      <div className="workspace">
        <AgentsList
          agents={visibleAgents}
          totalCount={state.agents.length}
          filters={urlState.filters}
          selectedId={
            showDetail && agentMatchesFilters(showDetail, urlState.filters)
              ? showDetail.id
              : null
          }
          onSelect={onSelect}
          onFiltersChange={onFiltersChange}
          disabled={busy}
        />
        <AgentDetail
          agent={showDetail}
          relatedFindings={state.relatedFindings}
          findingsPhase={state.findingsPhase}
          findingsError={state.findingsError}
          recentActivity={state.recentActivity}
          activityPhase={state.activityPhase}
          activityError={state.activityError}
          onClearFocus={showDetail ? onClearFocus : undefined}
        />
      </div>
    </div>
  );
}

export function AgentsConsole() {
  const { session } = useOutletContext<AgentsOutletContext>();
  return <AgentsConsoleView session={session} />;
}
