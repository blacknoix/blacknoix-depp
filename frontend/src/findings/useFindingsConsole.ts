import { useCallback, useEffect, useReducer, useRef } from "react";

import {
  clearSuppression,
  createSuppression,
  fetchDashboard,
  fetchFindings,
  fetchSuppressions,
  patchFindingStatus,
} from "../api/findings";
import { ApiError } from "../api/client";
import type { OperatorSession } from "../auth/session";
import { resolvePostMutationSelection } from "./triage";
import type {
  CorrelationRuleId,
  Finding,
  FindingStatus,
  FindingsDashboard,
  FindingsFilters,
  Suppression,
} from "./types";

export type LoadPhase = "idle" | "loading" | "ready" | "error";
export type MutationPhase = "idle" | "pending" | "error";

export interface ConsoleData {
  dashboard: FindingsDashboard | null;
  findings: Finding[];
  suppressions: Suppression[];
}

export interface ConsoleState {
  load: LoadPhase;
  loadError: string | null;
  data: ConsoleData;
  filters: FindingsFilters;
  selectedId: string | null;
  mutation: MutationPhase;
  mutationError: string | null;
  /** Quiet operator note after a successful status mutation that advanced selection. */
  triageNote: string | null;
}

type Action =
  | { type: "load_start" }
  | {
      type: "load_success";
      dashboard: FindingsDashboard;
      findings: Finding[];
      suppressions: Suppression[];
    }
  | { type: "load_error"; message: string }
  | { type: "set_filters"; filters: FindingsFilters }
  | { type: "select"; id: string | null }
  | { type: "mutation_start" }
  | {
      type: "mutation_success";
      findings: Finding[];
      dashboard: FindingsDashboard;
      suppressions: Suppression[];
      selectedId: string | null;
      triageNote: string | null;
    }
  | { type: "mutation_error"; message: string }
  | { type: "clear_triage_note" };

export const initialConsoleState: ConsoleState = {
  load: "idle",
  loadError: null,
  data: {
    dashboard: null,
    findings: [],
    suppressions: [],
  },
  filters: {},
  selectedId: null,
  mutation: "idle",
  mutationError: null,
  triageNote: null,
};

