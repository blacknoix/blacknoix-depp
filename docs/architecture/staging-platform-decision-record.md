# Staging Platform Decision Assessment

**Document type:** founder approval worksheet (not an ADR; no decision claimed)
**Audience:** BLACKNOIX founder (primary); Platform / Identity administrators where noted
**Companion contract:** [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md)
**Tip lineage at authoring:** `2e2b79e` on `feat/container-baseline-recreate`

---

## 1. Scope and explicit non-claims

This worksheet prepares **founder choices** required to authorize the **first staging** tenant-isolated endpoint-to-dashboard vertical slice:

authenticated Tenant A human → enforced RBAC → Tenant A agent telemetry → Tenant A-only alert → tenant-bound append-only audit → `/health` liveness + `/ready` dependency readiness.

**Explicit non-claims**

- No cloud/Kubernetes platform has been **selected**, provisioned, deployed, scanned, or evidenced by this document.
- No GitOps, Helm, Terraform, Pulumi, CI deploy jobs, registry, IdP tenant, or secret store is created here.
- All current application, database, container, tenant-isolation, RBAC, audit, telemetry, and recovery evidence remains **local-only** (see Section 2).
- Recommendations in Section 4 are **pilot defaults for assessment**, not adopted architecture decisions.
- ADR-0013 remains historical and unmodified. ADR-0012 / historical JWT/`enforce` evidence remain immutable and out of scope.

---

## 2. Current repository constraints (verified)

| Area | Verified fact | Implication for staging |
|---|---|---|
| Runtime | Node.js / Express api-gateway; TypeScript; Kysely + SQL migrations | Staging deploys this service first; no second backend required for the vertical slice |
| Container baseline | `backend/api-gateway/Dockerfile`: multi-stage Node 22, `USER node`, `CMD node dist/index.js`; ADR-0013 packaging constraints | Non-root is already in source packaging; staging must not override to root |
| Local container evidence | `9a3ecf0` cites SHA-bound `container-verification-20260817-081502.json` @ `bf88acc` (local build, non-root, `/health` under `not_configured`, SIGTERM) | **Not** staging; digests/scans/registry promotion still absent |
| Local infra | `infra/docker-compose.yml` + `infra/postgres/init/` only; roles `depp_app` / `depp_migrator` are **local-dev defaults** | No K8s/Helm/Terraform/Pulumi/GitOps assets; local passwords must never become staging secrets |
| Liveness / readiness | `/health` always 200 while process alive; `/ready` 200 only if DB `up`, else 503 (`not_configured`/`down`) — `e046202` / `bf88acc` | Orchestrators must probe `/ready`, not `/health` |
| RLS / audit | Tenant scoping via `withTenantTransaction` + RLS; `alert_audit_events` app grants `SELECT, INSERT` only (migration 017); local proofs `fbc43fb`, `12a90d5` | Staging must preserve separate least-privilege roles and append-only audit |
| Vertical-slice local proof | `fbc43fb` tenant isolation / RBAC / audit / telemetry→alert; `12a90d5` local recovery drill | Reusable acceptance *patterns*; not staging evidence packs |
| CI | `.github/workflows/api-gateway.yml`: merge-markers, typecheck, build, `test:unit` | **Does not** build/push images, scan, SBOM, provenance, or deploy |
| GitOps / IaC | **Absent** (no `helm/`, `k8s/`, `kubernetes/`, Terraform, Pulumi) | First implementation slice cannot invent an unapproved platform |
| Staging procedure scaffold | [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md) + template | Procedure only until a real staging environment exists |
| Prerequisite contract | [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md) (`2e2b79e`) | Owner checklist must be completed before manifests |

---

## 3. Decisions requiring founder approval

**Approval status legend:** all rows are `Pending — founder approval required` unless repository evidence proves otherwise (none do).

