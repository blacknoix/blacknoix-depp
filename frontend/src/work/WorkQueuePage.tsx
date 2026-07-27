import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  Link,
  useOutletContext,
  useSearchParams,
} from "react-router-dom";

import type { AttentionItem } from "../api/findings";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import {
  allWorkSections,
  parseWorkSearchParams,
  resolveWorkLandingSections,
  sectionsEqual,
  serializeWorkSearchParams,
  toggleWorkSection,
} from "../routing/workUrlState";
import { attentionKindLabel } from "../shell/attentionLinks";
import {
  BULK_ACTIONS,
  bulkActionLabel,
  MAX_BULK_SELECTION,
  type BulkAction,
} from "./bulkActions";
import { useWorkQueue } from "./useWorkQueue";
import { WorkAnalyticsStrip } from "./WorkAnalyticsStrip";
import {
  attentionWorkQueuePath,
  findingWorkQueuePath,
  WORK_QUEUE_SECTIONS,
  type WorkQueueSectionId,
} from "./workQueue";
import {
  WorkViewsBar,
  type TenantDefaultWorkView,
} from "./WorkViewsBar";

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
  selectable: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelect: (findingId: string) => void;
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
      {props.selectable ? (
        <label className="work-queue-select">
          <span className="visually-hidden">
            Select {props.item.title}
          </span>
          <input
            type="checkbox"
            checked={props.selected}
            disabled={props.selectionDisabled}
            onChange={() => props.onToggleSelect(props.item.findingId)}
          />
        </label>
      ) : null}
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

function FindingRow(props: {
  finding: Finding;
  selectable: boolean;
  selected: boolean;
  selectionDisabled: boolean;
  onToggleSelect: (findingId: string) => void;
}) {
  return (
    <li className="work-queue-row">
      {props.selectable ? (
        <label className="work-queue-select">
          <span className="visually-hidden">
            Select {props.finding.title}
          </span>
          <input
            type="checkbox"
            checked={props.selected}
            disabled={props.selectionDisabled}
            onChange={() => props.onToggleSelect(props.finding.id)}
          />
        </label>
      ) : null}
      <Link
        className="work-queue-link"
        to={findingWorkQueuePath(props.finding)}
      >
        <span className="work-queue-kind">{props.finding.status}</span>
        <span className="work-queue-title">{props.finding.title}</span>
        <span className="muted tiny mono">{props.finding.ruleId}</span>
        <span className="muted tiny">
          {formatWhen(props.finding.createdAt)}
        </span>
      </Link>
    </li>
  );
}

/**
 * Daily operator entry point: prioritized queues composed from existing
 * Findings / Attention semantics. Tiny bulk claim / clear / resolve and a
 * compact queue-health strip — not an inbox, mass-edit, or BI dashboard.
 */
