# ADR-0010: Least-privilege auditor read access for durable audit logs

- Status: Accepted
- Date: 2026-08-08

## Context

ADR-0008 introduced durable tenant-scoped `audit_logs` and operator-only
`GET /v1/audit/logs`. ADR-0009 added retention policy and append-only integrity.
Investigators need a least-privilege **auditor** principal that can read own-
tenant audit evidence without agent enrollment, credential lifecycle mutation,
telemetry ingest, or audit mutation.

Full RBAC (persisted role tables, IdP claim mapping, `requireRole` middleware
for every route) remains deferred per ADR-0003. This slice adds the smallest
in-token / principal role representation consistent with the existing auth seam.

## Decision

### Role allow-list

Recognized human roles (case-insensitive; unknown values ignored):

| Role | Meaning |
|---|---|
| `operator` | Existing human operator capabilities (agent management, audit read, findings, …). |
| `auditor` | Investigation-only: own-tenant audit log read (+ filters/cursor). No agent/telemetry/audit mutation. |

Legacy humans with **empty or omitted** roles continue to behave as **operators**
only when `AUTH_EXPLICIT_ROLES_MODE=compat` (temporary). Prefer explicit roles;
production must use `enforce` (ADR-0011).

A principal that has **only** `auditor` (no `operator`) is auditor-only.

### Capability matrix (this slice)

| Capability | Operator (or legacy empty roles) | Auditor-only |
|---|---|---|
| `GET /v1/audit/logs` (own tenant; filters + cursor) | Allow | Allow |
| Cross-tenant audit read | Deny / empty via RLS + server tenant | Deny / empty via RLS + server tenant |
| `POST /v1/agents` (enroll) | Allow (existing) | Deny (`AGENTS_REJECTED`) |
| Credential rotate / revoke / device revoke | Allow (existing) | Deny (`AGENTS_REJECTED`) |
| `GET /v1/agents` inventory | Allow (existing) | Deny (`AGENTS_REJECTED`) |
| Agent JWT exchange (`POST /v1/auth/agent/token`) | Unchanged (credential proof; not a human RBAC grant) | Unchanged |
| Telemetry ingest | Agent-only (unchanged) | Deny (`AGENT_AUTH_REQUIRED`) |
| Audit row mutation | Deny (append-only) | Deny (append-only) |
| Role / RBAC administration | Not implemented | Not implemented |

Auditors do **not** receive broad telemetry query, findings, or tenant-admin
access in this slice.

### How roles are supplied

1. **JWT access tokens:** optional `roles` claim (string array). Verified on
   `verifyAccessToken`; unknown entries dropped; empty array omitted.
2. **`dev-header` only:** optional `x-roles` header (comma-separated). Never
   trusted in production JWT mode except via signed token claims.
3. Tenant identity remains server-derived from the authenticated principal /
   verified token — never from a client “tenant override” query for audit reads.

### Authorization helpers

- `requireAuditReader` — human + (`isOperatorPrincipal` ∨ `isAuditorPrincipal`).
- `requireAgentManager` — human + `isOperatorPrincipal` (auditor-only rejected).
- Enroll additionally rejects auditor-only humans while preserving the existing
  agent-principal enrollment path.

## Consequences

- Auditors can investigate credential lifecycle evidence via the existing audit
  API without operational write power.
- Operators retain prior behavior when roles are omitted.
- Persisted user↔role mappings, IdP role sync, and fine-grained permission
  catalogs remain future work.
- No UI, SIEM export, legal hold, or retention purge in this ADR.

## Non-goals

Helm/chart defaults, heartbeat stand-in, Platform scan/provenance, deployment
reachability, credential delivery, SIEM connectors, audit UI, and full RBAC
redesign.