| Decision | Why it gates the first staging slice | Minimum acceptable criteria | Options to assess | Recommended default for a small security-SaaS staging pilot | Decision owner | Approval status |
|---|---|---|---|---|---|---|
| Cloud or Kubernetes hosting model | Nothing to deploy into without an environment boundary | Isolated non-prod account/project; ability to run one api-gateway workload + ingress + private DB path | Managed K8s (major cloud); managed container platform; deferred shared-dev cluster (**discouraged**) | Single managed Kubernetes cluster in a **dedicated non-production** account/project | BLACKNOIX founder + Platform (external) if admin rights required | Pending — founder approval required |
| Cluster ownership and access model | Prevents accidental prod access and uncontrolled `kubectl` | Least-privilege human access; break-glass documented; no shared prod kubeconfig | Founder-only; founder + one platform admin; SSO group | Founder as primary; optional single Platform admin; **no** standing prod access from staging credentials | BLACKNOIX founder | Pending — founder approval required |
| GitOps approach and promotion model | Repeatable, reviewable deploys; rollback via prior revision | Desired state in git; PR review before apply; digest-pinned image | App-repo manifests; separate config repo; CI `kubectl apply` only (**weaker**) | GitOps controller + PR promotion from a staging branch/path; apply only via controller | BLACKNOIX founder + Platform (external) | Pending — founder approval required |
| Container registry and immutable-image retention | Need a place to store digest-pinned images | Immutable digests; retention policy; no required mutable `latest` for staging | Cloud registry; GitHub Packages; other OCI registry | One private OCI registry; retain staging digests ≥ 30 days; deploy by digest | BLACKNOIX founder + Platform (external) | Pending — founder approval required |
| CI provider and image-build workflow | CI today stops at unit tests | Build image from api-gateway Dockerfile; push by digest; record source SHA | Extend GitHub Actions; other CI | Extend existing GitHub Actions with **build+push** (still no auto-prod) | BLACKNOIX founder | Pending — founder approval required |
| Image scanning, SBOM, provenance, severity policy | Blocks unscanned/unattested promotion | Scan before promote; retain SBOM/provenance linked to digest; written fail threshold | Registry-native scan; CI scanner + attestations | CI/registry scan; **fail on Critical** (and High if feasible); SBOM+provenance attached to digest | BLACKNOIX founder + Platform (external) | Pending — founder approval required |
| Secret-management and rotation | Staging must not use Compose/`test.env` secrets | Platform injection; no secrets in git/logs; named rotation owner | Cloud secret manager; sealed secrets; external vault | Platform-managed secret store; inject `DATABASE_URL`, JWT, IdP client material; 90-day rotation target | BLACKNOIX founder + Platform (external) | Pending — founder approval required |
| Staging PostgreSQL hosting, backup, restore ownership | Vertical slice is DB-dependent (`/ready`, RLS, audit) | Private network path; automated backups; named restore owner | Managed Postgres; self-hosted on cluster (**higher ops**) | Managed PostgreSQL in same non-prod account; private access; Platform/DB owns backups; founder owns restore *drill schedule* | BLACKNOIX founder + Platform/DB (external) | Pending — founder approval required |
| Separate runtime / migration DB identities | Preserves append-only audit + least privilege proven locally | Distinct login roles; app cannot bypass RLS; migrator owns DDL; app `SELECT,INSERT` only on audit tables | Mirror local model with **non-local** passwords; temporary single role (**unacceptable**) | Non-local `app` + `migrator` roles modeled on local semantics, never local passwords | BLACKNOIX founder + Platform/DB (external) | Pending — founder approval required |
| External IdP and test-user/group/role model | Staging evidence requires verified JWT + `enforce`, not `dev-header` | Issuer/audience documented; operator/auditor/role-less/agent test principals; no local JWT bundle reuse | Major OIDC IdP; deferred controlled issuer (**not IdP evidence**) | Real staging IdP tenant with mapped `operator`/`auditor`; document if deferred (blocks IdP Complete) | Identity (external) + BLACKNOIX founder | Pending — founder approval required |
| DNS, TLS/certificates, ingress, network policy | External HTTPS + limited exposure | TLS for external traffic; DB not public; default-deny where feasible | Cloud DNS + managed certs; external DNS | Single staging hostname; managed TLS; ingress only to api-gateway; NetworkPolicy default-deny egress/ingress except approved paths | Platform (external) + BLACKNOIX founder | Pending — founder approval required |
| Central logging, metrics, tracing, retention | Need security-relevant observability without secret leakage | Structured logs; secret redaction; retention bound | Cloud logging; vendor APM; deferred file-only (**weak**) | Central log sink + basic metrics; retention TBD by founder; **no** tokens/connection strings | BLACKNOIX founder + Platform (external) | Pending — founder approval required |
| Named deployer, reviewer, incident/rollback owner | Accountability for go/no-go and rollback | Named humans; rollback method agreed | Founder dual-hat; separate reviewer | Founder = deploy + rollback approver; optional second reviewer before first apply | BLACKNOIX founder | Pending — founder approval required |
| Budget ceiling and regional / data-residency constraints | Prevents unbounded spend and wrong-region data | Monthly cap; region chosen; staging data classification stated | Founder-set numbers; legal-driven residency | Cap and region = **TBD — founder approval required**; staging = synthetic/non-customer data only until classified otherwise | BLACKNOIX founder | Pending — founder approval required |

