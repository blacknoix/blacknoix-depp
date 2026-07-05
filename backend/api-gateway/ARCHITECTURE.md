# DEPP API Gateway — Architecture

Architecture and development guide for `backend/api-gateway`, the primary HTTP service in the Decentralized Endpoint Protection Platform (DEPP) monorepo. Written for staff-level backend/security reviewers who will read the code next.

This document describes **what exists in the repository today**. It is not a product pitch. DEPP is a solo-developed Express/TypeScript service backed by PostgreSQL, tested primarily with mocks and seeded integration data. It is **not deployed**, has **no users**, and has **no endpoint agent binary** in this repo.

---

## Phase 0 inventory (verified against code)

### HTTP routes (actual mount points)

| Prefix | Auth | Purpose |
|---|---|---|
| `GET /health` | None | Liveness |
| `/auth/*` | Mixed | `POST /login`, `/refresh`, `/logout`; `GET /me` (JWT) |
| `/telemetry/events` | Agent Bearer token | Batch telemetry ingest (1–100 events, 512 KB limit) |
| `/agent/heartbeat` | Agent Bearer token | Agent liveness ping |
| `/api/*` | User JWT + tenant context | Tenant-scoped dashboard API (default chain: `authenticate` → `requireTenantContext`) |
| `/internal/metrics` | User JWT, admin+ | In-process counters snapshot |

**Under `/api` today:**

- `GET /tenant`, `GET /tenant/overview`, `GET /tenants/:tenantId`, `GET /users/:userId`
- **Agents:** enroll (`POST /agents`, `/agents/enroll`), list/get, revoke, **isolate/restore**, list telemetry events
- **Alerts:** list/get/patch (triage)

**Not exposed as HTTP:** `runOutbreakDetection()` (correlation v2 runner) — callable from code/tests only.

**Correction vs common assumptions:** There is no tenant self-registration or user signup route. Tenants and users are created via direct database inserts (integration helpers or Prisma), not via a public API.

### Services (`src/services/`)

| File | Role |
|---|---|
| `authService.ts` | Login, refresh rotation, logout, password hashing |
| `tenantService.ts` | Tenant profile reads |
| `userService.ts` | Tenant-scoped user reads |
| `agentService.ts` | Enrollment, token auth lookup, heartbeat, revoke |
| `agentIsolationService.ts` | Platform-side `isolatedAt` intent (isolate/restore) |
| `telemetryService.ts` | Ingest batch, list events, runs v1 correlation inline |
| `alertService.ts` | List/get/update alerts (triage) |
| `tenantOverviewService.ts` | Dashboard aggregates (`groupBy`, counts, 24h windows) |
| `outbreakDetectionService.ts` | v2 outbreak runner (`runOutbreakDetection`) |

### Libraries (`src/lib/`)

| File | Role |
|---|---|
| `correlationEngine.ts` | v1 pure rules (`evaluateRules`) |
| `correlationEngineV2.ts` | v2 pure outbreak detection (`detectOutbreaks`) |
| `alertIndicator.ts` | Extract `payload.fileHash` → alert indicator |
| `authAudit.ts` | Structured auth/audit log lines to stdout |
| `metrics.ts` | In-memory counters |
| `tenantScope.ts` | Tenant query helpers |
| `prisma.ts` | Shared Prisma client singleton |

### Prisma models (`schema.prisma`)

`Tenant`, `User`, `RefreshToken`, `Agent`, `TelemetryEvent`, `Alert`, `CorrelatedIncident`

Enums: `Role`, `AgentStatus`, `AlertStatus`

### Tests (counts verified)

- **Unit:** 21 suites, **244 tests** (`npm test`) — Prisma mocked
- **Integration:** 4 suites, **11 tests** (`npm run test:integration`) — real Postgres via Docker

Integration suites: database smoke, tenant overview aggregations, alert indicator round-trip, outbreak detection idempotency.

### Honest operational facts

- **No endpoint agent** in this repository. Telemetry in tests is synthetic (HTTP POST with a enrolled agent token, or direct DB seeding).
- **`Alert.indicator` is null on typical ingest** unless `payload.fileHash` is present; agents do not emit it today.
- **Correlation v2:** one implemented pattern (`malware_outbreak`); five additional patterns documented as requirements only (`docs/correlation-v2.md`).
- **Outbreak scheduling deferred:** `runOutbreakDetection` is a plain function; no cron, worker, or ingest hook.
- **Isolation is platform intent only:** `Agent.isolatedAt` is set in Postgres; schema comments state endpoint enforcement is deferred.

