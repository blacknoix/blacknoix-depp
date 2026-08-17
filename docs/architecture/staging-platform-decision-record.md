# Staging Platform Decision Assessment

**Document type:** founder approval worksheet (not an ADR)
**Audience:** BLACKNOIX founder (primary); Platform / Identity administrators where noted
**Companion contract:** [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md)
**Tip lineage at authoring:** `2aad336` on `feat/container-baseline-recreate`
**Founder pilot baseline recorded:** 2026-08-17 — **choices only; nothing provisioned or deployed**

---

## 1. Scope and explicit non-claims

This worksheet prepares and records **founder choices** required to authorize the **first staging** tenant-isolated endpoint-to-dashboard vertical slice:

authenticated Tenant A human → enforced RBAC → Tenant A agent telemetry → Tenant A-only alert → tenant-bound append-only audit → `/health` liveness + `/ready` dependency readiness.

**Explicit non-claims**

- Section 6 now records a **founder-selected pilot baseline**. That is **not** evidence of provisioning, deployment, scanning, IdP enforcement, or staging Complete.
- No AWS account, EKS cluster, Argo CD install, ECR repository, RDS instance, Auth0 tenant, Secrets Manager secret, DNS record, or CI deploy job is created by this document.
- All current application, database, container, tenant-isolation, RBAC, audit, telemetry, and recovery evidence remains **local-only** (see Section 2).
- ADR-0013 remains historical and unmodified. ADR-0012 / historical JWT/`enforce` evidence remain immutable and out of scope.
- Namespace isolation (e.g. `depp-staging`) is **not** a substitute for application tenant checks, RLS, append-only audit grants, or cross-tenant negatives.

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
| GitOps / IaC | **Absent** (no `helm/`, `k8s/`, `kubernetes/`, Terraform, Pulumi) | Next allowed slice: non-secret skeleton only after Section 7 gate |
| Staging procedure scaffold | [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md) + template | Procedure only until a real staging environment exists |
| Prerequisite contract | [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md) (`2e2b79e`) | Owner checklist completed for *choices*; environment access still required |

---

## 3. Decisions requiring founder approval

**Approval status legend**

- `Founder recorded (pilot baseline) — not implemented` = choice written in Section 6; **no** cloud/platform evidence
- `Pending — founder approval required` = still blank

| Decision | Why it gates the first staging slice | Minimum acceptable criteria | Options to assess | Recommended / recorded pilot choice | Decision owner | Approval status |
|---|---|---|---|---|---|---|
| Cloud or Kubernetes hosting model | Nothing to deploy into without an environment boundary | Isolated non-prod account; managed control plane preferred for solo ops | Managed K8s; managed container platform; shared-dev (**discouraged**) | **AWS + EKS Auto Mode**, dedicated non-production AWS account | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Cluster ownership and access model | Prevents accidental prod access | Least-privilege humans; no shared root; CI via short-lived OIDC | Founder-only; SSO + least privilege | **AWS IAM Identity Center** for humans; least-privilege IAM roles for CI/CD; no shared root | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| GitOps approach and promotion model | Reviewable deploys + rollback via git | Desired state in git; PR before sync; digest-pinned image | Argo CD; Flux; CI apply only (**weaker**) | **Argo CD** + separate GitOps repo; protected `staging` branch; PR promotion | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Promotion model (SHA↔digest↔config) | Traceability for evidence packs | `main` SHA → digest → GitOps PR → sync | Same-repo manifests; separate config repo | `main` app commit → immutable digest → PR to GitOps `staging` → Argo sync after approval | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Container registry and retention | Store digest-pinned images | Private registry; retention; no `latest`-only deploys | ECR; GHCR; other OCI | **Amazon ECR** private; deployed digests **180d**; latest 30 non-deployed **30d** | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| CI provider and image-build workflow | CI today stops at unit tests | Build Dockerfile; push digest; OIDC to cloud | GitHub Actions OIDC; long-lived keys (**avoid**) | **GitHub Actions** + AWS OIDC (no long-lived AWS keys in GitHub) | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Image scanning, SBOM, provenance, severity | Blocks unscanned promotion | Scan before promote; SBOM+sign; written fail policy | Trivy; ECR enhanced; Cosign; Syft | **Trivy** + **ECR enhanced scanning** where available; **Syft** CycloneDX SBOM; **Cosign keyless** via GHA OIDC; block **Critical** with fix; block **High** with fix unless time-bound founder risk acceptance | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Secret-management and rotation | Must not use Compose/`test.env` | Platform injection; no secrets in git/logs | Secrets Manager + ESO; sealed secrets | **AWS Secrets Manager** via **External Secrets Operator**; **90-day** staging rotation target; immediate rotate on suspected exposure | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Staging PostgreSQL + backup ownership | Vertical slice is DB-dependent | Private path; automated backups; named owner | RDS; self-hosted on cluster (**higher ops**) | **Amazon RDS PostgreSQL**, private subnet, no public access; automated backups **≥7-day** retention; backup owner **BLACKNOIX founder** until Platform owner exists | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Separate runtime / migration DB identities | Preserves local least-privilege + append-only audit | Distinct `depp_migrator` / `depp_app`; never local passwords | Mirror local model with non-local secrets | Separate **`depp_migrator`** (migrations only) and **`depp_app`** (API only) | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| External IdP and test principals | Staging evidence needs verified JWT + `enforce` | Staging IdP tenant; operator/auditor/role-less/agent tests | Auth0; other OIDC; temporary deferral (**blocks IdP Complete**) | **Auth0** staging tenant, separate app/client, dedicated test users/roles; temporary deferral allowed only with explicit note that **customer pilot is blocked** until Auth0 enforce evidence exists | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| DNS, TLS, ingress, network policy | External HTTPS + limited exposure | TLS; DB not public; default-deny direction | Route 53 + ACM + ALB; other | **Route 53 + ACM**; staging subdomain `staging-api.<your-domain>`; **ALB** HTTPS-only via AWS Load Balancer Controller; NetworkPolicy default-deny with allow API↔Postgres + required DNS | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Central logging, metrics, tracing | Observe pilot without secret leakage | Structured logs; retention bound | CloudWatch; OTel later | **CloudWatch Logs** structured JSON, **30-day** retention; **Container Insights** initially; OTel later | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Named deployer / rollback owner | Accountability | Named human; GitOps rollback method | Founder dual-hat | **BLACKNOIX founder** deploy + rollback via protected GitOps + digest-pinned prior revision; protected-branch review required even if sole reviewer | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |
| Budget ceiling and region / residency | Bounds spend and data location | Monthly cap; region; classification | Founder-set | Region **`ap-south-1` (Mumbai)** subject to first pilot customer residency; **USD 250/month** hard cap with Budgets alerts at 50%/80%/100%; staging data = **synthetic only** | BLACKNOIX founder | Founder recorded (pilot baseline) — not implemented |

