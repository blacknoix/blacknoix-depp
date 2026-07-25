import {
  CORRELATION_RULE_IDS,
  type CorrelationRuleId,
  type Suppression,
} from "./types";

interface Props {
  suppressions: Suppression[];
  mutationPending: boolean;
  onClear: (id: string) => void;
  onCreate: (ruleId: CorrelationRuleId, untilIso: string) => void;
}

function isActive(row: Suppression, now = Date.now()): boolean {
  if (row.clearedAt) return false;
  const start = Date.parse(row.startsAt);
  const end = Date.parse(row.endsAt);
  return start <= now && now < end;
}

export function SnoozePanel({
  suppressions,
  mutationPending,
  onClear,
  onCreate,
}: Props) {
  const uncleared = suppressions.filter((s) => !s.clearedAt);

  return (
    <section className="panel snooze-panel" aria-label="Snooze management">
      <header className="panel-header">
        <h2>Snoozes</h2>
      </header>

      {uncleared.length === 0 ? (
        <p className="empty" role="status">
          No uncleared snoozes.
        </p>
      ) : (
        <ul className="snooze-rows">
          {uncleared.map((row) => (
            <li key={row.id} className="snooze-row">
              <div>
                <span className="mono">{row.ruleId}</span>
                <span className="muted tiny">
                  {isActive(row) ? "active" : "scheduled/expired"} · until{" "}
                  {new Date(row.endsAt).toLocaleString()}
                </span>
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={mutationPending}
                onClick={() => onClear(row.id)}
              >
                Clear
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="actions">
        <h3>Create snooze</h3>
        <div className="action-row wrap">
          {CORRELATION_RULE_IDS.map((ruleId) => (
            <button
              key={ruleId}
              type="button"
              className="btn btn-secondary"
              disabled={mutationPending}
              onClick={() => {
                const until = new Date(
                  Date.now() + 24 * 60 * 60 * 1000,
                ).toISOString();
                onCreate(ruleId, until);
              }}
            >
              {ruleId} · 24h
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
