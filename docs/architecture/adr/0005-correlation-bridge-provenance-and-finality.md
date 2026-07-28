# ADR-0005: Correlation Bridge Provenance and Single Finality Materializer

- Status: Accepted (amended 2026-07-29 — bridge-replacement slice)
- Date: 2026-07-28
- Depends on: ADR-0001 (tenancy), ADR-0004 (persistence), THREATEVENT contract
  (`docs/architecture/threat-event-contract.md`)

## Context

The gateway has two paths that can produce operator-visible findings:

1. **Agent-signed path (primary)** — `ThreatEventService.submitSigned`  
   Ed25519-verifies a THREATEVENT over v0 canonical bytes, then
   gossip → `FinalitySeam.finalize()` → insert or monotonically upgrade finding
   with `detection_source = "agent_signed"`. This is the intended steady-state
   path for correlation-based detections once agents emit signed events.

2. **Correlation bridge path (fallback)** — `ThreatEventService.submitFromDetection`  
   Server-side post-ingest / silence correlation builds a THREATEVENT-shaped
   envelope with a non-crypto bridge placeholder signature (gateway never holds
   agent private keys), then uses the same finality → finding flow when an
   **active** `device_identities` row exists. Materializes as
   `detection_source = "bridge_correlation"`.

Both paths share finality gating and the single materializer. Bridge remains
**transitional** and **tenant-flaggable**; it is not removed in the
bridge-replacement slice.

## Decision

### 1. Single finality-gated materializer (non-negotiable)

There is exactly one sanctioned function that may insert **or upgrade provenance
on** a row in `correlation_findings` as a result of THREATEVENT / correlation
evaluation: `materializeFindingAfterFinality`.

- **Invariant:** `insertFindingIgnoreDup` / `upgradeDetectionSourceMonotonic`
  for this flow MUST NOT be called except from that helper, and ONLY when the
  helper holds a `FinalizedEventProof` issued from a successful
  `FinalitySeam.finalize()` for the same `threatEventId` (intrinsic gate — not
  caller ordering alone).
- Correlation service, telemetry post-ingest hooks, silence evaluate, and routes
  MUST NOT insert findings directly.
- Fail closed: if finality rejects or errors, or the proof is missing/mismatched,
  no finding row is created and no provenance upgrade occurs.

### 2. Mandatory provenance label (non-negotiable)

| Path | Required `detection_source` value | Role |
|------|-----------------------------------|------|
| Agent-signed (`submitSigned`) | `"agent_signed"` | **Primary** |
| Correlation bridge (`submitFromDetection`) | `"bridge_correlation"` | **Fallback only** |

**Hard rules:**

1. **Signed findings must never be written as bridge provenance.**  
   `submitSigned` MUST never insert `detection_source = "bridge_correlation"`.

2. **Bridge findings must never carry signed-detection markers.**  
   Bridge materialization MUST NOT set signed-path provenance on insert, MUST NOT
   claim Ed25519 verification succeeded, and MUST NOT store a “verified
   signature” marker for the bridge placeholder.

3. **`detection_source = "bridge_correlation"`** is the **only** allowed
   provenance string for bridge inserts. No aliases.

4. **Do not invent a third write-path provenance label** unless forced by schema
   constraints. Historical `legacy_unspecified` remains read-only for old rows.

### 3. Monotonic provenance upgrade (bridge-replacement)

Finding uniqueness remains `(tenant_id, agent_id, rule_id, window_bucket)` —
one operator-visible finding per key.

Provenance is **monotonic**:

| Existing | Incoming path | Result |
|----------|---------------|--------|
| none | bridge | insert `bridge_correlation` |
| none | signed | insert `agent_signed` |
| `bridge_correlation` | signed | **upgrade** row to `agent_signed`; emit structured audit event `finding_detection_source_upgraded` |
| `agent_signed` | bridge | no-op (dedupe); **never downgrade** |
| same source | same source | no-op (dedupe) |

Threat events are path-scoped: unique on
`(tenant, agent, detection_rule_id, window_bucket, detection_source)` so a signed
event can finalize after a bridge event for the same correlation window.

### 4. Bridge remains temporary and tenant-gated

Until removal:

- Bridge still requires an **active** device identity for the agent.
- Bridge still uses the non-crypto placeholder signature.
- **Global** flag `CORRELATION_BRIDGE_ENABLED` (default on): when false, bridge
  is off for all tenants.
- **Per-tenant** denylist `CORRELATION_BRIDGE_DISABLED_TENANTS` (comma-separated
  UUIDs): when global is on, listed tenants skip bridge while signed correlation
  continues. Re-enabling bridge for a tenant must not rewrite existing
  `agent_signed` rows.
- When an `agent_signed` finding already covers the dedup key, bridge evaluation
  skips creating a weaker row (signed is primary).

### 5. Caller restriction

Only the correlation evaluation paths that already call `submitFromDetection`
may invoke the bridge. No new HTTP route may accept “bridge” submissions from
agents or operators. Agents submit only via `submitSigned` / `POST /v1/threat-events`.

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
- Deleting bridge code in this slice
- Ed25519-signing the bridge placeholder (gateway must not hold agent private keys)
- Introducing `canonicalVersion: 1` (separate contract bump)

## Consequences

### Positive

- Operators can distinguish bridge fallback from agent-attested detections.
- Signed coverage can take over a window without duplicate findings.
- Bridge can be disabled per tenant and re-enabled without schema rewrites of
  historical rows.

### Negative / costs

- Path-scoped `threat_events` uniqueness adds a small schema surface.
- Dual-path windows temporarily hold two threat_event rows (one per provenance).

## Migration / removal plan

### Narrowing slice (done)

Single materializer, `detection_source` on findings, cross-label rejection,
checklists.

### Bridge-replacement slice (this amendment)

1. Agent-signed correlation is primary; bridge is fallback.
2. Monotonic upgrade bridge → agent_signed with audit.
3. Tenant-aware bridge disablement + global flag preserved.
4. Path-scoped threat_event dedup so signed can finalize after bridge.

### Removal slice (later)

Preconditions: signed coverage for churn / burst / silence (or product accepts
dropping bridge coverage); no remaining production need for
`submitFromDetection`.

Steps:

1. Disable bridge globally and per remaining tenants; verify.
2. Delete or hard-error `submitFromDetection` and correlation wiring into it.
3. Stop writing `"bridge_correlation"` for new rows.
4. Retain historical `bridge_correlation` rows for audit; do not rewrite them
   wholesale to signed.
5. Supersede this ADR’s “keep bridge” clause when removal completes.

## Companion checklist

Executable test titles:
`docs/architecture/correlation-bridge-narrowing-checklist.md`
(plus bridge-replacement coverage in
`backend/api-gateway/tests/threat-events/bridge-replacement.test.ts`)
