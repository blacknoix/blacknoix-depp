# ADR-0004: Persistence and Data Access

- Status: Accepted
- Date: 2026-07-21
- Depends on: ADR-0001 (tenancy and data model), ADR-0003 (identity entities)

## Context
ADR-0001 commits DEPP to shared-schema multi-tenant PostgreSQL with isolation
enforced primarily by Row-Level Security, application-layer scoping as a second
layer, and an explicit instruction that the project "will not rely on ORM/global
filters alone as the only isolation mechanism." ADR-0003 added identity entities
that need somewhere to live.

No persistence exists yet. `infra/` is empty, there is no Docker configuration,
and api-gateway's only runtime dependencies are `express` and `dotenv`.

Both choices here are expensive to reverse: a migration history accumulates, and
a data-access idiom propagates into every service written afterwards. They are
therefore decided before any code is written.

## Decision

### 1. Data access: Kysely
Kysely is a typed query builder, not an ORM. It has no global filters and no
implicit scoping. Given ADR-0001 forbids relying on ORM filters for isolation,
the safest tool is one that offers none — there is nothing to be lulled by.

Its transaction API is explicit: `db.transaction().execute(async (trx) => ...)`.
Outside a transaction Kysely takes a new pooled connection per query, so ad-hoc
`SET` statements structurally cannot work. The tool therefore forces the
transaction-scoped pattern that RLS requires, rather than merely permitting it.

Raw SQL is first-class through the `sql` template tag and can be embedded
anywhere, which matters because the security-critical parts of this system are
raw SQL. Types are full TypeScript with no separate schema engine or runtime.

### 2. Migrations: Kysely's built-in migrator, security DDL as raw SQL
RLS policies, `FORCE ROW LEVEL SECURITY`, roles, and `GRANT`s must be
hand-written SQL under every candidate considered: `drizzle-kit` does not
generate policies, and Prisma has no representation for database-native objects
at all. Migration auto-generation therefore buys very little for exactly the
objects that matter most here.

Kysely's migrator provides a migration lock table and runs DDL inside a
transaction where the dialect supports it. Choosing it keeps the toolchain to one
library rather than two.

**Revisit deliberately.** Atlas offers declarative management and drift detection
for roles, grants, and policies — proving that access control has not drifted is
a compliance question DEPP will eventually be asked. Atlas is deferred, not
rejected, and adopting it later does not require changing the data-access layer.

### 3. Rejected: Prisma
Prisma is the default reach for a TypeScript backend, so the rejection is
recorded explicitly. Per its own documentation and tracking issues:

- Database-native objects, including policies, have no representation in Prisma
  models.
- The documented RLS client extension wraps each query in its own batch
  transaction, with the consequence that explicit `$transaction()` "may not work
  as intended."
- That extension does not apply to raw queries — precisely the escape hatch a
  security product needs most.

Prisma optimises for a model where the ORM owns the schema. ADR-0001 requires the
database to own isolation. Adopting Prisma would mean fighting the tool on the
one property the product cannot compromise, and inheriting a migration history
that is costly to unwind.

Drizzle was a credible runner-up, with genuine `pgPolicy` and `pgRole`
primitives. It was not chosen because `drizzle-kit` still does not generate
policies, and the bulk of its documented RLS material targets Neon and Supabase
JWT-claim models rather than the `app.current_tenant` setting ADR-0001 specifies
— which would place DEPP off the supported path for its most security-sensitive
code.

### 4. Required transaction model for tenant-scoped requests
Mandatory for every query that touches tenant-owned data:

- The query runs inside a transaction opened by the application.
- The transaction's first statement sets tenant context **transaction-locally**:
  `select set_config('app.current_tenant', $1, true)`. The third argument `true`
  scopes the setting to the transaction. `SET LOCAL` is equivalent.
- Session-level `SET` is forbidden.
- The tenant id comes from `req.principal.tenantId` (ADR-0002). The data layer
  never reads a header or query parameter.
- A single helper — `withTenantTransaction(principal, fn)` or equivalent — is the
  only sanctioned entry point for tenant-owned data. Reaching for the pool
  directly to query tenant data is a review-blocking defect.
- The setting key stays configurable via `TENANT_CONTEXT_KEY`, already present in
  `.env.example`, defaulting to `app.current_tenant` per ADR-0001.

Rationale: with a connection pool — or PgBouncer in transaction mode — a
session-scoped setting persists on the backend connection and is inherited by
whichever request gets that connection next. The result is a cross-tenant read
with no visible bug in the application code.

### 5. RLS enforcement requirements
For every tenant-owned table, all of the following are required:

- `ENABLE ROW LEVEL SECURITY` **and** `FORCE ROW LEVEL SECURITY`. Without
  `FORCE`, the table owner bypasses every policy, which is the most common way
  teams ship RLS that silently enforces nothing.
