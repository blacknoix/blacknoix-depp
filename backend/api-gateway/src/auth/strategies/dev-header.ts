import type { Request } from "express";

import type { AuthStrategy, AuthenticatedPrincipal } from "../principal";

const TENANT_HEADER = "x-tenant-id";

/**
 * Interim validation.
 *
 * ADR-0001 specifies tenant IDs are UUIDs, resolved into the Postgres runtime
 * setting `app.current_tenant` for RLS. Until Postgres lands, tenant IDs are
 * treated as opaque bounded identifiers so local development can use readable
 * values such as "tenant-dev-001".
 *
 * TODO(depp): tighten to UUID validation when Postgres/RLS is introduced.
 */
const MAX_TENANT_ID_LENGTH = 64;
const SAFE_TENANT_ID = /^[A-Za-z0-9_-]+$/;

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

/**
 * Development-only strategy: trusts the client-supplied x-tenant-id header.
 *
 * SECURITY: this performs no verification whatsoever. Any caller can claim any
 * tenant. It exists so the service can be exercised before real authentication
 * is built, and config/auth-mode.ts refuses to start the service with this
 * strategy when NODE_ENV=production.
 *
 * It establishes no userId and no roles, because a bare header cannot prove
 * either. Authorization beyond "a tenant was supplied" must wait for a verified
 * strategy.
 */
export const devHeaderStrategy: AuthStrategy = {
  name: "dev-header",

  authenticate(req: Request): AuthenticatedPrincipal | undefined {
    const tenantId = normalizeTenantId(req.get(TENANT_HEADER));

    if (!tenantId) {
      return undefined;
    }

    return { tenantId };
  },
};
