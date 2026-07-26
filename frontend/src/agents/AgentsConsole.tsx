import { useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import { parseUuidQueryParam } from "../routing/crossLinks";
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

  const agentParam = parseUuidQueryParam(searchParams.get("agentId"));

  useEffect(() => {
    if (!agentParam.ok) {
      selectAgent(null);
      return;
    }
    if (!agentParam.present) {
      selectAgent(null);
      return;
    }
    selectAgent(agentParam.id);
  }, [
    agentParam.ok,
    agentParam.present,
    agentParam.ok && agentParam.present ? agentParam.id : null,
    selectAgent,
  ]);

  function onSelect(id: string) {
    setSearchParams({ agentId: id }, { replace: true });
  }

  const focusBanner = !agentParam.ok
    ? "Invalid agent id in the URL — selection ignored."
    : agentParam.ok &&
        agentParam.present &&
        state.load === "ready" &&
        !selected
      ? "Agent from the URL was not found in this tenant inventory."
      : null;

  return (
    <div className="console">
      <header className="page-header">
        <h1>Agents</h1>
        <p className="muted">
          Inventory and heartbeat freshness. Not a device-management console —
          remote actions and enrollment UX are deferred.
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

      {selected ? (
        <p className="banner" role="status">
          Focused agent{" "}
          <span className="mono">{selected.name}</span>
        </p>
      ) : null}

      <div className="workspace">
        <AgentsList
          agents={state.agents}
          selectedId={selected?.id ?? null}
          onSelect={onSelect}
          disabled={busy}
        />
        <AgentDetail
          agent={selected}
          relatedFindings={state.relatedFindings}
          findingsPhase={state.findingsPhase}
          findingsError={state.findingsError}
          recentActivity={state.recentActivity}
          activityPhase={state.activityPhase}
          activityError={state.activityError}
        />
      </div>
    </div>
  );
}

export function AgentsConsole() {
  const { session } = useOutletContext<AgentsOutletContext>();
  return <AgentsConsoleView session={session} />;
}
