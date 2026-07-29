# ADR-0005: Correlation Bridge Provenance and Single Finality Materializer

- Status: Accepted (amended 2026-07-29 — **final bridge deletion complete**)
- Date: 2026-07-28
- Depends on: ADR-0001 (tenancy), ADR-0004 (persistence), THREATEVENT contract
  (`docs/architecture/threat-event-contract.md`)

## Context

Operator-visible correlation findings are produced by a single live path:

1. **Agent-signed path (only live write path)** — `ThreatEventService.submitSigned`
   Ed25519-verifies a THREATEVENT over v0 canonical bytes, then
   gossip → `FinalitySeam.finalize()` → insert or monotonically upgrade finding
   with `detection_source = "agent_signed"`.

The former **correlation bridge** (`ThreatEventService.submitFromDetection` and
gateway post-ingest / silence materialization into `bridge_correlation`) has
been **deleted**. Coverage-gated disablement was the transitional removal
mechanism; those runtime controls no longer exist. Historical
`bridge_correlation` rows remain valid, readable audit history.

## Decision

### 1. Single finality-gated materializer (non-negotiable)

There is exactly one sanctioned function that may insert **or upgrade provenance
on** a row in `correlation_findings` as a result of THREATEVENT evaluation:
`materializeFindingAfterFinality`.

- **Invariant:** `insertFindingIgnoreDup` / `upgradeDetectionSourceMonotonic`
  for this flow MUST NOT be called except from that helper, and ONLY when the
  helper holds a `FinalizedEventProof` issued from a successful
  `FinalitySeam.finalize()` for the same `threatEventId` (intrinsic gate — not
  caller ordering alone).
- Correlation service, telemetry post-ingest hooks, silence evaluate, and routes
  MUST NOT insert findings directly.
- Fail closed: if finality rejects or errors, or the proof is missing/mismatched,
  no finding row is created and no provenance upgrade occurs.

### 2. Provenance labels

| Path | `detection_source` | Role |
|------|--------------------|------|
| Agent-signed (`submitSigned`) | `"agent_signed"` | **Only live write path** |
| Historical bridge rows | `"bridge_correlation"` | **Read / upgrade-from only** |

**Hard rules:**

1. **Signed findings must never be written as bridge provenance.**  
   `submitSigned` MUST never insert `detection_source = "bridge_correlation"`.

2. **No new bridge-originated findings.** Live code MUST NOT materialize
   `bridge_correlation`. The enum/check value is retained solely so existing
   rows remain readable and so signed submissions may still upgrade them.

3. **Do not invent a third write-path provenance label** unless forced by schema
   constraints. Historical `legacy_unspecified` remains read-only for old rows.

4. **Historical `bridge_correlation` rows remain valid and readable.** Deletion
   of the live bridge path never rewrites or deletes history, and never
   downgrades `agent_signed`.

5. **No wholesale migration** of `bridge_correlation` → `agent_signed`. Upgrades
   happen only when a later signed event finalizes for the same dedup key.

### 3. Monotonic provenance upgrade

Finding uniqueness remains `(tenant_id, agent_id, rule_id, window_bucket)` —
one operator-visible finding per key.

Provenance is **monotonic**:

| Existing | Incoming path | Result |
|----------|---------------|--------|
| none | signed | insert `agent_signed` |
| `bridge_correlation` | signed | **upgrade** row to `agent_signed`; emit structured audit event `finding_detection_source_upgraded` |
| `agent_signed` | signed | no-op (dedupe); **never downgrade** |

Threat events remain path-scoped on
`(tenant, agent, detection_rule_id, window_bucket, detection_source)` so a signed
event can finalize after a historical bridge event for the same correlation
window. New `bridge_correlation` threat_event inserts from application code are
not permitted.

### 4. Bridge write path deleted (final deletion slice)

Completed:

1. Deleted `submitFromDetection` and all correlation → threat-event bridge wiring.
2. Deleted coverage-gating helpers, repository coverage queries, and all
   `CORRELATION_BRIDGE_*` env / operator list controls.
3. Gateway correlation evaluation may still run for snooze / observability but
   MUST NOT materialize findings (logs `correlation_bridge_write_path_deleted`).
4. Schema retains `bridge_correlation` as a check/enum value for historical rows.
5. Operators cannot re-enable the bridge; there is no force-enable or global
   bridge flag left.

### 5. Caller restriction

Agents submit only via `submitSigned` / `POST /v1/threat-events`. There is no
HTTP or internal API that accepts bridge submissions.

### 6. Tenant isolation and audit

- All reads/writes remain under `withTenantTransaction` / RLS (ADR-0001 / 0004).
- Provenance on the finding row is the primary durable signal.
- Provenance upgrades MUST emit an explicit structured lifecycle log
  (`finding_detection_source_upgraded` with `from` / `to` / `findingId` /
  `threatEventId`) so upgrades are queryable in log pipelines.

## Non-goals

- CometBFT / ledger consensus
- libp2p / gossipsub production networking
- Findings UI changes
- Response actions / remediation
- Deleting historical `bridge_correlation` rows or the schema check value
- Wholesale rewrite of historical bridge rows to `agent_signed`
- Introducing `canonicalVersion: 1` (separate contract bump)
- Broad analytics / metrics platform

## Consequences

### Positive

- Single live ingestion path; no fallback ambiguity or bridge control surface.
- Operators can still distinguish historical bridge rows from agent-attested
  detections via `detection_source`.
- Signed coverage can still upgrade a historical bridge window without duplicate
  findings.

### Negative / costs

- Path-scoped `threat_events` uniqueness remains for historical dual-path rows.
- Gateway-only correlation rules no longer create operator findings until agents
  emit signed THREATEVENTs for those detections.

## Migration history

### Narrowing / replacement / coverage-gated removal (done)

Documented in prior amendments. Bridge was primary→fallback→coverage-disabled
before this deletion.

### Final deletion slice (this amendment — done)

1. Live bridge submission deleted end-to-end.
2. Coverage gating and bridge env flags removed.
3. Historical `bridge_correlation` retained as valid readable history.
4. Signed path + single finality materializer unchanged.
5. Deletion-era suite:
   `backend/api-gateway/tests/threat-events/bridge-deleted.test.ts`

## Companion docs

- Contract: `docs/architecture/threat-event-contract.md`
- Post-deletion notes: `docs/architecture/correlation-bridge-narrowing-checklist.md`
