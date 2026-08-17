# Enterprise Readiness Control Matrix

## Status

- Draft / evidence-baseline
- Date: 2026-08-17
- Tip reconciled against: `9a3ecf086375110f6ca3d48ccb322d1b74f0fed5` (`feat/container-baseline-recreate`)
- Rule: no deliverable is **Done** / Complete for staging or production without a direct evidence link whose scope matches the claim.
- Owner for all matrix areas below unless an external dependency is named: **BLACKNOIX founder**

## Evidence Rules

- Evidence must link to a commit/PR, ADR, accepted test report, deployment proof, or accepted evidence bundle.
- Local verification must never be presented as staging or production verification.
- Evidence scopes must be explicit (for example: local controlled-issuer, local RLS/dbtest, staging IdP, production).
- Unproven items must use **Unverified**, **In progress**, **Blocked**, or **Not started**—not staging/production **Done**.
- Scope note (immutable, out of scope for this planning commit): `local-jwt-enforce-20260813-193009` is **local** controlled-issuer JWT/`enforce` evidence for commit `2ba2bc11dac03b7b8fc0ad346f71eb3c5b49aa6c` under the pre-ADR-0012 runner. It is not staging, production, IdP, or container evidence.
- ADR-0012 remains reserved/uncommitted for runner-integrity / five-path validation and must not be created or altered here.
- ADR-0013 is a **historical** staging-deployment-baseline decision record. It must not be rewritten; implementation status lives in this matrix and `CLAUDE.md`.
- Persistence on this tip is **Kysely + SQL migrations** (not Prisma). Alert spine tables are created in `backend/api-gateway/src/db/migrations/017_alerts_and_alert_audit.ts`.
- Local RLS/dbtest and local container verification must not be represented as staging or production proof.

## Repository facts reconciled (2026-08-17)

| Fact | Evidence on tip |
|---|---|
| Multi-tenant RLS + `withTenantTransaction` | ADR-0001/0004; `src/db/`; many `tests/db/*.dbtest.ts` |
| Explicit human roles `operator`/`auditor` + `AUTH_EXPLICIT_ROLES_MODE` | ADR-0010/0011; `src/auth/`; unit RBAC suites; local JWT/`enforce` bundle @ `2ba2bc1` |
| Telemetry ingest + tenant isolation | `src/telemetry/`; `tests/telemetry/`; `tests/db/telemetry.dbtest.ts` |
| Auth-failure burst → tenant alerts + append-only `alert_audit_events` | Commits `2570aac` / `35866cc`; migration `017_alerts_and_alert_audit.ts`; `tests/db/alerts-auth-failure.dbtest.ts`; `tests/alerts/route-rbac.test.ts` |
| App role cannot `UPDATE`/`DELETE` `alert_audit_events` | Granted `SELECT, INSERT` only in migration 017; asserted in `alerts-auth-failure.dbtest.ts` case 5 |
| Credential-lifecycle HTTP audit API (`/v1/audit/logs`) | **Absent** on this tip (`src/audit/` / `routes/audit.ts` not present) |
| `/health` liveness + `/ready` readiness | `e046202`; unit `tests/ready.test.ts`; live `SELECT 1` dbtest `bf88acc` (`tests/db/readiness.dbtest.ts`) |
| Local container baseline | Outside-repo artifact `container-verification-20260817-081502.json` bound to `bf88acc` (cited by `9a3ecf0`); proves build, `Config.User=node`, `/health` liveness under `not_configured`, SIGTERM — **not** staging, **not** live-DB-in-container |
| Local Postgres fixture | `infra/docker-compose.yml` + `infra/postgres/init/` (`depp_app` / `depp_migrator` local-dev roles) |
| Kubernetes / Helm / GitOps / image scan / SBOM | **Not present** in-repo (no charts, no scan workflow). CI (`.github/workflows/api-gateway.yml`) runs typecheck + `test:unit` only |
| Windows agent runtime / installer | **Not present** (docs mention future agent; no agent binary package in this repository) |
| Backup/restore recovery drill | **Not present** (ADR-0004 defers; Backup control remains Unverified) |

---

## 30 / 60 / 90-day enterprise-readiness status

States are exactly one of: **Done**, **In progress**, **Blocked**, **Not started**.
**Done** here means “done for the named local/implementation gate with linked evidence,” never “enterprise-complete” or “staging-complete,” unless a staging/production evidence link is present (none are, on this tip).

### Day-30 horizon (secure local vertical-slice foundation)

