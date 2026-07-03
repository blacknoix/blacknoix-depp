# DEPP Project Memory

## Project
Decentralized Endpoint Protection Platform (DEPP)

## Business goal
Build an enterprise-grade endpoint protection SaaS with:
- Multi-tenant dashboard
- Endpoint agents
- Telemetry ingestion
- Anomaly detection
- Alerting and response policies
- Audit logging and future immutable logging

## Stack
- Frontend: React + Vite + Tailwind + TypeScript
- API Gateway: Node.js + Express + TypeScript
- Agent Manager: Node.js + Socket.io + TypeScript
- ML service: FastAPI + Python
- Data: PostgreSQL + Redis
- Infra: Docker Compose first, Kubernetes later

## Repo structure
```
frontend/               React + Vite + Tailwind + TS
backend/
  api-gateway/          Node + Express + TS
  agent-manager/        Node + Socket.io + TS
  ml-anomaly/           FastAPI + Python
docs/
infra/
```

## Dev commands
| Service | Command | Purpose |
|---|---|---|
| frontend | `npm run dev` | Start dev server |
| frontend | `npm run test` | Run tests |
| frontend | `npm run lint` | Lint |
| api-gateway | `npm run dev` | Start dev server |
| api-gateway | `npm run test` | Run tests |
| api-gateway | `npm run test:integration` | Run Postgres integration tests (see below) |
| api-gateway | `npm run lint` | Lint |
| agent-manager | `npm run dev` | Start dev server |
| agent-manager | `npm run test` | Run tests |
| agent-manager | `npm run lint` | Lint |
| ml-anomaly | `uvicorn main:app --reload` | Start dev server |
| ml-anomaly | `pytest` | Run tests |

## DB migrations
- JS services (api-gateway, agent-manager): **Prisma** for PostgreSQL schema and migrations
- Python service (ml-anomaly): **Alembic** for migrations

## Auth strategy
Custom JWT-based auth:
- Access tokens + refresh tokens
- Per-tenant scoping on every token
- Roles: `owner`, `admin`, `analyst`, `read-only`

## Architecture principles
- Tenant isolation
- Strong auth and RBAC
- Secure defaults
- Auditability and observability
- Small, testable vertical slices
- Documentation updated when behavior changes

## Hard rules
- Never hardcode secrets
- Never instantiate `PrismaClient` directly in services or routes — always import the shared `prisma` instance from `src/lib/prisma.ts`
- Ask before destructive edits — this means:
  - Schema migrations that drop or rename columns
  - File deletions or major file/directory moves
  - Data wipes or backfills
  - Large-scale API contract changes
- Preserve tenant isolation always
- Add audit logs for security-sensitive actions
- Prefer maintainable patterns over clever hacks
- Do not add blockchain complexity unless explicitly required

## Current status
**Auth foundation complete** (`backend/api-gateway`):
- Prisma schema: `Tenant`, `User`, `RefreshToken` models
- `POST /auth/login` — bcrypt credential check, tenant-scoped JWT pair
- `POST /auth/refresh` — refresh token rotation with DB revocation
- `GET /auth/me` — protected route; validates access token
- `authenticate` middleware — reusable; attaches `{ userId, tenantId, role }` to req
- 14 tests covering login, refresh, middleware 401s, enumeration protection, tenant isolation
- `docs/auth.md` — token shapes, roles, endpoints, security notes

**Tenant isolation enforcement complete** (`backend/api-gateway`):
- `tenantScoped` middleware chain — `authenticate` + `requireTenantContext`; attaches `req.tenant`
- `requireMatchingTenantParam` — rejects cross-tenant URL `:tenantId` with 403
- `src/lib/tenantScope.ts` — Prisma query helpers (`tenantWhere`, `tenantOwnedWhere`, `withTenantId`)
- Shared `src/lib/prisma.ts` client used by all services
- Example routes: `GET /api/tenant`, `GET /api/tenants/:tenantId`, `GET /api/users/:userId`
- Tenant-scoped services: `tenantService`, `userService`
- Cross-tenant access tests (404 for resource ids, 403 for URL tenant mismatch)
- `docs/tenancy.md` — patterns, status codes, handler/service examples

**Agent registration complete** (`backend/api-gateway`):
- Prisma `Agent` model + `AgentStatus` enum; `Tenant.agents` relation
- `requireRole` RBAC middleware — role hierarchy: owner > admin > analyst > read-only
- `agentService` — create (one-time token + SHA-256 hash), list, get with tenant-scoped queries
- Routes: `POST /api/agents`, `GET /api/agents`, `GET /api/agents/:agentId`
- `docs/agents.md` — model, endpoints, token lifecycle, status values

**Telemetry ingestion complete** (`backend/api-gateway`):
- Prisma `TelemetryEvent` model with tenant/agent relations and indexes
- `authenticateAgent` middleware — SHA-256 agent token lookup (separate from user JWT)
- `telemetryService` — atomic batch ingest, agent activity update, tenant-scoped event listing
- `POST /telemetry/events` — agent-authenticated batch ingestion (1–100 events, 512 KB limit)
- `GET /api/agents/:agentId/events` — analyst+ query with `limit` and `before` pagination
- First accepted batch transitions agent `pending → active` and updates `lastSeenAt`
- `docs/telemetry.md` — agent auth, event schema, batch format, pagination, curl examples

**Alerts and triage complete** (`backend/api-gateway`):
- Prisma `Alert` model + `AlertStatus` enum; relations to Tenant, Agent, User, TelemetryEvent
- Auto-trigger on telemetry ingest — `high` and `critical` events create alerts in same transaction
- `alertService` — list (filters + pagination), get, update with forward-only status transitions
- Routes: `GET /api/alerts`, `GET /api/alerts/:alertId`, `PATCH /api/alerts/:alertId`
- Assignee validation — must belong to same tenant; explicit unassign via `null`
- `docs/alerts.md` — model, lifecycle, auto-trigger rules, triage workflow

**Next up:** Policy engine — priority #6.

**Note:** Run `npm install` in `backend/api-gateway` before `npm run test` or `npm run lint`. `postinstall` runs `prisma generate` so `@prisma/client` types match `schema.prisma`. After schema changes, run `npx prisma generate` (or reinstall).

### Integration tests (`backend/api-gateway`)

Unit tests (`npm test`) mock Prisma and do not need a database. Integration tests (`npm run test:integration`) use a real Postgres instance.

1. Start test Postgres (from `backend/api-gateway`):
   ```bash
   docker compose -f docker-compose.test.yml up -d --wait
   ```
2. Run integration tests:
   ```bash
   npm run test:integration
   ```
3. Stop when finished:
   ```bash
   docker compose -f docker-compose.test.yml down
   ```

Uses `DATABASE_URL=postgresql://test:test@localhost:5432/depp_test` (override via env if needed). Migrations are applied with `prisma migrate deploy` before the suite runs.

**Migration note (no action needed today):** This repo includes baseline migration `20240623100000_baseline_auth` so `prisma migrate deploy` builds the database correctly from an empty Postgres (previously failed with P3018 — auth tables were never captured as a migration). Development currently uses mocks and an ephemeral test database, so no baselining is required now. If a persistent database is ever created via `db push` instead of `migrate deploy`, it must be baselined with `prisma migrate resolve --applied` before its next deploy — inspect any such environment individually.

## Current priorities
1. Auth + RBAC
2. Tenant isolation
3. Agent registration
4. Telemetry ingestion
5. Alerts and triage
6. Policy engine
7. Observability + logs/metrics
8. Enterprise docs and readiness
