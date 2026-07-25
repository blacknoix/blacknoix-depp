import {
  allowedTransitions,
  CORRELATION_RULE_IDS,
  type CorrelationRuleId,
  type Finding,
  type FindingStatus,
} from "./types";

interface Props {
  finding: Finding | null;
  mutationPending: boolean;
  mutationError: string | null;
  onChangeStatus: (id: string, status: FindingStatus) => void;
  onSnooze: (ruleId: CorrelationRuleId, untilIso: string) => void;
}

const SNOOZE_PRESETS_MS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

export function FindingDetail({
  finding,
  mutationPending,
  mutationError,
  onChangeStatus,
  onSnooze,
}: Props) {
  if (!finding) {
    return (
      <section className="panel detail-panel" aria-label="Finding detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        <p className="empty" role="status">
          Select a finding to inspect and triage.
        </p>
      </section>
    );
  }

  const nextStatuses = allowedTransitions(finding.status);
  const ruleId = CORRELATION_RULE_IDS.includes(
    finding.ruleId as CorrelationRuleId,
  )
    ? (finding.ruleId as CorrelationRuleId)
    : null;

  return (
    <section className="panel detail-panel" aria-label="Finding detail">
      <header className="panel-header">
        <h2>{finding.title}</h2>
        <span className={`status-pill status-${finding.status}`}>
          {finding.status}
        </span>
      </header>

      <dl className="detail-grid">
        <div>
          <dt>Rule</dt>
          <dd className="mono">{finding.ruleId}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{finding.severity}</dd>
        </div>
        <div>
          <dt>Agent</dt>
          <dd className="mono">{finding.agentId}</dd>
        </div>
        <div>
          <dt>Created</dt>
          <dd>{new Date(finding.createdAt).toLocaleString()}</dd>
        </div>
        <div>
          <dt>Status changed</dt>
          <dd>
            {finding.statusChangedAt
              ? new Date(finding.statusChangedAt).toLocaleString()
              : "—"}
          </dd>
        </div>
        <div>
          <dt>Window</dt>
          <dd className="mono tiny">
            {new Date(finding.windowStart).toLocaleString()} →{" "}
            {new Date(finding.windowEnd).toLocaleString()}
          </dd>
        </div>
      </dl>

      <div className="actions">
        <h3>Lifecycle</h3>
        <div className="action-row">
          {nextStatuses.map((status) => (
            <button
              key={status}
              type="button"
              className="btn"
              disabled={mutationPending}
              onClick={() => onChangeStatus(finding.id, status)}
            >
              Mark {status}
            </button>
          ))}
        </div>
      </div>

      {ruleId ? (
        <div className="actions">
          <h3>Snooze this rule</h3>
          <p className="muted tiny">
            Skips creating new findings for{" "}
            <span className="mono">{ruleId}</span> while active. Existing
            findings are unchanged.
          </p>
          <div className="action-row">
            {SNOOZE_PRESETS_MS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                className="btn btn-secondary"
                disabled={mutationPending}
                onClick={() => {
                  const until = new Date(
                    Date.now() + preset.ms,
                  ).toISOString();
                  onSnooze(ruleId, until);
                }}
              >
                {preset.label}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {mutationError ? (
        <p className="error" role="alert">
          {mutationError}
        </p>
      ) : null}
    </section>
  );
}
