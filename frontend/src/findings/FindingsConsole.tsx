import type { OperatorSession } from "../auth/session";
import { FindingDetail } from "./FindingDetail";
import { FindingsList } from "./FindingsList";
import { SnoozePanel } from "./SnoozePanel";
import { SummaryStrip } from "./SummaryStrip";
import { useFindingsConsole } from "./useFindingsConsole";

interface Props {
  session: OperatorSession;
  onSignOut: () => void;
}

export function FindingsConsole({ session, onSignOut }: Props) {
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
      <header className="topbar">
        <div>
          <p className="brand">DEPP</p>
          <h1>Findings</h1>
        </div>
        <div className="topbar-meta">
          <span className="mono muted tiny">
            {session.kind === "tenant"
              ? `tenant ${session.tenantId}`
              : "bearer session"}
          </span>
          <button type="button" className="btn btn-secondary" onClick={onSignOut}>
            Sign out
          </button>
        </div>
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
