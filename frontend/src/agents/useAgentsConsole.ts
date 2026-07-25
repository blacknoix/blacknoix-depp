import { useEffect, useReducer } from "react";

import { ApiError } from "../api/client";
import { fetchAgentFindings, fetchAgentInventory } from "../api/agents";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import type { AgentInventoryItem } from "./types";

export type LoadPhase = "idle" | "loading" | "ready" | "error";
export type DetailPhase = "idle" | "loading" | "ready" | "error";

export interface AgentsState {
  load: LoadPhase;
  loadError: string | null;
  agents: AgentInventoryItem[];
  selectedId: string | null;
  detail: DetailPhase;
  detailError: string | null;
  relatedFindings: Finding[];
}

type Action =
  | { type: "load_start" }
  | { type: "load_success"; agents: AgentInventoryItem[] }
  | { type: "load_error"; message: string }
  | { type: "select"; id: string | null }
  | { type: "detail_start" }
  | { type: "detail_success"; findings: Finding[] }
  | { type: "detail_error"; message: string };

export const initialAgentsState: AgentsState = {
  load: "idle",
  loadError: null,
  agents: [],
  selectedId: null,
  detail: "idle",
  detailError: null,
  relatedFindings: [],
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
        ...(stillSelected
          ? {}
          : {
              detail: "idle" as const,
              detailError: null,
              relatedFindings: [],
            }),
      };
    }
    case "load_error":
      return { ...state, load: "error", loadError: action.message };
    case "select":
      return {
        ...state,
        selectedId: action.id,
        detail: action.id ? "loading" : "idle",
        detailError: null,
        relatedFindings: [],
      };
    case "detail_start":
      return { ...state, detail: "loading", detailError: null };
    case "detail_success":
      return {
        ...state,
        detail: "ready",
        relatedFindings: action.findings,
        detailError: null,
      };
    case "detail_error":
      return {
        ...state,
        detail: "error",
        detailError: action.message,
        relatedFindings: [],
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
      try {
        const findings = await fetchAgentFindings(session, agentId);
        if (cancelled) return;
        dispatch({ type: "detail_success", findings });
      } catch (err) {
        if (cancelled) return;
        dispatch({ type: "detail_error", message: errorMessage(err) });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session, state.selectedId]);

  const selected =
    state.agents.find((a) => a.id === state.selectedId) ?? null;

  function selectAgent(id: string | null) {
    dispatch({ type: "select", id });
  }

  return { state, selected, selectAgent };
}