| Area | State | Linked evidence | Next measurable gate | Blocking dependency | Owner |
|---|---|---|---|---|---|
| Tenant isolation + RBAC | In progress | RLS + dbtests; ADR-0010/0011; RBAC unit suites; local JWT/`enforce` @ `2ba2bc1` (local only); **local vertical-slice** `tests/db/tenant-isolation-immutable-audit.dbtest.ts` (criteria 1–3 via HTTP+RLS; disposable Postgres only) | Keep Day-30 local gate green; next is criterion-7 recovery drill (separate), then staging IdP+enforce | Staging IdP + enforce evidence not started | BLACKNOIX founder |
| Audit logging | In progress | `alert_audit_events` append-only grants + `alerts-auth-failure.dbtest.ts` cases 4–5; alerts HTTP RBAC; **local vertical-slice** `tenant-isolation-immutable-audit.dbtest.ts` (c4 tenant-bound `alert_created`; c5 `depp_app` UPDATE/DELETE deny) | Schedule criterion-7 recovery drill; SIEM/export deferred | No general credential-lifecycle audit HTTP on this tip; SIEM/export deferred | BLACKNOIX founder |
| Telemetry ingestion | In progress | Telemetry routes/services; unit + `telemetry.dbtest.ts`; auth_failure → alert path; **local vertical-slice** `tenant-isolation-immutable-audit.dbtest.ts` (c6 agent `auth_failure` burst → Tenant-A-only `GET /v1/alerts`) | Keep agent-authenticated ingest as the only write path into the alert spine; staging ingest reachability next | Deployed control-plane ingest reachability (external) | BLACKNOIX founder |
| Kubernetes/GitOps | Not started | No Helm/GitOps manifests; `infra/` is local Compose only | Introduce GitOps/Helm skeletons only after packaging + vertical-slice local gates pass | Platform cluster, scan/provenance, secret injection (external) | BLACKNOIX founder (repo); Platform (cluster) |
| Windows agent | Not started | No Windows agent package in-repo; threat-event docs reference a future agent | Do not start agent features until tenant-isolation + immutable-audit vertical slice gates secure onboarding | Product/agent runtime scope deferred | BLACKNOIX founder |
| Readiness and packaging | In progress | `/ready` `e046202`; live Postgres readiness `bf88acc`; container artifact `container-verification-20260817-081502.json` @ `bf88acc` cited by `9a3ecf0`; `smoke:dist`; ADR-0013 (historical) | Treat local readiness+packaging as closed for **local** evidence only; next packaging gates are scan/provenance and deployment-level readiness probe config | Non-local DB roles, secret injection, registry/scan, K8s probe wiring | BLACKNOIX founder |

### Day-60 horizon (staging-shaped control-plane proof)

| Area | State | Linked evidence | Next measurable gate | Blocking dependency | Owner |
|---|---|---|---|---|---|
| Tenant isolation + RBAC | Not started | Staging enforce+alert runbook exists (`docs/runbooks/staging-enforce-alert-evidence.md`) but **no filled staging evidence pack** in-repo | Execute staging JWT+`enforce` principal×route matrix with real issuer roles | External IdP owner; staging deploy | BLACKNOIX founder + Identity (external) |
| Audit logging | Not started | Local alert-audit only | Staging observation that alert_audit remains append-only under app role and tenant-scoped | Staging DB + app-role provisioning | BLACKNOIX founder + DB/Platform (external) |
| Telemetry ingestion | Not started | Local only | Staging agent JWT ingest → tenant-visible alert | Reachable staging control plane | BLACKNOIX founder + Platform (external) |
| Kubernetes/GitOps | Blocked | No charts/workflows for deploy | First GitOps path that deploys api-gateway with injected secrets and documented probe wiring | Cluster, registry, scan/provenance | Platform (external); BLACKNOIX founder (manifests when unblocked) |
| Windows agent | Not started | — | Still deferred past onboarding vertical slice | Day-30 vertical slice + product decision | BLACKNOIX founder |
| Readiness and packaging | Blocked | Local container/dbtest only | Staging deployment uses `/ready` as readiness probe (not `/health`) with non-local secrets/roles | Secret injection; non-local roles; scanned image | Platform + BLACKNOIX founder |

### Day-90 horizon (enterprise sales gates)

