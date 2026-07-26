import { Link } from "react-router-dom";

import type { Finding } from "../findings/types";
import { findingsPath } from "../routing/crossLinks";
import { sortRelatedFindings } from "./agentWorkflow";
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
  onClearFocus?: () => void;
}

function formatCountStrip(counts: Record<string, number>): string {
  const parts = Object.entries(counts)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([type, count]) => `${type}: ${count}`);
  return parts.length > 0 ? parts.join(" · ") : "none";
}

function freshnessHelp(agent: AgentInventoryItem): string {
  switch (agent.heartbeatFreshness) {
    case "recent":
      return "Last heartbeat is inside the silence threshold. This is inventory liveness, not online/offline.";
    case "stale":
      return "Last heartbeat is beyond the silence threshold. Investigate activity and open findings — not a remediation console.";
    case "unknown":
      return "No heartbeat recorded yet for this agent. Enrollment and install UX are deferred.";
  }
}

export function AgentDetail({
  agent,
  relatedFindings,
  findingsPhase,
  findingsError,
  recentActivity,
  activityPhase,
  activityError,
  onClearFocus,
}: Props) {
  if (!agent) {
    return (
      <section className="panel detail-panel" aria-label="Agent detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        <p className="empty" role="status">
          Select an agent to inspect heartbeat freshness, recent activity, and
          related findings.
        </p>
      </section>
    );
  }

  const sortedFindings = sortRelatedFindings(relatedFindings);
  const openRelated = sortedFindings.filter((f) => f.status === "open").length;

  return (
    <section className="panel detail-panel" aria-label="Agent detail">
      <header className="panel-header">
        <h2>{agent.name}</h2>
        <span className={`status-pill freshness-${agent.heartbeatFreshness}`}>
          {freshnessLabel(agent.heartbeatFreshness)}
        </span>
      </header>

      <p className="muted tiny agent-freshness-help" role="note">
        {freshnessHelp(agent)}
      </p>

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

      <div className="actions agent-investigate">
        <h3>Investigate</h3>
        <div className="action-row wrap">
          {agent.openFindingsCount > 0 ? (
            <Link
              className="btn"
              to={findingsPath({ agentId: agent.id, status: "open" })}
            >
              Open findings ({agent.openFindingsCount})
            </Link>
          ) : (
            <Link
              className="btn btn-secondary"
              to={findingsPath({ agentId: agent.id })}
            >
              Open in Findings
            </Link>
          )}
          {agent.openFindingsCount > 0 ? (
            <Link
              className="btn btn-secondary"
              to={findingsPath({ agentId: agent.id })}
            >
              All findings for agent
            </Link>
          ) : null}
          {onClearFocus ? (
            <button
              type="button"
              className="btn btn-secondary"
              onClick={onClearFocus}
            >
              Clear focus
            </button>
          ) : null}
        </div>
      </div>

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
        <p className="muted tiny">
          {findingsPhase === "ready"
            ? openRelated > 0
              ? `${openRelated} open of ${sortedFindings.length} loaded for this agent.`
              : sortedFindings.length > 0
                ? `${sortedFindings.length} finding(s) — none currently open.`
                : null
            : null}
        </p>
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
        {findingsPhase === "ready" && sortedFindings.length === 0 ? (
          <p className="empty" role="status">
            No findings for this agent.
          </p>
        ) : null}
        {sortedFindings.length > 0 ? (
          <ul className="related-findings">
            {sortedFindings.map((finding) => (
              <li key={finding.id}>
                <Link
                  className="related-finding-link"
                  to={findingsPath({
                    agentId: agent.id,
                    status: finding.status,
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
