import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchFindingsAttention,
  type AttentionItem,
  type FindingsAttentionDigest,
} from "../api/findings";
import { ApiError } from "../api/client";
import type { OperatorSession } from "../auth/session";
import { attentionItemPath, attentionKindLabel } from "./attentionLinks";
import {
  loadAttentionSeenAt,
  markAttentionSeenAt,
} from "./attentionSeen";

interface Props {
  session: OperatorSession;
}

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return "unknown time";
  }
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionHasOperatorIdentity(session: OperatorSession): boolean {
  if (session.kind === "bearer") {
    return true;
  }
  return Boolean(session.userId);
}

function AttentionItemRow({
  item,
  onNavigate,
}: {
  item: AttentionItem;
  onNavigate: () => void;
}) {
  const to = attentionItemPath(item);
  if (to) {
    return (
      <Link to={to} className="attention-item" onClick={onNavigate}>
        <span className="attention-kind">{attentionKindLabel(item.kind)}</span>
        <span className="attention-title">{item.title}</span>
        <span className="muted tiny mono">
          {item.status} · {item.ruleId}
        </span>
        <span className="muted tiny">{formatWhen(item.at)}</span>
      </Link>
    );
  }
  return (
    <div className="attention-item is-invalid">
      <span className="attention-kind">{attentionKindLabel(item.kind)}</span>
      <span className="error tiny">
        Obsolete filters — open Findings manually.
      </span>
    </div>
  );
}

/**
 * Compact shell attention digest — pull on open, no live stream.
 * Soft ownership / due reminders plus exclusive Action needed escalation.
 */
