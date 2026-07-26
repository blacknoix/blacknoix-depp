import type { AgentsFilters } from "../routing/agentsUrlState";
import { hasActiveAgentsFilters } from "../routing/agentsUrlState";
import type { AgentInventoryItem, HeartbeatFreshness } from "./types";
import { freshnessLabel } from "./types";
import { HEARTBEAT_FRESHNESS_VALUES } from "../routing/agentsUrlState";

interface Props {
  agents: AgentInventoryItem[];
  totalCount: number;
  filters: AgentsFilters;
  selectedId: string | null;
  onFiltersChange: (filters: AgentsFilters) => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function AgentsList({
  agents,
  totalCount,
  filters,
  selectedId,
  onFiltersChange,
  onSelect,
  disabled,
}: Props) {
  const active = hasActiveAgentsFilters(filters);

  return (
    <section className="panel list-panel" aria-label="Agents list">
      <header className="panel-header">
        <h2>Inventory</h2>
        {totalCount > 0 ? (
          <span className="muted tiny">
            {agents.length === totalCount
              ? `${totalCount}`
              : `${agents.length} of ${totalCount}`}
          </span>
        ) : null}
      </header>

      <div className="filter-bar" role="search" aria-label="Agents filters">
        <label>
          Freshness
          <select
            value={filters.freshness ?? ""}
            disabled={disabled}
            aria-label="Freshness"
            onChange={(e) => {
              const value = e.target.value;
              onFiltersChange({
                ...filters,
                freshness: value
                  ? (value as HeartbeatFreshness)
                  : undefined,
              });
            }}
          >
            <option value="">All</option>
            {HEARTBEAT_FRESHNESS_VALUES.map((value) => (
              <option key={value} value={value}>
                {freshnessLabel(value)}
              </option>
            ))}
          </select>
        </label>
        <label className="filter-check">
          <input
            type="checkbox"
            checked={Boolean(filters.hasOpenFindings)}
            disabled={disabled}
            aria-label="Only agents with open findings"
            onChange={(e) => {
              onFiltersChange({
                ...filters,
                hasOpenFindings: e.target.checked ? true : undefined,
              });
            }}
          />
          Open findings only
        </label>
        {active ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={disabled}
            onClick={() => onFiltersChange({})}
          >
            Clear filters
          </button>
        ) : null}
      </div>

      {totalCount === 0 ? (
        <p className="empty" role="status">
          No agents registered for this tenant yet.
        </p>
      ) : agents.length === 0 ? (
        <p className="empty" role="status">
          No agents match the current filters.
        </p>
      ) : (
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
      )}
    </section>
  );
}
