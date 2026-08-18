# Local PostgreSQL Backup/Restore Recovery Drill

**Scope:** local disposable-Postgres operational evidence only (vertical-slice criterion 7).

**Non-claims:** This drill is **not** staging or production recovery evidence. It does **not** establish RPO/RTO, HA, managed-backup validation, disaster-recovery certification, Kubernetes/platform readiness, scan/provenance, or external-IdP proof.

## Preconditions

1. Repository tip includes the tenant-isolation / immutable-audit vertical slice (`tests/db/tenant-isolation-immutable-audit.dbtest.ts`).
2. Docker is available and the disposable Compose Postgres fixture is running:

   ```bash
   docker compose -f infra/docker-compose.yml up -d
   ```

3. Fixture identity (hard-gated by the script):
   - Compose file: `infra/docker-compose.yml`
   - Service: `postgres`
   - Container: `depp-postgres`
   - Volume: `depp-postgres-data`
   - Image family: `postgres:17`
   - Database name: `depp`
   - App role: `depp_app` (from `backend/api-gateway/tests/test.env`)
   - Migrator role: `depp_migrator`
   - Host must be loopback (`localhost` / `127.0.0.1` / `::1`)
4. From `backend/api-gateway`: dependencies installed (`npm ci`).

The drill **refuses** to run if the safety check fails (wrong host, wrong DB name, missing disposable container/volume, etc.).

## Command

From `backend/api-gateway`:

```bash
npm run recovery:local-postgres
```

Equivalent:

```bash
node ../../scripts/local-postgres-recovery-drill.cjs
```

Optional evidence root override (directory must be outside the git repo):

```bash
# PowerShell example
$env:DEPP_RECOVERY_EVIDENCE_ROOT="C:\Users\Dell\Downloads\depp-local-recovery-drill"
npm run recovery:local-postgres
```

## What is backed up and restored

| Step | Action |
|---|---|
| Migrate | `migrate:latest` on disposable `depp` |
| Pre-check | Run `tenant-isolation-immutable-audit.dbtest.ts` on `depp` |
| Seed | Application/test paths create Tenant A auth_failure burst → alert + `alert_created` audit (identifiers only written to state JSON) |
| Backup | `pg_dump -Fc` of database `depp` inside `depp-postgres` |
| Restore target | New disposable database `depp_recovery_drill` (created/dropped by the drill) |
| Restore | `pg_restore` into `depp_recovery_drill` |
| Verify | Post-restore seed/verify script asserts criteria 1–6 on **restored rows**, then re-runs the vertical-slice dbtest against the restore DB |
| Original fixture | Re-runs vertical-slice dbtest against original `depp` |
| Cleanup | Drops `depp_recovery_drill`, deletes dump files (host + container tmp) |

## Post-restore validation

The verifier covers:

1. Cross-tenant fail-closed (Tenant B list empty; detail → non-oracular `ALERTS_NOT_FOUND`)
2. Allowed same-tenant operator read succeeds
3. Denied agent RBAC remains leak-safe (`ALERTS_REJECTED`; no secrets in bodies)
4. Restored `alert_audit_events` remain tenant-bound (`alert_created`)
5. `depp_app` cannot `UPDATE`/`DELETE` restored audit rows
6. Restored Tenant A alert remains Tenant-A-only on `GET /v1/alerts`

Then the existing `tenant-isolation-immutable-audit.dbtest.ts` suite is executed against the restored database (proves schema/grants/routes on the restore target).

## Artifacts and cleanup

- Default artifact directory (outside the repository):

  `~/Downloads/depp-local-recovery-drill/recovery-drill-<timestamp>/`

- Retained: `report.json` (redacted outcomes + fixture metadata) and `state-identifiers.json` (UUIDs only).
- Deleted on success/failure paths: binary `depp.dump` and container `/tmp/depp-recovery-drill.dump`.
- Never commit dumps, connection strings, passwords, or tokens.

## Failure behavior

The command exits non-zero if safety check, migrate, backup, restore, verification, vertical-slice re-run, or cleanup fails. Cleanup is attempted on failure; incomplete cleanup is itself a failure.

## Related evidence

- Vertical-slice tests (criteria 1–6): `backend/api-gateway/tests/db/tenant-isolation-immutable-audit.dbtest.ts`
- Control matrix: `docs/architecture/enterprise-readiness-control-matrix.md` (local citation only; not Done for staging/production)
