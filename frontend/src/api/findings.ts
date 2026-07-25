import { apiRequest } from "./client";
import type { OperatorSession } from "../auth/session";
import type {
  CorrelationRuleId,
  Finding,
  FindingStatus,
  FindingsDashboard,
  FindingsFilters,
  Suppression,
} from "../findings/types";

export function buildFindingsListPath(filters: FindingsFilters): string {
  const params = new URLSearchParams();
  if (filters.agentId) {
    params.set("agentId", filters.agentId);
  }
  if (filters.status) {
    params.set("status", filters.status);
  }
  if (filters.ruleId) {
    params.set("ruleId", filters.ruleId);
  }
  params.set("limit", "50");
  params.set("offset", "0");
  const qs = params.toString();
  return `/v1/findings?${qs}`;
}

export async function fetchDashboard(
  session: OperatorSession,
): Promise<FindingsDashboard> {
  return apiRequest<FindingsDashboard>(session, "/v1/findings/dashboard");
}

export async function fetchFindings(
  session: OperatorSession,
  filters: FindingsFilters,
): Promise<Finding[]> {
  const data = await apiRequest<{ findings: Finding[] }>(
    session,
    buildFindingsListPath(filters),
  );
  return data.findings;
}

export async function patchFindingStatus(
  session: OperatorSession,
  findingId: string,
  status: FindingStatus,
): Promise<Finding> {
  const data = await apiRequest<{ finding: Finding }>(
    session,
    `/v1/findings/${findingId}`,
    {
      method: "PATCH",
      body: JSON.stringify({ status }),
    },
  );
  return data.finding;
}

export async function fetchSuppressions(
  session: OperatorSession,
): Promise<Suppression[]> {
  const data = await apiRequest<{ suppressions: Suppression[] }>(
    session,
    "/v1/findings/suppressions",
  );
  return data.suppressions;
}

export async function createSuppression(
  session: OperatorSession,
  input: { ruleId: CorrelationRuleId; until: string },
): Promise<Suppression> {
  const data = await apiRequest<{ suppression: Suppression }>(
    session,
    "/v1/findings/suppressions",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
  return data.suppression;
}

export async function clearSuppression(
  session: OperatorSession,
  id: string,
): Promise<Suppression> {
  const data = await apiRequest<{ suppression: Suppression }>(
    session,
    `/v1/findings/suppressions/${id}`,
    { method: "DELETE" },
  );
  return data.suppression;
}