---

## 4. Recommended pilot baseline (now founder-recorded)

**Label:** founder-recorded pilot selections below — **still not provisioned**.

### Architecture boundary (intended; not deployed)

```text
GitHub Actions
  -> build image by source SHA
  -> scan + SBOM + sign
  -> push immutable digest to Amazon ECR
  -> PR to GitOps staging repository
  -> Argo CD syncs to EKS (Auto Mode) namespace (e.g. depp-staging)
  -> API gateway uses Secrets Manager-injected credentials (External Secrets)
  -> private Amazon RDS PostgreSQL (depp_app / depp_migrator)
  -> Auth0 staging issuer
  -> ALB HTTPS ingress
```

Application-level tenant checks, RLS, append-only audit grants, and cross-tenant negatives remain the **primary** protection mechanisms; the platform must demonstrate them under non-local identities and secrets.

### Required before any pilot deployment

| Item | Recorded choice | Why |
|---|---|---|
| Dedicated non-prod AWS account | Yes | Blast-radius / billing / identity separation |
| EKS Auto Mode + namespace e.g. `depp-staging` | Yes | Managed control plane; env boundary (not a tenant boundary) |
| Digest-pinned non-root image | Yes | Matches local `USER node` packaging; SHA↔digest evidence |
| ECR + Trivy + ECR enhanced scan | Yes | Pre-promotion security bar |
| Syft CycloneDX + Cosign keyless | Yes | Digest-linked SBOM/provenance without long-lived signing keys |
| Secrets Manager + External Secrets | Yes | No secrets in git/manifests/images |
| RDS private + `depp_app` / `depp_migrator` | Yes | Preserves local least-privilege / append-only model |
| TLS ALB ingress; DB private | Yes | Limited exposure for auth/telemetry |
| NetworkPolicy default-deny + allowlist | Yes | Defense in depth beyond app RBAC |
| `/ready` readiness (not `/health`) | Yes | Fail closed when DB/secrets missing |
| CloudWatch structured logs (30d) | Yes | Investigation without secret leakage |
| GitOps rollback to prior digest | Yes | Explicit rollback ownership |
| Automated RDS backups ≥7d; founder owns until Platform | Yes | Accountable restore window (not RPO/RTO claim) |

### Deliberate deferrals (do not add before first staging vertical slice)