| Area | State | Linked evidence | Next measurable gate | Blocking dependency | Owner |
|---|---|---|---|---|---|
| Tenant isolation + RBAC | Not started | — | Production-shaped IdP federation evidence lineage (separate from local JWT bundle) | IdP, production auth cutover (ADR-0003 residual) | BLACKNOIX founder + Identity |
| Audit logging | Not started | — | Retention/SIEM export and production audit integrity evidence | ADR-level retention work not on tip; SIEM sink | BLACKNOIX founder |
| Telemetry ingestion | Not started | — | Load/availability and deployed heartbeat cutover evidence | Platform image scan/provenance; Legal/privacy where required | Platform / Legal (external) |
| Kubernetes/GitOps | Blocked | — | Hardened deploy with provenance, network policy, and documented IR hooks | Platform hardening program | Platform (external) |
| Windows agent | Not started | — | Agent enrollment/identity against staging control plane | Agent product + staging CP | BLACKNOIX founder |
| Readiness and packaging | Blocked | — | Production readiness gating + restore drill of the vertical slice | Backup/restore program; production env | BLACKNOIX founder + Platform |

---

## Control Matrix (detailed)

| Control | Risk | Required outcome | Acceptance test | Implementation/code link | Evidence link | Environment proof | Owner | Blocker/dependency | Target date | Status |
|---|---|---|---|---|---|---|---|---|---|---|
| Tenant isolation | Cross-tenant data disclosure | Every tenant-owned read/write is scoped by `tenant_id` and enforced by Postgres RLS via `app.current_tenant` / `withTenantTransaction` | Tenant A cannot read or mutate tenant B rows; unknown/cross-tenant paths are non-oracular | [ADR-0001](adr/0001-tenancy-and-data-model.md); [ADR-0004](adr/0004-persistence-and-data-access.md); `backend/api-gateway/src/db/` | Local `tests/db/*.dbtest.ts` (incl. telemetry + alerts isolation). Local JWT/`enforce` cross-tenant negatives @ `2ba2bc1` (local only) | Local only. Staging/production: TBD | BLACKNOIX founder | Staging/production RLS proof not linked | TBD | In progress |
| Authentication and authorization | Unverified principals; privilege escalation; fail-open roles | Verified auth strategy; allow-listed human roles; JWT requires explicit `AUTH_EXPLICIT_ROLES_MODE`; agent vs human guards | Role-less human denied under `enforce`; agents cannot use human-only surfaces | [ADR-0002](adr/0002-authentication-seam.md); [ADR-0003](adr/0003-production-authentication.md); [ADR-0010](adr/0010-auditor-audit-read-rbac.md); [ADR-0011](adr/0011-explicit-roles-migration.md); `src/auth/` | Local JWT/`enforce` bundle @ `2ba2bc1`; unit RBAC suites (`tests/auth/*`, `tests/alerts/route-rbac.test.ts`) | Local only. Staging IdP: TBD | BLACKNOIX founder | IdP federation incomplete; ADR-0012 uncommitted | TBD | In progress |
| Audit logging and auditability | Undetectable abuse; mutable audit history | Durable security-relevant audit; append-only where required; least-privilege read | Alert create audited; app role cannot rewrite `alert_audit_events`; cross-tenant audit read empty | Migration `017_alerts_and_alert_audit.ts`; `src/alerts/`; [docs/alerts.md](../alerts.md); [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md) (procedure only) | `tests/db/alerts-auth-failure.dbtest.ts` (durable-before-success + append-only). **No** credential-lifecycle `/v1/audit/logs` on this tip | Local/dev only | BLACKNOIX founder | Denial-audit vertical gate incomplete; retention/SIEM deferred | TBD | In progress |
| Endpoint/agent telemetry ingestion | Unauthenticated or cross-tenant ingest | Agent-authenticated ingest; tenant+agent from principal | Agent ingest succeeds; human denied on agent-only ingest; cross-tenant query isolation | [docs/telemetry.md](../telemetry.md); `src/telemetry/`; `src/routes/telemetry.ts` | Unit + `tests/db/telemetry.dbtest.ts`; alerts path ties auth_failure ingest → tenant alert | Local only | BLACKNOIX founder | Deployed CP ingest / chart cutover external | TBD | In progress |
| Detection/correlation and tenant-scoped finding/alert visibility | Missed detection; cross-tenant leakage | Findings/alerts remain tenant-scoped | Cross-tenant list/detail empty/non-oracular | [ADR-0005](adr/0005-correlation-bridge-provenance-and-finality.md); alerts + findings routes | Local dbtests/route tests; alerts isolation case 2 | Local only | BLACKNOIX founder | Staging proof TBD | TBD | In progress |
| Secrets management and rotation | Long-lived leaked secrets | Hashed agent credentials; no secrets in logs/artifacts | Exchange/ingest reject unusable credentials; probe failure logs omit driver/connection secrets | [docs/agents.md](../agents.md); `src/agents/`; readiness logger hardening in `src/db/pool.ts` (`bf88acc`) | Local tests; container/dbtest non-leak assertions. No KMS/vault evidence | Local/dev | BLACKNOIX founder | Enterprise secret store deferred | TBD | In progress |
| Backup and restore | Unrecoverable tenant data loss | Documented, tested backup/restore with tenant + audit integrity | Restore drill restores isolation and append-only audit invariants | ADR-0004 defers backup/restore/retention | TBD — no restore runbook/drill in-repo | TBD | BLACKNOIX founder | No accepted restore drill | TBD | Unverified |
| Kubernetes/platform hardening | Cluster compromise; unscanned images | Hardened deploy path; provenance; gated cutover | Platform scan/provenance; chart cutover only after gates | Local Compose only; no Helm/GitOps/scan config in-repo; ADR-0013 packaging baseline (historical) | TBD | Blocked / external | Platform (external); BLACKNOIX founder (app manifests when unblocked) | Cluster, scan, provenance, Legal where required | TBD | Blocked |
| Observability, SLOs, and incident response | Undetected outages | Health/ready, logs, SLOs, IR | `/health` liveness; `/ready` reflects DB probe without hysteresis | `src/routes/health.ts`, `src/routes/ready.ts`, `createDatabaseHealthCheck` | Unit `tests/ready.test.ts`; live `tests/db/readiness.dbtest.ts` @ `bf88acc`. No SLO/IR bundle | Local only | BLACKNOIX founder | Deployed probe thresholds / SLO stack not started | TBD | Unverified |
| Evidence-bundle integrity and provenance | Misleading Complete claims | Bundles declare claim class/SHA/scope; safe runners | ADR-0012 accepted; five-path validation | Planned ADR-0012 **not present** | Local JWT bundle @ `2ba2bc1` (pre-ADR-0012). Container artifacts outside git, SHA-pinned in this matrix | Local only | BLACKNOIX founder | ADR-0012 uncommitted | TBD | In progress |
| External-IdP validation | Treating controlled-issuer as customer IdP proof | Per-tenant OIDC federation; roles from IdP | Staging IdP login → DEPP JWT → enforce routes | [ADR-0003](adr/0003-production-authentication.md) | TBD (must not reuse local JWT bundle) | Staging/production IdP: TBD | BLACKNOIX founder + Identity (external) | IdP readiness; staging env | TBD | Unverified |
| Staging deployment baseline (packaging) | Conflating packaging with deploy proof | Source packaging + honest local container evidence under ADR-0013 constraints | Clean-tree verifier artifact per SHA; smoke:dist | Dockerfile; `smoke:dist`; ADR-0013 (do not edit) | **Current:** `container-verification-20260817-081502.json` @ `bf88acc` (cited `9a3ecf0`). Prior immutable: `…075417`→`e046202`; `…071922`→`cc65dca`; `…065242`→`ce3d7c9`. Not staging | Local container only | BLACKNOIX founder | Scan/SBOM/registry/K8s/IdP separate | TBD | In progress |

