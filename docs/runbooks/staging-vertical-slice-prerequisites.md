# Staging Vertical-Slice Prerequisites and Reproducible Baseline Contract

**Document type:** planning / repository baseline contract
**Audience:** BLACKNOIX founder + Platform / Identity owners before any staging deploy slice
**Tip lineage at authoring:** `12a90d5` (local recovery drill) on `feat/container-baseline-recreate`

---

## 1. Scope and non-claims

This document defines **prerequisites** for the first **staging** tenant-isolated endpoint-to-dashboard vertical slice:

authenticated Tenant A human (staging identity boundary) → enforced RBAC → Tenant A agent telemetry → Tenant A-only alert visibility → tenant-bound append-only audit → `/health` liveness + `/ready` dependency readiness.

It is **not**:

- proof of deployment, rollout, or readiness gating in any cluster;
- proof of secret injection, image scanning, provenance/SBOM gates, or registry promotion;
- proof of external-IdP enforcement or staging JWT issuance;
- production operations, RPO/RTO, HA, or managed-backup certification;
- authorization to create cloud accounts, credentials, IdP tenants, or kubeconfigs.

**Discovered repository fact:** there is **no** in-repo Helm, Kustomize, Kubernetes manifest tree, Terraform, Pulumi, or GitOps promotion path. `infra/` is **local Compose only** (`infra/docker-compose.yml` + `infra/postgres/init/`). CI (`.github/workflows/api-gateway.yml`) runs merge-marker check, typecheck, build, and `test:unit` only — **no** image build/push, scan, or deploy jobs. This document therefore **does not** invent apply-ready staging manifests.

Do **not** begin infrastructure implementation or deployment without explicit founder approval after the Section 4 checklist is completed.

---

## 2. Existing evidence inventory

| Artifact / commit | Valid scope | Explicit non-scope |
|---|---|---|
| `a1ba411155b52458699a5119343eb21d8d2dc1e7` | Control-matrix reconciliation; Day-30/60/90 status vocabulary | Not staging deploy evidence |
| `fbc43fb456223432c4e5c0df901f2d57baffeb61` | Local disposable-Postgres tenant isolation + immutable audit validation (`tests/db/tenant-isolation-immutable-audit.dbtest.ts`) | Not staging/IdP/platform |
| `12a90d5b9541f6898e59159a679133babfe290b5` | Local Postgres backup/restore recovery drill (`npm run recovery:local-postgres`; [local-postgres-recovery-drill](./local-postgres-recovery-drill.md)); outside-repo reports under `~/Downloads/depp-local-recovery-drill/` | Not staging/managed-backup/RPO/RTO |
| `bf88acc7275f8d951a99548b26d340772a27fb6e` | Local live-Postgres `/ready` dbtest (`tests/db/readiness.dbtest.ts`) | Not in-container live-DB or staging probe wiring |
| `9a3ecf086375110f6ca3d48ccb322d1b74f0fed5` | Citation of immutable local container artifact bound to `bf88acc` | Not staging; does not roll prior artifacts forward |
| Outside-repo `container-verification-20260817-081502.json` @ `bf88acc` | Local image build, `Config.User=node`, `/health` under `not_configured`, SIGTERM | **Not** staging; **not** live-DB-in-container; prior SHA-bound artifacts remain immutable |
| Local JWT/`enforce` bundle @ `2ba2bc1` (`local-jwt-enforce-20260813-193009`) | Immutable **local** controlled-issuer evidence | **Not** IdP; ADR-0012 lineage out of scope / immutable |
| ADR-0013 | Historical packaging / staging-deployment-baseline **decision record** | Do not edit; packaging status lives in the matrix |
| [staging-enforce-alert-evidence](./staging-enforce-alert-evidence.md) | Procedure for a **future** staging evidence pack (JWT+`enforce` + alert spine) | Empty template until a real staging environment exists |

Local Compose roles (`depp_app` / `depp_migrator` in `infra/postgres/init/`) and `tests/test.env` are **local-development defaults only**. They must **not** be copied into staging configuration.

---

## 3. Staging vertical-slice target

Minimum deployed flow (future acceptance target — not claimed present):

1. **Tenant A human** authenticates through the **selected staging identity boundary** (external IdP → DEPP-verified JWT under `AUTH_MODE=jwt`; not `dev-header`).
2. **Enforced RBAC:** `AUTH_EXPLICIT_ROLES_MODE=enforce`; allow-listed roles (`operator` / `auditor` as designed per surface); role-less / unauthorized principals denied.
3. **Registered/authenticated Tenant A agent** obtains an agent access token via the established credential-exchange path and submits a **supported** telemetry event (for the alert spine: `auth_failure` burst per existing product rule).
4. Telemetry is **attributed only to Tenant A** (principal-bound tenant/agent; body tenant claims rejected).
5. Resulting **alert** is visible only via Tenant A authorized API/dashboard path (`GET /v1/alerts` / detail); Tenant B sees empty / non-oracular `ALERTS_NOT_FOUND`.
6. **Audit:** `alert_created` (or equivalent established event) is tenant-bound; runtime app role cannot `UPDATE`/`DELETE` `alert_audit_events` (migration `017` grants `SELECT, INSERT` only for app role on this tip).
7. **`GET /health`:** liveness only — process alive may return 200 even when DB is `not_configured` / down (informational `database` field).
8. **`GET /ready`:** dependency-aware readiness — `up` → 200; `down` / `not_configured` → 503 (fail closed). Orchestrators must use `/ready` for readiness probes, not `/health`.

