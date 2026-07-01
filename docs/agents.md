# Agents — Enrollment and Management

## Overview

An **agent** is an endpoint device enrolled under a tenant. Tenant admins create agent records and receive a **one-time enrollment token** used to authenticate the agent for telemetry and heartbeat traffic. Analysts and above can list and view agents.

Human management routes live under `/api/agents` (user JWT via `tenantScoped`). Agent traffic uses Bearer enrollment tokens on `/telemetry/*` and `/agent/*` only — never user JWTs on those paths.

See [tenancy.md](./tenancy.md) for isolation patterns.

---

## Agent model

| Field | Type | Description |
|---|---|---|
| `id` | UUID | Primary key |
| `tenantId` | UUID | Owning tenant (FK → `tenants`) |
| `displayName` | string | Human-set label (e.g. `prod-server-01`) |
| `hostname` | string | Endpoint hostname reported at enrollment |
| `os` | string | Operating system identifier |
| `agentVersion` | string | Installed agent software version |
| `status` | enum | `pending`, `active`, `inactive`, `revoked`, `expired` |
| `tokenHash` | string | SHA-256 hash of enrollment token (**never returned via API**) |
| `tokenPrefix` | string | First 17 chars of token — safe for support identification |
| `enrolledByUserId` | UUID | FK → user who issued the credential |
| `pendingExpiresAt` | datetime | Enrollment window expiry (default 24h) |
| `lastSeenAt` | datetime? | Updated on successful agent auth |
| `lastIpHash` | string? | SHA-256(ip + `IP_HASH_SALT`) — never raw IP |
| `lastAgentVersion` | string? | Last reported version (may drift) |
| `ipAddress` | string? | Deprecated — retained for migration window |
| `registeredAt` | datetime | When the agent was enrolled |
| `isolatedAt` | datetime? | When platform-side isolation was applied (`null` = not isolated) |
| `createdAt` / `updatedAt` | datetime | Row timestamps |

---

## Agent status values

| Status | Meaning |
|---|---|
| `pending` | Enrolled; token issued but agent has not authenticated yet |
| `active` | Agent has completed at least one successful authenticated request |
| `inactive` | Manually flagged; still authenticates (future automation) |
| `revoked` | Credential permanently invalidated |
| `expired` | Pending enrollment window passed without first auth |

### Transitions

```
pending → active     (first successful agent auth)
pending → expired    (pendingExpiresAt passed — lazy check on auth)
active  → inactive   (admin flag — future slice)
*       → revoked    (admin revoke)
```

---

## Enrollment token lifecycle

1. **Enrollment** — Admin calls `POST /api/agents` or `POST /api/agents/enroll`. Server generates `depp_agt_` + 64 hex chars, stores SHA-256 hash + 17-char prefix, sets `pendingExpiresAt`, returns plaintext token **once**.
2. **Configuration** — Admin stores `enrollmentToken` in the endpoint credential store (OS keychain, secrets manager, etc.).
3. **Agent auth** — Agent presents `Authorization: Bearer depp_agt_<hex>` on `/telemetry/*` and `/agent/*`.
4. **Revocation** — Admin calls `POST` or `PATCH /api/agents/:agentId/revoke`. Takes effect immediately; revoked tokens receive indistinguishable `401 Unauthorized`.

**Security notes:**
- Plaintext token is never stored, logged, or returned again after enrollment.
- `tokenHash` is never included in API responses.
- Auth failures always return `{ "error": "Unauthorized" }` with no distinguishing detail.
- Use HTTPS for all token transmission.

---

## Endpoints

All `/api/agents/*` endpoints require `Authorization: Bearer <user-access-token>`.

### `POST /api/agents` / `POST /api/agents/enroll`

Enroll a new agent. **Requires role: `admin` or higher.**

**Request**
```json
{
  "displayName": "prod-dc1-endpoint-01",
  "hostname": "WIN-DC1-PROD-01",
  "os": "windows",
  "agentVersion": "1.0.0",
  "enrollmentWindowHours": 24
}
```

Required: `displayName`, `hostname`, `os`, `agentVersion`. Optional: `enrollmentWindowHours` (default 24, max 72), `ipAddress`.

`tenantId` is taken from the JWT — never from the request body.

**Response `201`**
```json
{
  "agent": {
    "id": "<uuid>",
    "tenantId": "<uuid>",
    "displayName": "prod-dc1-endpoint-01",
    "hostname": "WIN-DC1-PROD-01",
    "os": "windows",
    "agentVersion": "1.0.0",
    "status": "pending",
    "tokenPrefix": "depp_agt_a3f2b91c",
    "enrolledBy": "<user-uuid>",
    "pendingExpiresAt": "2026-06-29T14:00:00.000Z",
    "registeredAt": "2026-06-28T14:00:00.000Z"
  },
  "enrollmentToken": "depp_agt_a3f2b91c...<full 73-char string>",
  "_tokenWarning": "This token will not be shown again. Store it securely before closing this response."
}
```

