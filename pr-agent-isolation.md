## Summary

- Introduces DEPP's **first response action**: platform-side endpoint isolation (`POST /api/agents/:agentId/isolate`) and restore (`POST /api/agents/:agentId/restore`).
- Adds orthogonal `agents.isolatedAt` field (nullable) — agents can be `active` and isolated simultaneously; lifecycle `status` is unchanged.
- Shifts the product from **monitoring-only** to **response-capable** at the API layer. **Endpoint-side enforcement** (daemon acting on isolation — network/process containment) is explicitly **deferred**; this slice records intent and state only.

## Security / design

- **Authorization:** `admin` or higher (same bar as revoke) — strictly above analyst alert triage.
- **Reversibility:** restore is a first-class operation; repeat calls are idempotent (200).
- **Audit:** `agent_isolated`, `agent_restored` on success; `agent_isolation_access_denied` on cross-tenant/missing agent (404); `access_denied_insufficient_role` on 403.
- **Tenant isolation:** cross-tenant agent IDs return an indistinguishable 404.
- Isolate/restore writes are tenant-scoped at the mutation itself (`updateMany` with `{ id, tenantId }`), not only at the lookup — with regression coverage at both route and service layers.

## Schema

Additive migration `20260701120000_add_agent_isolation`: `isolatedAt TIMESTAMP(3) NULL` + `(tenantId, isolatedAt)` index. **Reviewers: please review the migration consciously — this PR includes a schema change.**

## Test plan

- [x] Service: isolate/restore transitions, reason capture, cross-tenant null, tenant-guarded write miss → not-found, idempotency, terminal status 409
- [x] Routes: admin 200, analyst 403 (no side effect), no auth 401, cross-tenant 404, audit emission rules
- [x] Full suite green
- [ ] Apply migration in staging: `npx prisma migrate deploy`