export function AttentionPanel({ session }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState<FindingsAttentionDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const hasIdentity = sessionHasOperatorIdentity(session);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const since = loadAttentionSeenAt(session);
      const next = await fetchFindingsAttention(session, since);
      setDigest(next);
    } catch (err) {
      setDigest(null);
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) {
      return;
    }
    void load();

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    function onPointer(event: MouseEvent) {
      if (
        rootRef.current &&
        event.target instanceof Node &&
        !rootRef.current.contains(event.target)
      ) {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, load]);

  const changeCount = digest?.items.length ?? 0;
  const reminderCount = digest?.reminders.items.length ?? 0;
  const dueReminderCount = digest?.dueReminders.items.length ?? 0;
  const actionNeededCount = digest?.actionNeeded.items.length ?? 0;
  const count =
    changeCount + reminderCount + dueReminderCount + actionNeededCount;
  const badge = count === 0 ? null : count > 9 ? "9+" : String(count);
  const badgeUrgent = actionNeededCount > 0;

  function onMarkCaughtUp() {
    if (!digest) {
      return;
    }
    const result = markAttentionSeenAt(session, digest.generatedAt);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage(
      "Marked change feed caught up for this browser. Soft reminders and Action needed stay until the finding is touched/resolved or the operator clears them.",
    );
    void load();
  }

  function closePanel() {
    setOpen(false);
  }

  return (
    <div className="attention-panel" ref={rootRef}>
      <button
        type="button"
        className="btn btn-secondary attention-trigger"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Attention
        {badge ? (
          <span
            className={
              badgeUrgent
                ? "attention-badge is-urgent"
                : "attention-badge"
            }
            aria-label={
              badgeUrgent
                ? `${count} items, ${actionNeededCount} need action`
                : `${count} items`
            }
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          id={panelId}
          className="attention-popover"
          role="dialog"
          aria-label="Attention digest"
        >
          <header className="attention-header">
            <div>
              <h2>Attention</h2>
              <p className="muted tiny">
                Recent changes (max {digest?.maxLookbackHours ?? 24}h), soft
                follow-ups, and Action needed escalation (overdue reminders ≥
                {digest?.actionNeeded.overdueHours ?? 4}h / quiet ≥{" "}
                {digest?.actionNeeded.escalationQuietHours ?? 48}h). Pull-based
                — not live.
              </p>
            </div>
            <div className="attention-actions">
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading}
                onClick={() => void load()}
              >
                Refresh
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || !digest}
                onClick={onMarkCaughtUp}
              >
                Mark caught up
              </button>
            </div>
          </header>

          {digest ? (
            <p className="muted tiny attention-summary" role="status">
              Open findings: {digest.openCount}
              {" · "}
              Active snoozes: {digest.activeSuppressionCount}
              {digest.truncated ||
              digest.reminders.truncated ||
              digest.dueReminders.truncated ||
              digest.actionNeeded.truncated
                ? " · Showing latest only"
                : ""}
            </p>
          ) : null}

          {error ? (
            <p className="error tiny" role="alert">
              {error}
            </p>
          ) : null}
          {message ? (
            <p className="muted tiny" role="status">
              {message}
            </p>
          ) : null}

          {loading && !digest ? (
            <p className="muted tiny" role="status">
              Loading…
            </p>
          ) : null}

          <section className="attention-section" aria-label="Action needed">
            <h3 className="attention-section-title">Action needed</h3>
            {!hasIdentity ? (
              <p className="muted tiny" role="status">
                Operator identity is required for Action needed escalation.
              </p>
            ) : null}
            {hasIdentity && digest && digest.actionNeeded.items.length === 0 ? (
              <p className="muted tiny" role="status">
                No overdue reminders or long-quiet owned findings.
              </p>
            ) : null}
            {digest && digest.actionNeeded.items.length > 0 ? (
              <ul className="attention-list">
                {digest.actionNeeded.items.map((item) => (
                  <li key={`${item.kind}:${item.findingId}:${item.at}`}>
                    <AttentionItemRow item={item} onNavigate={closePanel} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="attention-section" aria-label="Recent changes">
            <h3 className="attention-section-title">Recent changes</h3>
            {!loading && digest && digest.items.length === 0 ? (
              <p className="muted tiny" role="status">
                Nothing new since the current cursor.
              </p>
            ) : null}
            {digest && digest.items.length > 0 ? (
              <ul className="attention-list">
                {digest.items.map((item) => (
                  <li key={`${item.kind}:${item.findingId}:${item.at}`}>
                    <AttentionItemRow item={item} onNavigate={closePanel} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="attention-section" aria-label="Needs revisit">
            <h3 className="attention-section-title">Needs revisit</h3>
            {!hasIdentity ? (
              <p className="muted tiny" role="status">
                Operator identity is required for ownership reminders (set a
                user UUID at the gate or use JWT).
              </p>
            ) : null}
            {hasIdentity && digest && digest.reminders.items.length === 0 ? (
              <p className="muted tiny" role="status">
                No soft ownership nudges (quiet{" "}
                {digest.reminders.quietHours}–
                {digest.actionNeeded.escalationQuietHours}h). Longer quiet
                items move to Action needed.
              </p>
            ) : null}
            {digest && digest.reminders.items.length > 0 ? (
              <ul className="attention-list">
                {digest.reminders.items.map((item) => (
                  <li key={`${item.kind}:${item.findingId}:${item.at}`}>
                    <AttentionItemRow item={item} onNavigate={closePanel} />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>

          <section className="attention-section" aria-label="Reminders due">
            <h3 className="attention-section-title">Reminders due</h3>
            {!hasIdentity ? (
              <p className="muted tiny" role="status">
                Operator identity is required for explicit reminder due items.
              </p>
            ) : null}
            {hasIdentity && digest && digest.dueReminders.items.length === 0 ? (
              <p className="muted tiny" role="status">
                No soft due reminders. Reminders overdue ≥{" "}
                {digest.actionNeeded.overdueHours}h move to Action needed.
              </p>
            ) : null}
            {digest && digest.dueReminders.items.length > 0 ? (
              <ul className="attention-list">
                {digest.dueReminders.items.map((item) => (
                  <li key={`${item.kind}:${item.findingId}:${item.at}`}>
                    <AttentionItemRow
                      item={item}
                      onNavigate={closePanel}
                    />
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
