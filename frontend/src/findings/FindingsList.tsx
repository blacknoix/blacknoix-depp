import {
  CORRELATION_RULE_IDS,
  FINDING_STATUSES,
  type CorrelationRuleId,
  type Finding,
  type FindingStatus,
  type FindingsFilters,
} from "./types";

interface Props {
  findings: Finding[];
  filters: FindingsFilters;
  selectedId: string | null;
  onFiltersChange: (filters: FindingsFilters) => void;
  onSelect: (id: string) => void;
  disabled?: boolean;
}

export function FindingsList({
  findings,
  filters,
  selectedId,
  onFiltersChange,
  onSelect,
  disabled,
}: Props) {
  return (
    <section className="panel list-panel" aria-label="Findings list">
      <header className="panel-header">
        <h2>Findings</h2>
        <div className="filters">
          <label>
            Status
            <select
              value={filters.status ?? ""}
              disabled={disabled}
              onChange={(e) => {
                const value = e.target.value;
                onFiltersChange({
                  ...filters,
                  status: value
                    ? (value as FindingStatus)
                    : undefined,
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
              onChange={(e) => {
                const value = e.target.value;
                onFiltersChange({
                  ...filters,
                  ruleId: value
                    ? (value as CorrelationRuleId)
                    : undefined,
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
        </div>
      </header>

      {findings.length === 0 ? (
        <p className="empty" role="status">
          No findings match the current filters.
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