- Multi-region / DR architecture
- Self-managed Kubernetes or self-hosted PostgreSQL on the cluster
- Service mesh
- SIEM/SOAR
- Production / customer data
- Full HA and autoscaling design
- Windows-agent signing and fleet management
- Enterprise IdP federation beyond the staging Auth0 tenant
- WAF / DDoS / advanced compliance tooling beyond baseline cloud protections

---

## 5. First staging implementation plan (future commits only)

Do **not** create these commits until Section 7 gates are met (choices are recorded; **account access and provisioning still required**).

| # | Future commit (atomic) | Purpose | Expected source paths (illustrative) | Acceptance evidence | Stop conditions |
|---|---|---|---|---|---|
| 1 | Non-secret AWS/EKS GitOps skeleton | Repo structure, namespace baseline, digest policy placeholders, SA/RBAC boundaries, External Secrets **name** refs only | e.g. GitOps repo + optional `infra/staging/` placeholders | Diff shows **no** secrets; matches Section 6 | AWS account missing; secrets in tree; provisioning without explicit authorize |
| 2 | Image build, scan, SBOM/provenance pipeline | SHA→ECR digest; Trivy + policy; Syft; Cosign keyless | `.github/workflows/*` | Critical/High-with-fix fail blocks promote; digest recorded | Long-lived AWS keys; public registry; scan policy ignored |
| 3 | Secret and non-local DB-role integration contract | Document injection for `depp_app` / `depp_migrator` secret **names**; rotation owner | runbook + ESO ExternalSecret stubs (no values) | Distinct role names evidenced; no Compose passwords | Values in git; single superuser for app |
| 4 | Minimal GitOps deployment definition | api-gateway: digest pin, non-root, `/ready`+`/health`, ALB HTTPS | Argo Application + manifests | Redacted render; ready only when `/ready` 200 | Floating tags; readiness on `/health` |
| 5 | Staging vertical-slice validation harness | Allow/deny, cross-tenant, telemetry→alert, audit immutability under Auth0/`enforce` | [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md) pack | Redacted pack + SHA + digest | `dev-header` or local JWT bundle as IdP proof; customer pilot before Auth0 evidence |
| 6 | Rollback/recovery evidence | Prior digest GitOps rollback + future staging RDS restore drill | Outside-repo evidence + matrix cite | Rollback green; smoke green | Claiming local `12a90d5` as staging recovery |

---

## 6. Approval checklist (founder-recorded)

Do **not** paste secrets. Domain placeholder `staging-api.<your-domain>` is intentional until DNS is owned.