---

## 1. Overview

DEPP (Decentralized Endpoint Protection Platform) is, in **current code**, a **centralized multi-tenant API gateway** for endpoint security workflows: user authentication, agent enrollment, telemetry ingestion, alert generation, alert triage, tenant dashboard aggregates, platform-side isolation intent, and cross-agent incident correlation (one pattern implemented).

The problem it addresses at this stage: provide a **tenant-isolated control plane** where analysts can enroll agents, receive security events, triage alerts, see tenant-level posture, and (eventually) respond — with correlation logic that can group related signals across endpoints.

### Name vs reality (read this first)

The word **“Decentralized”** in the project name refers to an **unbuilt vision** (decentralized mesh, distributed enforcement, possibly blockchain-adjacent ideas mentioned in project notes). **None of that exists in code.** What exists is a conventional **centralized SaaS backend**: one Postgres database, one API service, JWT auth, tenant scoping in SQL queries. Do not infer mesh networking, peer agents, or decentralized consensus from the name.

Similarly, the monorepo lists `frontend/`, `backend/agent-manager/`, and `backend/ml-anomaly/` in project docs, but **this document covers only `backend/api-gateway`**. Those sibling directories are not described here.

---

## 2. Architecture

### Request flow (simplified)

```
                    ┌─────────────────────────────────────┐
  User JWT          │  /api/*  tenantScoped middleware    │
  ───────────────►  │  authenticate → requireTenantContext │
                    │  requireRole(...) per route          │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │  Services (tenant-scoped queries)    │
                    └──────────────┬──────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────┐
                    │  PostgreSQL (Prisma)                 │
                    └─────────────────────────────────────┘

  Agent token       ┌─────────────────────────────────────┐
  ───────────────►  │  /telemetry/*  authenticateAgent   │
                    │  ingest → v1 evaluateRules → txn     │
                    └─────────────────────────────────────┘
```

### Tenancy and auth

- **Users:** Custom JWT pair (access + refresh). Access token carries `{ sub, tenantId, role }`. Refresh tokens stored hashed in `refresh_tokens` with rotation on refresh.
- **Roles:** `owner` > `admin` > `analyst` > `read_only`. Enforced by `requireRole` on routes.
- **Tenant isolation:** All `/api` routes pass through `tenantScoped` (`authenticate` + `requireTenantContext`). Services use `tenantWhere(tenantId)` / `tenantOwnedWhere(tenantId, id)` helpers so queries cannot cross tenants. Cross-tenant resource IDs return **404** (not 403) to avoid existence leaks.
- **Agents:** Separate credential — SHA-256 hash of enrollment token stored; raw token returned once at enroll. Agent routes use `authenticateAgent`, not user JWT.

### Audit and metrics

- **Audit:** `logAuthEvent` writes structured JSON lines to stdout (`AUTH_EVENT ...`). Used for login, alert access, agent isolation, etc. Not a separate audit store or immutable log chain.
- **Metrics:** In-memory counters (`alertsCreated`, `alertsUpdated`, auth outcomes). Exposed at `GET /internal/metrics` (admin JWT). Resets on process restart.

### Persistence and migrations

- **ORM:** Prisma 5, PostgreSQL.
- **Migration chain:** 11 migrations, including a **baseline auth migration** (`20240623100000_baseline_auth`) so `prisma migrate deploy` builds from an **empty database**. Earlier development had relied on mocks; the baseline fixed P3018 failures when FKs referenced tables with no creating migration.
- **Shared client rule:** Services import `prisma` from `src/lib/prisma.ts` — never instantiate `PrismaClient` in route handlers.
- **Generated client:** `@prisma/client` from `schema.prisma` (`postinstall`: `prisma generate`). A former hand-written Prisma type stub was removed; types come from generation.

### Integration test harness

- `docker-compose.test.yml` — Postgres 16 on `localhost:5432`, database `depp_test`.
- `integration/globalSetup.ts` runs `prisma migrate deploy` once per Jest run.
- `integration/helpers/seed.ts` and `truncate.ts` — reusable parent-first seed, child-first truncate for isolated tests.

---

## 3. Feature slices (engineering narrative)

Work proceeded in vertical slices with **foundations before features** — not because foundations are interesting, but because later slices (real SQL aggregation, correlation v2 idempotency) are untestable without them.

### Auth, tenancy, RBAC (foundation)

JWT auth, refresh rotation, `tenantScoped` middleware, role hierarchy, cross-tenant tests. Establishes the invariant every later slice inherits: **every query is tenant-bound**.

