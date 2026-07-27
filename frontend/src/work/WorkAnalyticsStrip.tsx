import {
  formatWorkMetricValue,
  type WorkQueueMetric,
  type WorkQueueMetrics,
} from "./workAnalytics";
import type { WorkQueueSectionId } from "./workQueue";

interface Props {
  metrics: WorkQueueMetrics;
  loading?: boolean;
  onFocusSection: (section: WorkQueueSectionId) => void;
}

/**
 * Compact Work queue health strip. Counters only — not a dashboard.
 */
export function WorkAnalyticsStrip({
  metrics,
  loading,
  onFocusSection,
}: Props) {
  if (loading && metrics.metrics.length === 0) {
    return (
      <section className="summary work-analytics" aria-label="Work queue health">
        <p className="muted tiny" role="status">
          Loading queue health…
        </p>
      </section>
    );
  }

  if (metrics.metrics.length === 0) {
    return (
      <section className="summary work-analytics" aria-label="Work queue health">
        <p className="muted tiny" role="status">
          Queue health unavailable.
        </p>
      </section>
    );
  }

  return (
    <section className="summary work-analytics" aria-label="Work queue health">
      <div className="summary-grid work-analytics-grid">
        {metrics.metrics.map((metric) => (
          <MetricCell
            key={metric.id}
            metric={metric}
            onFocusSection={onFocusSection}
          />
        ))}
      </div>
      <p className="muted tiny work-analytics-footnote">
        Counts from the current Work load. Unowned ≥7d uses created time
        (intake age, not an SLA). “+” means the source page is truncated.
      </p>
    </section>
  );
}

function MetricCell({
  metric,
  onFocusSection,
}: {
  metric: WorkQueueMetric;
  onFocusSection: (section: WorkQueueSectionId) => void;
}) {
  const display = formatWorkMetricValue(metric);
  const canFocus = metric.focusSection !== null && metric.value !== null;

  if (!canFocus || !metric.focusSection) {
    return (
      <div
        className="metric work-analytics-metric is-static"
        title={metric.hint}
      >
        <span className="metric-value">{display}</span>
        <span className="metric-label">{metric.label}</span>
      </div>
    );
  }

  const section = metric.focusSection;
  return (
    <button
      type="button"
      className="metric work-analytics-metric is-action"
      title={metric.hint}
      onClick={() => onFocusSection(section)}
    >
      <span className="metric-value">{display}</span>
      <span className="metric-label">{metric.label}</span>
    </button>
  );
}
