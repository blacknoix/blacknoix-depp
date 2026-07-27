import { Link } from "react-router-dom";
import { useMemo } from "react";

import type { Finding } from "../findings/types";
import { InvestigationTimeline } from "../investigation/InvestigationTimeline";
import {
  composeInvestigationTimeline,
  timelineSinceIso,
} from "../investigation/timeline";
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

function timelinePhase(
  findingsPhase: SectionPhase,
  activityPhase: SectionPhase,
): "idle" | "loading" | "ready" | "error" {
  if (findingsPhase === "idle" && activityPhase === "idle") {
    return "idle";
  }
  if (findingsPhase === "loading" || activityPhase === "loading") {
    return "loading";
  }
  if (findingsPhase === "ready" || activityPhase === "ready") {
    return "ready";
  }
  return "error";
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
  const sortedFindings = useMemo(
    () => sortRelatedFindings(relatedFindings),
    [relatedFindings],
  );

  const timeline = useMemo(() => {
    if (!agent) {
      return null;
    }
    const findingsReady = findingsPhase === "ready";
    const activityReady = activityPhase === "ready";
    if (!findingsReady && !activityReady) {
      return null;
    }
    const since =
      recentActivity?.since ?? timelineSinceIso();
    return composeInvestigationTimeline({
      since,
      findings: findingsReady ? relatedFindings : [],
      findingsAvailable: findingsReady,
      telemetryEvents: activityReady ? (recentActivity?.events ?? []) : [],
      telemetryAvailable: activityReady,
    });
  }, [
    agent,
    findingsPhase,
    activityPhase,
    relatedFindings,
    recentActivity,
  ]);

  if (!agent) {
    return (
      <section className="panel detail-panel" aria-label="Agent detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        <p className="empty" role="status">
          Select an agent to inspect heartbeat freshness, recent context, and
          related findings.
        </p>
      </section>
    );
  }

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

      <InvestigationTimeline
        timeline={timeline}
        phase={timelinePhase(findingsPhase, activityPhase)}
        findingsError={findingsError}
        telemetryError={activityError}
        telemetrySummary={
          activityPhase === "ready" && recentActivity
            ? recentActivity.summary
            : null
        }
      />

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
            {sortedFindings.map((related) => (
              <li key={related.id}>
                <Link
                  className="related-finding-link"
                  to={findingsPath({
                    agentId: agent.id,
                    status: related.status,
                    findingId: related.id,
                  })}
                >
                  <span className={`status-pill status-${related.status}`}>
                    {related.status}
                  </span>{" "}
                  <span>{related.title}</span>
                  <span className="mono muted tiny"> {related.ruleId}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