- Policies constrain both `USING` and `WITH CHECK` to
  `tenant_id = current_setting('app.current_tenant')::uuid`. `WITH CHECK` is not
  optional: without it a caller can write rows attributed to another tenant even
  though it cannot read them.
- The application connects as a dedicated role that is `NOSUPERUSER`,
  `NOBYPASSRLS`, and **not** the owner of any tenant-owned table. Migrations run
  as a separate, more privileged role.
- Use the single-argument `current_setting('app.current_tenant')`, which raises
  an error when the setting is absent, rather than the `missing_ok` form which
  returns NULL. Both fail closed, but an error is loud; a silent empty result set
  is easily misread as "this tenant has no data."
- A new tenant-owned table ships with its policies in the same migration. A table
  without RLS is a defect, not a follow-up.

### 6. Slice plan
Three slices, not one.

**Slice A — infra bootstrap.** `infra/docker-compose.yml` with PostgreSQL,
`DATABASE_URL` wired through `config/env.ts`, a connection pool module, and the
migration and application roles created. No application schema. Acceptance:
`docker compose up` yields a database the service connects to, and all 50
existing tests still pass untouched.

**Slice B — schema and RLS foundation.** Kysely migrator wired with npm scripts,
the `tenants` table (platform-global) plus one tenant-owned table, RLS enabled
and forced with `USING` and `WITH CHECK` policies, and the tenant-scoped
transaction helper. Acceptance is ADR-0001's required negative tests, run against
a real database: tenant A cannot read, update, insert as, or delete tenant B's
rows; a query issued with no tenant context fails rather than returning
everything; and the application role demonstrably cannot bypass RLS.

**Slice C — route wiring.** `GET /v1/tenants/me` becomes a real lookup instead of
echoing the header. Tenant ids tighten from bounded opaque strings to UUIDs per
ADR-0001. Acceptance: the route contract is preserved except for the UUID
tightening, which is a documented breaking change to local workflows.

Keeping B separate from C matters: B is where the isolation guarantee is
established, and freezing route behaviour while it lands means a failing
isolation test has exactly one possible cause.

### 7. Testing against a real database
The test suite currently needs nothing but Node. Slice B changes that.

- The suite splits: the existing pure tests keep running with no database; a new
  database-backed suite requires PostgreSQL.
- Isolation tests run against real PostgreSQL. Mocking the database would mock
  away the mechanism under test and prove nothing.
- Both CI and local development need a disposable database. Slice A decides
  whether that is `docker compose` or a per-run throwaway container.
- `npm test` either runs both suites or **fails loudly** when the database is
  absent. Silently skipping tenant-isolation tests is worse than failing: it
  produces a green build that asserts nothing about the product's core security
  property.

### 8. `dev-header` once tenants are persisted
`dev-header` continues to verify nothing about the caller, but the tenant it
names must exist. Resolution becomes a lookup against the `tenants` table.

- An unknown tenant returns the existing `400 TENANT_REQUIRED` envelope rather
  than a distinct error, so the endpoint does not become an oracle for which
  tenants exist. The distinction is recorded in the server log instead.
- `dev-header` must never create a tenant implicitly.
- It remains development-only and banned in production, unchanged from ADR-0002.
- Because tenant ids become UUIDs, readable local values such as
  `tenant-dev-001` stop working. Development seed data must provide real UUIDs.

## Consequences
- api-gateway takes on its first runtime dependencies beyond `express` and
  `dotenv`: `kysely` and `pg`.
- Docker becomes a requirement for development and CI, so `infra/` stops being
  empty.
- Every tenant-scoped request pays a transaction and one extra statement. This is
  accepted: correctness before micro-optimisation.
- The typed `Database` interface can drift from the migrations that define the
  real schema. Codegen or a schema-drift test is needed to catch it.
- The UUID tightening is a breaking change to existing local development
  workflows and to any manual `curl`/PowerShell snippets in circulation.
- Kysely and its migrator are TypeScript-specific. If a future DEPP service is
  written in another language it inherits the schema but not the tooling, which
  is a genuine reason the Atlas revisit may arrive sooner than expected.

## Deferred
- Atlas adoption for declarative security objects and drift detection.
- Read replicas and connection routing.
- Redis, which appears in `.env.example` but has no consumer.
- Partitioning or an analytics store for `telemetry_events`.
- Soft deletes and audit triggers.
- Indexing and query-performance strategy beyond primary and foreign keys.
- Backup, restore, and retention policy.

## Notes
Depends on ADR-0001 and ADR-0003; supersedes neither. The library evaluation
behind this decision was performed in July 2026 and should be re-checked if
implementation slips significantly, particularly `drizzle-kit`'s open RFC for
policy generation.
