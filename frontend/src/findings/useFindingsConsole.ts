import { useEffect, useReducer, useRef } from "react";

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
    }
  | { type: "mutation_error"; message: string };

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
      };
    case "select":
      return { ...state, selectedId: action.id, mutationError: null };
    case "mutation_start":
      return {
        ...state,
        mutation: "pending",
        mutationError: null,
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
      };
    case "mutation_error":
      return {
        ...state,
        mutation: "error",
        mutationError: action.message,
      };
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

  function setFilters(filters: FindingsFilters) {
    dispatch({ type: "set_filters", filters });
  }

  function selectFinding(id: string | null) {
    dispatch({ type: "select", id });
  }

  async function refreshAfterMutation(selectedId: string | null) {
    if (!session) return;
    const result = await loadAll(session, filtersRef.current);
    dispatch({
      type: "mutation_success",
      ...result,
      selectedId: result.findings.some((f) => f.id === selectedId)
        ? selectedId
        : null,
    });
  }

  async function changeStatus(findingId: string, status: FindingStatus) {
    if (!session) return;
    dispatch({ type: "mutation_start" });
    try {
      await patchFindingStatus(session, findingId, status);
      await refreshAfterMutation(findingId);
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
    }
  }

  async function snoozeRule(ruleId: CorrelationRuleId, untilIso: string) {
    if (!session) return;
    dispatch({ type: "mutation_start" });
    try {
      await createSuppression(session, { ruleId, until: untilIso });
      await refreshAfterMutation(state.selectedId);
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
    }
  }

  async function clearSnooze(id: string) {
    if (!session) return;
    dispatch({ type: "mutation_start" });
    try {
      await clearSuppression(session, id);
      await refreshAfterMutation(state.selectedId);
    } catch (err) {
      dispatch({ type: "mutation_error", message: errorMessage(err) });
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
  };
}
