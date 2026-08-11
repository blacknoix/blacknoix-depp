# Staging evidence — enforce mode + auditable alert spine

Repository-only procedure for a **human operator** to capture staging evidence
that verified JWT auth with `AUTH_EXPLICIT_ROLES_MODE=enforce` correctly gates
explicit-role routes and that the `telemetry-to-auditable-alert-v1` spine
behaves as designed.

This is **not** a deployment runbook. It does **not** contact or alter cloud,
Helm, Kubernetes, Docker Compose, CI secrets, IdP configuration, Platform
configuration, or production systems.

## Evidence classes (do not conflate)

| Class | What it proves | Where it lives |
|---|---|---|
| **Code evidence** | Unit/DB tests and typechecks against the repo | CI / local clean worktree |
| **Staging evidence** | Observed HTTP + DB behavior in an isolated non-production environment with verified JWT | This runbook’s filled template |
| **Production evidence** | Controlled production cutover / questionnaire artifacts | **Out of scope** — not authorized by a successful staging run |

A successful staging run **does not itself authorize production cutover**.

## Related documents

- [Explicit-roles enforce rollout](./explicit-roles-enforce-rollout.md) — mode semantics, startup fail-closed rules, transitional AuthService minting exit criteria
- [Telemetry-to-auditable-alert demo](../demo/telemetry-to-auditable-alert-v1.md) — schema, rule, same-TX boundary, immutable alert reads
- ADR-0010 / ADR-0011 — auditor role + staged `compat`→`enforce` migration
- Evidence capture template: [templates/staging-enforce-alert-evidence.template.md](./templates/staging-enforce-alert-evidence.template.md)

## Purpose and scope

**In scope**

- Confirm `AUTH_MODE=jwt` + `AUTH_EXPLICIT_ROLES_MODE=enforce` is active in the
  staging deployment the operator is testing against
- Exercise principal × route matrix for alerts + one operator-only denial + agent ingest
- Deterministic five-`auth_failure` alert creation and cross-tenant isolation
- Append-only `alert_audit_events` verification via **database/operator evidence only**
  (no general audit-log HTTP API)
- Invalid-mode startup abort rehearsal (config parse / process start)
- Enforce → `compat` rollback rehearsal (temporary incident posture only)

**Out of scope / non-goals**

- New product features, roles, APIs, rules, batch correlation, dashboards,
  notifications, alert mutation, audit-log HTTP API, IdP mapping, SCIM, role admin
- Using `dev-header` / `x-roles` as staging evidence of verified JWT behavior
- Committing real tokens, secrets, tenant/agent/customer identifiers, or raw logs
- Changing deployment, Platform, Legal, or production systems

## Required owners and approvals

| Role | Responsibility | Ownership |
|---|---|---|
| Security / product reviewer | Approves that this evidence pack is sufficient for the intended questionnaire step | Repository / product |
| Identity / IdP owner | Issues or maps verified human JWTs with allow-listed `roles` (`operator` / `auditor`) and a deliberate role-less human test principal | **External** |
| Platform / deployment owner | Ensures staging api-gateway runs with `AUTH_MODE=jwt` and `AUTH_EXPLICIT_ROLES_MODE=enforce`; performs restarts for invalid-mode and rollback rehearsals | **External** |
| Database / operator owner | Provides isolated non-production tenant data and safe read access to verify `alert_audit_events` (and confirm UPDATE/DELETE denied for app role) | **External** |
| Evidence recorder | Fills the redacted template; never pastes secrets | Human operator |

**Deployment/platform ownership is external.** This repository documents the
procedure only; it cannot execute staging configuration changes.

## Preconditions

Before any request:

1. **Isolated non-production tenant data** — two tenants (A and B) with no
   production customer data; agents enrolled only for the test tenants.
2. **Verified JWT auth** — `AUTH_MODE=jwt` (not `dev-header`). Access tokens
   are signed and verified by the gateway. Do **not** use `x-roles` or
   `x-tenant-id` stand-ins as evidence.
3. **Explicit enforce** — `AUTH_EXPLICIT_ROLES_MODE=enforce` is set in the
   staging environment and the process has been restarted under that config.
