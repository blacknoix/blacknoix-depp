# ADR-0011: Staged removal of legacy implicit-operator authorization

- Status: Accepted
- Date: 2026-08-08

## Context

ADR-0010 introduced allow-listed `operator` / `auditor` claims and least-privilege
auditor audit-read. For backwards compatibility it treated human principals with
**missing or empty** `roles` as operators.

That fallback preserved local development and existing JWTs without a roles
claim, but it is not a production-safe permanent authorization model: any
authenticated human without an explicit role silently receives operator-class
privileges on the routes that consult `isOperatorPrincipal`.

Full persisted `user_roles`, IdP synchronization, and a broad `requireRole`
catalog remain deferred (ADR-0003). This ADR stages a migration from implicit
operator privilege to explicit role authorization without abruptly breaking
local development or tests.

## Decision

### Configuration

`AUTH_EXPLICIT_ROLES_MODE=compat|enforce`

| Value | Behavior |
|---|---|
| `compat` (default when unset) | Missing/empty/unsupported-only human roles remain operator-equivalent for routes that use `isOperatorPrincipal` / `canManageAgents` / `canReadAuditLogs`. Emit rate-limited `implicit_operator_compat` warnings. |
| `enforce` | Missing/empty/unsupported-only human roles are **denied** (no silent elevation). Explicit `operator` and `auditor` behave per ADR-0010. |

Invalid values fail closed at startup (same pattern as `AUTH_MODE`).

**Default is deliberately `compat` when unset.** Deployments that run verified JWT
auth in production **must** set `AUTH_EXPLICIT_ROLES_MODE=enforce` after the
migration checklist below. This repository does not auto-flip the mode from
`NODE_ENV` heuristics.

### Normalization

Unsupported role strings continue to be dropped by `normalizeDeppRoles`. After
normalization, missing, empty, and unsupported-only claims are the same
authorization outcome (compat elevate / enforce deny). Deny responses do not
leak whether the caller previously relied on legacy implicit operator behavior.

### JWT roles claim contract (human access tokens)

| Rule | Specification |
|---|---|
| Claim name | `roles` |
| Type | JSON array of strings |
| Supported values (this phase) | `operator`, `auditor` only — do not invent additional role names here |
| Normalization | trim, lower-case, deduplicate; drop unknown values via `normalizeDeppRoles` |
| Unknown-only / empty / missing / malformed effective input | Treated as **missing roles** (`undefined` after normalize) |
| Compat | Missing roles → temporary operator-equivalent on role-gated helpers + bounded warn |
| Enforce | Missing roles → deny on protected human routes |
| Agent JWTs | Omit human `roles`; identity is `aid` + `token_use=agent`. Agent-only routes use `requireAgent` and ignore human role claims |
| Production source of truth | Validated, correctly signed DEPP access JWT only |
| Dev-only | `dev-header` `x-roles` (CSV) is **not** a production auth source |
| Logging / docs | Never log or paste raw JWTs, bearer tokens, authorization headers, or secrets |

**Issuer-side model**

- **Transitional (current):** `AuthService.completeOidcLogin` and `refresh` mint
  `roles: ["operator"]` so enforce mode does not strand OIDC/refresh sessions.
  This is a compatibility bridge, not a permanent authorization source.
- **Future (deferred):** An approved IdP/issuer maps authoritative
  identity/group/role information into the JWT `roles` claim. Mapping ownership,
  identity governance, and role administration remain outside this ADR.
  The API must not infer privileges from email, tenant id, username, or other
  unvalidated fields. Future mapping must be tested before transitional minting
  is removed (see runbook exit criteria).

**Enforce readiness**

- Suite: `backend/api-gateway/tests/auth/enforce-readiness.test.ts` (minted JWTs
  under `enforce`).
- Runbook: `docs/runbooks/explicit-roles-enforce-rollout.md` (before / switch /
  after / rollback; does **not** authorize Helm or Platform cutover).
- Transitional minting exit criteria are documented in that runbook; this ADR
  does **not** remove minting or `compat`.

### Scope covered by this migration

These paths are mode-aware via centralized helpers in `auth/roles.ts`:

- `GET /v1/audit/logs` (`requireAuditReader` / `canReadAuditLogs`)
- Agent management: inventory, credential rotate/revoke, device-identity revoke
  (`requireAgentManager` / `canManageAgents`)
- Human enroll (`POST /v1/agents`): humans require `canManageAgents`; **agent
  principals retain the existing enroll path**
- Telemetry **query** (`GET /v1/telemetry/events`): agents (self-scoped) or human
  operators via `requireTelemetryQuerier` / `canQueryTelemetry` (auditors denied)
- Findings: `GET /v1/findings` via `requireFindingsReader` / `canListFindings`
  (agent self-scoped **or** human operator); dashboard / attention / silence /
  suppressions / views / `PATCH` via `requireFindingsOperator` /
  `canManageFindings` (agents and auditors denied)
- Tenant self-service: `GET /v1/tenants/me` via `requireTenantSelfReader` /
  `canReadTenantSelf` — **authenticated human self-service** (Option A):
  explicit operators and auditors allowed; agents denied (JWT already carries
  `tid`). Response is a minimal identity echo `{ tenantId, scope: "tenant" }`
  only (no slug/name/billing/membership/config). Empty-role humans follow
  compat/enforce via `isOperatorPrincipal` / `canReadAuditLogs` semantics.
