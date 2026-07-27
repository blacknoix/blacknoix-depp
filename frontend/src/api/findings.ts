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
  return patchFinding(session, findingId, { status });
}

export interface FindingPatch {
  status?: FindingStatus;
  ownerUserId?: string | null;
  claimOwner?: true;
  operatorNote?: string | null;
}

export async function patchFinding(
  session: OperatorSession,
  findingId: string,
  patch: FindingPatch,
): Promise<Finding> {
  const data = await apiRequest<{ finding: Finding }>(
    session,
    `/v1/findings/${findingId}`,
    {
      method: "PATCH",
      body: JSON.stringify(patch),
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

export interface SharedFindingView {
  id: string;
  name: string;
  filters: FindingsFilters;
  createdAt: string;
  createdByUserId: string | null;
}

export async function fetchSharedFindingViews(
  session: OperatorSession,
): Promise<SharedFindingView[]> {
  const data = await apiRequest<{ views: SharedFindingView[] }>(
    session,
    "/v1/findings/views",
  );
  return data.views;
}

export async function createSharedFindingView(
  session: OperatorSession,
  input: { name: string; filters: FindingsFilters },
): Promise<SharedFindingView> {
  const data = await apiRequest<{ view: SharedFindingView }>(
    session,
    "/v1/findings/views",
    {
      method: "POST",
      body: JSON.stringify({
        name: input.name,
        filters: {
          ...(input.filters.status ? { status: input.filters.status } : {}),
          ...(input.filters.ruleId ? { ruleId: input.filters.ruleId } : {}),
          ...(input.filters.agentId ? { agentId: input.filters.agentId } : {}),
        },
      }),
    },
  );
  return data.view;
}

export async function deleteSharedFindingView(
  session: OperatorSession,
  id: string,
): Promise<SharedFindingView> {
  const data = await apiRequest<{ view: SharedFindingView }>(
    session,
    `/v1/findings/views/${id}`,
    { method: "DELETE" },
  );
  return data.view;
}

export type AttentionKind = "finding.created" | "finding.status_changed";

export interface AttentionItem {
  kind: AttentionKind;
  findingId: string;
  title: string;
  status: FindingStatus;
  ruleId: string;
  agentId: string;
  at: string;
}

export interface FindingsAttentionDigest {
  generatedAt: string;
  since: string;
  maxLookbackHours: number;
  openCount: number;
  activeSuppressionCount: number;
  truncated: boolean;
  items: AttentionItem[];
}

export async function fetchFindingsAttention(
  session: OperatorSession,
  since: string | null,
): Promise<FindingsAttentionDigest> {
  const params = new URLSearchParams();
  if (since) {
    params.set("since", since);
  }
  const qs = params.toString();
  const path = qs
    ? `/v1/findings/attention?${qs}`
    : "/v1/findings/attention";
  return apiRequest<FindingsAttentionDigest>(session, path);
}
