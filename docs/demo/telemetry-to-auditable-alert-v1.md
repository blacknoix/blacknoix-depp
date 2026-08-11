# Demo — telemetry-to-auditable-alert-v1

Smallest end-to-end spine: authenticated agent ingest → durable store → one
deterministic rule → tenant-isolated alert read + append-only audit.

This document does **not** authorize Helm/deployment cutover, Platform work,
heartbeat cutover, or production enforce activation by itself.

## Schema (`telemetry.event.v1`)

Supported `eventType` values:

- `heartbeat`
- `agent.started`
- `agent.stopped`
- `auth_success`
- `auth_failure` ← drives the rule below

Body fields: `schemaVersion: 1`, `eventType`, `occurredAt` (RFC3339),
`payload` (bounded object). Optional body `agentId` must match the principal
when present. Body `tenantId` / `tenant_id` / `tid` are **rejected**.

Tenant and agent identity come **only** from the verified agent principal.

## Rule

| Field | Value |
|---|---|
| Rule ID | `rule.auth_failure_burst.v1` |
| Window | Fixed 5-minute UTC buckets from `occurredAt` (not server `now()`) |
| Default threshold | `5` `auth_failure` events per `(tenant, agent, window_bucket)` |
| Dedup | Unique `(tenant_id, agent_id, rule_id, window_bucket)` — insert-ignore |

Evidence (no payload dump): rule ID, window start/end/bucket, contributing
count, contributing telemetry event IDs.

## Transaction boundary

For **single-event** `POST /v1/telemetry/events` with `auth_failure`:

1. Insert telemetry event
2. Evaluate burst rule
3. Insert-or-ignore alert
4. Insert `alert_created` audit **only if** the alert was newly created
5. Commit → then return success

Failures return non-2xx; no partial event/alert/audit. Batch ingest does **not**
participate in this rule. Legacy findings correlation remains separate and
best-effort.

## Alert reads (immutable in v1)

`GET /v1/alerts` and `GET /v1/alerts/:id` are the only alert HTTP surfaces.
Alerts are **immutable / read-only in v1**: there is no PATCH/POST status,
triage, acknowledge, resolve, or other mutation API. Lifecycle and status
mutation are explicitly deferred.

## Roles

| Principal | Ingest | `GET /v1/alerts` |
|---|---|---|
| Agent | Allowed | Denied (`ALERTS_REJECTED`) |
| Operator | Denied (401 agent-auth) | Allowed |
| Auditor | Denied | Allowed (read-only; no mutation API) |
| Role-less human under `enforce` | Denied | Denied |

## Demo steps (`AUTH_EXPLICIT_ROLES_MODE=enforce`)

Against a **clean** database migrated from this branch only (`001`–`017`):

1. Start api-gateway with JWT + `AUTH_EXPLICIT_ROLES_MODE=enforce`.
2. Exchange an agent credential for an agent access JWT.
3. `POST /v1/telemetry/events` five `auth_failure` events for one agent with
   `occurredAt` values inside the same 5-minute bucket.
4. As an operator (or auditor) JWT: `GET /v1/alerts` → exactly one alert;
   `GET /v1/alerts/:id` → evidence matches count + event IDs.
5. As a second tenant’s operator: list/detail show nothing for that alert
   (non-oracular).
6. Confirm one `alert_created` row in `alert_audit_events` for the alert’s
   tenant; app-role UPDATE/DELETE on that table must fail.

## CI acceptance criteria

1. Server-derived tenancy (body tenant rejected / principal tenant persisted)
2. Cross-tenant alert isolation (non-oracular)
3. Threshold + dedup determinism
4. Durable-before-success (forced write failure → non-2xx, no partials)
5. Append-only tenant-scoped audit

## Explicit deferrals

Batch alert evaluation, additional rules/event families, findings reuse,
triage/lifecycle mutation, dashboards, notifications, ML, device/fleet,
enrollment UX, general audit-log HTTP API, signed THREATEVENT product path,
frontend.
