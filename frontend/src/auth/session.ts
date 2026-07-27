/**
 * Operator session for the findings console.
 *
 * - bearer: production-shaped human access JWT (Authorization header)
 * - tenant: local/dev-header stand-in (x-tenant-id only — never x-agent-id)
 *
 * Fail closed: no session → console does not call operator APIs.
 */

export type OperatorSession =
  | { kind: "bearer"; accessToken: string }
  | { kind: "tenant"; tenantId: string; userId?: string };

const STORAGE_KEY = "depp.findings.session.v1";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseTenantId(raw: string): string | undefined {
  const trimmed = raw.trim().toLowerCase();
  if (!UUID.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

export function parseBearerToken(raw: string): string | undefined {
  const trimmed = raw.trim();
  if (trimmed.length < 16) {
    return undefined;
  }
  // Reject accidental agent-shaped wiring hints in the paste box.
  if (trimmed.toLowerCase().startsWith("agent:")) {
    return undefined;
  }
  return trimmed;
}

export function loadSession(): OperatorSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as Record<string, unknown>;
    if (record.kind === "bearer" && typeof record.accessToken === "string") {
      const token = parseBearerToken(record.accessToken);
      return token ? { kind: "bearer", accessToken: token } : null;
    }
    if (record.kind === "tenant" && typeof record.tenantId === "string") {
      const tenantId = parseTenantId(record.tenantId);
      if (!tenantId) {
        return null;
      }
      if (typeof record.userId === "string" && record.userId.trim() !== "") {
        const userId = parseTenantId(record.userId);
        if (!userId) {
          return null;
        }
        return { kind: "tenant", tenantId, userId };
      }
      return { kind: "tenant", tenantId };
    }
    return null;
  } catch {
    return null;
  }
}

export function saveSession(session: OperatorSession): void {
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function clearSession(): void {
  sessionStorage.removeItem(STORAGE_KEY);
}

/** Optional env bootstrap for local operator console only. */
export function sessionFromEnv(): OperatorSession | null {
  const tenant = import.meta.env.VITE_DEV_TENANT_ID;
  if (typeof tenant === "string" && tenant.trim() !== "") {
    const tenantId = parseTenantId(tenant);
    if (tenantId) {
      return { kind: "tenant", tenantId };
    }
  }
  return null;
}

export function resolveInitialSession(): OperatorSession | null {
  return loadSession() ?? sessionFromEnv();
}