---

## 4. Recommended pilot baseline

**Label:** recommendation for a **single** staging environment — **not** an adopted decision.

### Required before any pilot deployment

| Recommendation | Why (vertical-slice security outcomes) |
|---|---|
| Dedicated non-production account/project/subscription | Tenant-isolation and secret safety: reduces blast radius vs production billing/identity |
| Separate namespace/environment boundary | Deployment repeatability and rollback: clear staging vs other workloads |
| Digest-pinned container image | Repeatability and auditability: exact bits under test match evidence SHA↔digest |
| Non-root workload (`USER node` preserved) | Secret/host safety: matches local container baseline; limits container escape impact |
| Registry scan before promotion | Blocks known-critical images before they serve RBAC/telemetry paths |
| SBOM/provenance retention tied to digest | Evidence integrity: later matrix Complete claims can cite digest-linked artifacts |
| Platform-managed secret injection | Secret safety: forbids Compose/`test.env` leakage into staging |
| Separate least-privilege migration and runtime DB roles | Audit integrity + RLS: preserves local append-only / NOBYPASSRLS model |
| TLS ingress + DB not publicly reachable | Network exposure limit for auth and telemetry surfaces |
| Minimal NetworkPolicy (default deny + allowlist) | Tenant data path protection beyond app RBAC |
| Readiness-aware rollout (`/ready` probe; not `/health`) | Fail closed when DB/secrets missing (`bf88acc` / ready contract) |
| Structured logs without secrets | Supports investigation without credential disclosure |
| Documented rollback to prior digest/GitOps revision | Deployment repeatability after bad promote |
| Named backup owner + scheduled **future** staging restore drill | Extends local recovery (`12a90d5`) without claiming RPO/RTO |

### Deferrable until after the first protected vertical-slice demonstration

| Item | Why deferrable |
|---|---|
| Multi-AZ / HA database | Pilot needs correctness of isolation/audit, not production availability SLO |
| Full SIEM / long retention | Central logs sufficient for first evidence pack |
| Multi-cluster / multi-region | Single staging env is enough for first slice |
| Windows agent pilot | Explicitly deferred in matrix; not required for api-gateway vertical slice |
| Production IdP / customer federation | Staging IdP (or documented deferral) is enough for first pack; production IdP is Day-90 |
| Automated chaos / load testing | Not required to prove tenant isolation / audit / telemetry→alert |
| Broad service mesh | Ingress + NetworkPolicy cover the minimum exposure model |

---

## 5. First staging implementation plan (future commits only)

Do **not** create these commits until Section 6 is completed and access exists.

