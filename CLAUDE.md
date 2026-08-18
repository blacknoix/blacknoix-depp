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
- docs/architecture/adr/ — ADR-0001–0005, 0010–0011 accepted; ADR-0013 Proposed (staging deployment baseline); enterprise-readiness control matrix under `docs/architecture/`
- backend/api-gateway/ — running Express service, see below (includes production container **source** packaging: Dockerfile / `.dockerignore` / `npm run smoke:dist`; not Docker/staging/IdP proof by itself)
- frontend/ — operator app shell + findings + agents inventory (Vite + React + TypeScript)
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
- Cache/queue: Redis

Frontend (confirmed in `frontend/`):
- React 19 + TypeScript + Vite
- React Router (authenticated operator shell; default home Work at `/work`; Findings at `/findings`; Agents at `/agents`)
- Vitest + Testing Library
- Local `/v1` proxy to api-gateway (CORS on gateway deferred)

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
- Product docs: ADRs 0001–0005, 0010–0011 accepted; ADR-0013 Proposed (staging deployment baseline + packaging boundaries); enterprise-readiness control matrix at `docs/architecture/enterprise-readiness-control-matrix.md` (Draft / evidence-baseline; no Complete without linked evidence); staging enforce+alert evidence runbook at `docs/runbooks/staging-enforce-alert-evidence.md`; Work/Findings/Attention runbook at `docs/runbooks/work-findings-attention.md` (operational invariants — not a full product spec)
- Backend implementation: api-gateway — middleware baseline; `/v1/tenants/me`; tenant-scoped telemetry ingest + query/summary; minimal post-ingest correlation findings; agent enrollment + hashed credentials + agent JWT exchange for authenticated ingest; Findings triage + Attention + Work views/default; production container **source** packaging under ADR-0013 (Dockerfile, `.dockerignore`, `smoke:dist`)
- Frontend implementation: operator app shell (default `/work`) + findings (`/findings`) + agents (`/agents`) with URL cross-links (`agentId` / `findingId`)
- Infra setup: not started
- Auth / RBAC: authentication seam (ADR-0002) with `dev-header` + `jwt`; human OIDC/refresh and agent credential exchange implemented; allow-listed roles + staged `AUTH_EXPLICIT_ROLES_MODE` (ADR-0010/0011)
- Database: schema + RLS (tenants, agents, agent_credentials, users, sessions, refresh_tokens, telemetry_events, correlation_findings, finding_suppressions, finding_revisit_reminders, finding_attention_dismissals, finding_shared_views, work_shared_views, work_tenant_defaults) via Kysely + migrator, plus platform-global `oidc_initiations`. NOTE: some auth narrative elsewhere may still need a docs-sync pass.
- Enterprise hardening: packaging baseline started (ADR-0013); Docker verification, scan/SBOM, staging deploy, Kubernetes, and IdP proof remain separate / not claimed here

## backend/api-gateway
Implemented:
- Middleware: request ID, structured JSON request logging, tenant context, 404 handler, centralized error handler
- Routes: `GET /`, `GET /health` (liveness), `GET /ready` (readiness: 200 when
  the database probe is `up`; 503 on `down` / `not_configured`; no debounce),
  `GET /v1/tenants/me`, `GET /v1/agents` (operator inventory), `POST /v1/agents` (enroll), `POST /v1/agents/:id/credentials/revoke`, `POST /v1/auth/agent/token`, `POST /v1/telemetry/events`, `POST /v1/telemetry/events/batch`, `GET /v1/telemetry/events`, `GET /v1/findings`, `GET /v1/findings/dashboard`, `GET /v1/findings/attention`, `POST /v1/findings/attention/dismiss`, `POST /v1/findings/evaluate-silence`, `PATCH /v1/findings/:id`, `GET|POST /v1/findings/suppressions`, `DELETE /v1/findings/suppressions/:id`, `GET|POST|DELETE /v1/findings/views`, `GET|POST|DELETE /v1/work/views`, `PUT|DELETE /v1/work/default`
