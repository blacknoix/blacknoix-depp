import type { AgentInventoryItem } from "./types";
import { freshnessLabel } from "./types";

interface Props {
  agents: AgentInventoryItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function AgentsList({
  agents,
  selectedId,
  onSelect,
  disabled,
}: Props) {
  if (agents.length === 0) {
    return (
      <section className="panel list-panel" aria-label="Agents list">
        <header className="panel-header">
          <h2>Inventory</h2>
        </header>
        <p className="empty" role="status">
          No agents registered for this tenant yet.
        </p>
      </section>
    );
  }

  return (
    <section className="panel list-panel" aria-label="Agents list">
      <header className="panel-header">
        <h2>Inventory</h2>
      </header>
      <ul className="finding-rows">
        {agents.map((agent) => {
          const selected = agent.id === selectedId;
          return (
            <li key={agent.id}>
              <button
                type="button"
                className={selected ? "finding-row selected" : "finding-row"}
                onClick={() => onSelect(agent.id)}
                disabled={disabled}
                aria-current={selected ? "true" : undefined}
              >
                <span className="finding-title">{agent.name}</span>
                <span
                  className={`status-pill freshness-${agent.heartbeatFreshness}`}
                >
                  {freshnessLabel(agent.heartbeatFreshness)}
                </span>
                <span className="mono muted tiny">{agent.id}</span>
                <span className="muted tiny">
                  Open findings: {agent.openFindingsCount}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