| # | Future commit (atomic) | Purpose | Expected source paths (illustrative) | Acceptance evidence | Stop conditions |
|---|---|---|---|---|---|
| 1 | Infrastructure skeleton after approvals | Encode approved env boundary (namespace/project refs, non-secret placeholders) | e.g. `infra/staging/` or agreed GitOps repo paths | Diff shows **no** secrets; matches approved hosting/GitOps choices | Section 6 incomplete; wrong account; secrets in tree |
| 2 | Image build, scan, SBOM/provenance pipeline | SHA→digest build; scan gate; retain SBOM/provenance | `.github/workflows/*` (+ scanner config as approved) | Failed Critical scan blocks promote; digest recorded | Scan policy undecided; push to public registry without approval |
| 3 | Secret and non-local DB-role integration contract | Document/inject contract for app vs migrator URLs; rotation owner | runbook + non-secret IaC refs to secret **names** only | Proof of distinct roles (names only); injection without values in git | Local Compose passwords reused; single superuser for app |
| 4 | Minimal GitOps deployment definition | Deploy api-gateway: digest pin, `USER`/securityContext, `/ready` readiness, `/health` liveness, TLS ingress | GitOps manifests for api-gateway only | Render redacted; pods ready only when `/ready` 200 | Floating tags; probe wired to `/health` for readiness |
| 5 | Staging tenant-isolated endpoint-to-dashboard validation harness | Execute allow/deny, cross-tenant negatives, telemetry→alert, audit immutability | Evidence pack from [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md) | Filled redacted template + SHA + digest | Using `dev-header` or local JWT bundle as IdP proof |
| 6 | Rollback/recovery evidence capture | Prior digest restore + smoke; staging DB restore drill when approved | Outside-repo evidence dir + matrix citation | Rollback succeeds; vertical-slice smoke green | Rollback untested; claiming local `12a90d5` as staging recovery |

---

## 6. Approval checklist (copy-paste for founder)

Complete **one answer per line**. Use `TBD — founder approval required` until decided. Do **not** paste secrets.

```text
STAGING PLATFORM APPROVAL WORKSHEET
Date:
Founder name:

1. Hosting / Kubernetes provider or local managed platform:
   Answer: TBD — founder approval required

2. Billing / account / subscription owner:
   Answer: TBD — founder approval required

3. Region:
   Answer: TBD — founder approval required

4. Maximum monthly staging budget (currency + amount):
   Answer: TBD — founder approval required

5. Git repository and branch promotion model (app-repo vs config-repo; branch/path):
   Answer: TBD — founder approval required

6. Container registry choice:
   Answer: TBD — founder approval required

7. Secret manager choice:
   Answer: TBD — founder approval required

8. Managed PostgreSQL (or approved alternative) choice:
   Answer: TBD — founder approval required

9. IdP provider (or explicit deferral note — blocks IdP Complete):
   Answer: TBD — founder approval required

10. DNS / TLS owner:
    Answer: TBD — founder approval required

11. Logging / monitoring destination:
    Answer: TBD — founder approval required

12. Named deploy / rollback approver:
    Answer: TBD — founder approval required

13. Acceptable image-scan severity threshold (e.g. fail on Critical):
    Answer: TBD — founder approval required

14. Data classification allowed in staging (synthetic only / anonymized / other):
    Answer: TBD — founder approval required

15. Cluster access model (who may authenticate to the API server):
    Answer: TBD — founder approval required

16. Confirm local Compose passwords will NOT be reused in staging (Y/N):
    Answer: TBD — founder approval required

Signature / recorded approval location:
   Answer: TBD — founder approval required
```

---

## 7. Guardrails for the following implementation task

The **next infrastructure implementation prompt must not proceed** until all of the following are true:

1. Section 6 approval checklist is **completed** (no outstanding `TBD` on required rows, or an explicit written deferral that accepts the blocked matrix control).
2. An **approved environment and access route** exists (account/project + how humans authenticate to it).
3. **Account/subscription and billing ownership** are confirmed.
4. **Secret-management** choice is approved (and will not use git or Compose defaults).
5. **IdP test tenant** is available **or** explicitly deferred with a documented alternative (deferral blocks External-IdP / staging IdP Complete claims).
6. **Database hosting and role-ownership** model are approved (separate runtime vs migration identities).
7. **Image scan / provenance** policy is approved (severity threshold + retention of SBOM/provenance with digest).

Until then: keep Kubernetes/GitOps **Blocked** in the control matrix; do not add apply-ready manifests that presuppose unapproved vendors.

---

## Related documents

- [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md)
- [enterprise-readiness-control-matrix](./enterprise-readiness-control-matrix.md)
- [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md)
- [local-postgres-recovery-drill](../runbooks/local-postgres-recovery-drill.md)

**End of worksheet.** No infrastructure, secrets, cloud resources, IdP configuration, CI/CD deploy jobs, scans, or deployments were created by publishing this assessment.