- Error envelope: `{ ok: false, error: { code, message }, requestId }`
- Success envelope on /v1: `{ ok: true, data, requestId }`
- Tests: `node:test` integration suite against `createApp()` (`npm test`)
- Persistence: Kysely + pg pool; `withTenantTransaction` is the only sanctioned
  path to tenant-owned data; schema/RLS in `src/db/migrations`. See ADR-0004.
- Telemetry v1: auth/liveness events; append-only `telemetry_events`; tenant +
  agent identity from verified principal (agent JWT / dev `x-agent-id`), not body.
  Batch ingest: `POST /v1/telemetry/events/batch` (all-or-nothing, max events
  via `TELEMETRY_BATCH_MAX_EVENTS`, default 50).
  Query: `GET /v1/telemetry/events` returns a recent page + tiny operator summary
  (lastSeenAt, lastHeartbeatAt, countsByEventType). Tenant from principal only;
  agents are self-scoped; human operators must pass `agentId`. Filters: eventType,
  since/until (occurred_at, max 30d window), limit 1–100, offset 0–10000.
  Unknown agents return an empty non-oracular page. Dashboards / export / indexing deferred.
- Correlation v1 (minimal): after successful ingest, two deterministic count rules
  run synchronously in a separate tenant transaction — `agent.lifecycle_churn`
  (≥6 start/stop in 10m) and `agent.heartbeat_burst` (≥30 heartbeats in 60s).
  Silence: `agent.heartbeat_silence` (≥5m since last heartbeat; never-heartbeated
  agents do not fire) evaluated only via operator `POST /v1/findings/evaluate-silence`
  (not on ingest; agent principals rejected). Findings persist in
  `correlation_findings` (RLS, dedup by rule+window_bucket). Correlation failures
  never fail ingest. `GET /v1/findings` lists findings (optional status filter).
  Triage: `PATCH /v1/findings/:id` with explicit transitions
  open↔acknowledged→resolved / reopen to open; same-status idempotent; last-change
  audit (`status_changed_at`, nullable `status_changed_by_user_id`); agent
  principals rejected. Snooze: time-bounded `finding_suppressions` per
  tenant+rule (max 30d); while active, evaluation skips creating new findings
  for that rule (existing findings unchanged). Operator
  `POST/GET/DELETE /v1/findings/suppressions`; one uncleared snooze per rule.
  Operator dashboard: `GET /v1/findings/dashboard` — fixed 24h windows; counts by
  status and ruleId (zero-filled); recentCreated/recentChanged; active
  suppression count; no query params; agents rejected. Frontend console consumes
  these surfaces (see `frontend/`). Finding detail includes a static rule catalog
  explanation, compact evidence summary (no sample ids/payloads), active rule
  snooze context, agent cross-link, triage ergonomics (prev/next, post-mutation
  advance when a status change removes the finding from the current filter, URL
  `findingId` kept coherent), plus minimal investigation intent: self-claim
  ownership (`claimOwner` / clear / reassign), one current plain-text operator
  note, and explicit `remindAt` on `PATCH /v1/findings/:id`. Soft UUID audit
  fields; operator-only; threads / case entities deferred.
  **Work / Findings / Attention operational invariants** (landing precedence,
  shared vs local Work views, tenant default, `ownerScope`, Attention soft vs
  escalation bands, dismiss-until-change, bulk action bounds, auth fail-closed
  rules): see `docs/runbooks/work-findings-attention.md` — keep that runbook
  current when this stack changes. Frontend Work home is `/work` (shell
  default). Findings local/shared views + Jump bar + Attention popover remain
  as composed in the frontend. Charts, export, scheduled digests, full case
  management, comments/threads, queue balancing, SLA engines, push
  notifications, rule DSL, malware, and remediation deferred.
