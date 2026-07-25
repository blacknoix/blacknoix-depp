import { useOutletContext } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
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
  const { state, selected, selectAgent } = useAgentsConsole(session);
  const busy = state.load === "loading";

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

      <div className="workspace">
        <AgentsList
          agents={state.agents}
          selectedId={state.selectedId}
          onSelect={selectAgent}
          disabled={busy}
        />
        <AgentDetail
          agent={selected}
          relatedFindings={state.relatedFindings}
          detailPhase={state.detail}
          detailError={state.detailError}
        />
      </div>
    </div>
  );
}

export function AgentsConsole() {
  const { session } = useOutletContext<AgentsOutletContext>();
  return <AgentsConsoleView session={session} />;
}