export function consoleReducer(
  state: ConsoleState,
  action: Action,
): ConsoleState {
  switch (action.type) {
    case "load_start":
      return {
        ...state,
        load: "loading",
        loadError: null,
      };
    case "load_success": {
      const stillSelected = action.findings.some(
        (f) => f.id === state.selectedId,
      );
      return {
        ...state,
        load: "ready",
        loadError: null,
        data: {
          dashboard: action.dashboard,
          findings: action.findings,
          suppressions: action.suppressions,
        },
        selectedId: stillSelected ? state.selectedId : null,
      };
    }
    case "load_error":
      return {
        ...state,
        load: "error",
        loadError: action.message,
      };
    case "set_filters":
      return {
        ...state,
        filters: action.filters,
        selectedId: null,
        triageNote: null,
      };
    case "select":
      if (state.selectedId === action.id) {
        return state;
      }
      return {
        ...state,
        selectedId: action.id,
        mutationError: null,
        triageNote: null,
      };
    case "mutation_start":
      return {
        ...state,
        mutation: "pending",
        mutationError: null,
        triageNote: null,
      };
    case "mutation_success":
      return {
        ...state,
        mutation: "idle",
        mutationError: null,
        data: {
          dashboard: action.dashboard,
          findings: action.findings,
          suppressions: action.suppressions,
        },
        selectedId: action.selectedId,
        triageNote: action.triageNote,
      };
    case "mutation_error":
      return {
        ...state,
        mutation: "error",
        mutationError: action.message,
      };
    case "clear_triage_note":
      return { ...state, triageNote: null };
    default:
      return state;
  }
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

async function loadAll(
  session: OperatorSession,
  filters: FindingsFilters,
): Promise<{
  dashboard: FindingsDashboard;
  findings: Finding[];
  suppressions: Suppression[];
}> {
  const [dashboard, findings, suppressions] = await Promise.all([
    fetchDashboard(session),
    fetchFindings(session, filters),
    fetchSuppressions(session),
  ]);
  return { dashboard, findings, suppressions };
}

export function useFindingsConsole(session: OperatorSession | null) {
  const [state, dispatch] = useReducer(consoleReducer, initialConsoleState);
  const filtersRef = useRef(state.filters);
  filtersRef.current = state.filters;
  const findingsRef = useRef(state.data.findings);
  findingsRef.current = state.data.findings;
  const selectedRef = useRef(state.selectedId);
  selectedRef.current = state.selectedId;

  useEffect(() => {
    if (!session) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "load_start" });

    void (async () => {
      try {
        const result = await loadAll(session, filtersRef.current);
        if (cancelled) return;
        dispatch({ type: "load_success", ...result });
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: "load_error", message: errorMessage(err) });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, state.filters]);

  const setFilters = useCallback((filters: FindingsFilters) => {
    dispatch({ type: "set_filters", filters });
  }, []);

  const selectFinding = useCallback((id: string | null) => {
    dispatch({ type: "select", id });
  }, []);

  const clearTriageNote = useCallback(() => {
    dispatch({ type: "clear_triage_note" });
  }, []);

  async function refreshKeepingSelection(
    preferredSelectedId: string | null,
    triageNote: string | null = null,
  ): Promise<string | null> {
    if (!session) return null;
    const result = await loadAll(session, filtersRef.current);
    const selectedId = result.findings.some((f) => f.id === preferredSelectedId)
      ? preferredSelectedId
      : null;
    dispatch({
      type: "mutation_success",
      ...result,
      selectedId,
      triageNote,
    });
    return selectedId;
  }

  /**
   * Status triage. Returns the post-mutation selected finding id (may advance
   * when the current item leaves the filtered list). Caller should sync URL.
   */
  async function changeStatus(
    findingId: string,
    status: FindingStatus,
  ): Promise<string | null> {
    if (!session) return null;
    const previousFindings = findingsRef.current;
    const previousSelectedId = findingId;
    dispatch({ type: "mutation_start" });
    try {
      await patchFindingStatus(session, findingId, status);
      const result = await loadAll(session, filtersRef.current);
      const selectedId = resolvePostMutationSelection({
        previousFindings,
        previousSelectedId,
        nextFindings: result.findings,
      });
      let triageNote: string | null = null;
      if (selectedId && selectedId !== previousSelectedId) {
        triageNote =
          "Status updated — advanced to the next finding in this filter.";
      } else if (!selectedId && previousSelectedId) {
        triageNote =
          "Status updated — no remaining findings match the current filters.";
      }
      dispatch({
        type: "mutation_success",
        ...result,
        selectedId,
        triageNote,
      });
      return selectedId;
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
      return selectedRef.current;
    }
  }

  async function snoozeRule(
    ruleId: CorrelationRuleId,
    untilIso: string,
  ): Promise<string | null> {
    if (!session) return selectedRef.current;
    dispatch({ type: "mutation_start" });
    try {
      await createSuppression(session, { ruleId, until: untilIso });
      return await refreshKeepingSelection(selectedRef.current);
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
      return selectedRef.current;
    }
  }

  async function clearSnooze(id: string): Promise<string | null> {
    if (!session) return selectedRef.current;
    dispatch({ type: "mutation_start" });
    try {
      await clearSuppression(session, id);
      return await refreshKeepingSelection(selectedRef.current);
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
      return selectedRef.current;
    }
  }

  const selected =
    state.data.findings.find((f) => f.id === state.selectedId) ?? null;

  return {
    state,
    selected,
    setFilters,
    selectFinding,
    changeStatus,
    snoozeRule,
    clearSnooze,
    clearTriageNote,
  };
}