Related procedure once staging exists: [staging-enforce-alert-evidence](./staging-enforce-alert-evidence.md).

---

## 4. Required owner decisions — do not choose them

Complete and sign this checklist **before** any manifest/GitOps/deploy implementation slice. Blank cells mean **blocked**.

| # | Decision | Options / notes (do not invent) | Owner | Approved? (Y/N) | Date |
|---|---|---|---|---|---|
| 1 | Hosting / Kubernetes environment and account/subscription | Cluster, project/subscription, namespace/project isolation model | Platform (external) + BLACKNOIX founder | | |
| 2 | GitOps mechanism and repository/branch promotion model | Tooling, source-of-truth repo, promotion path (e.g. PR → env) | Platform (external) + BLACKNOIX founder | | |
| 3 | Container registry and image-retention policy | Registry URL policy, retention, immutability of digests | Platform (external) | | |
| 4 | Image scanning and provenance/signing provider | Scanner, severity gate, SBOM/provenance store | Platform (external) | | |
| 5 | Staging PostgreSQL hosting model and backup ownership | Managed vs self-hosted; who owns backups/restore drills | Platform / DB (external) + BLACKNOIX founder | | |
| 6 | External IdP provider, tenant, issuer, audience, roles/groups, test-user ownership | Must issue DEPP-consumable claims; separate from local JWT bundle | Identity (external) + BLACKNOIX founder | | |
| 7 | Secret-management system and secret rotation owner | Inject runtime + migration secrets; rotation cadence | Platform (external) + BLACKNOIX founder | | |
| 8 | DNS, TLS/certificate, ingress, and network-policy ownership | External hostname, cert issuer, ingress controller, netpol | Platform (external) | | |
| 9 | Logging / metrics / tracing destination and retention | Sink, PII/secret redaction rules, retention | Platform (external) + BLACKNOIX founder | | |
| 10 | Named approver for staging deployment and rollback | Single accountable human for go/no-go and rollback | BLACKNOIX founder (name required) | | |

**Approval gate:** no Helm/Kustomize/Terraform/GitOps implementation or cluster apply until rows 1–10 are approved in writing (PR comment, signed checklist, or founder record).

---

## 5. Security baseline contract

Verifiable acceptance criteria for a **future** staging deploy. Tooling is named only after Section 4 selections; criteria themselves are fixed.

| Criterion | Verifiable expectation (from repo facts + enterprise norms) |
|---|---|
| Immutable image pin | Deployed workload references an **immutable digest**, not a floating tag alone |
| Pre-promotion scan | Image is scanned **before** promotion; severity policy is written and enforced by the chosen scanner (Section 4.4) |
| Provenance / SBOM | Build provenance and/or SBOM retained and linkable to the digest |
| Non-root runtime | Runtime user is non-root (Dockerfile already sets `USER node`; staging must not override to root) |
| Secret injection | Secrets supplied by the platform secret system; **absent** from git, rendered manifests committed as evidence (redacted), logs, and artifacts |
| Separate DB roles | Runtime uses least-privilege app role; migrations use a distinct migrator/owner role — **not** local Compose passwords; **not** a single superuser for app traffic |
| Tenant / RBAC / audit preserved | Post-deploy: RLS + `enforce` + alert audit append-only invariants still hold (reuse staging-enforce + vertical-slice negatives) |
| Limited network exposure | Only intended ingress paths; no public DB; internal service exposure documented |
| TLS for external traffic | HTTPS for external clients; TLS termination ownership per Section 4.8 |
| Structured logs without secrets | Security-relevant events available; no connection strings, tokens, or raw credentials in log bodies |
| Rollback | Named approver (4.10) can execute a documented rollback to the prior digest/GitOps revision |

Local-dev defaults in `.env.example` / Compose init are **explicitly forbidden** as staging secret values.

---

## 6. Deployment evidence checklist

Retain the following for any later staging “Complete” claim. Locations and retention owner = Section 4 decisions (typically Platform + BLACKNOIX founder).

