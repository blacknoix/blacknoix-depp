# ADR-0011: Staged removal of legacy implicit-operator authorization

- Status: Accepted
- Date: 2026-08-08
- Updated: 2026-08-10

## Context

Allow-listed `operator` / `auditor` claims need a staged migration away from
treating human principals with **missing or empty** `roles` as operators.

That fallback preserved local development and existing JWTs without a roles
claim, but it is not a production-safe permanent authorization model: any
authenticated human without an explicit role silently receives operator-class
privileges on routes that consult `isOperatorPrincipal`.

Full persisted `user_roles`, IdP synchronization, and a broad `requireRole`
catalog remain deferred (ADR-0003). This ADR stages a migration from implicit
operator privilege to explicit role authorization without abruptly breaking
local development or tests.

## Decision

### Configuration

`AUTH_EXPLICIT_ROLES_MODE=compat|enforce`

| Value | Behavior |
|---|---|
| `compat` (default when unset **and** `AUTH_MODE` is not `jwt`) | Missing/empty/unsupported-only human roles remain operator-equivalent for routes that use `isOperatorPrincipal`. Emit rate-limited `implicit_operator_compat` warnings. |
| `enforce` | Missing/empty/unsupported-only human roles are **denied** (no silent elevation). Explicit `operator` and `auditor` behave per ADR-0010. |

**Startup wiring:** `config/env.ts` calls `applyExplicitRolesModeFromEnv` at
import time (before `listen`). Invalid values throw and stop startup. The
resolved mode is exposed on typed `env.explicitRolesMode`.

**Verified JWT requirement:** when `AUTH_MODE=jwt`, `AUTH_EXPLICIT_ROLES_MODE`
**must** be set explicitly to `compat` or `enforce`. Unset fails startup. This
uses the existing `AUTH_MODE` signal — **not** `NODE_ENV` inference.

**Default remains `compat` when unset under `dev-header`** (local +
`tests/test.env`). `compat` is transitional and is **not** an enforce
equivalent. Deployments that run verified JWT auth should set
`AUTH_EXPLICIT_ROLES_MODE=enforce` after the migration checklist.

### Normalization

Unsupported role strings continue to be dropped by `normalizeDeppRoles`. After
normalization, missing, empty, and unsupported-only claims are the same
authorization outcome (compat elevate / enforce deny).

### JWT roles claim contract (human access tokens)

| Rule | Specification |
|---|---|
| Claim name | `roles` |
| Type | JSON array of strings |
| Supported values (this phase) | `operator`, `auditor` only |
| Normalization | trim, lower-case, deduplicate; drop unknown values via `normalizeDeppRoles` |
| Unknown-only / empty / missing / malformed effective input | Treated as **missing roles** |
| Compat | Missing roles → temporary operator-equivalent on role-gated helpers + bounded warn |
| Enforce | Missing roles → deny on protected human routes |
| Agent JWTs | Omit human `roles`; identity is `aid` + `token_use=agent`. Agent-only routes use `requireAgent` and ignore human role claims |
| Production source of truth | Validated, correctly signed DEPP access JWT only |
| Dev-only | `dev-header` `x-roles` (CSV) is **not** a production auth source |
| Logging / docs | Never log or paste raw JWTs, bearer tokens, authorization headers, or secrets |

**Issuer-side model**

- **Transitional (current):** `AuthService.completeOidcLogin` and `refresh` mint
  `roles: ["operator"]` so enforce mode does not strand OIDC/refresh sessions.
  This is a compatibility bridge, **not** authoritative IdP mapping.
- **Future (deferred):** An approved IdP/issuer maps authoritative
  identity/group/role information into the JWT `roles` claim. Mapping ownership
  remains outside this ADR / this repository.

**Enforce readiness**

- Suites: `tests/auth/enforce-readiness.test.ts`,
  `tests/auth/startup-explicit-roles.test.ts` (startup helper + minted JWTs).
- Runbook: `docs/runbooks/explicit-roles-enforce-rollout.md` (does **not**
  authorize Helm, Platform, or deployment actions).

### Scope covered by this foundation branch

Mode-aware via helpers wired into **included** routes:

- Findings: `GET /v1/findings` via `requireFindingsReader` / `canListFindings`;
  dashboard / attention / silence / suppressions / views / `PATCH` via
  `requireFindingsOperator` / `canManageFindings`
- Tenant self-service: `GET /v1/tenants/me` via `requireTenantSelfReader` /
  `canReadTenantSelf` (operators + auditors; agents denied)
- Agent-only threat-event submit: `POST /v1/threat-events` via `requireAgent` /
  `canActAsAgent` (mode-independent)

### Deferred (not claimed complete on this branch)

| Surface | Status |
|---|---|
| `GET /v1/audit/logs` / `requireAuditReader` | Deferred with durable audit subsystem |
| Agent management / human enroll RBAC (`requireAgentManager`) | Deferred; HEAD agents route still uses local principal checks |
| Telemetry query (`requireTelemetryQuerier`) | Deferred with query product wiring |
| Telemetry ingest central `requireAgent` | Deferred if route still uses local agent helper; threat-events uses `requireAgent` |
| Device-identity bind centralization | Deferred with agents route product work |
| Work HTTP / attention-dismiss | Not implemented |

Do not treat deferred surfaces as enforce-covered.

### Transitional human JWT minting

Until IdP claim mapping / persisted roles land, `AuthService` mints
`roles: ["operator"]` on login/refresh. Agent tokens remain unchanged.

### Compat warning observability

Event: `implicit_operator_compat` (structured warn via `logLifecycle`).
Safe fields only; never JWTs or secrets. Rate-limited as implemented in
`auth/roles.ts`.

### Local development

- `.env.example` / `tests/test.env`: `AUTH_EXPLICIT_ROLES_MODE=compat`
- Prefer explicit `x-roles: operator` or `auditor` in new `dev-header` tests
- `AUTH_MODE=jwt` local runs must set the mode explicitly

## Deployment migration checklist

Authoritative operational detail:
[`docs/runbooks/explicit-roles-enforce-rollout.md`](../../runbooks/explicit-roles-enforce-rollout.md).

## Consequences

- Explicit-role enforcement is executable at startup for this foundation.
- Local/test defaults stay compatible under `dev-header`; JWT auth must opt in.
- Deferred route families are documented honestly, not pre-covered by dead helpers.

## Non-goals

Persisted role tables, IdP sync/SCIM, role admin UI, shipping audit/credential
subsystems on this branch, Helm/Platform/heartbeat cutover, SIEM/export.
