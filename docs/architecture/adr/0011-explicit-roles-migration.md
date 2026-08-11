# ADR-0011: Staged removal of legacy implicit-operator authorization

- Status: Accepted
- Date: 2026-08-08
- Updated: 2026-08-11

## Context

Allow-listed `operator` / `auditor` claims need a staged migration away from
treating human principals with **missing or empty** `roles` as operators.

That fallback preserved local development and existing JWTs without a roles
claim, but it is not a production-safe permanent authorization model.

Full persisted `user_roles`, IdP synchronization, and a broad `requireRole`
catalog remain deferred (ADR-0003).

## Decision

### Configuration

`AUTH_EXPLICIT_ROLES_MODE=compat|enforce`

| Value | Behavior |
|---|---|
| `compat` (default when unset **and** `AUTH_MODE` is not `jwt`) | Missing/empty/unsupported-only human roles remain operator-equivalent for routes that use `isOperatorPrincipal`. Emit rate-limited `implicit_operator_compat` warnings. |
| `enforce` | Missing/empty/unsupported-only human roles are **denied**. Explicit `operator` and `auditor` behave per ADR-0010. |

**Startup wiring:** `config/env.ts` calls `applyExplicitRolesModeFromEnv` at
import time. Invalid values stop startup. When `AUTH_MODE=jwt`, the mode must
be set explicitly (not inferred from `NODE_ENV`).

### Scope covered by this foundation branch

| Surface | Guard | Notes |
|---|---|---|
| Findings list / management | `requireFindingsReader` / `requireFindingsOperator` | Agents self-scope list only |
| `GET /v1/tenants/me` | `requireTenantSelfReader` | Operator **or** auditor |
| Agent inventory / human enroll / credential revoke / device-identity revoke | `requireAgentManager` / `canManageAgents` | Operator-only; enroll still allows **agent** principals |
| Device-identity bind | `requireAgent` | Agent-only; path self-match |
| Telemetry GET/query | `requireTelemetryQuerier` / `canQueryTelemetry` | Human operators; agents self-scoped only |
| Telemetry POST ingest + batch | `requireAgent` | Agent-only; mode-independent |
| Threat-event submit | `requireAgent` | Agent-only; mode-independent |

### Deferred

| Surface | Status |
|---|---|
| `GET /v1/audit/logs` / `requireAuditReader` | Deferred — no audit HTTP route on this branch |
| Credential **rotate** product surface | Not part of this RBAC wiring slice |
| Work HTTP / attention-dismiss | Not implemented |

Auditor **audit-log read** remains deferred. The currently implemented
auditor-capable human surface is `GET /v1/tenants/me` (plus role predicates
shared with future audit read).

### JWT roles claim (summary)

Human tokens may carry allow-listed `roles: ["operator"|"auditor"]`.
`dev-header` `x-roles` is development-only. Agent JWTs omit human roles.
Transitional AuthService minting of `roles: ["operator"]` is a bridge, not
authoritative IdP mapping.

## Consequences

- Agent management and telemetry query are role-enforced on this branch.
- Audit HTTP remains honestly deferred.
- Local/test defaults stay `compat` under `dev-header`.

## Non-goals

Persisted role tables, IdP sync, audit subsystem shipping, Helm/Platform/
heartbeat cutover, credential lifecycle product features beyond auth guards on
already-included revoke/inventory/enroll routes.
