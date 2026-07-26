import { useEffect, useMemo } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import {
  filtersEqual,
  parseFindingsSearchParams,
  serializeFindingsSearchParams,
} from "../routing/findingsUrlState";
import { FindingDetail } from "./FindingDetail";
import { FindingsList } from "./FindingsList";
import { SavedViewsBar } from "./SavedViewsBar";
import { SnoozePanel } from "./SnoozePanel";
import { SummaryStrip } from "./SummaryStrip";
import {
  adjacentFindingId,
  selectionPosition,
} from "./triage";
import type { CorrelationRuleId, FindingStatus, FindingsFilters } from "./types";
import { useFindingsConsole } from "./useFindingsConsole";

export interface FindingsOutletContext {
  session: OperatorSession;
}

interface ViewProps {
  session: OperatorSession;
}

/**
 * Findings page body. Product chrome lives in OperatorShell.
 * URL is the source of truth for status/ruleId/agentId filters and findingId
 * selection.
 */
export function FindingsConsoleView({ session }: ViewProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const {
    state,
    selected,
    setFilters,
    selectFinding,
    changeStatus,
    snoozeRule,
    clearSnooze,
  } = useFindingsConsole(session);

  const urlState = useMemo(
    () => parseFindingsSearchParams(searchParams),
    [searchParams],
  );

  useEffect(() => {
    if (!filtersEqual(state.filters, urlState.filters)) {
      setFilters(urlState.filters);
    }
  }, [urlState.filters, state.filters, setFilters]);

  useEffect(() => {
    if (state.load !== "ready") {
      return;
    }
    if (!urlState.findingId) {
      return;
    }
    if (state.data.findings.some((f) => f.id === urlState.findingId)) {
      if (state.selectedId !== urlState.findingId) {
        selectFinding(urlState.findingId);
      }
    }
  }, [
    state.load,
    state.data.findings,
    state.selectedId,
    urlState.findingId,
    selectFinding,
  ]);

  function writeUrl(next: {
    filters: FindingsFilters;
    findingId?: string | null;
  }) {
    setSearchParams(
      serializeFindingsSearchParams({
        filters: next.filters,
        findingId: next.findingId,
      }),
      { replace: true },
    );
  }

  function onFiltersChange(filters: FindingsFilters) {
    // Filter changes drop selection — keep URL coherent with the list.
    writeUrl({ filters, findingId: null });
  }

  function onSelect(id: string) {
    selectFinding(id);
    writeUrl({ filters: state.filters, findingId: id });
  }

  function onGoAdjacent(direction: -1 | 1) {
    const nextId = adjacentFindingId(
      state.data.findings,
      state.selectedId,
      direction,
    );
    if (!nextId) {
      return;
    }
    onSelect(nextId);
  }

  async function onChangeStatus(id: string, status: FindingStatus) {
    const nextId = await changeStatus(id, status);
    writeUrl({ filters: state.filters, findingId: nextId });
  }

  async function onSnooze(ruleId: CorrelationRuleId, untilIso: string) {
    const nextId = await snoozeRule(ruleId, untilIso);
    writeUrl({ filters: state.filters, findingId: nextId });
  }

  async function onClearSnooze(id: string) {
    const nextId = await clearSnooze(id);
    writeUrl({ filters: state.filters, findingId: nextId });
  }

  const busy = state.load === "loading" || state.mutation === "pending";
  const position = selectionPosition(state.data.findings, state.selectedId);
  const canGoPrev = Boolean(
    adjacentFindingId(state.data.findings, state.selectedId, -1),
  );
  const canGoNext = Boolean(
    adjacentFindingId(state.data.findings, state.selectedId, 1),
  );

  const filterBanners: string[] = [];
  if (urlState.invalid.agentId) {
    filterBanners.push("Invalid agent id in the URL — agent filter ignored.");
  }
  if (urlState.invalid.status) {
    filterBanners.push("Invalid status in the URL — status filter ignored.");
  }
  if (urlState.invalid.ruleId) {
    filterBanners.push("Invalid rule id in the URL — rule filter ignored.");
  }
  if (urlState.invalid.findingId) {
    filterBanners.push("Invalid finding id in the URL — selection ignored.");
  } else if (
    urlState.findingId &&
    state.load === "ready" &&
    state.mutation !== "pending" &&
    !state.data.findings.some((f) => f.id === urlState.findingId) &&
    // After triage advances/clears selection, URL is rewritten; only warn when
    // the URL still points at a missing finding while local selection is empty
    // or also mismatched (stale share link).
    state.selectedId !== urlState.findingId &&
    !state.triageNote
  ) {
    filterBanners.push(
      "Finding from the URL is not in the current filtered list.",
    );
  }

  return (
    <div className="console">
      <header className="page-header">
        <h1>Findings</h1>
        <p className="muted">
          Triage correlation findings and manage time-bounded rule snoozes.
          Filters are shareable via the URL.
        </p>
      </header>

      {state.load === "loading" && !state.data.dashboard ? (
        <p className="banner" role="status">
          Loading findings…
        </p>
      ) : null}

      {state.load === "error" ? (
        <p className="banner error" role="alert">
          {state.loadError ?? "Failed to load findings"}
        </p>
      ) : null}

      {filterBanners.map((message) => (
        <p key={message} className="banner error" role="alert">
          {message}
        </p>
      ))}

      {state.mutation === "pending" ? (
        <p className="banner" role="status">
          Saving…
        </p>
      ) : null}

      {state.filters.agentId ? (
        <p className="banner" role="status">
          Filtered to agent{" "}
          <span className="mono">{state.filters.agentId}</span>
        </p>
      ) : null}

      <SummaryStrip dashboard={state.data.dashboard} />

      <SavedViewsBar
        session={session}
        filters={state.filters}
        disabled={busy}
        onApply={onFiltersChange}
      />

      <div className="workspace">
        <FindingsList
          findings={state.data.findings}
          filters={state.filters}
          selectedId={state.selectedId}
          onFiltersChange={onFiltersChange}
          onSelect={onSelect}
          disabled={busy}
        />
        <FindingDetail
          finding={selected}
          suppressions={state.data.suppressions}
          mutationPending={state.mutation === "pending"}
          mutationError={state.mutationError}
          triageNote={state.triageNote}
          position={position}
          canGoPrev={canGoPrev}
          canGoNext={canGoNext}
          onChangeStatus={onChangeStatus}
          onSnooze={onSnooze}
          onGoPrev={() => onGoAdjacent(-1)}
          onGoNext={() => onGoAdjacent(1)}
        />
      </div>

      <SnoozePanel
        suppressions={state.data.suppressions}
        mutationPending={state.mutation === "pending"}
        onClear={onClearSnooze}
        onCreate={onSnooze}
      />
    </div>
  );
}

export function FindingsConsole() {
  const { session } = useOutletContext<FindingsOutletContext>();
  return <FindingsConsoleView session={session} />;
}