---

## Next Critical-Path Vertical Slice: Tenant-Isolated Authorization and Immutable Audit Validation

### Why this slice next

Secure customer onboarding is gated by a single vertical proof:

**authenticated principal → tenant-scoped telemetry → tenant-bound alert → append-only audit → fail-closed cross-tenant/RBAC denial**

Local building blocks already exist (`alerts-auth-failure.dbtest.ts`, alerts RBAC unit tests, RLS helpers). **Local implementation evidence (criteria 1–6 only):** `backend/api-gateway/tests/db/tenant-isolation-immutable-audit.dbtest.ts` via `npm run test:db` against disposable Compose Postgres. Status remains **In progress**—not staging/platform/Done. Criterion 7 (recovery drill) remains explicitly out of scope for that suite.

### Acceptance criteria (1–6 gated locally; 7 deferred)

| # | Criterion | Planned test layer |
|---|---|---|
| 1 | Tenant A cannot read, mutate, or act on Tenant B resources (alerts, telemetry, audit rows) | **Database integration** (`*.dbtest.ts`) + **API integration** where HTTP surfaces exist |
| 2 | A valid authorized action succeeds for an allowed role (`operator`/`auditor` as designed for the surface) | **API integration** (minted JWT / enforce) and/or **unit** route guard tests |
| 3 | Denied cross-tenant and RBAC attempts fail closed and are audited **safely** (no secrets/tokens/connection strings in bodies or logs; denial outcome is explicit and non-oracular) | **API integration** + log/response non-leak assertions; extend db/HTTP coverage where denial audit is in scope |
| 4 | Authorized mutations that create security-relevant state also create tenant-bound audit events (`alert_audit_events` for alert creation on this tip) | **Database integration** (same-TX durable-before-success already partially proven—keep as required gate) |
| 5 | Application runtime role (`depp_app`) cannot `UPDATE` or `DELETE` immutable audit events | **Database integration** (privilege negative already present—retain as required gate) |
| 6 | A registered agent’s authenticated telemetry event appears only in its tenant’s alert/dashboard path | **Database integration** + **API integration** for `GET /v1/alerts` tenant scoping |
| 7 | A documented recovery test restores the vertical slice without violating tenant isolation or audit integrity | **Manual recovery drill** (procedure + recorded results) until automation exists; not claimed Done until executed and linked |