### Agent enrollment and telemetry ingest

Agents enroll via admin API; ingest accepts batched JSON events. First ingest transitions agent `pending → active` and updates `lastSeenAt`. Events are append-only.

### Correlation v1 (inline, ingest-time)

Pure function `evaluateRules` in `correlationEngine.ts` runs **before** the ingest transaction:

| Rule ID | Behavior |
|---|---|
| `malware-prefix` | `eventType` starts with `malware.` → alert severity `high` |
| `severity-threshold` | `high` / `critical` non-malware events |
| `batch-burst` | ≥3 high/critical in one batch → synthetic alert (`telemetryEventId: null`) |

First matching per-event rule wins. v1 does **not** correlate across batches or agents.

### Alerts and triage

Auto-created on ingest; analysts list/filter/patch status and assignee. Forward-only status transitions: `open → acknowledged → resolved`.

### Agent isolation (monitoring → response, platform-side)

`POST /api/agents/:agentId/isolate` and `/restore` set/clear `Agent.isolatedAt`. Audit events logged. **Endpoint enforcement is not implemented** — this records intent in the database only.

### Tenant overview

`GET /api/tenant/overview` — read-only aggregates: agent counts by status, recently seen (24h), alert counts by status/severity, telemetry volume (24h), latest activity timestamps. Proven against real Postgres in integration tests (not just mocks).

### Foundation hardening (parallel to features)

- Baseline migration for empty-db deploys
- Removal of Prisma type stub (honest generated types)
- Integration harness + seed/truncate helpers

### Alert indicator (data path for v2)

Nullable `Alert.indicator`, populated from optional `payload.fileHash` at v1 alert creation. Indexed `(tenantId, indicator)`. **Null in practice** until an agent emits structured IOCs.

### Correlation v2 — outbreak pattern only

- Pure engine: `detectOutbreaks` groups non-null indicators across agents in a sliding window
- Persistence: `CorrelatedIncident` model
- Runner: `runOutbreakDetection(tenantId)` upserts by deterministic id
- **Not on ingest path; not scheduled; not HTTP-exposed**

---

## 4. Correlation v2 backlog

Six patterns are contemplated. **Only `malware_outbreak` is implemented.** The other five are documented requirements in `docs/correlation-v2.md` with named telemetry gaps.

| Pattern | Status | Telemetry / alert data today | Would need first |
|---|---|---|---|
| **Malware hash outbreak** | **Implemented** | `Alert.indicator` from `payload.fileHash` (capture path exists; values null without agent) | Real agent emitting `fileHash` on malware events |
| Lateral movement chain | Not built | Generic `payload` JSON only | `payload.parentProcessId` or process-tree links across agents |
| Credential spray | Not built | No auth-failure event types | Structured auth-failure events with `payload.targetUser` |
| C2 beaconing | Not built | No network beacon event types | Network events with `payload.destinationHost` + timing |
| Privilege escalation burst | Not built | No elevation event types | `payload.elevatedTo` / role-change events across agents |
| Data exfiltration spike | Not built | No egress volume fields | `payload.bytesOut` (or equivalent) per agent |

Outbreak defaults (in code): `OUTBREAK_WINDOW_MS` = 24h, `OUTBREAK_MIN_AGENTS` = 3, lookback = 24h.

---

## 5. Data model

### Core entities

**Tenant / User / RefreshToken** — standard multi-tenant SaaS auth. Users belong to one tenant; roles gate API access.

**Agent** — endpoint identity (`displayName`, `hostname`, `os`, `agentVersion`), lifecycle status (`pending`, `active`, `inactive`, `revoked`, `expired`), credential hash, `lastSeenAt`, optional `isolatedAt`.

**TelemetryEvent** — append-only: `eventType`, `severity`, `occurredAt`, `payload` (JSON), `receivedAt`. No enforced payload schema except “JSON object.”

**Alert** — tenant-owned, links optional `telemetryEventId`, carries `ruleId`, nullable `indicator`, triage `status`, assignee.

**CorrelatedIncident** — v2 outbreak record: deterministic string `id`, `type` (`malware_outbreak`), `indicator`, `agentIds[]`, `alertIds[]`, `agentCount`, `firstSeen`, `lastSeen`.

### How correlation works

**v1 (ingest):** Row-at-a-time and single-batch rules. No cross-agent state.

**v2 (outbreak, out-of-band):**

1. Read tenant alerts with `indicator IS NOT NULL` within lookback window
2. Group by `(tenantId, indicator)`
3. Sliding window on `createdAt`: qualify when ≥ `minAgents` **distinct** `agentId` within `windowMs`
4. Emit incident with sorted `agentIds` / `alertIds`, `firstSeen`, `lastSeen`

