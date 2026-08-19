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
| Fail-closed guard | Job `non-operational-guard` runs **outside** GitHub Environment `staging`, performs **no** AWS authentication, and rejects placeholders before the cloud job starts |
| Protected environment | Job `supply-chain` is bound to GitHub Environment **`staging`** (`environment: staging`). Required reviewer approval gates that job before OIDC can authenticate to AWS |
| OIDC trust subject (expected) | `repo:blacknoix/blacknoix-depp:environment:staging` |
| Execute confirm | Requires `I_UNDERSTAND_THIS_PUSHES_TO_ECR` in addition to founder approval |
| GitOps | Echo-only reminder; no `kubectl` / `helm` / `argocd` / Terraform |

Docker build context (discovered): `backend/api-gateway` with `backend/api-gateway/Dockerfile`.
Deploy rule (unchanged): GitOps must use `repository@sha256:<digest>`, never a tag / never `latest`.

**Authorization boundary:** Environment approval is a CI gate only. It is **not** evidence of an ECR push, scan, signing, provenance, or Kubernetes deployment. Real IAM role ARNs, ECR repository URIs, AWS account IDs, access keys, and secrets must **never** be committed to this repository.

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

### Trivy GitHub Action pin

Workflow uses an **immutable commit SHA** (not a floating tag):

`aquasecurity/trivy-action@57a97c7e7821a5776cebc9bb87c984fa69cba8f1` (reviewed as v0.35.0)

Do **not** use `@latest`, branch refs, or mutable version tags (e.g. `@0.28.0`) for this action.

### First controlled run — action-resolution failure (not scan evidence)

| Field | Record |
|---|---|
| GitHub Actions run ID | `32265431591` |
| Source commit | `d654efb61c8e887044256815d5aa464b04e7725a` |
| Guard | Passed |
| Environment `staging` | Gated and manually approved |
| Failure class | Pre-execution external-action resolution |
| Error (redacted class) | Unable to resolve `aquasecurity/trivy-action@0.28.0` (version not found) |

**Non-claims for run `32265431591`:** This is **not** an image vulnerability finding, ECR push failure, AWS IAM failure, Docker build failure, SBOM/signing/provenance failure, or deployment attempt. No ECR image, scan result, SBOM, signature, provenance, retained supply-chain artifact, or deployment outcome is established by that failed run.

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
5. Trust policy with **exact** org/repo and environment subject `repo:blacknoix/blacknoix-depp:environment:staging`, plus `aud=sts.amazonaws.com` (sample template below — placeholders only for account ID).
6. ECR repository policy allowing that role to push/pull as required.
7. GitHub Environment **`staging`** with required reviewers (workflow already binds `supply-chain` via `environment: staging`; creating/protecting the environment remains console work).
8. Protected branches / rulesets for `main` (and GitOps `staging` when that repo exists).
9. Repository Actions permissions reviewed (OIDC token, artifacts, attestations).
10. Action version review (checkout, setup-node, aws-actions, **trivy-action at immutable commit SHA**, cosign, attest, upload-artifact).
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
          "token.actions.githubusercontent.com:sub": "repo:blacknoix/blacknoix-depp:environment:staging"
        }
      }
    }
  ]
}
```

**Warning:** Replace `<AWS_ACCOUNT_ID>` only. Do not apply until peer-reviewed in the dedicated non-prod account. Never commit a filled policy with a real account ID to this application repository; prefer AWS-side storage. Environment approval does not prove ECR push, scan, signing, or deployment.

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