### Ordered execution sequence (post local 1–6 gate)

1. **Landed (local only):** `tests/db/tenant-isolation-immutable-audit.dbtest.ts` fails the build unless criteria 1–6 pass against disposable Compose Postgres (`npm run test:db`). Reuses `tests/db/helpers.ts`, real telemetry+alerts services, JWT strategy; no committed secrets.
2. Record source SHA in the Day-30 evidence cells when this commit lands (this citation).
3. Next: schedule the **manual recovery drill** (criterion 7) as a separate commit/evidence note—do not claim Done for the slice until then.
4. **Defer:** Windows agent work, UI polish, Helm/GitOps scaffolding, Dockerfile/verifier changes, ADR-0012/0013 edits, and staging IdP packs until founder schedules those gates.

### External / deployment prerequisites (later gates — not claims of this planning commit)

These remain **Blocked** / external and must not be implied by local tests or the `bf88acc` container artifact:

| Prerequisite | Why it is later |
|---|---|
| Kubernetes / GitOps environment | No in-repo deploy path yet |
| Non-local least-privilege app and migration roles | Compose init roles are local-dev defaults only |
| Secret injection | Images/docs require runtime injection; no staging injector evidenced |
| Image scan / provenance | No scan workflow or attested digest evidence in-repo |
| Reachable deployed control plane | Required for staging ingest/onboarding proof |
| Deployment-level readiness gating | `/ready` exists locally; orchestrator probe wiring is undeployed |

### Explicit non-claims

- The `bf88acc` container verifier result is **local-only** (build, `Config.User=node`, `/health` liveness under `not_configured`, SIGTERM). It is **not** staging evidence and does **not** prove in-container live-DB readiness.
- `not_configured` on `/health` must not be reinterpreted as readiness success.
- ADR-0012 and the historical JWT/`enforce` bundle remain isolated and immutable.

---

## Critical Path (enterprise sales loop)

Enterprise-salable readiness for the protection loop depends on this vertical slice being true **with linked evidence** in the target environment:

1. **Authenticated tenant/device** — verified principal (human via IdP-backed DEPP JWT in staging/production lineages; agent via credential exchange), never unverified headers in those lineages.
2. **Telemetry accepted** — agent-only ingest paths accept well-formed events bound to principal tenant/agent.
3. **Durable tenant-scoped storage** — append-only (or equivalently integrity-protected) persistence under RLS.
4. **Detection/finding/alert** — deterministic materialization for the tenant.
5. **Audit trail** — durable security-relevant audit where required.
6. **Read-only operator visibility** — operator/auditor read surfaces without cross-tenant leakage.
7. **Cross-tenant negative tests** — explicit empty/`NOT_FOUND`/reject outcomes proving isolation.
8. **Recovery** — restore drill preserves isolation and audit integrity.

Local controlled-issuer JWT/`enforce`, local dbtests, and local container verification may support **In progress** claims. They do not make the slice **Done** for staging or production.

---

## Weekly Review

Before any Status field changes on this matrix:

1. Review every **Blocked** and failed control.
2. Confirm each Evidence link still resolves and matches the claimed scope (local vs staging vs production vs IdP).
3. Reject any proposal to mark staging/production **Done** without a direct evidence link that satisfies Evidence Rules.
4. Record the review date and reviewer in the change notes or PR description when this file is updated.
5. Do not begin the next implementation slice without explicit founder approval.
