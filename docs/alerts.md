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

## Auto-trigger rules

Alerts are created **inside the telemetry ingestion transaction** when:

- Event `severity` is `high` or `critical`
- Event is successfully persisted

| Severity | Creates alert? |
|---|---|
| `info` | No |
| `low` | No |
| `medium` | No |
| `high` | Yes |
| `critical` | Yes |

Alert fields at creation:

| Field | Source |
|---|---|
| `tenantId` | Authenticated agent context |
| `agentId` | Authenticated agent context |
| `telemetryEventId` | Pre-generated event UUID |
| `title` | `{SEVERITY} event: {eventType}` |
| `severity` | Event severity |
| `status` | `open` |

If alert creation fails, the entire telemetry batch is rolled back.

There is **no manual alert creation**, deduplication, or suppression in this slice.

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

1. **Ingest** — Agent sends `high`/`critical` telemetry; alert auto-created as `open`.
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
