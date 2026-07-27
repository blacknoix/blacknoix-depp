import { useCallback, useEffect, useReducer } from "react";

import { ApiError } from "../api/client";
import {
  fetchAgentFindings,
  fetchAgentInventory,
  fetchAgentRecentActivity,
} from "../api/agents";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import type { AgentInventoryItem, AgentRecentActivity } from "./types";

export type LoadPhase = "idle" | "loading" | "ready" | "error";
export type SectionPhase = "idle" | "loading" | "ready" | "error";

export interface AgentsState {
  load: LoadPhase;
  loadError: string | null;
  agents: AgentInventoryItem[];
  selectedId: string | null;
  findingsPhase: SectionPhase;
  findingsError: string | null;
  relatedFindings: Finding[];
  activityPhase: SectionPhase;
  activityError: string | null;
  recentActivity: AgentRecentActivity | null;
}

type Action =
  | { type: "load_start" }
  | { type: "load_success"; agents: AgentInventoryItem[] }
  | { type: "load_error"; message: string }
  | { type: "select"; id: string | null }
  | { type: "detail_start" }
  | { type: "findings_success"; findings: Finding[] }
  | { type: "findings_error"; message: string }
  | { type: "activity_success"; activity: AgentRecentActivity }
  | { type: "activity_error"; message: string };

const clearedDetail = {
  findingsPhase: "idle" as const,
  findingsError: null,
  relatedFindings: [] as Finding[],
  activityPhase: "idle" as const,
  activityError: null,
  recentActivity: null,
};

export const initialAgentsState: AgentsState = {
  load: "idle",
  loadError: null,
  agents: [],
  selectedId: null,
  ...clearedDetail,
};

export function agentsReducer(state: AgentsState, action: Action): AgentsState {
  switch (action.type) {
    case "load_start":
      return { ...state, load: "loading", loadError: null };
    case "load_success": {
      const stillSelected = action.agents.some((a) => a.id === state.selectedId);
      return {
        ...state,
        load: "ready",
        loadError: null,
        agents: action.agents,
        selectedId: stillSelected ? state.selectedId : null,
        ...(stillSelected ? {} : clearedDetail),
      };
    }
    case "load_error":
      return { ...state, load: "error", loadError: action.message };
    case "select":
      if (state.selectedId === action.id) {
        return state;
      }
      return {
        ...state,
        selectedId: action.id,
        ...(action.id
          ? {
              findingsPhase: "loading" as const,
              findingsError: null,
              relatedFindings: [],
              activityPhase: "loading" as const,
              activityError: null,
              recentActivity: null,
            }
          : clearedDetail),
      };
    case "detail_start":
      return {
        ...state,
        findingsPhase: "loading",
        findingsError: null,
        activityPhase: "loading",
        activityError: null,
      };
    case "findings_success":
      return {
        ...state,
        findingsPhase: "ready",
        relatedFindings: action.findings,
        findingsError: null,
      };
    case "findings_error":
      return {
        ...state,
        findingsPhase: "error",
        findingsError: action.message,
        relatedFindings: [],
      };
    case "activity_success":
      return {
        ...state,
        activityPhase: "ready",
        recentActivity: action.activity,
        activityError: null,
      };
    case "activity_error":
      return {
        ...state,
        activityPhase: "error",
        activityError: action.message,
        recentActivity: null,
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

export function useAgentsConsole(session: OperatorSession) {
  const [state, dispatch] = useReducer(agentsReducer, initialAgentsState);

  useEffect(() => {
    let cancelled = false;
    dispatch({ type: "load_start" });
    void (async () => {
      try {
        const agents = await fetchAgentInventory(session);
        if (cancelled) return;
        dispatch({ type: "load_success", agents });
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: "load_error", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session]);

  useEffect(() => {
    if (!state.selectedId) {
      return;
    }
    const agentId = state.selectedId;
    let cancelled = false;
    dispatch({ type: "detail_start" });
    void (async () => {
      const [findingsResult, activityResult] = await Promise.allSettled([
        fetchAgentFindings(session, agentId),
        fetchAgentRecentActivity(session, agentId),
      ]);
      if (cancelled) return;

      if (findingsResult.status === "fulfilled") {
        dispatch({ type: "findings_success", findings: findingsResult.value });
      } else {
        dispatch({
          type: "findings_error",
          message: errorMessage(findingsResult.reason),
        });
      }

      if (activityResult.status === "fulfilled") {
        dispatch({
          type: "activity_success",
          activity: activityResult.value,
        });
      } else {
        dispatch({
          type: "activity_error",
          message: errorMessage(activityResult.reason),
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, state.selectedId]);

  const selected =
    state.agents.find((a) => a.id === state.selectedId) ?? null;

  const selectAgent = useCallback((id: string | null) => {
    dispatch({ type: "select", id });
  }, []);

  return { state, selected, selectAgent };
}
