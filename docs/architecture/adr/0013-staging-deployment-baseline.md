# ADR-0013: Staging deployment baseline

- Status: Proposed
- Date: 2026-08-14
- Depends on: ADR-0001, ADR-0002, ADR-0004, ADR-0011

## Context

DEPP needs a staging deployment baseline that separates **source packaging**
from **environment proof**. Local JWT/`enforce` verification and unit/dbtest
suites are useful for development confidence, but they are not staging,
production, IdP, scan, SBOM, Kubernetes, or database-readiness evidence.

Operators and reviewers need an explicit decision record for what “staging
deployment baseline” means in this repository so container packaging and
related docs can land without over-claiming deployability.

## Decision

### What this baseline covers

1. **Documented staging control intent** — staging must run verified auth
   (`AUTH_MODE=jwt`) with explicit human role mode set to `enforce` after
   issuer/role readiness (see ADR-0011 and
   `docs/runbooks/explicit-roles-enforce-rollout.md`). Staging evidence capture
   for enforce + alert spine remains the separate runbook
   `docs/runbooks/staging-enforce-alert-evidence.md`.
2. **Source-level production container packaging for api-gateway** — a
   multi-stage Dockerfile under `backend/api-gateway/` (build context =
   `backend/api-gateway`) intended to produce a runtime image that:
   - runs Node from compiled `dist/`
   - is configured to run as the non-root `node` user
   - uses `node` as PID 1 via `CMD ["node","dist/index.js"]` so existing
     process `SIGTERM`/`SIGINT` shutdown handlers can run when an orchestrator
     stops the container
3. **Local dist smoke** — `npm run smoke:dist` validates that the compiled
   artifact boots far enough to answer `/health` without claiming container,
   staging, or database readiness.
4. **Evidence honesty** — the enterprise-readiness control matrix
   (`docs/architecture/enterprise-readiness-control-matrix.md`) tracks control
   status. No control is **Complete** without a direct evidence link whose
   scope matches the claim (local vs staging vs production vs IdP).

### What this baseline explicitly does **not** claim

Landing this ADR (and related packaging commits) does **not** by itself prove:

- local Docker image production success
- non-root execution at runtime, or PID-1 SIGTERM behavior under Docker
- registry publication, digest pinning, provenance, SBOM, or image scanning
- database connectivity, migrations, or readiness probes as a deploy gate
- staging or production deployment
- Kubernetes / platform hardening
- external-IdP validation
- secret injection / non-local role provisioning completeness

Those require separate evidence lineages. Outside-repo verifiers are tooling
only until they succeed against a reviewed committed tree and produce scoped
artifacts.

### Relationship to ADR-0012

ADR-0012 (evidence-bundle integrity / runner integrity / five-path validation)
is a **separate** reserved lineage. It must not be created, copied, staged, or
committed as part of container-baseline packaging work.

### Local evidence already on record (scope-limited)

`local-jwt-enforce-20260813-193009` is immutable **local** controlled-issuer
JWT/`enforce` evidence for commit `2ba2bc11dac03b7b8fc0ad346f71eb3c5b49aa6c`
under the pre-ADR-0012 runner. It is not staging, production, IdP, or
container evidence.

## Consequences

- Packaging and docs for a container baseline may land under this ADR’s
  constraints without implying staging cutover.
- Reviewers must reject Complete / staging / production claims that cite only
  local suites or un-run Docker tooling.
- Future slices (readiness HTTP semantics as a deploy gate, secret injection,
  non-local role provisioning, scan/provenance, chart cutover) need their own
  ADRs or evidence updates—do not silently expand this baseline.

## Related

- `docs/architecture/enterprise-readiness-control-matrix.md`
- `docs/runbooks/staging-enforce-alert-evidence.md`
- `docs/runbooks/explicit-roles-enforce-rollout.md`
- ADR-0002, ADR-0003, ADR-0011