- Agent identity (ADR-0003 §5 minimal): register agent → hashed credential once;
  exchange for short-lived agent access JWT (`tid`+`aid`); revoke blocks exchange.
  Operator inventory: `GET /v1/agents` returns name/id/createdAt, last heartbeat,
  open findings count, and heartbeat freshness (`recent`/`stale`/`unknown` using
  the silence threshold — not online/offline). Agent principals rejected.
  Frontend Agents page at `/agents` consumes this inventory, related findings,
  and a shared 24h **recent context** timeline (finding created / latest status
  change markers + telemetry via existing `GET /v1/telemetry/events`; eventType +
  occurredAt only; no payload dump; not online/offline; not an event browser).
  Findings detail uses the same panel for the selected finding + that agent's
  telemetry. Client-side merge, newest-first, capped; no backend timeline API.
  Agents URL state: shareable `freshness` / `hasOpenFindings` filters plus
  `agentId` selection (client-side on inventory; invalid values fail closed).
  Selected-agent detail prioritizes investigation CTAs into Findings and keeps
  honest freshness language. Jump bar includes narrow Agents filter commands
  plus deterministic entity lookup (agent name/id prefix, finding UUID) via
  inventory already loaded in the shell — not a search index. Full-text/fuzzy
  search deferred. Global event search, unbounded history, comments, assignment,
  case management, live updates, remote actions, enrollment UX, bulk/tagging,
  and device management deferred.
  Cross-links: `/agents?agentId=` focuses an agent (optional `freshness` /
  `hasOpenFindings` list filters); `/findings` carries
  shareable `status` / `ruleId` / `agentId` filters plus optional `findingId`
  selection. Invalid UUIDs/enums fail closed. Shell “Jump to…” bar (Ctrl/⌘K)
  offers nav + built-in findings filters + Agents freshness/open-findings
  filters + local/shared views + entity lookup; actions navigate
  via URL paths only (no search API). Shell Attention popover surfaces the
  pull-based findings digest.

Not implemented: RBAC, agent runtime, mTLS, enrollment UX, credential rotation UX,
access-token denylist, policy/remediation, mesh, in-process timers / job framework,
agent-side spool, alert console / case management / finding comments.

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

Two modes are implemented (`src/auth/auth-mode.ts`):

- `dev-header` — trusts the client-supplied `x-tenant-id` header without
  verification. A development stand-in, and the default when `AUTH_MODE` is
  unset. Listed in `UNVERIFIED_MODES` and therefore **rejected at startup when
  `NODE_ENV=production`**.
- `jwt` — the principal comes only from a DEPP-signed HS256 access token, never
  from request headers. It verifies a signature, so it is not an unverified mode
  and is permitted in production.

Startup requirements for `AUTH_MODE=jwt`, all fail-closed:

- `JWT_ACCESS_SECRET` (≥32 characters), `JWT_ISSUER`, `JWT_AUDIENCE` — missing
  configuration throws rather than yielding a strategy that cannot verify.
- `AUTH_EXPLICIT_ROLES_MODE` must be set explicitly to `compat` or `enforce`.
  Unset is rejected under `jwt` (verified authentication must opt in); an
  invalid value is rejected in any mode. See ADR-0011.

An unrecognised `AUTH_MODE` also stops startup rather than falling back.

**Presented-but-invalid credentials are authentication failures, not anonymous
requests.** A bearer token that fails verification — tampered signature,
`alg: none` or any non-HS256 header, malformed structure, wrong issuer or
audience, expired, missing claims — makes the strategy throw
`InvalidCredentialError`. `middleware/authenticate.ts` records it as
`req.authFailed` (it still never rejects, so `/` and `/health` stay reachable),
and `requireTenant` / `requirePrincipal` answer `401 INVALID_TOKEN` with
`WWW-Authenticate: Bearer error="invalid_token"` before any tenant lookup or
RBAC check runs. This is distinct from a request carrying no credential at all,
which still yields `400 TENANT_REQUIRED`. Rejection messages are fixed and
claim-free so they cannot become an oracle for token forgery. The verifier
hardcodes HS256 and never reads an attacker-supplied `alg`.

ADR-0003 decides the full production mechanism. Implemented so far: DEPP-issued
short-lived access tokens with server-side refresh, and the separate
machine-identity path for agents. **Not yet implemented**: per-tenant OIDC
federation end to end, and roles sourced from IdP claims — `AuthService`-minted
human tokens still carry the transitional `operator` role
(`TRANSITIONAL_HUMAN_OPERATOR_ROLES`), with DEPP-persisted mappings intended
only as a per-tenant compatibility layer.

