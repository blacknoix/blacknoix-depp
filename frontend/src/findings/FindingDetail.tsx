import { Link } from "react-router-dom";

import { agentsPath } from "../routing/crossLinks";
import {
  ruleCatalogEntry,
  summarizeEvidence,
} from "./ruleCatalog";
import {
  allowedTransitions,
  CORRELATION_RULE_IDS,
  type CorrelationRuleId,
  type Finding,
  type FindingStatus,
  type Suppression,
} from "./types";

interface Props {
  finding: Finding | null;
  suppressions: Suppression[];
  mutationPending: boolean;
  mutationError: string | null;
  triageNote: string | null;
  position: { index: number; total: number } | null;
  canGoPrev: boolean;
  canGoNext: boolean;
  onChangeStatus: (id: string, status: FindingStatus) => void;
  onSnooze: (ruleId: CorrelationRuleId, untilIso: string) => void;
  onGoPrev: () => void;
  onGoNext: () => void;
}

const SNOOZE_PRESETS_MS = [
  { label: "1 hour", ms: 60 * 60 * 1000 },
  { label: "4 hours", ms: 4 * 60 * 60 * 1000 },
  { label: "24 hours", ms: 24 * 60 * 60 * 1000 },
  { label: "7 days", ms: 7 * 24 * 60 * 60 * 1000 },
] as const;

function activeRuleSnooze(
  suppressions: Suppression[],
  ruleId: string,
  now: Date = new Date(),
): Suppression | null {
  const nowMs = now.getTime();
  return (
    suppressions.find(
      (s) =>
        s.ruleId === ruleId &&
        !s.clearedAt &&
        new Date(s.startsAt).getTime() <= nowMs &&
        new Date(s.endsAt).getTime() > nowMs,
    ) ?? null
  );
}

export function FindingDetail({
  finding,
  suppressions,
  mutationPending,
  mutationError,
  triageNote,
  position,
  canGoPrev,
  canGoNext,
  onChangeStatus,
  onSnooze,
  onGoPrev,
  onGoNext,
}: Props) {
  if (!finding) {
    return (
      <section className="panel detail-panel" aria-label="Finding detail">
        <header className="panel-header">
          <h2>Detail</h2>
        </header>
        {triageNote ? (
          <p className="banner" role="status">
            {triageNote}
          </p>
        ) : null}
        <p className="empty" role="status">
          Select a finding to inspect context and triage.
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
  const catalog = ruleCatalogEntry(finding.ruleId);
  const evidenceFacts = summarizeEvidence(finding.evidence ?? {});
  const snooze = activeRuleSnooze(suppressions, finding.ruleId);

  return (
    <section className="panel detail-panel" aria-label="Finding detail">
      <header className="panel-header">
        <div className="detail-heading">
          <h2>{finding.title}</h2>
          {position ? (
            <p className="muted tiny" aria-live="polite">
              Finding {position.index} of {position.total}
            </p>
          ) : null}
        </div>
        <span className={`status-pill status-${finding.status}`}>
          {finding.status}
        </span>
      </header>

      <div className="triage-nav" aria-label="Finding navigation">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={mutationPending || !canGoPrev}
          onClick={onGoPrev}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={mutationPending || !canGoNext}
          onClick={onGoNext}
        >
          Next
        </button>
      </div>

      {triageNote ? (
        <p className="banner" role="status">
          {triageNote}
        </p>
      ) : null}

      {catalog ? (
        <div className="finding-meaning">
          <h3>What this means</h3>
          <p>{catalog.summary}</p>
          <p className="muted tiny">
            Signals: <span className="mono">{catalog.signals}</span>
          </p>
        </div>
      ) : (
        <p className="muted tiny" role="status">
          Unknown rule id — no catalog explanation available.
        </p>
      )}

      <dl className="detail-grid">
        <div>
          <dt>Finding id</dt>
          <dd className="mono tiny">{finding.id}</dd>
        </div>
        <div>
          <dt>Rule</dt>
          <dd className="mono">{finding.ruleId}</dd>
        </div>
        <div>
          <dt>Severity</dt>
          <dd>{finding.severity}</dd>
        </div>
        <div>
          <dt>Lifecycle</dt>
          <dd>
            <span className={`status-pill status-${finding.status}`}>
              {finding.status}
            </span>
          </dd>
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
          <dt>Correlation window</dt>
          <dd className="mono tiny">
            {new Date(finding.windowStart).toLocaleString()} →{" "}
            {new Date(finding.windowEnd).toLocaleString()}
          </dd>
        </div>
        <div>
          <dt>Rule snooze</dt>
          <dd>
            {snooze ? (
              <>
                Active until {new Date(snooze.endsAt).toLocaleString()}
                <span className="muted tiny">
                  {" "}
                  (skips new findings for this rule; this finding is unchanged)
                </span>
              </>
            ) : (
              "None active"
            )}
          </dd>
        </div>
      </dl>

      {evidenceFacts.length > 0 ? (
        <div className="finding-section">
          <h3>Evidence summary</h3>
          <p className="muted tiny">
            Compact fields from correlation evidence. Raw event payloads and
            sample ids are not shown here.
          </p>
          <dl className="detail-grid">
            {evidenceFacts.map((fact) => (
              <div key={fact.label}>
                <dt>{fact.label}</dt>
                <dd>{fact.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ) : null}

      <div className="finding-section">
        <h3>Agent context</h3>
        <p className="muted tiny">
          Related agent{" "}
          <Link className="mono cross-link" to={agentsPath(finding.agentId)}>
            {finding.agentId}
          </Link>
        </p>
        <div className="action-row">
          <Link
            className="btn btn-secondary"
            to={agentsPath(finding.agentId)}
          >
            Open agent
          </Link>
        </div>
      </div>

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