**Deterministic id (idempotency):**

```
windowBucketStart = floor(firstSeen / windowMs) * windowMs
id = SHA-256(`${tenantId}|${indicator}|${windowBucketStart}`)
```

`runOutbreakDetection` **upserts** on `id`. Integration test runs the runner twice and asserts one row — duplicate outbreaks do not duplicate incidents.

**Tenant overview (separate from correlation):** Uses Prisma `groupBy`, `count`, and `findFirst` with `TENANT_OVERVIEW_WINDOW_MS` (24h) for `events24h` and `recentlySeen` — proven in integration tests against real SQL.

---

## 6. Development and testing

### Commands

```bash
cd backend/api-gateway
npm install          # runs prisma generate
npm run typecheck
npm test             # 244 unit tests, mocked DB
npm run lint
```

### Integration tests (Postgres required)

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration   # 11 tests, migrate deploy + real SQL
docker compose -f docker-compose.test.yml down   # when finished
```

Default test DB URL (set in `integration/setup.ts`):  
`postgresql://test:test@localhost:5432/depp_test`

### What tests actually prove

| Layer | Proves |
|---|---|
| Unit | Route validation, auth, v1/v2 pure engines, service logic with mocked Prisma |
| Integration | Migrations apply from empty; tenant overview SQL math; indicator filter; outbreak upsert idempotency |

Unit tests are the bulk of coverage. Integration tests target behaviors mocks cannot validate (aggregations, FK constraints, upsert semantics).

---

## 7. Honest limitations and future work

### Not built (do not assume)

- Decentralized mesh, peer agents, distributed enforcement
- Kernel drivers, EDR sensor, host isolation enforcement
- Real endpoint agent (no binary, no installer, no OS hooks in repo)
- ML anomaly service wired to this gateway (sibling service exists in monorepo, not integrated here)
- Redis, job queue, or background worker for correlation v2
- Immutable audit log / SIEM export
- Public tenant signup, billing, multi-region deployment
- Production deployment configuration

### Working today (in code, tested)

- Multi-tenant JWT auth with RBAC
- Agent enroll / revoke / heartbeat
- Telemetry ingest with v1 correlation and transactional alert creation
- Alert triage API
- Tenant overview aggregates
- Platform-side isolation timestamps
- Alert indicator capture path (null without agent IOCs)
- v2 outbreak engine + idempotent persistence (callable, tested via integration seeds)
- Migration chain from empty Postgres

### Future work (named dependencies)

- Build endpoint agent emitting structured telemetry (`fileHash`, process trees, network events, etc.)
- Wire correlation v2 scheduling (interval/worker — design choice deferred)
- Implement remaining five v2 patterns once telemetry exists
- HTTP API for incidents (none today)
- Endpoint enforcement of `isolatedAt`
- Frontend dashboard consuming these APIs (separate package)

---

## 8. How to run locally

There is no checked-in `.env` and no production docker-compose for dev — only `docker-compose.test.yml` for Postgres. A reviewer can reuse that container for local development.

### 1. Start Postgres

```bash
cd backend/api-gateway
docker compose -f docker-compose.test.yml up -d --wait
```

### 2. Environment variables

Create `backend/api-gateway/.env` (not committed):

```env
DATABASE_URL=postgresql://test:test@localhost:5432/depp_test
JWT_ACCESS_SECRET=<at-least-32-characters-secret>
JWT_REFRESH_SECRET=<at-least-32-characters-secret>
PORT=3001
```

Optional: `IP_HASH_SALT` for agent IP hashing.

### 3. Apply migrations

```bash
npx prisma migrate deploy
```

**Note:** `prisma migrate deploy` from empty is supported. If you ever created a DB via `db push` instead of migrations, you may need per-environment baselining (`prisma migrate resolve`) before deploy — inspect that DB individually.

### 4. Seed tenant and user (no signup API)

There is no HTTP route to create tenants or users. Options:

- **Prisma Studio:** `npx prisma studio` — insert `Tenant` and `User` rows manually. Password must be bcrypt hash (`authService.hashPassword` in a one-liner script or Node REPL).
- **Integration helpers:** Import `createTenant` / `createUser` from `integration/helpers/seed.ts` in a small script (test-only helpers, but convenient for local data).
- **Integration tests:** `npm run test:integration` seeds and verifies behavior without manual curl.

### 5. Start the service

```bash
npm run dev
curl http://localhost:3001/health
```