4. **Known test principals** (identities provisioned by Identity/IdP owner):
   - Operator human JWT with `roles: ["operator"]` for tenant A
   - Auditor human JWT with `roles: ["auditor"]` for tenant A
   - Role-less (or empty / unsupported-only) human JWT for tenant A under enforce
   - Agent access JWT for tenant A (via established agent credential exchange)
   - Operator human JWT for tenant B (cross-tenant negative)
5. **Safe log capture location** — operator-controlled store that supports
   redaction; never commit logs to git.
6. **Rollback authority** — named Platform owner authorized to set
   `AUTH_EXPLICIT_ROLES_MODE=compat` and restart if needed.

### Transitional role provisioning (honest limitation)

AuthService login/refresh still **transitionally mints** `roles: ["operator"]`
until IdP mapping exit criteria in the enforce rollout runbook are met. Staging
evidence for **auditor** and **role-less** humans therefore requires Identity/
IdP (or an approved test issuer) to mint those claims deliberately. Do not treat
default minting as proof that auditor/role-less paths are IdP-complete.

`compat` is a **rollback posture**, not a production authorization claim.

## Environment assertions (no secret values)

Record only that each item was checked; never paste secrets.

| Assertion | Expected | Record as |
|---|---|---|
| `AUTH_MODE` | `jwt` | present / correct |
| `AUTH_EXPLICIT_ROLES_MODE` | `enforce` | present / correct |
| `JWT_ACCESS_SECRET` (or equivalent) | configured (≥32 chars), not logged | present / not dumped |
| `JWT_ISSUER` / `JWT_AUDIENCE` | match issued tokens | present / match |
| Database connectivity | staging DB reachable to gateway | ok / fail |
| Process start under enforce | process accepts traffic | ok / fail |

Invalid / unset mode under `AUTH_MODE=jwt` must **fail closed at startup**
(process does not serve requests). Supported values only: `compat`, `enforce`.

## Principal × route matrix

Use **Bearer** verified JWTs only. Replace placeholders; never commit real tokens.

| # | Principal | Request | Expected |
|---|---|---|---|
| M1 | Operator (tenant A) | `GET /v1/alerts` | `200` `{ ok: true, data: { alerts } }` |
| M2 | Auditor (tenant A) | `GET /v1/alerts` | `200` (read-only; no mutation API exists) |
| M3 | Auditor (tenant A) | Operator-only surface, e.g. `GET /v1/agents` | `403` `AGENTS_REJECTED` (or established operator-only denial) |
| M4 | Role-less human (tenant A) under enforce | `GET /v1/alerts` | `403` `ALERTS_REJECTED` |
| M5 | Agent (tenant A) | `POST /v1/telemetry/events` (`auth_failure`) | `201` success envelope with event `id` |
| M6 | Agent (tenant A) | `GET /v1/alerts` | `403` `ALERTS_REJECTED` |
| M7 | Operator (tenant B) | `GET /v1/alerts` and `GET /v1/alerts/:id` for tenant A alert | Empty list / `404` `ALERTS_NOT_FOUND` (non-oracular) |

### Request pseudocode (curl)

No repository request-runner is provided. Operators may use curl or an equivalent
HTTP client. **Do not** put tokens in shell history if avoidable (prefer env vars
in a private session that is not logged to git).

```bash
# Placeholders only — never commit real values.
export BASE_URL="[STAGING_BASE_URL]"
export OPERATOR_TOKEN="[REDACTED]"
export AUDITOR_TOKEN="[REDACTED]"
export ROLELESS_TOKEN="[REDACTED]"
export AGENT_TOKEN="[REDACTED]"
export OPERATOR_B_TOKEN="[REDACTED]"

# M1 — operator list alerts
curl -sS -o /dev/null -w "%{http_code}" \
  -H "Authorization: Bearer ${OPERATOR_TOKEN}" \
  "${BASE_URL}/v1/alerts"

# M5 — agent ingest (repeat five times with occurredAt in one 5-minute bucket)
curl -sS -w "\n%{http_code}\n" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"schemaVersion":1,"eventType":"auth_failure","occurredAt":"[RFC3339_IN_BUCKET]","payload":{}}' \
  "${BASE_URL}/v1/telemetry/events"

# M6 — agent denied alert read
curl -sS -w "\n%{http_code}\n" \
  -H "Authorization: Bearer ${AGENT_TOKEN}" \
  "${BASE_URL}/v1/alerts"
```

