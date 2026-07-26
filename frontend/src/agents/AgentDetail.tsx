import { Link } from "react-router-dom";

import type { Finding } from "../findings/types";
import { findingsPath } from "../routing/crossLinks";
import type {
  AgentInventoryItem,
  AgentRecentActivity,
} from "./types";
import { freshnessLabel } from "./types";
import type { SectionPhase } from "./useAgentsConsole";

interface Props {
  agent: AgentInventoryItem | null;
  relatedFindings: Finding[];
  findingsPhase: SectionPhase;
  findingsError: string | null;
  recentActivity: AgentRecentActivity | null;
  activityPhase: SectionPhase;
  activityError: string | null;
}

function formatCountStrip(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}: ${count}`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}

export function AgentDetail({
  agent,
  relatedFindings,
  findingsPhase,
  findingsError,
  recentActivity,
  activityPhase,
  activityError,
}: Props) {
  if (!agent) {
    return (
      <section className="panel detail-panel" aria-label="Agent detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        <p className="empty" role="status">
          Select an agent to inspect heartbeat, recent activity, and related
          findings.
        </p>
      </section>
    );
  }

  return (
    <section className="panel detail-panel" aria-label="Agent detail">
      <header className="panel-header">
        <h2>{agent.name}</h2>
        <span className={`status-pill freshness-${agent.heartbeatFreshness}`}>
          {freshnessLabel(agent.heartbeatFreshness)}
        </span>
      </header>

      <dl className="detail-grid">
        <div>
          <dt>Agent id</dt>
          <dd className="mono tiny">{agent.id}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(agent.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Last heartbeat</dt>
          <dd>
            {agent.lastHeartbeatAt
              ? new Date(agent.lastHeartbeatAt).toLocaleString()
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Open findings</dt>
          <dd>{agent.openFindingsCount}</dd>
        </div>
      </dl>

      <div className="agent-section">
        <h3>Recent activity (last 24 hours)</h3>
        <p className="muted tiny">
          Telemetry events in an explicit 24-hour window. Heartbeat freshness
          above remains the inventory liveness signal — not online/offline.
        </p>
        {activityPhase === "loading" ? (
          <p className="muted tiny" role="status">
            Loading recent activity…
          </p>
        ) : null}
        {activityError ? (
          <p className="error" role="alert">
            {activityError}
          </p>
        ) : null}
        {activityPhase === "ready" && recentActivity ? (
          <>
            <p className="activity-summary" role="status">
              <span>
                {recentActivity.summary.totalInWindow} event
                {recentActivity.summary.totalInWindow === 1 ? "" : "s"} in window
              </span>
              <span className="muted">
                {formatCountStrip(recentActivity.summary.countsByEventType)}
              </span>
            </p>
            {recentActivity.events.length === 0 ? (
              <p className="empty" role="status">
                No telemetry in the last 24 hours.
              </p>
            ) : (
              <ul className="activity-list" aria-label="Recent telemetry events">
                {recentActivity.events.map((event) => (
                  <li key={event.id}>
                    <span className="mono">{event.eventType}</span>
                    <span className="muted tiny">
                      {new Date(event.occurredAt).toLocaleString()}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </div>

      <div className="actions">
        <h3>Related findings</h3>
        <div className="action-row" style={{ marginBottom: "0.75rem" }}>
          <Link
            className="btn btn-secondary"
            to={findingsPath({ agentId: agent.id })}
          >
            Open in Findings
          </Link>
        </div>
        {findingsPhase === "loading" ? (
          <p className="muted tiny" role="status">
            Loading findings…
          </p>
        ) : null}
        {findingsError ? (
          <p className="error" role="alert">
            {findingsError}
          </p>
        ) : null}
        {findingsPhase === "ready" && relatedFindings.length === 0 ? (
          <p className="empty" role="status">
            No findings for this agent.
          </p>
        ) : null}
        {relatedFindings.length > 0 ? (
          <ul className="related-findings">
            {relatedFindings.map((finding) => (
              <li key={finding.id}>
                <Link
                  className="related-finding-link"
                  to={findingsPath({
                    agentId: agent.id,
                    findingId: finding.id,
                  })}
                >
                  <span className={`status-pill status-${finding.status}`}>
                    {finding.status}
                  </span>{" "}
                  <span>{finding.title}</span>
                  <span className="mono muted tiny"> {finding.ruleId}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
