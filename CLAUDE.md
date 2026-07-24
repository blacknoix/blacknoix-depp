# DEPP — Decentralized Endpoint Protection Platform

## Project overview
DEPP is an enterprise cybersecurity platform focused on decentralized endpoint protection, telemetry ingestion, detection, correlation, alerting, auditability, and enterprise readiness.

## Primary goal
Build an enterprise-ready multi-tenant endpoint protection platform that can be sold to organizations.

## Founder context
This project is being built by a solo founder using Claude Pro / Claude Code and Cursor Pro+ as the main AI development system.

## Working model
- Claude Code is the planner, reviewer, architect, and gap finder.
- Cursor is the implementation engine for multi-file code changes, test/fix loops, and refactors.
- Prefer small, production-oriented slices over broad unfinished scaffolding.

## Current repo status
Early. One backend service exists; everything else is still scaffolding.

What actually exists:
- CLAUDE.md
- docs/architecture/adr/ — ADR-0001 (tenancy and data model), Accepted
- backend/api-gateway/ — running Express service, see below
- frontend/ — empty
- infra/ — empty

Anything not listed above does not exist yet.

## Stack
Confirmed and in use (backend/api-gateway):
- Runtime: Node.js
- API framework: Express 5
- Language: TypeScript (strict, CommonJS, rootDir src/)
- Dev runner: tsx
- Config: dotenv
- Database: PostgreSQL via Kysely (query builder) + pg; Kysely migrator
- Local infra: Docker Compose (infra/docker-compose.yml)
- Package manager: npm

Data-access and migration choices are recorded in ADR-0004.

Still assumptions, not yet implemented:
- Frontend: React + TypeScript
- Cache/queue: Redis

If the actual stack changes, update this file immediately.

## Product direction
The platform should prioritize:
1. Auth and RBAC
2. Tenant isolation
3. Agent registration and identity
4. Telemetry ingestion
5. Alerting and triage
6. Policy engine
7. Observability
8. Enterprise readiness and documentation

Treat this as the current priority order unless explicitly changed.

## Current status
- Repository setup: done (git, hygiene files, ADR log)
- Product docs: ADR-0001 accepted; no product/spec docs yet
- Backend implementation: api-gateway — middleware baseline; `/v1/tenants/me`; tenant-scoped telemetry ingest; agent enrollment + hashed credentials + agent JWT exchange for authenticated ingest
- Frontend implementation: not started
- Infra setup: not started
- Auth / RBAC: authentication seam (ADR-0002) with `dev-header` + `jwt`; human OIDC/refresh and agent credential exchange implemented; no RBAC
- Database: schema + RLS (tenants, agents, agent_credentials, users, sessions, refresh_tokens, telemetry_events) via Kysely + migrator, plus platform-global `oidc_initiations`. NOTE: some auth narrative elsewhere may still need a docs-sync pass.
- Enterprise hardening: not started

## backend/api-gateway
Implemented:
- Middleware: request ID, structured JSON request logging, tenant context, 404 handler, centralized error handler
- Routes: `GET /`, `GET /health`, `GET /v1/tenants/me`, `POST /v1/agents` (enroll), `POST /v1/agents/:id/credentials/revoke`, `POST /v1/auth/agent/token`, `POST /v1/telemetry/events`, `POST /v1/telemetry/events/batch`
- Error envelope: `{ ok: false, error: { code, message }, requestId }`
- Success envelope on /v1: `{ ok: true, data, requestId }`
- Tests: `node:test` integration suite against `createApp()` (`npm test`)
- Persistence: Kysely + pg pool; `withTenantTransaction` is the only sanctioned
  path to tenant-owned data; schema/RLS in `src/db/migrations`. See ADR-0004.
- Telemetry v1: auth/liveness events; append-only `telemetry_events`; tenant +
  agent identity from verified principal (agent JWT / dev `x-agent-id`), not body.
  Batch ingest: `POST /v1/telemetry/events/batch` (all-or-nothing, max events
  via `TELEMETRY_BATCH_MAX_EVENTS`, default 50).
- Agent identity (ADR-0003 §5 minimal): register agent → hashed credential once;
  exchange for short-lived agent access JWT (`tid`+`aid`); revoke blocks exchange.

Not implemented: RBAC, agent runtime, mTLS, enrollment UX, credential rotation UX,
access-token denylist, policy/remediation, mesh, correlation, agent-side spool.

## Persistence and RLS
Authoritative decision: docs/architecture/adr/0004-persistence-and-data-access.md.

Postgres RLS enforces tenant isolation, keyed on `app.current_tenant`. Every
access to tenant-owned data must go through `withTenantTransaction`, which sets
that value transaction-locally via `set_config(..., true)`. Never set it at
session level (it leaks across pooled connections), and never query tenant-owned
data outside the helper.