| Evidence item | Notes |
|---|---|
| Source commit SHA | Exact deployable git SHA |
| Image digest | Immutable digest of the running image |
| Build record | CI/build system record linking SHA → digest |
| SBOM / provenance record | Linked to digest |
| Scan result | Pass/fail against written severity policy |
| Redacted deployment render / GitOps revision | No secrets; shows probes, image pin, resource limits as applicable |
| Non-secret proof of secret injection | e.g. “secret present / key names only” — never values |
| Non-secret proof of separate runtime vs migration DB roles | Role names + grant model; no passwords |
| Rollout / pod health result | Replica readiness events |
| `/health` result | Expect liveness 200; DB field may be informational |
| `/ready` result | Expect 200 only when DB `up`; 503 if dependency absent |
| Staging IdP enforced RBAC allow/deny | Operator/auditor allow; role-less deny; agent vs human surface rules |
| Tenant A / Tenant B isolation negatives | Empty list / non-oracular not-found; no Tenant B alert visibility |
| Telemetry → tenant-correct alert | Agent ingest → Tenant A-only alert |
| Tenant-bound immutable audit | `alert_created` (or established) + app-role UPDATE/DELETE deny |
| Rollback / recovery result | Prior digest restored; vertical-slice smoke still green |
| Evidence store path + retention owner | Outside customer data; redaction rules applied |

Procedure scaffold for the RBAC/alert portion: [staging-enforce-alert-evidence](./staging-enforce-alert-evidence.md) + template under `docs/runbooks/templates/`.

---

## 7. Staging acceptance criteria

**Pass** only if all apply. Any failure **blocks** matrix staging/production **Done** / Complete for the related control.

| # | Pass / fail rule |
|---|---|
| 1 | Deployment **must not promote** if image scan policy fails |
| 2 | Instance **must remain unready** (`/ready` 503) if required secrets or database dependency are absent / unreachable |
| 3 | Tenant B **must not** read or mutate Tenant A resources (alerts, telemetry, audit rows) |
| 4 | Unauthorized role **denied**; intended role **allowed** on the same surface under `enforce` |
| 5 | Runtime DB role **must not** `UPDATE`/`DELETE` audit events (`alert_audit_events` on this tip) |
| 6 | Tenant A telemetry **must not** create Tenant B–visible alerts |
| 7 | `/health` may remain 200 without DB configuration; `/ready` **must fail closed** (`not_configured` / `down` → 503) |
| 8 | Evidence pack **must** include source SHA **and** image digest |
| 9 | Missing or failed checklist items (Section 6) → **not** Complete in [enterprise-readiness-control-matrix](../architecture/enterprise-readiness-control-matrix.md) |

---

## 8. Ordered future execution

Smallest safe order (**each step requires founder approval** before starting the next):

1. Obtain explicit Platform / IdP / secret-management approvals and access (complete Section 4).
2. Create/review an infrastructure **implementation plan** from those approved choices (still no apply until reviewed).
3. Add **minimal** reproducible staging manifests / GitOps configuration matching approved choices (new slice; not this document).
4. Add build **scan / provenance** gate before promotion.
5. Provision **non-local** DB roles and secrets through the approved systems (never commit values).
6. Deploy the vertical slice to staging.
7. Execute and capture the staging acceptance suite (Sections 6–7; staging-enforce-alert pack).
8. Execute rollback / recovery validation in staging.
9. Update the control matrix **only** with linked evidence (scope-correct); never promote local evidence to staging Complete.

---

## 9. Current blockers and owners

Evidence-supported blockers carried forward (no new invented blockers):

| Blocker | Owner |
|---|---|
| Kubernetes / GitOps environment (none in-repo) | Platform (external) + BLACKNOIX founder (app manifests when unblocked) |
| Image scan / provenance capability (not in CI) | Platform (external) |
| Secret injection and rotation mechanism | Platform (external) + BLACKNOIX founder |
| Non-local DB roles and reachable staging database | Platform / DB (external) |
| Staging IdP and enforcement evidence | Identity (external) + BLACKNOIX founder |
| Reachable deployed control-plane ingestion | Platform (external) + BLACKNOIX founder |
| Production-grade backup/restore program (local drill ≠ staging) | BLACKNOIX founder + Platform (external) |
| Windows-agent pilot build | BLACKNOIX founder — **explicitly deferred** past this staging prerequisite |

---

## Related repository facts (discovery summary)

- **Dockerfile** (`backend/api-gateway/Dockerfile`): multi-stage Node 22; `USER node`; packaging only (ADR-0013 constraints).
- **Probes:** `src/routes/health.ts` (liveness), `src/routes/ready.ts` (readiness fail-closed).
- **Auth seams:** `AUTH_MODE=jwt` + `AUTH_EXPLICIT_ROLES_MODE` (ADR-0010/0011); staging must not use `dev-header` as evidence.
- **Alert spine:** migration `017_alerts_and_alert_audit.ts`; local proofs in `alerts-auth-failure.dbtest.ts` and `tenant-isolation-immutable-audit.dbtest.ts`.
- **CI:** `.github/workflows/api-gateway.yml` — typecheck / unit only.

**End of contract.** No deployment, credentials, IdP tenant, scan run, or staging evidence pack is created by publishing this document.
