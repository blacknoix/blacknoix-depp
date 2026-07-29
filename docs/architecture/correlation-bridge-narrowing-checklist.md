# Correlation bridge — post-deletion notes

Companion to [ADR-0005](adr/0005-correlation-bridge-provenance-and-finality.md).

**Status:** Final bridge deletion is complete. The live correlation-bridge write
path, coverage gating, and `CORRELATION_BRIDGE_*` controls are gone. This file
is retained as operational notes + the historical narrowing title archive; it is
**not** a runbook for re-enabling the bridge.

## Current operational facts

1. **Only live write path:** `POST /v1/threat-events` → `submitSigned` → finality
   → `materializeFindingAfterFinality` with `detection_source = agent_signed`.
2. **No bridge re-enable.** There is no global flag, force-enable list, denylist,
   coverage threshold, or soak control. Operators cannot restore bridge writes
   without a code change.
3. **Historical rows:** Existing `bridge_correlation` findings and threat_events
   remain valid, RLS-scoped, and audit-visible. Do not bulk-rewrite them to
   `agent_signed`.
4. **Upgrades only:** A later signed event for the same
   `(tenant, agent, rule, window_bucket)` may upgrade
   `bridge_correlation` → `agent_signed` (audited
   `finding_detection_source_upgraded`). Never downgrade.
5. **Gateway correlation:** Post-ingest / silence evaluation may still run for
   snooze short-circuit and observability, but must not materialize findings.
6. **Schema:** Keep the `bridge_correlation` check/enum value while historical
   rows exist.

## Deletion-era test suite

Executable proofs live in:

`backend/api-gateway/tests/threat-events/bridge-deleted.test.ts`

That suite covers: absence of `submitFromDetection` / bridge env / coverage
helpers; signed submit still works; historical bridge rows readable; monotonic
upgrade; no runtime consultation of bridge gating; materializer proof gate for
signed flow.

Related dbtests:

- `tests/db/threat-events.dbtest.ts` — signed materialize + historical bridge
  readability / tenant isolation
- `tests/db/correlation.dbtest.ts` — gateway correlation no longer writes findings

## Historical narrowing titles (archive)

The following titles governed earlier slices (narrowing / replacement /
coverage-gated removal). They are **not** active requirements for reintroducing
bridge writes. Kept for audit trail of what was proven before deletion.

### Finality gate

1. bridge materialization does not insert a finding when finality.finalize returns failure
2. signed materialization does not insert a finding when finality.finalize returns failure
3. finding insert is not invoked before finality.finalize resolves successfully
4. finality rejection leaves threat_events in a terminal non-finalized state without a finding_id

### Provenance / monotonicity

16–21. provenance integrity across bridge vs signed labels
22–24b. idempotency and upgrade / no-downgrade
(see ADR-0005 for the retained live rules: signed-only inserts + upgrade-from-bridge)

### Transitional controls (removed)

28–31. flag-off behavior
coverage auto-disable / force-enable / soak / threshold

These controls no longer exist in env or runtime. Do not document rollback-via-
force-enable; that path was deleted with the bridge.
