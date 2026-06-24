# Agents — Registration and Management

## Overview

An **agent** is an endpoint device registered under a tenant. Tenant admins create agent records and receive a **one-time agent token** used to authenticate the agent for future telemetry ingestion. Analysts and above can list and view agents.

All agent routes live under `/api/agents` and inherit `tenantScoped` middleware from the parent API router. See [tenancy.md](./tenancy.md) for isolation patterns.

---

## Agent model

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenantId` | UUID | Owning tenant (FK → `tenants`) |
| `hostname` | string | Endpoint hostname |
| `os` | string | Operating system identifier |
| `ipAddress` | string? | Optional IP at registration |
| `agentVersion` | string | Installed agent software version |
| `status` | enum | `pending`, `active`, `inactive`, `revoked` |
| `tokenHash` | string | SHA-256 hash of the agent token (**never returned via API**) |
| `registeredAt` | datetime | When the agent was registered |
| `lastSeenAt` | datetime? | Updated on each accepted telemetry batch |
| `createdAt` | datetime | Row creation time |
| `updatedAt` | datetime | Row last update time |

---

## Agent status values

| Status | Meaning |
|---|---|
| `pending` | Registered; token issued but agent has not sent telemetry yet (default) |
| `active` | Agent has sent at least one accepted telemetry batch |
| `inactive` | Agent stopped reporting; not revoked |
| `revoked` | Token invalidated; agent must re-register |

### Transitions

```
pending → active     (first accepted telemetry batch — see telemetry.md)
active  → inactive   (missed heartbeats threshold — future slice)
inactive → active    (telemetry resumed — future slice)
*       → revoked    (admin revokes — future slice)
```

On creation, agents start in `pending`. The first successful `POST /telemetry/events` batch atomically sets `status = active` and updates `lastSeenAt`.

---

## Agent token lifecycle

1. **Registration** — Admin calls `POST /api/agents`. Server generates a 64-character hex token (`crypto.randomBytes(32)`), hashes it with SHA-256, stores only the hash, and returns the plaintext token **once** in the response.
2. **Configuration** — Admin copies `agentToken` into the endpoint agent config file or environment variable (e.g. `DEPP_AGENT_TOKEN`).
3. **Telemetry auth** — The agent presents this token as `Authorization: Bearer <token>` on `POST /telemetry/events`. See [telemetry.md](./telemetry.md).
4. **Revocation** — Not implemented in this slice. Future work will set `status = revoked` and reject matching tokens.

**Security notes:**
- Plaintext token is never stored, logged, or returned again after registration.
- `tokenHash` is never included in API responses.
- Use HTTPS for all token transmission.

---

## Endpoints

All endpoints require `Authorization: Bearer <accessToken>`.

### `POST /api/agents`

Register a new agent. **Requires role: `admin` or higher.**

**Request**
```json
{
  "hostname": "workstation-01",
  "os": "windows",
  "agentVersion": "1.0.0",
  "ipAddress": "10.0.0.42"
}
```

Required: `hostname`, `os`, `agentVersion`. Optional: `ipAddress`.

`tenantId` is taken from the JWT — never from the request body.

**Response `201`**
```json
{
  "agent": {
    "id": "<uuid>",
    "tenantId": "<uuid>",
    "hostname": "workstation-01",
    "os": "windows",
    "agentVersion": "1.0.0",
    "status": "pending",
    "registeredAt": "2024-06-01T00:00:00.000Z"
  },
  "agentToken": "<64-char-hex — save immediately>"
}
```

**Response `400`** — validation failure
```json
{ "error": "Validation failed", "fields": ["hostname"] }
```

**Response `403`** — insufficient role (analyst, read-only)

---

### `GET /api/agents`

List agents in the caller's tenant. **Requires role: `analyst` or higher.**

**Response `200`**
```json
[
  {
    "id": "<uuid>",
    "tenantId": "<uuid>",
    "hostname": "workstation-01",
    "os": "windows",
    "agentVersion": "1.0.0",
    "status": "pending",
    "registeredAt": "2024-06-01T00:00:00.000Z"
  }
]
```

Ordered by `registeredAt` descending.

---

### `GET /api/agents/:agentId`

Get a single agent. **Requires role: `analyst` or higher.**

**Response `200`**
```json
{
  "id": "<uuid>",
  "tenantId": "<uuid>",
  "hostname": "workstation-01",
  "os": "windows",
  "agentVersion": "1.0.0",
  "status": "pending",
  "registeredAt": "2024-06-01T00:00:00.000Z",
  "ipAddress": "10.0.0.42",
  "lastSeenAt": null,
  "createdAt": "2024-06-01T00:00:00.000Z",
  "updatedAt": "2024-06-01T00:00:00.000Z"
}
```

**Response `404`** — agent not found or belongs to another tenant (same body; no existence leak)

---

## Wiring the token into agent configuration

After registration, configure the endpoint agent with:

```env
DEPP_AGENT_TOKEN=<agentToken from POST response>
DEPP_API_URL=https://api.depp.example.com
DEPP_AGENT_ID=<agent.id from POST response>
```

The agent process will use `DEPP_AGENT_TOKEN` to authenticate on `POST /telemetry/events`. Keep the token out of logs, version control, and shared dashboards.

---

## RBAC summary

| Endpoint | Minimum role |
|---|---|
| `POST /api/agents` | `admin` |
| `GET /api/agents` | `analyst` |
| `GET /api/agents/:agentId` | `analyst` |

Role hierarchy: `owner` > `admin` > `analyst` > `read-only`.
