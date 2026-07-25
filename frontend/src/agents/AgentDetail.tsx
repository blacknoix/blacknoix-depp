import { Link } from "react-router-dom";

import type { Finding } from "../findings/types";
import { findingsPath } from "../routing/crossLinks";
import type { AgentInventoryItem } from "./types";
import { freshnessLabel } from "./types";

interface Props {
  agent: AgentInventoryItem | null;
  relatedFindings: Finding[];
  detailPhase: "idle" | "loading" | "ready" | "error";
  detailError: string | null;
}

export function AgentDetail({
  agent,
  relatedFindings,
  detailPhase,
  detailError,
}: Props) {
  if (!agent) {
    return (
      <section className="panel detail-panel" aria-label="Agent detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        <p className="empty" role="status">
          Select an agent to inspect heartbeat and related findings.
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
        {detailPhase === "loading" ? (
          <p className="muted tiny" role="status">
            Loading findings…
          </p>
        ) : null}
        {detailError ? (
          <p className="error" role="alert">
            {detailError}
          </p>
        ) : null}
        {detailPhase === "ready" && relatedFindings.length === 0 ? (
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
