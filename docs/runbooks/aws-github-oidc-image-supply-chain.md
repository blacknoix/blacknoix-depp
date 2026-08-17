# AWS / GitHub OIDC Image Supply-Chain Skeleton

**Scope:** repository workflow contract for future staging image build → scan → SBOM → sign → ECR push.
**Workflow:** `.github/workflows/staging-image-supply-chain.yml`
**Status:** **INTENTIONALLY NON-OPERATIONAL** until founder completes manual setup and supplies non-placeholder `workflow_dispatch` inputs.

---

## Explicit non-claims

This commit does **not**:

- create or configure an AWS account, IAM role, OIDC provider, or ECR repository;
- create a GitHub Environment, repository secret, or variable;
- build, push, scan, sign, or attest any image;
- deploy to EKS/Argo CD or modify `infra/gitops` placeholders;
- prove tenant isolation, IdP, RDS, or Secrets Manager in staging.

Local container/readiness/isolation/recovery evidence remains **local-only**.

---

## Purpose and default-disabled behavior

| Behavior | Detail |
|---|---|
| Trigger | `workflow_dispatch` only (no `push` / no `pull_request_target`) |
| Default inputs | All critical fields are `REPLACE_*` or `NO` |
| Fail-closed guard | Job `non-operational-guard` runs **before** AWS OIDC and rejects placeholders |
| Execute confirm | Requires `I_UNDERSTAND_THIS_PUSHES_TO_ECR` in addition to founder approval |
| GitOps | Echo-only reminder; no `kubectl` / `helm` / `argocd` / Terraform |

Docker build context (discovered): `backend/api-gateway` with `backend/api-gateway/Dockerfile`.
Deploy rule (unchanged): GitOps must use `repository@sha256:<digest>`, never a tag / never `latest`.

---

## Ordered future gates (encoded in workflow)

1. Fail-closed input/placeholder guard
2. `npm ci`
3. `npm run typecheck`
4. `npm run typecheck:test`
5. `npm run test:unit`
6. `test:db` **skipped** until a safe CI Postgres fixture exists
7. Local `docker build` (api-gateway Dockerfile)
8. Trivy image scan (Critical/High with fix)
9. Policy enforcement (Critical always block; High block unless complete exception)
10. Syft CycloneDX SBOM
11. ECR push
12. Immutable digest capture
13. Cosign keyless sign (GitHub OIDC)
14. Build provenance attestation
15. Artifact upload (scan/SBOM/digest summary; pilot retention **180 days**, subject to GitHub plan limits)
16. GitOps promotion PR — **later, separate slice**

Remote ECR enhanced scanning (decision record) **complements** this pipeline; it does not replace local/CI Trivy or local container verification evidence.

---

## Scan / exception policy

| Severity | Rule |
|---|---|
| Critical with available fix | **Always block** promotion |
| High with available fix | **Block** unless all of: `high_vuln_exception_approved=YES`, non-empty reason, future UTC `YYYY-MM-DD` expiry, `FOUNDER_ACK_HIGH_EXCEPTION`, and an uploaded exception record |
| Incomplete exception | **Fail closed** |

No hidden bypass inputs.

---

## Manual setup checklist (founder / console — not this commit)

Complete before a successful non-placeholder run:

1. Dedicated AWS **non-production** account; region `ap-south-1` (or approved residency).
2. Private **ECR** repository for api-gateway.
3. GitHub OIDC identity provider in that AWS account.
4. Least-privilege IAM role for this repository only (see permission categories below).
5. Trust policy with **exact** org/repo, protected ref, protected environment, `aud=sts.amazonaws.com` (sample template below — placeholders only).
6. ECR repository policy allowing that role to push/pull as required.
7. GitHub **protected environment** (e.g. `staging-image-supply-chain`) with required reviewers — then optionally wire `environment:` into the workflow in a follow-up edit.
8. Protected branches / rulesets for `main` (and GitOps `staging` when that repo exists).
9. Repository Actions permissions reviewed (OIDC token, artifacts, attestations).
10. Action version review (checkout, setup-node, aws-actions, trivy, cosign, attest, upload-artifact).
11. AWS Budgets alerts under the USD 250/month staging cap.
12. Confirm synthetic-data-only staging classification.

---

## Minimum IAM permission categories (no account IDs / ARNs)

Allow approximately:

- ECR authorization token
- ECR layer upload / initiate / complete
- ECR image put/upload/manifest
- ECR image/metadata describe/get (read back digest)

Do **not** grant: EKS API, RDS, Secrets Manager, IAM write, Route 53, ACM, broad `AdministratorAccess`, or wildcard resource on unrelated accounts.

---

## Sample IAM trust policy (PLACEHOLDERS ONLY — do not apply as-is)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<AWS_ACCOUNT_ID>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<GITHUB_REPO>:environment:<GITHUB_ENVIRONMENT>"
        },
        "StringLike": {
          "token.actions.githubusercontent.com:sub": "repo:<GITHUB_ORG>/<GITHUB_REPO>:ref:<PROTECTED_REF>"
        }
      }
    }
  ]
}
```

**Warning:** Replace every `<…>` placeholder, remove contradictory conditions after choosing environment **or** ref binding (prefer environment + ref together per AWS/GitHub guidance), peer-review, and apply only in the dedicated non-prod account. Never commit a filled policy with a real account ID to this application repository if it can be avoided; prefer AWS-side storage.

---

## Evidence to retain after a future successful run

- Source commit SHA
- Workflow run URL / ID
- ECR image URI + **digest**
- Trivy report artifact
- Exception record artifact (if any)
- CycloneDX SBOM
- Cosign / provenance attestation references
- ECR enhanced scan result (console/API later)
- Later: GitOps PR replacing `REPLACE_WITH_ECR_IMAGE_AT_DIGEST`
- Later: deployment `/health` + `/ready` + vertical-slice staging pack

**Rule:** a green image workflow is **not** Kubernetes deployment proof, RDS/secret proof, IdP proof, or tenant-isolation staging proof.

## Retention / rollback

- Deployed digests: retain **180 days** (pilot).
- Non-deployed images: retain **30 days**.
- Do not delete an image digest still referenced by a deployed GitOps revision.

---

## Offline validation

```bash
node scripts/validate-image-supply-chain-skeleton.cjs
```

---

## Explicit confirmation

No cloud identity, registry, image, scan, SBOM, signature, provenance artifact, GitHub environment, or deployment was created by publishing this skeleton.
