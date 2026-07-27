import type { Request } from "express";

import type { AuthStrategy, AuthenticatedPrincipal } from "../principal";

const TENANT_HEADER = "x-tenant-id";
const AGENT_HEADER = "x-agent-id";
const USER_HEADER = "x-user-id";

/**
 * Interim validation.
 *
 * ADR-0001 specifies tenant IDs are UUIDs. The opaque bounded form remains for
 * local development readability under this stand-in strategy only.
 */
const MAX_TENANT_ID_LENGTH = 64;
const SAFE_TENANT_ID = /^[A-Za-z0-9_-]+$/;
const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeTenantId(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  if (
    trimmed.length === 0 ||
    trimmed.length > MAX_TENANT_ID_LENGTH ||
    !SAFE_TENANT_ID.test(trimmed)
  ) {
    return undefined;
  }

  return trimmed;
}

function normalizeAgentId(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim().toLowerCase();
  if (!UUID.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

function normalizeUserId(value: string | undefined): string | undefined {
  return normalizeAgentId(value);
}

/**
 * Development-only strategy: trusts x-tenant-id (and optionally x-agent-id /
 * x-user-id).
 *
 * SECURITY: no verification. Banned when NODE_ENV=production.
 * x-agent-id exists so local telemetry ingest can exercise the agent
 * principal boundary without minting JWTs.
 * x-user-id is optional operator identity for local claim/audit exercises.
 * Present-but-invalid x-user-id fails closed (no principal).
 */
export const devHeaderStrategy: AuthStrategy = {
  name: "dev-header",

  authenticate(req: Request): AuthenticatedPrincipal | undefined {
    const tenantId = normalizeTenantId(req.get(TENANT_HEADER));

    if (!tenantId) {
      return undefined;
    }

    const rawUserId = req.get(USER_HEADER);
    let userId: string | undefined;
    if (typeof rawUserId === "string" && rawUserId.trim() !== "") {
      userId = normalizeUserId(rawUserId);
      if (!userId) {
        return undefined;
      }
    }

    const agentId = normalizeAgentId(req.get(AGENT_HEADER));

    if (agentId) {
      return { tenantId, agentId };
    }
    return userId ? { tenantId, userId } : { tenantId };
  },
};