---

### `POST /api/agents/:agentId/revoke` / `PATCH /api/agents/:agentId/revoke`

Revoke an agent credential. **Requires role: `admin` or higher.**

**Request**
```json
{ "reason": "suspected_compromise" }
```

**Response `200`**
```json
{ "status": "revoked", "agent": { "...summary fields..." } }
```

**Response `404`** — agent not found or belongs to another tenant

---

### `POST /api/agents/:agentId/isolate`

Record **platform-side isolation intent** for an endpoint (first response action). **Requires role: `admin` or higher** — strictly above analyst alert triage; isolating a machine is a privileged, near-destructive operation.

**Request**
```json
{ "reason": "active_incident_containment" }
```

Optional `reason` is captured in the audit log (operator justification). Never include secrets or tokens in `reason`.

**Response `200`**
```json
{
  "agentId": "<uuid>",
  "tenantId": "<uuid>",
  "status": "active",
  "isolated": true,
  "isolatedAt": "2026-06-23T12:00:00.000Z"
}
```

`status` reflects lifecycle (`pending` / `active` / etc.) and remains independent of isolation — an agent can be `active` **and** isolated.

**Response `404`** — agent not found or belongs to another tenant (same body; no existence leak). Emits `agent_isolation_access_denied` audit.

**Response `409`** — agent is in a terminal lifecycle state (`revoked`, `expired`) where isolation cannot be applied.

Repeat isolate on an already-isolated agent returns **200** (idempotent) with current state.

---

### `POST /api/agents/:agentId/restore`

Lift platform-side isolation — **first-class reversible counterpart** to isolate. **Requires role: `admin` or higher.**

**Response `200`**
```json
{
  "agentId": "<uuid>",
  "tenantId": "<uuid>",
  "status": "active",
  "isolated": false,
  "isolatedAt": null
}
```

Restore on a non-isolated agent returns **200** (idempotent). Cross-tenant or missing agents return **404** with `agent_isolation_access_denied` audit.

> **Deferred (future work):** Endpoint-side enforcement — the agent daemon acting on `isolatedAt` (network drop, process containment, etc.) is **not implemented** in this slice. This API records and exposes isolation **state and intent** only. Do not assume an isolated endpoint is physically contained until the daemon slice ships.

---

### `GET /api/agents`

List agents in the caller's tenant. **Requires role: `analyst` or higher.**

Ordered by `registeredAt` descending. Never includes `enrollmentToken` or `tokenHash`.

---

### `GET /api/agents/:agentId`

Get a single agent. **Requires role: `analyst` or higher.**

**Response `404`** — agent not found or belongs to another tenant (same body; no existence leak)

---

## Agent authentication header

Agent routes accept **only** enrollment Bearer tokens (not user JWTs):

```
Authorization: Bearer depp_agt_<64-hex-chars>
```

On success, `req.agent = { agentId, tenantId }` where `tenantId` comes from the DB row — never from request body or headers.

---

## RBAC summary

| Endpoint | Minimum role |
|---|---|
| `POST /api/agents` / `/enroll` | `admin` |
| `POST` / `PATCH /api/agents/:id/revoke` | `admin` |
| `POST /api/agents/:id/isolate` | `admin` |
| `POST /api/agents/:id/restore` | `admin` |
| `GET /api/agents` | `analyst` |
| `GET /api/agents/:agentId` | `analyst` |

Role hierarchy: `owner` > `admin` > `analyst` > `read-only`.

---

## Audit events

| Action | When |
|---|---|
| `agent_enrollment` | Successful enrollment |
| `agent_enrollment_failed` | Enrollment persistence failure |
| `agent_auth_success` / `agent_auth_failed` | Agent middleware auth |
| `agent_activated` | First successful auth (`pending → active`) |
| `agent_expired` | Pending window expired |
| `agent_revoked` | Admin revocation |
| `agent_isolated` | Admin isolation (success, including idempotent re-isolate) |
| `agent_restored` | Admin restore (success, including idempotent restore) |
| `agent_isolation_access_denied` | Isolate/restore denied — missing or cross-tenant agent (`404`) |

Raw tokens are never logged. Operator `reason` on isolate is scrubbed via the same `sanitizeEvent` path as other audit fields. Failures omit `agentId` when the token is unknown.
