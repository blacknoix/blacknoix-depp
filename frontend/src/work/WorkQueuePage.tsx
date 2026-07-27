import type { ReactNode } from "react";
import { Link, useOutletContext } from "react-router-dom";

import type { AttentionItem } from "../api/findings";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import { attentionKindLabel } from "../shell/attentionLinks";
import { useWorkQueue } from "./useWorkQueue";
import {
  attentionWorkQueuePath,
  findingWorkQueuePath,
  WORK_QUEUE_SECTIONS,
} from "./workQueue";

export interface WorkOutletContext {
  session: OperatorSession;
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

function AttentionRow(props: {
  item: AttentionItem;
  onDismiss?: (item: AttentionItem) => void;
  dismissDisabled?: boolean;
}) {
  const path = attentionWorkQueuePath(props.item);
  const body = (
    <>
      <span className="work-queue-kind">{attentionKindLabel(props.item.kind)}</span>
      <span className="work-queue-title">{props.item.title}</span>
      <span className="muted tiny mono">{props.item.ruleId}</span>
      <span className="muted tiny">{formatWhen(props.item.at)}</span>
    </>
  );

  return (
    <li className="work-queue-row">
      {path ? (
        <Link className="work-queue-link" to={path}>
          {body}
        </Link>
      ) : (
        <div className="work-queue-link is-invalid" aria-disabled="true">
          {body}
          <span className="muted tiny">Cannot open — invalid context</span>
        </div>
      )}
      {props.onDismiss ? (
        <button
          type="button"
          className="btn btn-secondary work-queue-dismiss"
          disabled={props.dismissDisabled}
          onClick={() => props.onDismiss?.(props.item)}
        >
          Dismiss
        </button>
      ) : null}
    </li>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  return (
    <li className="work-queue-row">
      <Link className="work-queue-link" to={findingWorkQueuePath(finding)}>
        <span className="work-queue-kind">{finding.status}</span>
        <span className="work-queue-title">{finding.title}</span>
        <span className="muted tiny mono">{finding.ruleId}</span>
        <span className="muted tiny">{formatWhen(finding.createdAt)}</span>
      </Link>
    </li>
  );
}

/**
 * Daily operator entry point: prioritized queues composed from existing
 * Findings / Attention semantics. Not an inbox or analytics dashboard.
 */
export function WorkQueuePage() {
  const { session } = useOutletContext<WorkOutletContext>();
  const {
    phase,
    error,
    message,
    data,
    hasIdentity,
    dismissPending,
    reload,
    dismissFollowUp,
  } = useWorkQueue(session);

  const loading = phase === "loading" || phase === "idle";

  return (
    <div className="console work-queue">
      <header className="page-header">
        <h1>Work</h1>
        <p className="muted">
          What to look at first — Action needed, due reminders, then Mine and
          Unowned open. Triage stays on Findings; Attention remains the change
          digest.
        </p>
      </header>

      <div className="work-queue-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || dismissPending}
          onClick={() => void reload()}
        >
          Refresh
        </button>
        {loading ? (
          <span className="muted tiny" role="status">
            Loading queues…
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="error" role="alert">
          {error}
        </p>
      ) : null}
      {message ? (
        <p className="banner" role="status">
          {message}
        </p>
      ) : null}

      {!hasIdentity ? (
        <p className="banner" role="status">
          Operator identity is required for Action needed, Reminders due, and
          Mine. Unowned open still loads. Connect with a user id (or bearer
          session) to see owner-aware queues.
        </p>
      ) : null}

      <div className="work-queue-sections">
        {WORK_QUEUE_SECTIONS.map((section) => {
          const identityBlocked =
            section.requiresOperatorIdentity && !hasIdentity;

          let itemsNode: ReactNode = null;
          let count = 0;
          let truncated = false;

          if (section.id === "action_needed") {
            count = data.actionNeeded.length;
            truncated = data.actionNeededTruncated;
            itemsNode = identityBlocked ? null : (
              <ul className="work-queue-list">
                {data.actionNeeded.map((item) => (
                  <AttentionRow
                    key={`${item.kind}:${item.findingId}`}
                    item={item}
                    dismissDisabled={dismissPending}
                    onDismiss={(row) => void dismissFollowUp(row)}
                  />
                ))}
              </ul>
            );
          } else if (section.id === "reminders_due") {
            count = data.remindersDue.length;
            truncated = data.remindersDueTruncated;
            itemsNode = identityBlocked ? null : (
              <ul className="work-queue-list">
                {data.remindersDue.map((item) => (
                  <AttentionRow
                    key={`${item.kind}:${item.findingId}`}
                    item={item}
                    dismissDisabled={dismissPending}
                    onDismiss={(row) => void dismissFollowUp(row)}
                  />
                ))}
              </ul>
            );
          } else if (section.id === "mine") {
            count = data.mine.length;
            truncated = data.mineTruncated;
            itemsNode = identityBlocked ? null : (
              <ul className="work-queue-list">
                {data.mine.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} />
                ))}
              </ul>
            );
          } else {
            count = data.unownedOpen.length;
            truncated = data.unownedOpenTruncated;
            itemsNode = (
              <ul className="work-queue-list">
                {data.unownedOpen.map((finding) => (
                  <FindingRow key={finding.id} finding={finding} />
                ))}
              </ul>
            );
          }

          const empty =
            !identityBlocked &&
            phase === "ready" &&
            count === 0 &&
            !loading;

          return (
            <section
              key={section.id}
              className="work-queue-section"
              aria-labelledby={`work-queue-${section.id}`}
              data-section={section.id}
            >
              <header className="work-queue-section-header">
                <div>
                  <h2 id={`work-queue-${section.id}`}>{section.title}</h2>
                  <p className="muted tiny">{section.description}</p>
                </div>
                <Link className="tiny" to={section.queuePath}>
                  View all in Findings
                </Link>
              </header>

              {identityBlocked ? (
                <p className="empty muted" role="status">
                  Unavailable without operator identity.
                </p>
              ) : null}
              {empty ? (
                <p className="empty muted" role="status">
                  Nothing here.
                </p>
              ) : null}
              {itemsNode}
              {truncated && !identityBlocked ? (
                <p className="muted tiny">
                  Showing a subset — open Findings for the full queue.
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
