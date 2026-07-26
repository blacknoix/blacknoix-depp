import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router-dom";

import {
  fetchFindingsAttention,
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

/**
 * Compact shell attention digest — pull on open, no live stream.
 */
export function AttentionPanel({ session }: Props) {
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [digest, setDigest] = useState<FindingsAttentionDigest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

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

  const count = digest?.items.length ?? 0;
  const badge =
    count === 0 ? null : count > 9 ? "9+" : String(count);

  function onMarkCaughtUp() {
    if (!digest) {
      return;
    }
    const result = markAttentionSeenAt(session, digest.generatedAt);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setMessage("Marked caught up for this browser.");
    void load();
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
          <span className="attention-badge" aria-label={`${count} items`}>
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
                Findings changes since last caught up (max{" "}
                {digest?.maxLookbackHours ?? 24}h). Pull-based — not live.
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
              {digest.truncated ? " · Showing latest only" : ""}
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

          {!loading && digest && digest.items.length === 0 ? (
            <p className="muted tiny" role="status">
              Nothing new since the current cursor.
            </p>
          ) : null}

          {digest && digest.items.length > 0 ? (
            <ul className="attention-list">
              {digest.items.map((item) => {
                const to = attentionItemPath(item);
                const key = `${item.kind}:${item.findingId}:${item.at}`;
                return (
                  <li key={key}>
                    {to ? (
                      <Link
                        to={to}
                        className="attention-item"
                        onClick={() => setOpen(false)}
                      >
                        <span className="attention-kind">
                          {attentionKindLabel(item.kind)}
                        </span>
                        <span className="attention-title">{item.title}</span>
                        <span className="muted tiny mono">
                          {item.status} · {item.ruleId}
                        </span>
                        <span className="muted tiny">
                          {formatWhen(item.at)}
                        </span>
                      </Link>
                    ) : (
                      <div className="attention-item is-invalid">
                        <span className="attention-kind">
                          {attentionKindLabel(item.kind)}
                        </span>
                        <span className="error tiny">
                          Obsolete filters — open Findings manually.
                        </span>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