### 6. Exercise flows manually

**Login** (after seeding a user):

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"you@example.com","password":"your-password"}'
```

**Enroll agent** (admin JWT):

```bash
curl -X POST http://localhost:3001/api/agents/enroll \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"displayName":"lab-1","hostname":"host-1","os":"linux","agentVersion":"0.0.1"}'
```

Save the one-time `enrollmentToken` from the response.

**Ingest telemetry** (agent token — triggers v1 correlation):

```bash
curl -X POST http://localhost:3001/telemetry/events \
  -H "Authorization: Bearer <enrollmentToken>" \
  -H "Content-Type: application/json" \
  -d '[{"eventType":"malware.detected","severity":"high","occurredAt":"2026-01-01T12:00:00.000Z","payload":{"fileHash":"abc123"}}]'
```

With `fileHash` present, `Alert.indicator` is set. Without it, indicator is null.

**Tenant overview** (analyst JWT):

```bash
curl http://localhost:3001/api/tenant/overview \
  -H "Authorization: Bearer <accessToken>"
```

**v2 outbreak detection** — no HTTP endpoint. From Node:

```typescript
import { runOutbreakDetection } from './src/services/outbreakDetectionService';
await runOutbreakDetection('<tenantId>');
```

Or run `npm run test:integration` which seeds alerts with indicators and asserts one incident after double invocation.

**Isolation** (admin JWT):

```bash
curl -X POST http://localhost:3001/api/agents/<agentId>/isolate \
  -H "Authorization: Bearer <accessToken>" \
  -H "Content-Type: application/json" \
  -d '{"reason":"investigation"}'
```

Sets `isolatedAt` in Postgres only.

---

## 9. Engineering judgment

Concrete decisions visible in the codebase — stated without adjectives.

**Foundations before correlation v2.** Cross-agent outbreak detection needs a queryable indicator on alerts and idempotent incident storage. The indicator field and integration harness landed before the outbreak engine, so v2 tests hit real Postgres upserts instead of mocking away the hard parts.

**Pure engines, impure runners.** v1 and v2 correlation logic live in pure functions (`evaluateRules`, `detectOutbreaks`) with no Prisma imports. Ingest and `runOutbreakDetection` own I/O. That split makes unit tests deterministic and integration tests small.

**Content-derived incident ids.** Outbreak ids hash `(tenantId, indicator, windowBucketStart)` rather than random UUIDs so repeated detection upserts instead of duplicating. The integration test runs the runner twice and counts rows — that test exists because random ids would hide idempotency bugs.

**Honest telemetry dependencies.** v2 outbreak ignores null indicators rather than inferring IOCs from `eventType` or alert titles. The doc and code agree: without `payload.fileHash`, outbreak detection has nothing to group. Five future patterns are listed with **named missing fields**, not implied capabilities.

**Tenant isolation as default.** `/api` mounts `tenantScoped` on the router, not per-handler opt-in. Cross-tenant IDs return 404. Agent tokens are a separate auth path from user JWTs.

**Security-sensitive changes ask first.** Project rules require confirmation before destructive migrations, major deletes, or large contract breaks. Integration tests truncate between cases rather than sharing dirty state.

**Tests as the safety net.** 244 unit tests catch regressions in auth, RBAC, v1 correlation, and triage rules. Eleven integration tests cover what mocks cannot: SQL aggregation correctness, indicator persistence, outbreak upsert idempotency. Neither replaces manual review of auth and tenancy code paths.

---

## Related documentation

| Document | Contents |
|---|---|
| `docs/auth.md` | JWT shapes, roles, endpoints |
| `docs/tenancy.md` | Isolation patterns, status codes |
| `docs/agents.md` | Enrollment, tokens, isolation |
| `docs/telemetry.md` | Event schema, ingest format |
| `docs/alerts.md` | Alert lifecycle, v1 rules, indicator |
| `docs/correlation-v2.md` | Outbreak pattern, deferred scheduling, future patterns |
| `CLAUDE.md` (repo root) | Project memory, dev commands, slice status |

---

## Corrections applied while writing

| Assumption | Actual code |
|---|---|
| Outbreak runner exposed via API | **No HTTP route** — `runOutbreakDetection` is service-only |
| Dev Postgres compose file | Only `docker-compose.test.yml` exists |
| Tenant/user creation via API | **No signup routes** — DB seed required |
| Six fully planned patterns in code | **One implemented**, five documented as prerequisites only |
| “Decentralized” architecture | **Centralized** gateway + Postgres; mesh is vision only |
