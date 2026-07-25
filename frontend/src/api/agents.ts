import { apiRequest } from "../api/client";
import type { OperatorSession } from "../auth/session";
import type { Finding } from "../findings/types";
import type { AgentInventoryItem } from "../agents/types";

export async function fetchAgentInventory(
  session: OperatorSession,
): Promise<AgentInventoryItem[]> {
  const data = await apiRequest<{ agents: AgentInventoryItem[] }>(
    session,
    "/v1/agents",
  );
  return data.agents;
}

export async function fetchAgentFindings(
  session: OperatorSession,
  agentId: string,
): Promise<Finding[]> {
  const params = new URLSearchParams({
    agentId,
    limit: "10",
    offset: "0",
  });
  const data = await apiRequest<{ findings: Finding[] }>(
    session,
    `/v1/findings?${params.toString()}`,
  );
  return data.findings;
}
