## Summary

Adds a read-only tenant dashboard endpoint that returns aggregated agent, alert, telemetry, and activity metrics for the authenticated caller's tenant.

## What changed

- **Endpoint:** `GET /api/tenant/overview` (tenant-from-auth-context, `analyst+`)
- **Service:** `getTenantOverview(tenantId)` — tenant-scoped `groupBy`/`count`/`findFirst` aggregations, no side effects
- **Response:** tenant profile slice, agent status counts + `recentlySeen`, alert status/severity counts, 24h telemetry count, latest activity timestamps, `generatedAt`
- **Docs:** `docs/tenancy.md` — path, auth, field definitions, 24h window semantics

## Design notes

- Agent `byStatus` uses stored `Agent.status`; `recentlySeen` uses `lastSeenAt` within rolling 24h (product sign-off recommended).
- Telemetry `events24h` uses `receivedAt` with existing `(tenantId, receivedAt)` index.
- No new audit action or metrics counter (matches `GET /api/tenant` read pattern).
- `GET /api/tenant/overview` resolves tenant from auth context, not a path param — no cross-tenant existence oracle on the 404 path.

## Validation

- `npm run typecheck` — pass
- `npm run lint` — pass
- `npm test` — 15 suites, all green