Two DB roles: `depp_migrator` owns tables and runs migrations
(`DATABASE_MIGRATION_URL`); `depp_app` is the non-owner, NOBYPASSRLS application
role (`DATABASE_URL`). Tenant-owned tables use ENABLE + FORCE ROW LEVEL SECURITY
with a policy carrying both USING and WITH CHECK, and the fail-closed
one-argument `current_setting`.

The database-backed test suite (`*.dbtest.ts`, `npm run test:db`) requires a real
Postgres and fails loudly if it is unavailable — it never skips.

`/v1/tenants/me` performs a real lookup through the sanctioned path (Kysely
repository → `withTenantTransaction`). The `tenants` registry has RLS (ENABLE,
not FORCE) with a self-read policy, so the app role sees only its own row; the
migrator role still manages the whole registry. Tenant ids are UUIDs now:
readable values like `tenant-dev-001` no longer resolve, and dev seed data must
use real UUIDs. An unknown tenant returns the same `400 TENANT_REQUIRED` envelope
as a missing one (no existence oracle); the distinction is logged server-side.
Tenant existence is enforced at the data-access layer, not in the auth strategy,
which stays synchronous until a verified mode lands.

## Authentication
Authoritative decision: docs/architecture/adr/0002-authentication-seam.md.

Requests are resolved into an `AuthenticatedPrincipal` by a pluggable
`AuthStrategy` selected via `AUTH_MODE`. Route handlers read `req.principal` and
never parse credentials themselves.

The only implemented mode is `dev-header`, which trusts the client-supplied
`x-tenant-id` header without verification. It is a development stand-in.

**The service cannot start with `NODE_ENV=production`.** Unverified modes are
rejected at startup, and `dev-header` is currently the only mode, so there is no
configuration in which api-gateway runs in production. This is intentional and
fail-closed; it lifts when a verified mode exists.

An unrecognised `AUTH_MODE` also stops startup rather than falling back.

The production authentication mechanism is decided in ADR-0003 but **not yet
implemented**: per-tenant OIDC federation, no stored human credentials,
DEPP-issued short-lived access tokens with server-side refresh, and a separate
machine-identity path for agents. Roles come from IdP claims, with DEPP-persisted
mappings only as a per-tenant compatibility layer.

## Tenancy model
Authoritative decision: docs/architecture/adr/0001-tenancy-and-data-model.md.

Summary: shared-schema PostgreSQL with `tenant_id` on every tenant-owned table,
isolation enforced primarily by Postgres RLS via `app.current_tenant`, with
explicit application-layer tenant scoping as a second layer.
No query for tenant-owned data should run without tenant scope.
No cross-tenant access is allowed unless explicitly designed and documented for platform-admin behavior.

ADR-0001 specifies tenant IDs as UUIDs. api-gateway currently accepts bounded
opaque strings so local development can use readable values; tighten to UUID
when Postgres lands.

## Engineering principles
- Security and tenant isolation come before speed.
- No shortcuts that weaken enterprise readiness.
- Prefer explicit types, validation, logging, and tests.
- Keep changes scoped and reviewable.
- Update docs when architecture or behavior changes.
- Avoid hardcoded secrets.
- Prefer maintainable code over clever code.

## Hard rules
- Never commit secrets or .env files.
- Never access tenant-owned data without explicit tenant scope.
- Never add auth-sensitive routes without authorization checks.
- Never log raw secrets, tokens, or sensitive telemetry.
- Never describe something as implemented unless it exists in the repo.

## Standard commands
Run from `backend/api-gateway/`:
- Install dependencies: `npm install`
- Start dev: `npm run dev` (tsx, no build step)
- Typecheck: `npm run typecheck`
- Build: `npm run build` (emits to dist/)
- Start built: `npm start`
- Lint: not configured yet
- Test: `npm test` (`node:test` + tsx; see `tests/`)
- Typecheck tests: `npm run typecheck:test`

No commands exist for frontend/ or infra/ yet.
If a service is added, update these commands immediately.

## How Claude should work in this repo
When asked to plan work:
1. Read this file first.
2. Read relevant files in docs/ and affected code areas.
3. Propose the smallest useful implementation slice.
4. Output:
   - objective
   - files likely affected
   - acceptance criteria
   - security / tenancy risks
   - tests required
   - docs to update
5. Do not start coding until asked.

When asked to review work:
- Prioritize security, tenant isolation, auth, data boundaries, error handling, and enterprise readiness.
- Be concrete and list the highest-risk issues first.

When asked to implement:
- Keep scope tight.
- Preserve existing patterns.
- Run relevant checks if available.
- Summarize what changed, what remains, and any risks.

## Notes
This file should stay concise and current. Add important project-specific decisions here as the repo evolves.
