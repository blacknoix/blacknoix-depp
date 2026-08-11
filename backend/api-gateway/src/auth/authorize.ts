import type { Request } from "express";

import { AppError } from "../middleware/error-handler";
import { requirePrincipal } from "../middleware/tenant-context";
import type { AuthenticatedPrincipal } from "./principal";
import {
  canActAsAgent,
  canListFindings,
  canManageAgents,
  canManageFindings,
  canQueryTelemetry,
  canReadAlerts,
  canReadTenantSelf,
} from "./roles";

/** Authenticated principal with a non-empty agentId. */
export type AgentPrincipal = AuthenticatedPrincipal & { agentId: string };

/**
 * Operator principal for agent enrollment (human path) / inventory /
 * credential revoke / device-identity revoke. Auditor-only denied.
 */
export function requireAgentManager(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canManageAgents(principal)) {
    throw new AppError(
      "AGENTS_REJECTED",
      403,
      "Agent management requires an operator principal",
    );
  }
  return principal;
}

/**
 * Telemetry query/read: agent (self-scoped) or human operator.
 * Auditors and enforce-mode empty-role humans are denied.
 */
export function requireTelemetryQuerier(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canQueryTelemetry(principal)) {
    throw new AppError(
      "TELEMETRY_QUERY_REJECTED",
      403,
      "Telemetry query requires an operator or agent principal",
    );
  }
  return principal;
}

/**
 * Findings list: agent (self-scoped) or human operator.
 */
export function requireFindingsReader(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canListFindings(principal)) {
    throw new AppError(
      "FINDINGS_REJECTED",
      403,
      "Findings query requires an operator or agent principal",
    );
  }
  return principal;
}

/**
 * Findings dashboard / attention / suppressions / views / triage / silence.
 * Agents and auditors denied.
 */
export function requireFindingsOperator(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canManageFindings(principal)) {
    throw new AppError(
      "FINDINGS_REJECTED",
      403,
      "Findings management requires an operator principal",
    );
  }
  return principal;
}

/**
 * GET /v1/tenants/me — human operator or auditor (minimal identity echo).
 * Agents denied.
 */
export function requireTenantSelfReader(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canReadTenantSelf(principal)) {
    throw new AppError(
      "TENANT_SELF_REJECTED",
      403,
      "Tenant self-read requires an operator or auditor principal",
    );
  }
  return principal;
}

/**
 * GET /v1/alerts — human operator or auditor (read-only). Agents denied.
 */
export function requireAlertReader(req: Request): AuthenticatedPrincipal {
  const principal = requirePrincipal(req);
  if (!canReadAlerts(principal)) {
    throw new AppError(
      "ALERTS_REJECTED",
      403,
      "Alert read requires an operator or auditor principal",
    );
  }
  return principal;
}

/**
 * Agent-only routes (threat-event submit, device-identity bind, telemetry ingest).
 * Mode-independent: does not consult roles or AUTH_EXPLICIT_ROLES_MODE.
 * Preserves 401 AGENT_AUTH_REQUIRED for human/missing-agent principals.
 */
export function requireAgent(req: Request): AgentPrincipal {
  const principal = requirePrincipal(req);
  if (!canActAsAgent(principal) || !principal.agentId) {
    throw new AppError(
      "AGENT_AUTH_REQUIRED",
      401,
      "Agent authentication is required",
    );
  }
  return principal as AgentPrincipal;
}