export function WorkQueuePage() {
  const { session } = useOutletContext<WorkOutletContext>();
  const [searchParams, setSearchParams] = useSearchParams();
  const urlState = useMemo(
    () => parseWorkSearchParams(searchParams),
    [searchParams],
  );
  const activeSections = urlState.sections;
  const activeSectionSet = useMemo(
    () => new Set(activeSections),
    [activeSections],
  );
  /** undefined = shared views not resolved yet; null = no valid tenant default. */
  const [tenantDefault, setTenantDefault] = useState<
    TenantDefaultWorkView | null | undefined
  >(undefined);
  const [tenantDefaultBanner, setTenantDefaultBanner] = useState<string | null>(
    null,
  );

  const {
    phase,
    error,
    message,
    data,
    hasIdentity,
    dismissPending,
    bulkPending,
    selectedIds,
    reload,
    dismissFollowUp,
    toggleSelected,
    clearSelection,
    runBulkAction,
  } = useWorkQueue(session);

  const loading = phase === "loading" || phase === "idle";
  const selectionDisabled = loading || bulkPending || dismissPending;
  const selectedCount = selectedIds.size;
  const canBulk = hasIdentity && selectedCount > 0 && !bulkPending;

  function writeSections(
    next: readonly WorkQueueSectionId[],
    opts?: { tenantDefaultName?: string | null },
  ) {
    if (opts && "tenantDefaultName" in opts) {
      setTenantDefaultBanner(opts.tenantDefaultName ?? null);
    } else {
      setTenantDefaultBanner(null);
    }
    const params = serializeWorkSearchParams({ sections: next });
    setSearchParams(params, { replace: true });
  }

  // Bare /work (sections unset): apply tenant default, else product all.
  // Explicit URL (including sections=all) always wins.
  useEffect(() => {
    if (urlState.kind !== "unset") {
      return;
    }
    if (tenantDefault === undefined) {
      return;
    }
    const resolved = resolveWorkLandingSections({
      url: urlState,
      tenantDefault,
    });
    if (!resolved.shouldWriteUrl) {
      return;
    }
    writeSections(resolved.sections, {
      tenantDefaultName:
        resolved.source === "tenant_default"
          ? resolved.tenantDefaultName
          : null,
    });
    // Intentionally omit writeSections: land once per unset URL + resolved default.
  }, [urlState, tenantDefault, setSearchParams]);

  function onToggleSection(id: WorkQueueSectionId) {
    writeSections(toggleWorkSection(activeSections, id));
  }

  function onApplyView(sections: WorkQueueSectionId[]) {
    writeSections(sections);
  }

  async function onBulk(action: BulkAction) {
    if (!canBulk) {
      return;
    }
    if (action === "resolve") {
      const ok = window.confirm(
        `Mark ${selectedCount} finding${selectedCount === 1 ? "" : "s"} resolved?`,
      );
      if (!ok) {
        return;
      }
    }
    await runBulkAction(action);
  }

  const visibleSections = WORK_QUEUE_SECTIONS.filter((section) =>
    activeSectionSet.has(section.id),
  );

  return (
    <div className="console work-queue">
      <header className="page-header">
        <h1>Work</h1>
        <p className="muted">
          What to look at first — queue health, section focus, local or shared
          Work views, optional tenant default, then claim / clear / resolve.
          Detail triage stays on Findings.
        </p>
      </header>

      <WorkAnalyticsStrip
        metrics={data.metrics}
        loading={loading}
        onFocusSection={(section) => writeSections([section])}
      />

      <div
        className="work-queue-section-toggles"
        role="group"
        aria-label="Work sections"
      >
        {WORK_QUEUE_SECTIONS.map((section) => {
          const on = activeSectionSet.has(section.id);
          return (
            <button
              key={section.id}
              type="button"
              className={
                on
                  ? "btn btn-secondary work-section-chip is-on"
                  : "btn btn-secondary work-section-chip"
              }
              aria-pressed={on}
              disabled={loading || bulkPending}
              onClick={() => onToggleSection(section.id)}
            >
              {section.title}
            </button>
          );
        })}
        {!sectionsEqual(activeSections, allWorkSections()) ? (
          <button
            type="button"
            className="btn btn-secondary"
            disabled={loading || bulkPending}
            onClick={() => writeSections(allWorkSections())}
          >
            Show all
          </button>
        ) : null}
      </div>

      <WorkViewsBar
        session={session}
        sections={activeSections}
        disabled={loading || bulkPending || dismissPending}
        onApply={onApplyView}
        onTenantDefaultResolved={setTenantDefault}
      />

      <div className="work-queue-toolbar">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={loading || dismissPending || bulkPending}
          onClick={() => void reload()}
        >
          Refresh
        </button>
        {loading ? (
          <span className="muted tiny" role="status">
            Loading queues…
          </span>
        ) : null}
        {bulkPending ? (
          <span className="muted tiny" role="status">
            Applying bulk action…
          </span>
        ) : null}
      </div>

      {hasIdentity && selectedCount > 0 ? (
        <div
          className="work-queue-bulk-bar"
          role="region"
          aria-label="Bulk actions"
        >
          <span className="work-queue-bulk-count" role="status">
            {selectedCount} selected
            {selectedCount >= MAX_BULK_SELECTION
              ? ` (max ${MAX_BULK_SELECTION})`
              : ""}
          </span>
          <div className="work-queue-bulk-actions">
            {BULK_ACTIONS.map((action) => (
              <button
                key={action}
                type="button"
                className={
                  action === "resolve" ? "btn" : "btn btn-secondary"
                }
                disabled={!canBulk}
                onClick={() => void onBulk(action)}
              >
                {bulkActionLabel(action)}
              </button>
            ))}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={bulkPending}
              onClick={clearSelection}
            >
              Clear selection
            </button>
          </div>
        </div>
      ) : null}

      {urlState.invalidSections ? (
        <p className="banner" role="status">
          Invalid sections in the URL were ignored — showing the default Work
          home.
        </p>
      ) : null}

      {tenantDefaultBanner ? (
        <p className="banner" role="status">
          Showing tenant default Work view “{tenantDefaultBanner}”. Toggle
          sections or apply another view to override for this session.
        </p>
      ) : null}

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
          Operator identity is required for Action needed, Reminders due, Mine,
          and bulk actions. Unowned open still loads. Connect with a user id
          (or bearer session) to select and act.
        </p>
      ) : null}

      <div className="work-queue-sections">
        {visibleSections.map((section) => {
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
                    selectable={hasIdentity}
                    selected={selectedIds.has(item.findingId)}
                    selectionDisabled={selectionDisabled}
                    onToggleSelect={toggleSelected}
                    dismissDisabled={dismissPending || bulkPending}
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
                    selectable={hasIdentity}
                    selected={selectedIds.has(item.findingId)}
                    selectionDisabled={selectionDisabled}
                    onToggleSelect={toggleSelected}
                    dismissDisabled={dismissPending || bulkPending}
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
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    selectable={hasIdentity}
                    selected={selectedIds.has(finding.id)}
                    selectionDisabled={selectionDisabled}
                    onToggleSelect={toggleSelected}
                  />
                ))}
              </ul>
            );
          } else {
            count = data.unownedOpen.length;
            truncated = data.unownedOpenTruncated;
            itemsNode = (
              <ul className="work-queue-list">
                {data.unownedOpen.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    selectable={hasIdentity}
                    selected={selectedIds.has(finding.id)}
                    selectionDisabled={selectionDisabled || !hasIdentity}
                    onToggleSelect={toggleSelected}
                  />
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
