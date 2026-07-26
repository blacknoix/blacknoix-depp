import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type CorrelationRuleId,
  type Finding,
  type FindingStatus,
  type FindingsFilters,
} from "./types";
import { hasActiveFilters } from "../routing/findingsUrlState";
import {
  activeFindingsQueue,
  applyFindingsQueue,
  clearFindingsQueue,
  FINDINGS_QUEUES,
  type FindingsQueueId,
} from "./queues";

interface Props {
  findings: Finding[];
  filters: FindingsFilters;
  selectedId: string | null;
  onFiltersChange: (filters: FindingsFilters) => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
  /** When false, Mine queue is disabled (no operator identity). */
  canUseMineQueue?: boolean;
}

export function FindingsList({
  findings,
  filters,
  selectedId,
  onFiltersChange,
  onSelect,
  disabled,
  canUseMineQueue = true,
}: Props) {
  const active = hasActiveFilters(filters);
  const activeQueue = activeFindingsQueue(filters);

  function selectQueue(queueId: FindingsQueueId) {
    if (activeQueue === queueId) {
      onFiltersChange(clearFindingsQueue(filters));
      return;
    }
    onFiltersChange(applyFindingsQueue(filters, queueId));
  }

  return (
    <section className="panel list-panel" aria-label="Findings list">
      <header className="panel-header">
        <h2>Findings</h2>
      </header>

      <div
        className="queue-bar"
        role="toolbar"
        aria-label="Findings work queues"
      >
        {FINDINGS_QUEUES.map((queue) => {
          const selected = activeQueue === queue.id;
          const blocked =
            queue.requiresOperatorIdentity && !canUseMineQueue;
          return (
            <button
              key={queue.id}
              type="button"
              className={
                selected ? "btn queue-chip selected" : "btn btn-secondary queue-chip"
              }
              disabled={disabled || blocked}
              aria-pressed={selected}
              title={
                blocked
                  ? "Operator user id required for Mine (set at session gate or use JWT)"
                  : undefined
              }
              onClick={() => selectQueue(queue.id)}
            >
              {queue.label}
            </button>
          );
        })}
        {!canUseMineQueue ? (
          <span className="muted tiny queue-hint">
            Mine needs an operator user id
          </span>
        ) : null}
      </div>

      <div className="filter-bar" role="search" aria-label="Findings filters">
        {filters.agentId ? (
          <div className="agent-filter-chip">
            <span className="muted tiny">Agent</span>
            <span className="mono tiny">{filters.agentId}</span>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={disabled}
              onClick={() => {
                onFiltersChange({
                  ...(filters.status ? { status: filters.status } : {}),
                  ...(filters.ruleId ? { ruleId: filters.ruleId } : {}),
                  ...(filters.ownerScope
                    ? { ownerScope: filters.ownerScope }
                    : {}),
                });
              }}
            >
              Clear agent
            </button>
          </div>
        ) : null}
        <label>
          Status
          <select
            value={filters.status ?? ""}
            disabled={disabled}
            aria-label="Status"
            onChange={(e) => {
              const value = e.target.value;
              onFiltersChange({
                ...filters,
                status: value ? (value as FindingStatus) : undefined,
              });
            }}
          >
            <option value="">All</option>
            {FINDING_STATUSES.map((status) => (
              <option key={status} value={status}>
                {status}
              </option>
            ))}
          </select>
        </label>
        <label>
          Rule
          <select
            value={filters.ruleId ?? ""}
            disabled={disabled}
            aria-label="Rule"
            onChange={(e) => {
              const value = e.target.value;
              onFiltersChange({
                ...filters,
                ruleId: value ? (value as CorrelationRuleId) : undefined,
              });
            }}
          >
            <option value="">All</option>
            {CORRELATION_RULE_IDS.map((ruleId) => (
              <option key={ruleId} value={ruleId}>
                {ruleId}
              </option>
            ))}
          </select>
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

      {findings.length === 0 ? (
        <p className="empty" role="status">
          {activeQueue === "mine"
            ? "Nothing assigned to you in this queue."
            : activeQueue === "unowned_open"
              ? "No unowned open findings."
              : "No findings match the current filters."}
        </p>
      ) : (
        <ul className="finding-rows">
          {findings.map((finding) => {
            const selected = finding.id === selectedId;
            return (
              <li key={finding.id}>
                <button
                  type="button"
                  className={
                    selected ? "finding-row selected" : "finding-row"
                  }
                  onClick={() => onSelect(finding.id)}
                  disabled={disabled}
                  aria-current={selected ? "true" : undefined}
                >
                  <span className={`status-pill status-${finding.status}`}>
                    {finding.status}
                  </span>
                  <span className="finding-title">{finding.title}</span>
                  <span className="mono muted">{finding.ruleId}</span>
                  {finding.ownerUserId ? (
                    <span className="muted tiny">Owned</span>
                  ) : (
                    <span className="muted tiny">Unowned</span>
                  )}
                  <span className="mono muted tiny">
                    {new Date(finding.createdAt).toLocaleString()}
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
