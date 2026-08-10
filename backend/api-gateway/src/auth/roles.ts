/**
 * Narrow DEPP role claims for least-privilege authorization seams.
 *
 * Not a full RBAC matrix (ADR-0003 deferred). Only allow-listed role names are
 * accepted from JWTs / dev-header.
 *
 * Empty/missing human roles: operator-equivalent only in AUTH_EXPLICIT_ROLES_MODE=compat
 * (with a rate-limited warning). In enforce mode they are denied (ADR-0011).
 */

import { logLifecycle } from "../lib/log";
import type { ExplicitRolesMode } from "./explicit-roles-mode";
import {
  DEFAULT_EXPLICIT_ROLES_MODE,
} from "./explicit-roles-mode";
import type { AuthenticatedPrincipal } from "./principal";

export const DEPP_ROLES = ["operator", "auditor"] as const;

export type DeppRole = (typeof DEPP_ROLES)[number];

/**
 * Transitional default claimed on AuthService-minted human JWTs until IdP /
 * persisted role mapping lands (ADR-0011).
 */
export const TRANSITIONAL_HUMAN_OPERATOR_ROLES: readonly DeppRole[] = [
  "operator",
];

const ROLE_SET = new Set<string>(DEPP_ROLES);

/** Module-configured mode (set at startup / test). Defaults to compat. */
let explicitRolesMode: ExplicitRolesMode = DEFAULT_EXPLICIT_ROLES_MODE;

export function configureExplicitRolesMode(mode: ExplicitRolesMode): void {
  explicitRolesMode = mode;
}

export function getExplicitRolesMode(): ExplicitRolesMode {
  return explicitRolesMode;
}

/**
 * Filters unknown role strings. Returns undefined when nothing usable remains
 * (missing / empty / unsupported-only → same authorization outcome).
 */
export function normalizeDeppRoles(
  raw: unknown,
): readonly DeppRole[] | undefined {
  const collected: DeppRole[] = [];
  const seen = new Set<string>();

  const push = (value: string) => {
    const role = value.trim().toLowerCase();
    if (!ROLE_SET.has(role) || seen.has(role)) {
      return;
    }
    seen.add(role);
    collected.push(role as DeppRole);
  };

  if (typeof raw === "string") {
    for (const part of raw.split(",")) {
      push(part);
    }
  } else if (Array.isArray(raw)) {
    for (const item of raw) {
      if (typeof item === "string") {
        push(item);
      }
    }
  }

  return collected.length > 0 ? collected : undefined;
}

export function isHumanPrincipal(principal: AuthenticatedPrincipal): boolean {
  return principal.agentId === undefined;
}

/**
 * Agent machine principal (mode-independent). True when agentId is present.
 * Used by agent-only routes; does not consult roles or AUTH_EXPLICIT_ROLES_MODE.
 */
export function canActAsAgent(principal: AuthenticatedPrincipal): boolean {
  return (
    typeof principal.agentId === "string" && principal.agentId.trim() !== ""
  );
}

export function hasDeppRole(
  principal: AuthenticatedPrincipal,
  role: DeppRole,
): boolean {
  return (principal.roles ?? []).includes(role);
}

function hasExplicitRoles(principal: AuthenticatedPrincipal): boolean {
  return Boolean(principal.roles && principal.roles.length > 0);
}

/**
 * Bounded rate limiter for compat implicit-operator warnings.
 *
 * Key: tenantId + subject (userId, else sessionId, else "human").
 * Capacity: fixed max entries; FIFO eviction of oldest key when full.
 * Interval: one warn per key per WARN_INTERVAL_MS.
 */
const WARN_INTERVAL_MS = 60_000;
const WARN_MAX_ENTRIES = 1_024;
const warnLastEmitted = new Map<string, number>();

function warnSubject(principal: AuthenticatedPrincipal): string {
  if (principal.userId) {
    return principal.userId;
  }
  if (principal.sessionId) {
    return principal.sessionId;
  }
  return "human";
}

function compatWarnKey(principal: AuthenticatedPrincipal): string {
  return `${principal.tenantId}\0${warnSubject(principal)}`;
}

/** Test/reset hook — clears rate-limiter state. */
export function resetImplicitOperatorCompatWarnState(): void {
  warnLastEmitted.clear();
}

/** Test helper — current bounded map size. */
export function implicitOperatorCompatWarnMapSize(): number {
  return warnLastEmitted.size;
}

