import { Link } from "react-router-dom";

import type { AgentActivitySummary } from "../agents/types";
import {
  timelineKindLabel,
  type ComposeTimelineResult,
  type TimelineItem,
} from "./timeline";

export type TimelinePhase = "idle" | "loading" | "ready" | "error";

interface Props {
  /** Newest-first composed result; null while both sources are still loading. */
  timeline: ComposeTimelineResult | null;
  phase: TimelinePhase;
  findingsError: string | null;
  telemetryError: string | null;
  /** Optional telemetry summary strip when that source succeeded. */
  telemetrySummary: AgentActivitySummary | null;
}

function formatCountStrip(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}: ${count}`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}

function TimelineRow({ item }: { item: TimelineItem }) {
  const kind = timelineKindLabel(item.kind);
  const body = (
    <>
      <span className="timeline-kind muted tiny">{kind}</span>
      <span className="timeline-title">{item.title}</span>
      <span className="muted tiny timeline-sub">{item.subtitle}</span>
      <span className="muted tiny mono timeline-at">
        {new Date(item.at).toLocaleString()}
      </span>
    </>
  );

  if (item.href) {
    return (
      <li>
        <Link className="timeline-link" to={item.href} aria-label={`${kind}: ${item.title}`}>
          {body}
        </Link>
      </li>
    );
  }

  return <li className="timeline-row">{body}</li>;
}

/**
 * Compact recent-context stream for selected agent or finding detail.
 * Partial source failures surface as alerts; available items still render.
 * Loading does not hide items already composed from a ready source.
 */
export function InvestigationTimeline({
  timeline,
  phase,
  findingsError,
  telemetryError,
  telemetrySummary,
}: Props) {
  const showLoading = phase === "loading";
  const hasItems = Boolean(timeline && timeline.items.length > 0);
  const empty = !showLoading && timeline !== null && timeline.items.length === 0;

  return (
    <div className="agent-section investigation-timeline" aria-label="Recent context">
      <h3>Recent context (last 24 hours)</h3>
      <p className="muted tiny">
        Finding lifecycle markers and telemetry in an explicit 24-hour window.
        Not a full event history, search surface, or causality graph.
      </p>

      {showLoading ? (
        <p className="muted tiny" role="status">
          Loading recent context…
        </p>
      ) : null}

      {findingsError ? (
        <p className="error" role="alert">
          Findings source unavailable: {findingsError}
        </p>
      ) : null}
      {telemetryError ? (
        <p className="error" role="alert">
          Telemetry source unavailable: {telemetryError}
        </p>
      ) : null}

      {telemetrySummary ? (
        <p className="activity-summary" role="status">
          <span>
            {telemetrySummary.totalInWindow} telemetry event
            {telemetrySummary.totalInWindow === 1 ? "" : "s"} in window
          </span>
          <span className="muted">
            {formatCountStrip(telemetrySummary.countsByEventType)}
          </span>
        </p>
      ) : null}

      {timeline?.truncated ? (
        <p className="muted tiny" role="status">
          Showing the newest {timeline.items.length} items — older activity in
          this window is omitted.
        </p>
      ) : null}

      {empty ? (
        <p className="empty" role="status">
          No finding or telemetry activity in the last 24 hours.
        </p>
      ) : null}

      {hasItems && timeline ? (
        <ul className="activity-list timeline-list" aria-label="Recent context items">
          {timeline.items.map((item) => (
            <TimelineRow key={item.id} item={item} />
          ))}
        </ul>
      ) : null}
    </div>
  );
}