- Agent-only threat-event pipeline (mode-independent; **not** role-gated):
  `POST /v1/threat-events` and `POST /v1/agents/:agentId/device-identity` via
  centralized `requireAgent` / `canActAsAgent`. Humans (operator, auditor,
  empty/unsupported roles) receive `401 AGENT_AUTH_REQUIRED` in both compat and
  enforce. Path self-match for device bind remains a route business rule.
- Agent-only telemetry **ingest** (mode-independent): `POST /v1/telemetry/events`
  and `POST /v1/telemetry/events/batch` via the same centralized `requireAgent`.
  Telemetry **query** remains separate (`requireTelemetryQuerier`).

### Known residual paths (deferred — not “solved” by enforce)

Enforce still does **not** fully solve product RBAC. Residual after telemetry
ingest agent centralization (2026-08-09):

**Completed (human explicit-role):** audit-log read; agent management / human
enroll / rotate / revoke; human telemetry query; findings list + management;
tenant self-read.

**Completed (agent-only centralization):** threat-event submit; device-identity
bind; telemetry ingest + batch ingest.

| Surface | Status | Recommended target |
|---|---|---|
| `POST /v1/findings/attention/dismiss` | Not implemented | `defer pending product decision` |
| Work HTTP (`/v1/work/views`, `/v1/work/default`) | Schema tables only; **no** router in `app.ts` | `defer` → `operator-only` when implemented |

#### Selected next implementation slice

**Work HTTP auth when routes land**, or attention-dismiss when product adds it.
Do not expand auditor permissions beyond own-tenant audit read + tenant
self-identity echo.

### Transitional human JWT minting

Until IdP claim mapping / persisted roles land, `AuthService.completeOidcLogin`
and `AuthService.refresh` mint human access tokens with
`roles: ["operator"]` so enforce mode does not strand OIDC/refresh sessions.
Agent access tokens remain unchanged (no human roles claim).

### Compat warning observability

Event: `implicit_operator_compat` (structured warn via `logLifecycle`).

Safe fields only: `reason`, `message`, `tenantId`, `principalKind`,
`subjectKind` (`user` | `session` | `anonymous_human`), `explicitRolesMode`.
Never JWTs, bearer tokens, raw headers, or secrets.

Rate limit: key = `tenantId` + subject (`userId`, else `sessionId`, else
`human`); at most one warn per key per 60s; in-memory map capped at 1024
entries with FIFO eviction of the oldest key when capacity is exceeded
(re-insert moves an existing key to the end).

### Local development

- `.env.example` / `tests/test.env`: `AUTH_EXPLICIT_ROLES_MODE=compat`
- Prefer explicit `x-roles: operator` or `auditor` in new tests and curl examples
- `dev-header` `x-roles` remains development-only
- Heartbeat integration-proof helper mints human JWTs with `roles: ["operator"]`
- Enforce readiness (minted JWTs): `tests/auth/enforce-readiness.test.ts`;
  operational checklist: `docs/runbooks/explicit-roles-enforce-rollout.md`

## Deployment migration checklist

Authoritative operational detail:
[`docs/runbooks/explicit-roles-enforce-rollout.md`](../../runbooks/explicit-roles-enforce-rollout.md).

Summary:

1. Confirm human access tokens carry an explicit `roles` claim (`operator`
   and/or `auditor`) — either IdP mapping or transitional AuthService minting.
2. Confirm agent JWT exchange and telemetry ingest still work (unaffected).
3. Run enforce-readiness validation (`tests/auth/enforce-readiness.test.ts`).
4. Exercise audit-read, agent-management, telemetry query, and findings with
   explicit operator (and confirm auditor cannot access findings/telemetry query)
   in staging.
5. Confirm empty-role human principals receive consistent `403` denials under
   enforce (audit + agent management + telemetry query + findings + tenant self).
6. Set `AUTH_EXPLICIT_ROLES_MODE=enforce` in the deployment environment
   (explicit; not inferred from `NODE_ENV`).
7. Monitor for unexpected `AUDIT_REJECTED` / `AGENTS_REJECTED` /
   `TELEMETRY_QUERY_REJECTED` / `FINDINGS_REJECTED` / `TENANT_SELF_REJECTED`
   after cutover.
8. Plan removal of `compat` and transitional `["operator"]` minting only when
   runbook exit criteria are met.

## Removal plan (future)

1. Require IdP or DEPP-persisted roles on every human login (no transitional mint).
2. Delete `compat` mode and the implicit-operator warn path.
3. Fail startup if `AUTH_EXPLICIT_ROLES_MODE` is unset in production JWT
   deployments (optional harden).
4. Migrate future work HTTP / attention-dismiss to explicit roles when
   implemented.
5. Introduce persisted `user_roles` / admin UI only when product-ready.

## Consequences

- Explicit-role enforcement is available without a full RBAC redesign.
- Local/test defaults stay compatible; production must opt into enforce.
- Live residual authorization debt for implemented **human** routes and live
  **agent-only** HTTP surfaces (threat-event, device bind, telemetry ingest) is
  cleared; deferred surfaces are work HTTP / attention-dismiss (not implemented).

## Non-goals

Persisted role tables, IdP sync/SCIM, role admin UI, findings/work RBAC redesign,
Helm/Platform/heartbeat cutover changes, SIEM/export, legal hold, retention purge.
