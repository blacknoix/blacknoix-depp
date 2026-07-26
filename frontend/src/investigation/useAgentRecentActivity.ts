import { useEffect, useState } from "react";

import { fetchAgentRecentActivity } from "../api/agents";
import { ApiError } from "../api/client";
import type { OperatorSession } from "../auth/session";
import type { AgentRecentActivity } from "../agents/types";

export type ActivityPhase = "idle" | "loading" | "ready" | "error";

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    return `${err.code}: ${err.message}`;
  }
  if (err instanceof Error) {
    return err.message;
  }
  return "Unexpected error";
}

/**
 * Loads the same 24h agent telemetry window used by Agents detail.
 * Sectional: failure does not block other finding detail content.
 */
export function useAgentRecentActivity(
  session: OperatorSession,
  agentId: string | null,
): {
  phase: ActivityPhase;
  error: string | null;
  activity: AgentRecentActivity | null;
} {
  const [phase, setPhase] = useState<ActivityPhase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [activity, setActivity] = useState<AgentRecentActivity | null>(null);

  useEffect(() => {
    if (!agentId) {
      setPhase("idle");
      setError(null);
      setActivity(null);
      return;
    }

    let cancelled = false;
    setPhase("loading");
    setError(null);
    setActivity(null);

    void (async () => {
      try {
        const next = await fetchAgentRecentActivity(session, agentId);
        if (cancelled) return;
        setActivity(next);
        setPhase("ready");
      } catch (err) {
        if (cancelled) return;
        setActivity(null);
        setError(errorMessage(err));
        setPhase("error");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, agentId]);

  return { phase, error, activity };
}
