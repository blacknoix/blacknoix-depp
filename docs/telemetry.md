# Telemetry — Event Ingestion and Querying

## Overview

DEPP agents submit structured security telemetry events to the api-gateway. Ingestion is **agent-authenticated** (Bearer agent token), not user JWT. Analysts query events through the standard user-authenticated `/api` routes.

See also: [agents.md](./agents.md) for agent registration and token lifecycle, [tenancy.md](./tenancy.md) for tenant isolation.

---

## Authentication

### Agent ingestion (`POST /telemetry/events`)

Agents authenticate with the **plaintext token** issued at registration:

```
Authorization: Bearer <agentToken>
```

The server hashes the token with SHA-256 and looks up the matching `agents.tokenHash` row. Revoked agents receive the same `401` response as unknown tokens — no existence leak.

**Do not** use user JWT tokens on `/telemetry/*` routes.

### User query (`GET /api/agents/:agentId/events`)

Analysts and above use standard user JWT auth via the `/api` tenant-scoped middleware chain. Minimum role: `analyst`.

---

## Event schema

Each event in a batch:

| Field | Type | Required | Description |
|---|---|---|---|
| `eventType` | string | yes | Event category (e.g. `process.start`, `file.write`) |
| `severity` | string | yes | One of: `info`, `low`, `medium`, `high`, `critical` |
| `occurredAt` | string | yes | ISO 8601 datetime when the event happened on the endpoint |
| `payload` | object | yes | Arbitrary JSON object with event-specific fields (not an array) |

`tenantId` and `agentId` are **never** accepted from the request body — they are derived from the authenticated agent context.

---

## Batch format

`POST /telemetry/events` accepts a **JSON array** of 1–100 events.

```json
[
  {
    "eventType": "process.start",
    "severity": "low",
    "occurredAt": "2024-06-01T12:00:00.000Z",
    "payload": {
      "pid": 1234,
      "processName": "chrome.exe"
    }
  }
]
```

**Response `202`**
```json
{ "accepted": 1 }
```

**Response `400`** — validation failure (all errors collected)
```json
{
  "error": "Validation failed",
  "details": ["events[0].severity must be one of: info, low, medium, high, critical"]
}
```

**Response `401`** — missing, unknown, or revoked agent token
```json
{ "error": "Invalid or expired agent token" }
```

**Response `413`** — request body exceeds 512 KB

---

## Severity values

| Severity | Typical use |
|---|---|
| `info` | Informational telemetry |
| `low` | Low-risk activity |
| `medium` | Notable activity warranting review |
| `high` | Suspicious activity |
| `critical` | Active threat indicators |

Severity is stored as a string for flexibility — not a Prisma enum.

---

## Agent side effects on ingestion

When a batch is accepted:

1. All events are persisted atomically with the agent's `tenantId` and `agentId`.
2. The agent's `status` is set to `active` (transitions from `pending` on first batch).
3. `lastSeenAt` is updated to the current time.
4. Alerts are auto-created for `high` and `critical` severity events (see [alerts.md](./alerts.md)).

All writes succeed or fail together in a single database transaction.

---

## Querying events

### `GET /api/agents/:agentId/events`

**Headers:** `Authorization: Bearer <userAccessToken>`

**Query parameters:**

| Param | Default | Max | Description |
|---|---|---|---|
| `limit` | 50 | 200 | Maximum events to return |
| `before` | — | — | ISO datetime cursor; returns events with `receivedAt` strictly before this value |

**Response `200`** — array of events ordered by `receivedAt` descending

```json
[
  {
    "id": "<uuid>",
    "tenantId": "<uuid>",
    "agentId": "<uuid>",
    "eventType": "process.start",
    "severity": "low",
    "occurredAt": "2024-06-01T12:00:00.000Z",
    "receivedAt": "2024-06-01T12:00:01.000Z",
    "payload": { "pid": 1234 }
  }
]
```

**Response `404`** — agent not found or belongs to another tenant

Cross-tenant agent ids return the same `404` as genuinely missing agents.

---

## Example curl

### Ingest events (agent token)

```bash
curl -X POST https://api.depp.example.com/telemetry/events \
  -H "Authorization: Bearer <agentToken>" \
  -H "Content-Type: application/json" \
  -d '[{
    "eventType": "file.write",
    "severity": "medium",
    "occurredAt": "2024-06-01T12:00:00.000Z",
    "payload": {
      "path": "/etc/passwd",
      "processName": "unknown"
    }
  }]'
```

### Query events (user JWT)

```bash
curl "https://api.depp.example.com/api/agents/<agentId>/events?limit=50" \
  -H "Authorization: Bearer <userAccessToken>"
```

### Paginate with cursor

```bash
curl "https://api.depp.example.com/api/agents/<agentId>/events?limit=50&before=2024-06-01T12:00:00.000Z" \
  -H "Authorization: Bearer <userAccessToken>"
```

---

## Immutability

Telemetry events are **append-only** in this slice. There is no update or delete endpoint. Future anomaly detection and alerting will consume these immutable records.
