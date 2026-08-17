# AWS/EKS GitOps Skeleton (non-deployable)

**Scope:** repository source structure and safety contracts only.  
**Companion decisions:** [staging-platform-decision-record](../architecture/staging-platform-decision-record.md)  
**Tree:** `infra/gitops/`

---

## Purpose

Provide a minimal, reviewable Kubernetes/Kustomize overlay for a future
`depp-staging` deployment of api-gateway that is **safe by default** and
**intentionally non-deployable** until:

1. an approved ECR image **digest** replaces the placeholder;
2. External Secrets Operator + SecretStore exist;
3. private RDS egress strategy is approved;
4. AWS account / EKS / Argo CD / Auth0 / DNS/TLS/ALB prerequisites from the
   decision record are provisioned under separate, explicit authorizations.

## What the skeleton enforces vs describes

| Enforced in-repo (validator + manifest shape) | Described only (not active / not provisioned) |
|---|---|
| No `:latest`, no `Secret`/`Ingress`/`LoadBalancer`/`ClusterRole` | AWS account, EKS Auto Mode cluster |
| ClusterIP Service on port **3000** (Dockerfile/`PORT`) | Amazon ECR repository and real digests |
| Liveness `/health`, readiness `/ready` | Argo CD install and GitOps remote repo |
| `runAsNonRoot`, drop ALL caps, no privilege escalation, RuntimeDefault seccomp, read-only root + `/tmp` emptyDir | AWS Secrets Manager values |
| `automountServiceAccountToken: false` | Auth0 tenant, Route 53, ACM, ALB |
| Default-deny NetworkPolicy + DNS egress + same-ns ingress | RDS CIDR/SG egress (template only) |
| Sensitive env via `secretKeyRef` key names only | CloudWatch, GitHub OIDC CI scan/SBOM/sign |

## Why it cannot be deployed yet

- Deployment image is `REPLACE_WITH_ECR_IMAGE_AT_DIGEST` (will not pull).
- No Kubernetes `Secret` is created; runtime Secret `api-gateway-runtime` is expected from ESO later.
- ExternalSecret YAML is a **commented template** under `staging/templates/` (ESO API version must match an installed operator).
- RDS egress NetworkPolicy is template-only (no invented CIDR; no `0.0.0.0/0`).
- No Ingress/ALB/DNS objects exist in this slice.
- NetworkPolicy does **not** replace AWS security groups or RDS `publicly accessible = false`.

## External prerequisites (not created by this commit)

- Dedicated non-production AWS account (`ap-south-1` per decision record)
- EKS Auto Mode cluster + access via IAM Identity Center
- Amazon ECR private repository
- Argo CD + separate GitOps repository / protected `staging` branch
- External Secrets Operator + approved SecretStore → Secrets Manager
- Private Amazon RDS PostgreSQL; roles `depp_app` (runtime) and `depp_migrator` (migrations Job — not in this skeleton)
- Auth0 staging tenant (or documented deferral blocking customer pilot)
- Route 53 + ACM + ALB HTTPS (future ingress slice)
- CloudWatch logging/metrics
- GitHub Actions OIDC + Trivy/Syft/Cosign pipeline (future CI slice)

## Replacing the image placeholder

1. Build/push api-gateway image to ECR; record source SHA and digest.
2. Pass scan/SBOM/sign gates from the decision record.
3. Edit `api-gateway-deployment.yaml` (or a future Kustomize image transformer) to:

   `image: <registry>/depp-api-gateway@sha256:<64-hex>`

4. Re-run `node scripts/validate-gitops-skeleton.cjs` (must still reject `:latest` and tag-only refs).
5. Promote via GitOps PR — do not `kubectl apply` from a laptop as the long-term path.

## Secret key mapping (names only — never values)

Target Secret name: `api-gateway-runtime`

| Key | Used by |
|---|---|
| `DATABASE_URL` | Runtime app role connection (`depp_app`) |
| `AUTH_MODE` | Must be `jwt` for staging evidence |
| `AUTH_EXPLICIT_ROLES_MODE` | Prefer `enforce` for staging evidence |
| `JWT_ACCESS_SECRET` | HS256 signing secret |
| `JWT_ISSUER` / `JWT_AUDIENCE` | Exact-match JWT claims |
| Optional OIDC_* | Only when `OIDC_ISSUER` enabled (all required together) |

`DATABASE_MIGRATION_URL` must **not** be mounted into the api-gateway runtime Secret.

Activate `templates/api-gateway-external-secret.yaml.template` only after ESO version confirmation and approved SecretStore name (no ARNs in git).

## Future network / ingress / DB egress

- Ingress/ALB: separate slice; Service remains ClusterIP here.
- Ingress-boundary traffic: namespace label `depp.blacknoix.io/role: ingress-boundary` (unused until created).
- RDS: fill `templates/network-policy-api-gateway-rds-egress.yaml.template` with an **approved** private CIDR or adopt SG-aware CNI policy — never broad internet egress.

## Future deployment evidence to retain

Source SHA, image digest, scan/SBOM/signature records, redacted GitOps revision, non-secret proof of secret injection, `/health` + `/ready` results, RBAC/tenant isolation pack, rollback to prior digest.

## Validate

```bash
node scripts/validate-gitops-skeleton.cjs
kubectl kustomize infra/gitops/staging   # optional offline render
```

## Explicit non-claims

This commit creates **no** AWS resource, EKS object apply, secret value, identity-provider tenant, network rule in AWS, scan, SBOM, signature, CI workflow, or staging deployment evidence. Local Compose remains unrelated local-dev infrastructure.