function maybeWarnImplicitOperatorCompat(
  principal: AuthenticatedPrincipal,
): void {
  const now = Date.now();
  const key = compatWarnKey(principal);
  const last = warnLastEmitted.get(key);
  if (last !== undefined && now - last < WARN_INTERVAL_MS) {
    return;
  }

  // Capacity bound: FIFO-evict oldest insertion when full and key is new.
  // Re-insert (delete+set) moves an existing key to the end so recently warned
  // subjects are less likely to be evicted next.
  if (warnLastEmitted.has(key)) {
    warnLastEmitted.delete(key);
  } else if (warnLastEmitted.size >= WARN_MAX_ENTRIES) {
    const oldest = warnLastEmitted.keys().next().value;
    if (oldest !== undefined) {
      warnLastEmitted.delete(oldest);
    }
  }
  warnLastEmitted.set(key, now);

  logLifecycle("warn", "implicit_operator_compat", {
    reason: "implicit_operator_compat",
    message:
      "Human principal missing explicit roles; treated as operator in AUTH_EXPLICIT_ROLES_MODE=compat. Set roles (operator/auditor) and switch to enforce before production.",
    tenantId: principal.tenantId,
    principalKind: "human",
    subjectKind: principal.userId
      ? "user"
      : principal.sessionId
        ? "session"
        : "anonymous_human",
    explicitRolesMode: "compat",
  });
}

/**
 * Operator for agent-management and (by default) audit read.
 * Empty/missing roles → operator only in compat mode (with warning).
 */
export function isOperatorPrincipal(
  principal: AuthenticatedPrincipal,
): boolean {
  if (!isHumanPrincipal(principal)) {
    return false;
  }
  if (hasExplicitRoles(principal)) {
    return hasDeppRole(principal, "operator");
  }
  if (explicitRolesMode === "compat") {
    maybeWarnImplicitOperatorCompat(principal);
    return true;
  }
  return false;
}

/** Investigation-only; may also hold operator (union of permissions). */
export function isAuditorPrincipal(
  principal: AuthenticatedPrincipal,
): boolean {
  return isHumanPrincipal(principal) && hasDeppRole(principal, "auditor");
}

/** Auditor without operator — investigation read only. */
export function isAuditorOnlyPrincipal(
  principal: AuthenticatedPrincipal,
): boolean {
  return isAuditorPrincipal(principal) && !isOperatorPrincipal(principal);
}

export function canReadAuditLogs(principal: AuthenticatedPrincipal): boolean {
  return isOperatorPrincipal(principal) || isAuditorPrincipal(principal);
}

/**
 * Enroll / inventory / rotate / revoke / device-identity revoke.
 * Auditor-only and empty-role (enforce) principals are denied.
 */
export function canManageAgents(principal: AuthenticatedPrincipal): boolean {
  return isOperatorPrincipal(principal);
}

/**
 * GET telemetry query/read: agents (self-scoped) or human operators.
 * Auditors and empty-role humans in enforce mode are denied (ADR-0011 follow-on).
 * Compat empty-role humans use isOperatorPrincipal (rate-limited warn).
 */
export function canQueryTelemetry(principal: AuthenticatedPrincipal): boolean {
  if (!isHumanPrincipal(principal)) {
    return true;
  }
  return isOperatorPrincipal(principal);
}

/**
 * GET /v1/findings list: agents (self-scoped) or human operators.
 * Auditors denied. Compat empty-role humans use isOperatorPrincipal.
 */
export function canListFindings(principal: AuthenticatedPrincipal): boolean {
  if (!isHumanPrincipal(principal)) {
    return true;
  }
  return isOperatorPrincipal(principal);
}

/**
 * Findings dashboard / attention / suppressions / views / triage / silence.
 * Agents and auditors denied; humans need isOperatorPrincipal.
 */
export function canManageFindings(principal: AuthenticatedPrincipal): boolean {
  return isOperatorPrincipal(principal);
}

/**
 * GET /v1/tenants/me — minimal tenant identity echo for humans.
 * Operators (incl. compat empty-role) and auditors allowed; agents denied
 * (agent JWT already carries tid). Same human set as audit-read.
 */
export function canReadTenantSelf(principal: AuthenticatedPrincipal): boolean {
  return canReadAuditLogs(principal);
}