Body must **not** include `tenantId` / `tenant_id` / `tid`. Optional body
`agentId`, if present, must match the agent principal.

## Deterministic five-`auth_failure` scenario

Aligned with [telemetry-to-auditable-alert demo](../demo/telemetry-to-auditable-alert-v1.md):

1. Choose a fixed UTC 5-minute window bucket (derive from `occurredAt`, not wall clock at evaluation time beyond choosing timestamps inside one bucket).
2. As agent (tenant A), `POST /v1/telemetry/events` **five** times with
   `eventType: "auth_failure"` and `occurredAt` values inside that bucket.
3. As operator (tenant A), `GET /v1/alerts` → **exactly one** alert with
   `ruleId: "rule.auth_failure_burst.v1"`.
4. `GET /v1/alerts/:id` → evidence includes rule ID, window bounds, contributing
   count `5`, and contributing event IDs — **no payload dump**.
5. As operator (tenant B), confirm non-oracular invisibility of that alert.
6. Sixth `auth_failure` in the **same** bucket must **not** create a second alert.

## Append-only audit verification (DB / operator only)

There is **no** general audit-log HTTP API in this evidence pack.

With Database/operator owner assistance under tenant A scope:

1. Confirm exactly one `alert_created` row in `alert_audit_events` for the new alert.
2. Confirm the row is invisible under tenant B scope.
3. Confirm application role cannot `UPDATE` or `DELETE` the row (permission failure).

Record only redacted assertion results — never paste row payloads containing
customer identifiers beyond placeholders.

## Invalid-mode startup-abort verification

Owned by Platform/deployment; recorder captures outcome only.

1. With `AUTH_MODE=jwt`, attempt start with **unset** `AUTH_EXPLICIT_ROLES_MODE`
   → process must **abort** (fail closed).
2. Attempt start with **invalid** value (e.g. `AUTH_EXPLICIT_ROLES_MODE=maybe`)
   → process must **abort**.
3. Restore `AUTH_EXPLICIT_ROLES_MODE=enforce` and confirm healthy start.

Do not leave staging in a broken config after the rehearsal.

## Enforce → compat rollback rehearsal

`compat` is **temporary incident mitigation**, not a production authorization claim.

1. Platform owner sets `AUTH_EXPLICIT_ROLES_MODE=compat` and restarts.
2. Confirm process starts.
3. Optionally note that role-less humans may regain temporary operator-equivalent
   behavior on role-gated helpers (undesirable for production).
4. Restore `enforce` after the rehearsal unless an approved incident requires
   remaining on `compat`.
5. Remediate issuer/role mapping before relying on `enforce` again.

## Redaction rules

**Never** record in git, PR comments, or the filled evidence template:

- Access tokens, refresh tokens, agent credentials, JWT secrets
- Raw `Authorization` headers
- Full JWT payloads (even if claims seem non-sensitive)
- Real tenant UUIDs, agent UUIDs, user subjects, emails, or customer names
- Database connection strings with credentials
- Unredacted log excerpts containing any of the above

**Allowed** in the template:

- Placeholders (`[REDACTED_TENANT_A]`, `[HTTP_STATUS]`, …)
- HTTP status codes and error **codes** (e.g. `ALERTS_REJECTED`)
- Pass/fail and redacted artifact references
- Run ID and environment name (non-secret)

## Pass/fail recording

Copy [templates/staging-enforce-alert-evidence.template.md](./templates/staging-enforce-alert-evidence.template.md)
to an operator-controlled location **outside** the repository (or a private
evidence store). Fill placeholders only. Do not commit filled copies with real data.

Overall run: **PASS** only if every matrix row, the five-event alert scenario,
audit checks, invalid-mode abort, and rollback rehearsal meet expected results
(or are explicitly waived with named approver and reason).

## Explicit reminder

Successful staging evidence supports questionnaire / readiness discussion.
It **does not** authorize production cutover, Platform scan acceptance, Legal
disclosure completion, or removal of transitional AuthService role minting.
