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

## Event schema (telemetry contract)

Each event in a batch is a versioned envelope. `tenantId` and `agentId` are **never** accepted from the request body — they are derived from the authenticated agent context.

### Envelope

| Field | Type | Required | Description |
|---|---|---|---|
| `eventType` | string | yes | Event category (e.g. `process.start`, `malware.detected`, `auth.remote_logon`) |
| `severity` | string | yes | One of: `info`, `low`, `medium`, `high`, `critical` |
| `occurredAt` | string | yes | ISO 8601 datetime when the event happened on the endpoint |
| `schemaVersion` | number | no | Contract version (current: `1`). Omitted values are treated as version `1`. Unsupported versions are rejected. |
| `payload` | object | yes | Event-specific fields (not an array) |

`schemaVersion` is the seam for future breaking payload changes — it is **not** a full multi-version runtime yet. Today only version `1` is accepted when the field is present.

### Progressive validation policy

Validation at `POST /telemetry/events` is **progressive**:

| eventType | Payload validation |
|---|---|
| `malware.*` (prefix) | **Strict** — must match the malware payload schema below |
| `auth.remote_logon` | **Strict** — must match the remote-logon schema below |
| `auth.privilege_change` | **Strict** — must match the privilege-change schema below |
| Any other / unrecognized type | **Opaque** — accepted and stored as today; no payload schema enforcement |

A malformed payload for a **known** strict type — missing or wrong-typed **required** fields — is rejected with `400` and structured `details`. **Extra unrecognized fields on a known type are silently stripped** (forward-compatibility choice, not an oversight); they do not fail ingest. Unknown event types remain accepted so future telemetry can land before the contract catches up.

When extra keys are stripped on a known type, the gateway increments an observability counter (`telemetryContractUnknownKeysStripped` via `GET /internal/metrics`) — counts occurrences only, never logs key values, and does not affect ingest success or failure.

If **any** event in a batch fails validation, the **entire batch** is rejected (no partial acceptance). This matches existing batch ingest behavior.

### Strict payload schemas (version 1)

#### `malware.*`

Used by v1 `malware-prefix` correlation and v2 outbreak grouping via `Alert.indicator`.

| Field | Required | Type | Notes |
|---|---|---|---|
| `fileHash` | no | non-empty string | Copied to `Alert.indicator` when present |

Empty `{}` is valid (indicator remains null).

#### `auth.remote_logon`

Used by lateral-movement correlation; fields are copied to `TelemetryEvent` auth columns at ingest.

| Field | Required | Type | Persisted column |
|---|---|---|---|
| `account` | yes | non-empty string | `authAccount` |
| `targetHost` | yes | non-empty string | `authHost` |
| `sourceHost` | no | non-empty string | `authSourceHost` |
| `logonType` | no | non-empty string | (payload only today) |

#### `auth.privilege_change`

Used by privilege-escalation follow-up in lateral-movement correlation.

| Field | Required | Type | Persisted column |
|---|---|---|---|
| `account` | yes | non-empty string | `authAccount` |
| `host` | yes | non-empty string | `authHost` |
| `grantedTo` | no | non-empty string | `authGrantedTo` |
| `mechanism` | no | non-empty string | (payload only today) |

Known-type schemas validate required and optional field types; **extra unrecognized payload keys are silently ignored** (stripped at ingest). Wrong or missing **required** fields are hard rejections. Extraction helpers (`alertIndicator.ts`, `authTelemetryExtractors.ts`) are unchanged in this slice — consolidation into the contract module is deferred (Slice 2).

**There is no endpoint agent in this repository.** Auth columns and `Alert.indicator` remain null on typical ingest until an agent emits these shapes.

Example `auth.remote_logon` (strict schema — missing `targetHost` is rejected at ingest):

```json
{
  "eventType": "auth.remote_logon",
  "severity": "medium",
  "occurredAt": "2026-06-15T10:00:00.000Z",
  "schemaVersion": 1,
  "payload": {
    "account": "CORP\\jdoe",
    "sourceHost": "jumpbox-01",
    "targetHost": "workstation-42",
    "logonType": "remoteInteractive"
  }
}
```

Example `auth.privilege_change`:

```json
{
  "eventType": "auth.privilege_change",
  "severity": "high",
  "occurredAt": "2026-06-15T10:05:00.000Z",
  "schemaVersion": 1,
  "payload": {
    "account": "jdoe",
    "host": "workstation-42",
    "grantedTo": "admin",
    "mechanism": "sudo"
  }
}
```

If required payload fields are missing or wrong-typed, **strict auth event types are rejected at ingest** (`400`). Extra fields on known types are stripped, not rejected. Generic event types still store payloads without schema checks. Correlation code can query auth events via `listAuthTelemetryForTenant` (tenant + `authAccount` + `eventType` + `occurredAt` window).

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
