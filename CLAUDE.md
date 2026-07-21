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
- Package manager: npm

Still assumptions, not yet implemented:
- Frontend: React + TypeScript
- Database: PostgreSQL (required by ADR-0001 for RLS)
- Cache/queue: Redis
- Infra: Docker

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
- Backend implementation: api-gateway only — middleware baseline and one tenant-scoped route
- Frontend implementation: not started
- Infra setup: not started
- Auth / RBAC: authentication seam only (ADR-0002); no verified mode, no RBAC
- Database: not started
- Enterprise hardening: not started

## backend/api-gateway
Implemented:
- Middleware: request ID, structured JSON request logging, tenant context, 404 handler, centralized error handler
- Routes: `GET /` (service identity), `GET /health`, `GET /v1/tenants/me` (tenant-scoped)
- Error envelope: `{ ok: false, error: { code, message }, requestId }`
- Success envelope on /v1: `{ ok: true, data, requestId }`
- Tests: `node:test` integration suite against `createApp()` (`npm test`)

Not implemented: verified authentication, RBAC, database, persistence, Docker.

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
