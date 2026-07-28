# ADR-0005: Correlation Bridge Provenance and Single Finality Materializer

- Status: Accepted
- Date: 2026-07-28
- Depends on: ADR-0001 (tenancy), ADR-0004 (persistence), THREATEVENT contract
  (`docs/architecture/threat-event-contract.md`)

## Context

The gateway has two paths that can produce operator-visible findings:

1. **Agent-signed path** — `ThreatEventService.submitSigned`  
   Ed25519-verifies a THREATEVENT over v0 canonical bytes, then
   gossip → `FinalitySeam.finalize()` → insert finding.

2. **Correlation bridge path** — `ThreatEventService.submitFromDetection`  
   Server-side post-ingest / silence correlation builds a THREATEVENT-shaped
   envelope with a non-crypto bridge placeholder signature (gateway never holds
   agent private keys), then uses the same finality → finding flow when an
   **active** `device_identities` row exists.

Both paths already share finality gating in the happy path. The remaining gap is
**trust labeling and hard isolation of materialization**:

- Bridge-created findings can look like signed detections if provenance is absent
  or ambiguous.
- A future refactor could reintroduce a direct `insertFindingIgnoreDup` call that
  bypasses finality.
- Bridge and signed markers must not be interchangeable.

**Settled product decision:** keep the bridge for **one more implementation
slice**, but narrow it now so it cannot masquerade as a signed detection or
bypass finality. Remove or replace the bridge only after agent-signed detections
cover the same correlation rules.

## Decision

### 1. Single finality-gated materializer (non-negotiable)

There is exactly one sanctioned function that may insert a row into
`correlation_findings` as a result of THREATEVENT / correlation evaluation.

- Name (implementation target): a single private or package-local helper used by
  both `submitSigned` and `submitFromDetection` (today: the body of
  `persistThroughFinality` after `finality.finalize()` returns success).
- **Invariant:** `insertFindingIgnoreDup` (or any successor insert) for this
  flow MUST NOT be called except from that helper, and ONLY when the helper
  holds a `FinalizedEventProof` issued from a successful
  `FinalitySeam.finalize()` for the same `threatEventId` (intrinsic gate — not
  caller ordering alone).
- Correlation service, telemetry post-ingest hooks, silence evaluate, and routes
  MUST NOT insert findings directly.
- Fail closed: if finality rejects or errors, or the proof is missing/mismatched,
  no finding row is created.

### 2. Mandatory provenance label (non-negotiable)

Every finding materialized through this helper MUST carry an explicit detection
provenance value persisted with the finding (column or evidence-adjacent field —
implementation chooses storage; the **value** is normative).

| Path | Required `detection_source` value |
|------|-----------------------------------|
| Correlation bridge (`submitFromDetection`) | `"bridge_correlation"` |
| Agent-signed (`submitSigned`) | a signed-path value that is **not** `"bridge_correlation"` (e.g. `"agent_signed"`; exact signed enum fixed in the implementation slice) |

**Hard rules:**

1. **Signed findings must never show bridge provenance.**  
   `submitSigned` MUST never write `detection_source = "bridge_correlation"`.

2. **Bridge findings must never carry signed-detection markers.**  
   Bridge materialization MUST NOT set signed-path provenance, MUST NOT claim
   Ed25519 verification succeeded, and MUST NOT store a “verified signature”
   marker for the bridge placeholder.

3. **`detection_source = "bridge_correlation"`** is the **only** allowed
   provenance string for the bridge path. No aliases, no empty/default that
   could be read as signed.

### 3. Bridge remains temporary and gated

Until removal:

- Bridge still requires an **active** device identity for the agent (existing
  fail-closed behavior).
- Bridge still uses the non-crypto placeholder signature; it is **not**
  Ed25519-attested detection.
- Optional feature flag (recommended in the narrowing slice): when off, bridge
  skips materialization entirely (no finding, no pretending success as signed).
  Flag name is an implementation detail; behavior when off is tested (see
  checklist).

### 4. Caller restriction

Only the correlation evaluation paths that already call `submitFromDetection`
may invoke the bridge. No new HTTP route may accept “bridge” submissions from
agents or operators. Agents submit only via `submitSigned` / `POST /v1/threat-events`.

### 5. Tenant isolation and idempotency unchanged in meaning

- All reads/writes remain under `withTenantTransaction` / RLS (ADR-0001 / 0004).
- Dedup remains `(tenant_id, agent_id, rule_id|detection_rule_id, window_bucket)`
  for threat_events and findings; duplicate submits must not create duplicate
  findings.
- **First-writer provenance:** when a finding already exists for that dedup key,
  a later submit (bridge or signed) does not insert a second row and does **not**
  upgrade or rewrite `detection_source` — the first writer's label is retained.

### 6. Audit presence

Bridge and signed materialization MUST leave distinguishable audit/log signals
(structured lifecycle logs and/or persisted provenance) so an operator or auditor
can tell which path created a finding. Provenance on the finding row is the
primary durable signal; logs are secondary.

## Non-goals

- CometBFT / ledger consensus
- libp2p / gossipsub production networking
- Findings UI changes (beyond what API fields already expose)
- Response actions / remediation
- Replacing correlation rules with agent-side detection in this slice
- Ed25519-signing the bridge placeholder (explicitly rejected: gateway must not
  hold agent private keys)
- Introducing `canonicalVersion: 1` (separate contract bump)

## Consequences

### Positive

- Bridge cannot silently look like agent-attested detection if provenance is
  enforced and tested.
- Finality bypass becomes a concrete, reviewable invariant (single materializer).
- Removal of the bridge later is a delete of one labeled path, not an archaeology
  exercise.

### Negative / costs

- Schema or evidence shape must carry `detection_source` (small migration or
  evidence key — implementation chooses).
- Existing bridge-created findings (if any) may lack provenance until backfill
  or “unknown” handling is defined; prefer fail-closed for **new** writes only
  in the narrowing slice unless a one-shot backfill is explicitly added.
- Feature flag (if used) adds a config surface.

### Risks if ignored

- Operators and future TRD consumers treat bridge findings as cryptographic
  attestations.
- A second insert path reappears and skips finality.

## Migration / removal plan

### Narrowing slice (immediate next implementation)

1. Enforce single materializer (refactor if needed; no second insert site).
2. Persist `detection_source`:
   - bridge → `"bridge_correlation"`
   - signed → non-bridge signed value
3. Reject / assert in code that the two labels cannot cross.
4. Add tests from the companion checklist.
5. Document bridge as temporary in `threat-event-contract.md` with a pointer to
   this ADR.

### Removal slice (later)

Preconditions:

- Agent-signed (or other attested) detections cover churn / burst / silence (or
  product accepts dropping bridge coverage).
- No remaining caller of `submitFromDetection` except a deprecated stub.

Steps:

1. Feature-flag bridge off in all environments; verify no finding regressions
   that product still requires.
2. Delete or hard-error `submitFromDetection` and correlation wiring into it.
3. Stop writing `"bridge_correlation"` for new rows.
4. Optionally retain historical rows with `detection_source = "bridge_correlation"`
   for audit; do not rewrite them to signed provenance.
5. Supersede or amend this ADR’s “keep bridge” clause via a new ADR when removal
   completes.

## Companion checklist

Executable test titles:
`docs/architecture/correlation-bridge-narrowing-checklist.md`
