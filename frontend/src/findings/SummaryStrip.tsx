import type { FindingsDashboard } from "./types";

interface Props {
  dashboard: FindingsDashboard | null;
}

export function SummaryStrip({ dashboard }: Props) {
  if (!dashboard) {
    return (
      <section className="summary" aria-label="Findings summary">
        <p className="muted">Summary unavailable</p>
      </section>
    );
  }

  const { countsByStatus, recentCreatedCount, recentChangedCount, activeSuppressionCount, window } =
    dashboard;

  return (
    <section className="summary" aria-label="Findings summary">
      <div className="summary-grid">
        <Metric label="Open" value={countsByStatus.open} />
        <Metric label="Acknowledged" value={countsByStatus.acknowledged} />
        <Metric label="Resolved" value={countsByStatus.resolved} />
        <Metric
          label={`Created (${window.hours}h)`}
          value={recentCreatedCount}
        />
        <Metric
          label={`Changed (${window.hours}h)`}
          value={recentChangedCount}
        />
        <Metric label="Active snoozes" value={activeSuppressionCount} />
      </div>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="metric">
      <span className="metric-value">{value}</span>
      <span className="metric-label">{label}</span>
    </div>
  );
}