```text
STAGING PLATFORM APPROVAL WORKSHEET
Date: 2026-08-17
Founder name: BLACKNOIX founder

1. Hosting / Kubernetes provider or local managed platform:
   Answer: AWS EKS Auto Mode in a dedicated non-production AWS account

2. Billing / account / subscription owner:
   Answer: BLACKNOIX founder (dedicated non-production AWS account)

3. Region:
   Answer: ap-south-1 (Mumbai), subject to first pilot customer residency needs

4. Maximum monthly staging budget (currency + amount):
   Answer: USD 250/month hard cap, with AWS Budgets alerts at 50%, 80%, and 100%

5. Git repository and branch promotion model (app-repo vs config-repo; branch/path):
   Answer: Separate GitOps repository; protected staging branch; PR-based promotion;
           main application commit -> immutable image digest -> GitOps staging PR -> Argo CD sync after approval

6. Container registry choice:
   Answer: Amazon ECR private repository; deployed digests retained 180 days;
           latest 30 non-deployed images retained 30 days

7. Secret manager choice:
   Answer: AWS Secrets Manager via External Secrets Operator; 90-day staging rotation target;
           rotate immediately on suspected exposure

8. Managed PostgreSQL (or approved alternative) choice:
   Answer: Private Amazon RDS PostgreSQL (private subnet, no public access);
           automated backups with at least 7-day retention;
           database backup owner: BLACKNOIX founder until a platform owner exists

9. IdP provider (or explicit deferral note — blocks IdP Complete):
   Answer: Auth0 staging tenant with separate staging app, test users, and roles.
           Temporary deferral allowed only if needed: deploy initially with existing local
           identity boundary, but block any customer pilot until Auth0 enforcement evidence exists.

10. DNS / TLS owner:
    Answer: Route 53 + AWS Certificate Manager; staging subdomain staging-api.<your-domain>;
            ALB HTTPS ingress via AWS Load Balancer Controller; database remains private

11. Logging / monitoring destination:
    Answer: CloudWatch structured JSON logs with 30-day retention;
            CloudWatch Container Insights initially; OpenTelemetry-compatible export later

12. Named deploy / rollback approver:
    Answer: BLACKNOIX founder (protected-branch review required even if sole reviewer);
            rollback via GitOps to last known-good image digest/config revision

13. Acceptable image-scan severity threshold (e.g. fail on Critical):
    Answer: Block Critical with an available fix; block High with an available fix unless a
            time-bound, documented risk acceptance is approved by BLACKNOIX founder.
            Scanners: Trivy in GitHub Actions plus Amazon ECR enhanced scanning where available.
            SBOM: Syft CycloneDX JSON. Provenance: Cosign keyless signing via GitHub Actions OIDC.

14. Data classification allowed in staging (synthetic only / anonymized / other):
    Answer: Synthetic data only — no customer endpoint telemetry, production credentials,
            personal data, or real customer secrets

15. Cluster access model (who may authenticate to the API server):
    Answer: AWS IAM Identity Center (SSO) for humans; least-privilege IAM roles for CI/CD via OIDC;
            no shared root credentials

16. Confirm local Compose passwords will NOT be reused in staging (Y/N):
    Answer: Y — separate non-local depp_migrator and depp_app identities only

Founder approval — staging pilot baseline (recorded):

Hosting/Kubernetes: AWS EKS Auto Mode in a dedicated non-production AWS account
Region: ap-south-1 (Mumbai), subject to first pilot customer residency needs
Budget ceiling: USD 250/month, with alerts at 50%, 80%, and 100%
Cluster access: AWS IAM Identity Center for human access; least-privilege OIDC roles for GitHub Actions
GitOps: Argo CD, separate GitOps repository, protected staging branch, PR-based promotion
Registry: Amazon ECR private repository; deployed digests retained 180 days
CI: GitHub Actions using AWS OIDC, no long-lived cloud credentials
Scanning: Trivy plus ECR enhanced scanning where available
Scan policy: block Critical with a fix; block High with a fix unless founder-approved time-bound exception exists
SBOM/provenance: Syft CycloneDX SBOM and Cosign keyless signing via GitHub OIDC
Secrets: AWS Secrets Manager via External Secrets Operator; 90-day staging rotation target
PostgreSQL: private Amazon RDS PostgreSQL with automated backups and 7-day retention
Database identities: separate depp_migrator and depp_app least-privilege roles
Database backup owner: BLACKNOIX founder
IdP: Auth0 staging tenant with separate staging app, test users, and roles
DNS/TLS/ingress: Route 53, AWS Certificate Manager, ALB HTTPS ingress; database remains private
Network policy: default-deny direction; allow only required API, database, and DNS traffic
Logging/monitoring: CloudWatch structured logs with 30-day retention; CloudWatch Container Insights initially
Deployment and rollback authority: BLACKNOIX founder through protected GitOps promotion and digest-pinned rollback
Staging data classification: synthetic data only; no customer, production, personal, or secret data

Signature / recorded approval location:
   Answer: This document Section 6 (repository); date 2026-08-17
```

---

## 7. Guardrails for the following implementation task

**Choice gate (Section 6):** completed for the pilot baseline above.

The **next infrastructure implementation prompt must not proceed to provision or deploy** until:

1. An **approved AWS non-production account and access route** exist (IAM Identity Center usable by the founder).
2. **Billing ownership** for that account is confirmed under the USD 250/month cap (Budgets alerts configured when account exists).
3. **Explicit founder authorization** is given for the next atomic slice (recommended first: **non-secret** AWS/EKS GitOps skeleton only — repository structure, digest policy, namespace baseline, service-account/RBAC boundaries, placeholders for externally managed secrets — **without** provisioning EKS/RDS/Auth0 until separately authorized).
4. Secret-management choice remains **AWS Secrets Manager + External Secrets** (no Compose/`test.env` values in git).
5. Auth0 staging tenant is available **or** the temporary deferral in Section 6 is invoked in writing (customer pilot blocked until Auth0 enforce evidence).
6. RDS + `depp_app` / `depp_migrator` ownership model remains as recorded (create roles only in approved account).
7. Image scan/provenance policy remains as recorded (Trivy/ECR/Syft/Cosign).

Until account access + explicit authorize-for-skeleton: keep Kubernetes/GitOps **Blocked** in the control matrix; do **not** create live cloud resources from a docs-only commit.

---

## Related documents

- [staging-vertical-slice-prerequisites](../runbooks/staging-vertical-slice-prerequisites.md)
- [enterprise-readiness-control-matrix](./enterprise-readiness-control-matrix.md)
- [staging-enforce-alert-evidence](../runbooks/staging-enforce-alert-evidence.md)
- [local-postgres-recovery-drill](../runbooks/local-postgres-recovery-drill.md)

**End of worksheet.** Founder pilot choices are recorded. No infrastructure, secrets, cloud resources, IdP tenant, CI/CD deploy jobs, scans, or deployments were created by this update.
