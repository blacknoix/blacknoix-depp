# Tenancy — Tenant Isolation in api-gateway

## Overview

Every authenticated access token carries a `tenantId` claim. Tenant-scoped API routes enforce isolation by default through middleware and query helpers — individual handlers should not re-implement auth checks.

See also: [auth.md](./auth.md) for JWT shapes and login flow.

---

## Request types

| Type | When available | Key fields |
|---|---|---|
| `AuthenticatedRequest` | After `authenticate` | `req.auth.{ userId, tenantId, role }` |
| `TenantScopedRequest` | After `tenantScoped` chain | `req.tenant.{ tenantId, userId, role }` |

`TenantScopedRequest` is the canonical type for handlers under `/api/*`.

---

## Middleware

### `tenantScoped` (default for `/api`)

```typescript
import { tenantScoped } from '../middleware/tenantScoped';

router.use(...tenantScoped); // [authenticate, requireTenantContext]
```

1. **`authenticate`** — validates Bearer access token; rejects missing/malformed/expired tokens.
2. **`requireTenantContext`** — ensures `tenantId` is present and attaches `req.tenant`.

### `requireMatchingTenantParam`

Use on routes that expose `:tenantId` in the path. Rejects with **403** when the param does not match the token (caller explicitly targeted another tenant).

```typescript
router.get(
  '/tenants/:tenantId',
  requireMatchingTenantParam('tenantId'),
  handler
);
```

---

## Query helpers (`src/lib/tenantScope.ts`)

| Helper | Purpose |
|---|---|
| `tenantWhere(tenantId)` | Prisma `where` fragment for tenant-owned tables |
| `tenantOwnedWhere(tenantId, id)` | Scoped lookup by primary key + tenant |
| `withTenantId(tenantId, data)` | Inject `tenantId` into create payloads |
| `belongsToTenant(resource, tenantId)` | Post-fetch ownership check |
| `tenantParamMatches(authTenantId, param)` | Compare token tenant to URL param |

**Rule:** Always include `tenantId` in Prisma `where` clauses for tenant-owned models. Do not fetch by id alone and check ownership afterward unless unavoidable.

```typescript
// Preferred — cross-tenant id returns null from DB
const user = await prisma.user.findFirst({
  where: tenantOwnedWhere(tenantId, userId),
});

// On create — always inject tenantId from token, never from body
await prisma.someModel.create({
  data: withTenantId(tenantId, { name: body.name }),
});
```

---

## HTTP status conventions

| Situation | Status | Rationale |
|---|---|---|
| Missing/invalid token | `401` | Unauthenticated |
| URL `:tenantId` ≠ token tenant | `403` | Caller targeted another tenant namespace |
| Resource id not in caller's tenant | `404` | Same response as not found — no existence leak |
| Resource genuinely missing in tenant | `404` | Standard not found |

---

## Example routes

| Method | Path | Description |
|---|---|---|
| `GET` | `/api/tenant` | Current tenant profile |
| `GET` | `/api/tenant/overview` | Dashboard aggregates for caller's tenant (analyst+) |
| `GET` | `/api/tenants/:tenantId` | Tenant profile (param must match token) |
| `GET` | `/api/users/:userId` | User in caller's tenant only |
| `GET` | `/api/agents` | List agents in caller's tenant ([agents.md](./agents.md)) |
| `POST` | `/api/agents` | Register agent (admin+) |
| `GET` | `/api/agents/:agentId` | Agent detail in caller's tenant |
| `GET` | `/api/agents/:agentId/events` | Telemetry events for agent ([telemetry.md](./telemetry.md)) |
| `POST` | `/telemetry/events` | Agent telemetry ingestion (agent token auth) |
| `GET` | `/api/alerts` | List alerts in caller's tenant ([alerts.md](./alerts.md)) |
| `GET` | `/api/alerts/:alertId` | Alert detail |
| `PATCH` | `/api/alerts/:alertId` | Triage alert (status / assignee) |

---

## Tenant-owned models

| Model | Scoped by | Documentation |
|---|---|---|
| `User` | `tenantId` | [auth.md](./auth.md) |
| `Agent` | `tenantId` | [agents.md](./agents.md) |
| `TelemetryEvent` | `tenantId` | [telemetry.md](./telemetry.md) |
| `Alert` | `tenantId` | [alerts.md](./alerts.md) |
| `RefreshToken` | via `User.tenantId` | [auth.md](./auth.md) |

---

### Handler pattern

```typescript
apiRouter.get('/users/:userId', async (req, res) => {
  const { tenantId } = readTenantFromRequest(req);
  const user = await getUserInTenant(tenantId, req.params.userId);
  if (!user) {
    res.status(404).json({ error: 'User not found' });
    return;
  }
  res.json(user);
});
```

### Service pattern

```typescript
export async function getUserInTenant(tenantId: string, userId: string) {
  return prisma.user.findFirst({
    where: tenantOwnedWhere(tenantId, userId),
    select: { id: true, email: true, role: true, tenantId: true },
  });
}
```

---

## Adding new tenant-scoped resources

1. Add a `tenantId` foreign key on the Prisma model (if not already present).
2. Mount routes on `apiRouter` or a sub-router that uses `tenantScoped`.
3. Read `req.tenant.tenantId` — never trust `tenantId` from the request body.
4. Scope all reads/writes with `tenantWhere` / `tenantOwnedWhere` / `withTenantId`.
5. Return `404` for cross-tenant resource ids; use `requireMatchingTenantParam` when the URL includes `:tenantId`.
6. Add tests proving cross-tenant access is rejected.

---

## Tenant overview dashboard

### `GET /api/tenant/overview`

Returns read-only aggregate metrics for the authenticated caller's tenant. Uses **tenant-from-auth-context** (same pattern as `GET /api/tenant`) — no path-param tenant id.

| Requirement | Value |
|---|---|
| Auth | Bearer access token (`tenantScoped` chain) |
| Minimum role | `analyst` (owner/admin/analyst allowed; read-only → 403) |
| Missing tenant | `404` `{ "error": "Tenant not found" }` (same as `GET /api/tenant`) |

**Response fields:**

| Section | Fields |
|---|---|
| `tenant` | `id`, `name` |
| `agents` | `total`, `byStatus` (stored `Agent.status`: `pending`, `active`, `inactive`, `revoked`, `expired`), `recentlySeen` |
| `alerts` | `total`, `byStatus` (`open`, `acknowledged`, `resolved`), `bySeverity` (`info`, `low`, `medium`, `high`, `critical`) |
| `telemetry` | `events24h` — count of events with `receivedAt` in the rolling last 24 hours |
| `activity` | `lastTelemetryReceivedAt`, `lastAlertCreatedAt`, `lastAgentSeenAt` (ISO strings or `null`) |
| `generatedAt` | Server ISO timestamp when the overview was computed |

**Semantics (product sign-off recommended for `recentlySeen`):**

- **`agents.byStatus`:** counts from the stored `Agent.status` column (not computed from `lastSeenAt`).
- **`agents.recentlySeen`:** count of agents where `lastSeenAt >= now - 24h` (rolling window from server clock). Same 24h window as `telemetry.events24h`.
- **`telemetry.events24h`:** tenant-scoped count where `receivedAt >= now - 24h`. Supported by index `@@index([tenantId, receivedAt])` on `telemetry_events`.

**Audit / metrics:** No dedicated audit action or metric counter — matches `GET /api/tenant` (read-only profile) and avoids dashboard log flooding on every page load.

---

Import `prisma` from `src/lib/prisma.ts` in all services. Do not instantiate `PrismaClient` per module.
