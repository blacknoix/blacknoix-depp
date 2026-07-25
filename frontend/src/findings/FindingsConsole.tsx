import { useOutletContext } from "react-router-dom";

import type { OperatorSession } from "../auth/session";
import { FindingDetail } from "./FindingDetail";
import { FindingsList } from "./FindingsList";
import { SnoozePanel } from "./SnoozePanel";
import { SummaryStrip } from "./SummaryStrip";
import { useFindingsConsole } from "./useFindingsConsole";

export interface FindingsOutletContext {
  session: OperatorSession;
}

interface ViewProps {
  session: OperatorSession;
}

/**
 * Findings page body. Product chrome lives in OperatorShell.
 * `FindingsConsoleView` is the testable surface; the route wrapper reads session
 * from the shell outlet.
 */
export function FindingsConsoleView({ session }: ViewProps) {
  const {
    state,
    selected,
    setFilters,
    selectFinding,
    changeStatus,
    snoozeRule,
    clearSnooze,
  } = useFindingsConsole(session);

  const busy = state.load === "loading" || state.mutation === "pending";

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

      {state.mutation === "pending" ? (
        <p className="banner" role="status">
          Saving…
        </p>
      ) : null}

      <SummaryStrip dashboard={state.data.dashboard} />

      <div className="workspace">
        <FindingsList
          findings={state.data.findings}
          filters={state.filters}
          selectedId={state.selectedId}
          onFiltersChange={setFilters}
          onSelect={selectFinding}
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
