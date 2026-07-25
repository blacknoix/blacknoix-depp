import { useEffect } from "react";
import { useOutletContext, useSearchParams } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import { parseUuidQueryParam } from "../routing/crossLinks";
import { FindingDetail } from "./FindingDetail";
import { FindingsList } from "./FindingsList";
import { SnoozePanel } from "./SnoozePanel";
import { SummaryStrip } from "./SummaryStrip";
import type { FindingsFilters } from "./types";
import { useFindingsConsole } from "./useFindingsConsole";

export interface FindingsOutletContext {
  session: OperatorSession;
}

interface ViewProps {
  session: OperatorSession;
}

/**
 * Findings page body. Product chrome lives in OperatorShell.
 * Cross-link params: ?agentId=&findingId= (URL is source of truth for those).
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

  const agentParam = parseUuidQueryParam(searchParams.get("agentId"));
  const findingParam = parseUuidQueryParam(searchParams.get("findingId"));

  useEffect(() => {
    const nextAgentId =
      agentParam.ok && agentParam.present ? agentParam.id : undefined;
    if (state.filters.agentId === nextAgentId) {
      return;
    }
    setFilters({
      status: state.filters.status,
      ruleId: state.filters.ruleId,
      ...(nextAgentId ? { agentId: nextAgentId } : {}),
    });
  }, [
    agentParam.ok,
    agentParam.present,
    agentParam.ok && agentParam.present ? agentParam.id : null,
    setFilters,
    state.filters.agentId,
    state.filters.status,
    state.filters.ruleId,
  ]);

  useEffect(() => {
    if (state.load !== "ready") {
      return;
    }
    if (!findingParam.ok || !findingParam.present) {
      return;
    }
    if (state.data.findings.some((f) => f.id === findingParam.id)) {
      if (state.selectedId !== findingParam.id) {
        selectFinding(findingParam.id);
      }
    }
  }, [
    state.load,
    state.data.findings,
    state.selectedId,
    findingParam,
    selectFinding,
  ]);

  function writeCrossLinkParams(next: {
    agentId?: string;
    findingId?: string;
  }) {
    const params = new URLSearchParams();
    if (next.agentId) {
      params.set("agentId", next.agentId);
    }
    if (next.findingId) {
      params.set("findingId", next.findingId);
    }
    setSearchParams(params, { replace: true });
  }

  function onFiltersChange(filters: FindingsFilters) {
    setFilters(filters);
    writeCrossLinkParams({
      agentId: filters.agentId,
      // Clearing filters drops finding focus — intentional.
    });
  }

  function onSelect(id: string) {
    selectFinding(id);
    writeCrossLinkParams({
      agentId: state.filters.agentId,
      findingId: id,
    });
  }

  const busy = state.load === "loading" || state.mutation === "pending";

  const agentBanner = !agentParam.ok
    ? "Invalid agent id in the URL — agent filter ignored."
    : null;

  const findingBanner =
    findingParam.ok &&
    findingParam.present &&
    state.load === "ready" &&
    !state.data.findings.some((f) => f.id === findingParam.id)
      ? "Finding from the URL is not in the current filtered list."
      : !findingParam.ok
        ? "Invalid finding id in the URL — selection ignored."
        : null;

  return (
    <div className="console">
      <header className="page-header">
        <h1>Findings</h1>
        <p className="muted">
          Triage correlation findings and manage time-bounded rule snoozes.
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

      {agentBanner ? (
        <p className="banner error" role="alert">
          {agentBanner}
        </p>
      ) : null}

      {findingBanner ? (
        <p className="banner error" role="alert">
          {findingBanner}
        </p>
      ) : null}

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
          mutationPending={state.mutation === "pending"}
          mutationError={state.mutationError}
          onChangeStatus={changeStatus}
          onSnooze={snoozeRule}
        />
      </div>

      <SnoozePanel
        suppressions={state.data.suppressions}
        mutationPending={state.mutation === "pending"}
        onClear={clearSnooze}
        onCreate={snoozeRule}
      />
    </div>
  );
}

export function FindingsConsole() {
  const { session } = useOutletContext<FindingsOutletContext>();
  return <FindingsConsoleView session={session} />;
}
