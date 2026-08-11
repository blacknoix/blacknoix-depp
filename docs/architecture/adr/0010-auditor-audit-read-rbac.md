# ADR-0010: Least-privilege auditor role (foundation; audit HTTP deferred)

- Status: Accepted (audit-read HTTP deferred on explicit-roles foundation)
- Date: 2026-08-08
- Updated: 2026-08-10

## Context

Investigators need a least-privilege **auditor** principal distinct from
**operator**. Full RBAC (persisted role tables, IdP claim mapping, `requireRole`
for every route) remains deferred per ADR-0003. This slice defines the smallest
in-token / principal role representation consistent with the existing auth seam.

Durable `audit_logs` storage and `GET /v1/audit/logs` are **not** part of the
`feat/explicit-roles-foundation` branch. Auditor **capability predicates**
(`isAuditorPrincipal` / `canReadAuditLogs`) exist so tenant self-read and future
audit HTTP can share the same allow-list; the audit route and
`requireAuditReader` are deferred until that subsystem lands as its own slice.

## Decision

### Role allow-list

Recognized human roles (case-insensitive; unknown values ignored):

| Role | Meaning |
|---|---|
| `operator` | Human operator capabilities on wired routes (findings, …). |
| `auditor` | Investigation-oriented human: tenant self-identity echo now; own-tenant audit log read when audit HTTP lands. No agent/telemetry/findings management. |

Legacy humans with **empty or omitted** roles continue to behave as **operators**
only when `AUTH_EXPLICIT_ROLES_MODE=compat` (temporary). Prefer explicit roles;
verified JWT deployments must set the mode explicitly (ADR-0011).

A principal that has **only** `auditor` (no `operator`) is auditor-only.

### Capability matrix (this foundation slice)

| Capability | Operator (or compat empty roles) | Auditor-only |
|---|---|---|
| `GET /v1/tenants/me` | Allow | Allow |
| Findings list / management | Allow (list + manage) | Deny (`FINDINGS_REJECTED`) |
| Agent inventory / human enroll / credential revoke / device revoke | Allow (`requireAgentManager`) | Deny (`AGENTS_REJECTED`) |
| Telemetry GET/query | Allow (`requireTelemetryQuerier`) | Deny (`TELEMETRY_QUERY_REJECTED`) |
| `GET /v1/audit/logs` | **Deferred** (no audit route on this branch) | **Deferred** |
| Telemetry ingest / threat-event submit / device bind | Agent-only (`requireAgent`) | Deny (`AGENT_AUTH_REQUIRED`) |
| Role / RBAC administration | Not implemented | Not implemented |

### Authorization helpers (this branch)

- `requireTenantSelfReader` — human operator or auditor
- `requireFindingsReader` / `requireFindingsOperator`
- `requireAgentManager` — human operator agent-management surfaces
- `requireTelemetryQuerier` — human operator or self-scoped agent query
- `requireAgent` — agent-only ingest / bind / threat-events

`requireAuditReader` is **not** exported — audit HTTP is deferred.

### How roles are supplied

1. **JWT access tokens:** optional `roles` claim (string array). Verified on
   `verifyAccessToken`; unknown entries dropped; empty array omitted.
2. **`dev-header` only:** optional `x-roles` header (comma-separated). Never
   trusted in production JWT mode except via signed token claims.
3. Tenant identity remains server-derived from the authenticated principal /
   verified token.

## Consequences

- Auditor is a first-class allow-listed role without claiming audit HTTP is done.
- Operators retain prior behavior when roles are omitted under `compat` only.
- Agent management and telemetry query are operator-gated for humans on this
  branch; audit HTTP remains deferred.
- Persisted user↔role mappings, IdP role sync, and fine-grained permission
  catalogs remain future work.

## Non-goals

Helm/chart defaults, heartbeat stand-in, Platform scan/provenance, deployment
reachability, credential delivery, SIEM connectors, audit UI, full RBAC,
and shipping the durable audit subsystem on this branch.
