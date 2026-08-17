# GitOps staging skeleton (repository-only)

**Purpose:** Non-deployable Kubernetes/Kustomize source structure for the future
DEPP api-gateway staging environment, aligned with the founder-recorded pilot
baseline in `docs/architecture/staging-platform-decision-record.md`.

**This tree is intentionally non-deployable.** Applying it without replacing
placeholders and without approved AWS/EKS/ECR/ESO/RDS/Auth0 prerequisites is
unsafe and unsupported.

## What is active vs template-only

| Path | In `kustomization.yaml`? | Notes |
|---|---|---|
| `staging/*.yaml` (except noted) | Yes | Namespace, quota, SA, NetworkPolicies, Deployment, Service |
| `staging/templates/` | No | ExternalSecret contract + RDS egress sketch — require platform decisions |

## Why there is no Role / RoleBinding

The api-gateway workload does not call the Kubernetes API. A dedicated
ServiceAccount is still created (identity boundary for future IRSA / workload
identity). Granting decorative `get/list/watch` RBAC would widen the attack
surface without a repository requirement. Add Role/RoleBinding only when a
proven runtime need appears.

## Image policy

- Placeholder in Deployment: `REPLACE_WITH_ECR_IMAGE_AT_DIGEST`
- At promotion time, replace with an **immutable ECR digest** only, e.g.
  `123456789012.dkr.ecr.ap-south-1.amazonaws.com/depp-api-gateway@sha256:…`
  (account/region are examples of the *form*; do not commit real account IDs).
- **Never** deploy a mutable floating tag (for example the conventional latest tag) or a tag-only reference.

## Validate (offline)

From the repository root:

```bash
node scripts/validate-gitops-skeleton.cjs
```

Optional render (local kubectl only; does not contact a cluster):

```bash
kubectl kustomize infra/gitops/staging
```

## Related docs

- [aws-eks-gitops-skeleton runbook](../../docs/runbooks/aws-eks-gitops-skeleton.md)
- [staging-platform-decision-record](../../docs/architecture/staging-platform-decision-record.md)