Local JWT/enforce verification uses a controlled test issuer. It is not
staging evidence and not external-IdP evidence; issuer, audience, JWKS/key
rotation, and claim-mapping behaviour against a real IdP remain unverified.

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
- Never commit unresolved merge-conflict markers; CI and `.githooks/pre-commit`
  run `scripts/check-merge-markers.cjs` (see `docs/contributing.md`).

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
- Dist smoke (local process only): `npm run smoke:dist` — builds, then boots
  `dist/index.js` and asserts liveness plus three fail-closed startup cases
  (short JWT secret, missing `AUTH_EXPLICIT_ROLES_MODE` under jwt, `dev-header`
  in production). No Docker, no database, no network; not Docker/staging proof
- Start built: `npm start`
- Lint: not configured yet
- Test: `npm test` (`node:test` + tsx; see `tests/`)
- Typecheck tests: `npm run typecheck:test`
- Merge-marker scan (repo root): `node scripts/check-merge-markers.cjs`
- Fresh migrate verify (repo root): `node scripts/verify-fresh-migrate.cjs`
- Enable local marker hook once: `git config core.hooksPath .githooks`

No commands exist for infra/ yet.

### Container image (api-gateway)

`backend/api-gateway/Dockerfile` is a two-stage build: the build stage installs
all dependencies, runs `tsc`, then `npm prune --omit=dev`; the runtime stage
copies the pruned `node_modules` plus `dist/` and the manifest, and runs as the
base image's unprivileged `node` user. The build context is the package
directory, not the repository root.

Build:

```
docker build -t depp-api-gateway:local -f backend/api-gateway/Dockerfile backend/api-gateway
```

Run (placeholders — supply real values from your own environment):

```
docker run --rm -p 3000:3000 \
  -e PORT=3000 \
  -e AUTH_MODE=jwt \
  -e AUTH_EXPLICIT_ROLES_MODE=enforce \
  -e JWT_ACCESS_SECRET='<at least 32 characters>' \
  -e JWT_ISSUER='<issuer>' \
  -e JWT_AUDIENCE='<audience>' \
  -e DATABASE_URL='postgres://<app-role>:<password>@<host>:5432/<db>' \
  depp-api-gateway:local
```

Facts that constrain what a running container means:

- **The image sets `NODE_ENV=production`.** `AUTH_MODE=dev-header` is therefore
  refused at startup (ADR-0002), so a container must be given a verified mode.
  Overriding `NODE_ENV` to re-enable the development stand-in defeats the guard.
- **The database must already be reachable, and migrations must already have
  run.** The image cannot run them: `migrate:latest` executes through `tsx`, a
  devDependency, which the pruned runtime tree does not contain. Migrations are
  a separate step run as `depp_migrator` via `DATABASE_MIGRATION_URL`
  (ADR-0013). The container receives the application-role `DATABASE_URL` only.
- **The pool connects lazily**, so the gateway starts even when the database is
  unreachable. A started container is not evidence of a working database.
- **`GET /health` is liveness; `GET /ready` is readiness.** `/health` returns 200
  while the process serves, including when the database is down
  (`src/routes/health.ts`). `/ready` (`src/routes/ready.ts`) reads the same probe
  and answers 200 only when the database reports `up`, 503 on `down` or
  `not_configured`. It carries no debounce: a single failed probe is unready
  immediately, and transient-fault tolerance belongs in the deployment's probe
  `failureThreshold`/period, not in application code. The image still declares
  no `HEALTHCHECK`, because a Docker healthcheck governs container restart —
  a liveness concern — and pointing it at `/ready` would restart instances over
  a database fault.
- **Secrets are injected as environment variables** by whatever runs the
  container. No `.env` is present in the image (`.dockerignore`), and none may
  be committed.
- **A successful container start is not staging acceptance evidence.** ADR-0013
  defines a 13-item bundle for that; building and booting an image satisfies
  none of it.

Run from `frontend/`:
- Install dependencies: `npm install`
- Start dev (proxies `/v1` → api-gateway `:3000`): `npm run dev`
- Typecheck: `npm run typecheck`
- Build: `npm run build`
- Test: `npm test` (Vitest + Testing Library)

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
