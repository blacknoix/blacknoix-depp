# Alerts — Auto-Trigger and Triage

## Overview

**Alerts** are tenant-owned records created automatically when agents ingest `high` or `critical` severity telemetry events. Analysts list, inspect, and triage alerts through user-authenticated `/api/alerts` routes.

See also: [telemetry.md](./telemetry.md) for ingestion, [tenancy.md](./tenancy.md) for isolation patterns.

---

## Alert model

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenantId` | UUID | Owning tenant |
| `agentId` | UUID | Source endpoint agent |
| `telemetryEventId` | UUID? | Linked telemetry event (unique when set) |
| `title` | string | Human-readable summary |
| `severity` | string | Copied from triggering event (`high`, `critical`, etc.) |
| `status` | enum | `open`, `acknowledged`, `resolved` |
| `ruleId` | string? | Correlation rule that produced the alert (`null` for legacy rows) |
| `assignedToId` | UUID? | Assigned analyst (must be same tenant) |
| `resolvedAt` | datetime? | Set when status becomes `resolved` |
| `createdAt` | datetime | Alert creation time |
| `updatedAt` | datetime | Last update time |

---

## Status lifecycle

```
open  →  acknowledged  →  resolved
```

| Status | Meaning |
|---|---|
| `open` | New alert; awaiting triage (default) |
| `acknowledged` | Analyst has seen and is investigating |
| `resolved` | Investigation complete |

### Forward-only transitions

| From | Allowed next |
|---|---|
| `open` | `acknowledged` |
| `acknowledged` | `resolved` |
| `resolved` | *(none)* |

Backward transitions (e.g. `resolved → acknowledged`) are rejected with `400`.

---

## Correlation rules and `ruleId`

Alerts are created during telemetry ingest by a **pure in-memory correlation engine** (`evaluateRules`) that runs **before** the database transaction. Each alert stores the producing rule in nullable `ruleId` (legacy alerts remain `ruleId: null`).

### Default rules (priority order — lower runs first)

| Rule ID | Type | Priority | Behavior |
|---------|------|----------|----------|
| `malware-prefix` | `event_type_match` | 10 | `eventType` starts with `malware.` → severity normalized to `high` |
| `severity-threshold` | `severity_threshold` | 20 | `high` / `critical` events not already claimed |
| `batch-burst` | `batch_burst` | 30 | ≥3 high/critical in batch → one synthetic alert with `telemetryEventId: null` |

**Per-event rules:** first matching rule wins per event (no duplicate per-event alerts).

**Batch burst:** additive; does not claim event IDs. Burst alerts have `telemetryEventId: null`.

**v2 (deferred):** cross-batch / sliding-window correlation will be a background job, not inline ingest.

### Filtering by rule

`GET /api/alerts?ruleId=malware-prefix` returns tenant-scoped alerts for that rule. Indexed by `(tenantId, ruleId)`.

---

## Auto-trigger rules (ingest)

Correlation runs on in-memory event rows, then alerts are persisted inside the telemetry transaction:

- Per-event alerts link `telemetryEventId` to the pre-generated event UUID
- Burst alerts use `telemetryEventId: null`
- If alert creation fails, the entire telemetry batch rolls back

| Severity / pattern | Typical rule |
|---|---|
| `malware.*` (any severity) | `malware-prefix` |
| `high` / `critical` (non-malware) | `severity-threshold` |
| ≥3 high/critical in one batch | `batch-burst` (plus per-event alerts) |
| `info` / `low` / `medium` (non-malware) | No alert |

Alert fields at creation:

| Field | Source |
|---|---|
| `tenantId` | Authenticated agent context |
| `agentId` | Authenticated agent context |
| `telemetryEventId` | Event UUID, or `null` for burst |
| `ruleId` | Matching correlation rule id |
| `title` | Rule title template |
| `severity` | Rule output severity |
| `status` | `open` |

There is **no manual alert creation** or suppression in this slice.

---

## Audit and metrics

| Action | When |
|--------|------|
| `alert_created` | After successful ingest batch with alerts (`meta.alertCount`, `meta.ruleIds`) |
| `alert_list` | First-page list or when filters present (avoids pagination log floods) |
| `alert_read` | Successful `GET /api/alerts/:id` |
| `alert_access_denied` | `GET` or `PATCH` when alert is missing or cross-tenant (`404`) |
| `alert_updated` | Successful status/assignee update via service (`meta.previousStatus`, `meta.newStatus`) |

Metrics: `alertsCreated` (per alert on ingest), `alertsUpdated` (per triage update). Nested audit `meta` is scrubbed for sensitive keys.

---

## Auto-trigger rules (legacy note)

Previously, alerts were created only for raw `high`/`critical` severity. The correlation engine preserves backward-compatible titles for severity-threshold matches (`{SEVERITY} event: {eventType}`) while adding malware and burst rules.

---

## Endpoints

All endpoints require `Authorization: Bearer <userAccessToken>`. Minimum role: **analyst**.

### `GET /api/alerts`

List alerts in the caller's tenant.

**Query parameters:**

| Param | Description |
|---|---|
| `status` | Filter: `open`, `acknowledged`, or `resolved` |
| `severity` | Filter by severity string |
| `agentId` | Filter by source agent |
| `ruleId` | Filter by correlation rule id |
| `limit` | Default 50, max 200 |
| `before` | ISO datetime cursor on `createdAt` |

**Response `200`** — array ordered by `createdAt` descending

---

### `GET /api/alerts/:alertId`

**Response `200`** — alert detail including `resolvedAt`

**Response `404`** — not found or cross-tenant (same body)

---

### `PATCH /api/alerts/:alertId`

Update status and/or assignee. Only `status` and `assignedToUserId` are accepted; all other body fields are ignored.

**Acknowledge**
```json
{ "status": "acknowledged" }
```

**Resolve**
```json
{ "status": "resolved" }
```

**Assign**
```json
{ "assignedToUserId": "<userId in same tenant>" }
```

**Unassign**
```json
{ "assignedToUserId": null }
```

**Combined**
```json
{
  "status": "acknowledged",
  "assignedToUserId": "<userId>"
}
```

**Response `200`** — updated alert

**Response `400`** — invalid status, invalid transition, assignee not in tenant, or empty body

**Response `404`** — alert not found or cross-tenant

---

## Triage workflow

1. **Ingest** — Agent sends telemetry; correlation engine creates alerts with `ruleId` as `open`.
2. **Review** — Analyst lists alerts filtered by `status=open`.
3. **Acknowledge** — `PATCH { "status": "acknowledged" }` optionally with assignee.
4. **Investigate** — Analyst reviews linked telemetry via `GET /api/agents/:agentId/events`.
5. **Resolve** — `PATCH { "status": "resolved" }` sets `resolvedAt`.

### Assignee behavior

- Assignee must be a `User` in the **same tenant** as the alert.
- Assignee-only updates do not change status.
- `assignedToUserId: null` clears the assignee.
- Assignee can be updated independently or combined with status change in one request.

---

## RBAC

| Endpoint | Minimum role |
|---|---|
| `GET /api/alerts` | `analyst` |
| `GET /api/alerts/:alertId` | `analyst` |
| `PATCH /api/alerts/:alertId` | `analyst` |

Role hierarchy: `owner` > `admin` > `analyst` > `read-only`.
