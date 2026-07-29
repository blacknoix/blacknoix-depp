# THREATEVENT contract (Phase 0/1)

Status: Draft toward TRD. Not yet CometBFT / libp2p / Rust agent.
ADR-0005 final bridge deletion is complete: signed correlation is the only live
write path; historical `bridge_correlation` rows remain valid readable history.

## Flow

```
agent credential → JWT
  → POST /v1/agents/:agentId/device-identity (Ed25519 pubkey self-bind)

agent-signed correlation / detection (ONLY LIVE WRITE PATH)
  → POST /v1/threat-events
  → parse envelope → Ed25519 verify vs device_identities.public_key_ed25519
  → ThreatEventService.submitSigned
  → persist pending (detection_source=agent_signed) → gossip → finality
  → materializeFindingAfterFinality → finding agent_signed
     (or upgrade existing historical bridge_correlation → agent_signed)

gateway correlation evaluation (NO MATERIALIZATION)
  → may still evaluate rules / honor snooze
  → MUST NOT call threat-event submission or insert findings
  → logs correlation_bridge_write_path_deleted when a candidate would formerly bridge
```

## Invariants

1. Operator-visible findings are created only after `FinalitySeam.finalize()` returns success.
2. `finality_state` transitions: `pending` → `finalized` | `rejected` | `analyst_review` (no reverse).
3. Agent bind requires authenticated agent principal; path `agentId` must match.
4. Agent-signed submit requires an **active** device identity and a valid Ed25519
   signature over canonical bytes (signature field excluded).
5. Missing / revoked / mismatched identity or bad signature fails closed before finality.
6. **Live bridge submission is deleted.** There is no `submitFromDetection`, no
   bridge HTTP entrypoint, and no `CORRELATION_BRIDGE_*` runtime controls.
   Coverage gating was transitional only and is no longer consulted. New findings
   use `detection_source = "agent_signed"` only. Historical
   `bridge_correlation` rows remain valid and queryable; they are never rewritten
   wholesale to signed and never downgraded from.
7. Detection findings are inserted or provenance-upgraded only by the single
   finality-gated materializer (`materializeFindingAfterFinality`), which
   requires an intrinsic finality proof from a successful `finalize()`. See
   ADR-0005.
8. Provenance is **monotonic** for the finding key
   `(tenant, agent, rule, window_bucket)`:
   - historical `bridge_correlation` may upgrade to `agent_signed` when a later
     signed path succeeds (audited via `finding_detection_source_upgraded`).
   - `agent_signed` never downgrades.
   - Same-source repeats dedupe without a second finding.
9. `threat_events` dedup remains path-scoped:
   `(tenant, agent, detection_rule_id, window_bucket, detection_source)` so a
   signed event may still finalize after a historical bridge event for the same
   correlation window. Application code must not insert new
   `bridge_correlation` threat events.

## Canonical signing bytes (normative — v0)

This section is the cross-implementation signing contract. Agents (including a
future Rust Windows agent) MUST produce the same bytes the gateway verifies.

**Gateway source of truth:** `canonicalThreatEventBytes` in
`backend/api-gateway/src/threat-events/signature.ts`. The gateway verifies the
**exact** UTF-8 bytes returned by that function via
`verifyThreatEventSignature` → Node `crypto.verify` (Ed25519).

**Versioning:** The current signed payload has **no** `canonicalVersion` field.
That behavior is the **v0** contract. A follow-up bump will introduce
`canonicalVersion: 1` inside the signed JSON; until then, implementations MUST
match v0 exactly as specified below.

### Signed payload field order (v0)

The signed JSON object MUST contain exactly these keys, in this order
(JavaScript object-literal / `JSON.stringify` key order). The `signature` field
MUST NOT appear in the signed payload.

1. `kind`
2. `tenantId`
3. `agentId`
4. `deviceIdentityId`
5. `detectionRuleId`
6. `title`
7. `severity`
8. `evidence`
9. `windowStart`
10. `windowEnd`
11. `windowBucket`
12. `occurredAt`
13. `signedAt`

Illustrative shape (values are examples; types/rules below are normative):

```json
{
  "kind": "THREATEVENT",
  "tenantId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "agentId": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  "deviceIdentityId": "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  "detectionRuleId": "agent.heartbeat_burst",
  "title": "Agent heartbeat burst",
  "severity": "medium",
  "evidence": { "a": 1, "b": 2 },
  "windowStart": "2026-03-01T12:00:00.000Z",
  "windowEnd": "2026-03-01T12:01:00.000Z",
  "windowBucket": "2026-03-01T12:00:00.000Z",
  "occurredAt": "2026-03-01T12:01:00.000Z",
  "signedAt": "2026-03-01T12:01:00.000Z"
}
```

### Encoding rules (v0)

1. **Message bytes:** UTF-8 encoding of the JSON text produced for the payload
   above.
2. **JSON serialization:** Equivalent to ECMA-262 / Node `JSON.stringify` on a
   plain object whose own enumerable string keys appear in the field order
   listed above (no whitespace pretty-printing; compact form).
3. **`evidence`:** Must be a JSON object. Before serialization, object keys are
   sorted recursively (lexicographic ascending on Unicode code points of the
   key strings). Arrays keep element order; each array element that is an
   object is key-sorted the same way. Non-object values are left as-is under
   `JSON.stringify` rules.
4. **Timestamps** (`windowStart`, `windowEnd`, `windowBucket`, `occurredAt`,
   `signedAt`): Must be ISO-8601 strings identical to JavaScript
   `Date.prototype.toISOString()` (UTC, millisecond precision, `Z` suffix, e.g.
   `2026-03-01T12:00:00.000Z`).
5. **`signature`:** Excluded from the signed payload. Transmitted alongside the
   envelope for verification only.
6. **Public key encoding:** base64url (no padding) of the raw 32-byte Ed25519
   public key. Stored in `device_identities.public_key_ed25519`.
7. **Signature encoding:** base64url (no padding) of the raw 64-byte Ed25519
   signature over the canonical message bytes.

### Verification (gateway)

For agent-signed submit (`ThreatEventService.submitSigned`):

1. Load the active device identity for `deviceIdentityId`.
2. Build canonical bytes with `canonicalThreatEventBytes(envelope)` (v0 rules).
3. Decode `signature` as base64url → 64 raw bytes.
4. Ed25519-verify those bytes against `public_key_ed25519`.
5. On failure: reject; do not insert `threat_events`; do not materialize a finding.

## Tables

- `device_identities` — Ed25519 public key bound to `(tenant_id, agent_id)`
- `threat_events` — signed envelope persistence + finality audit fields

## Deferred

- `canonicalVersion: 1` (explicit version field inside the signed JSON)
- NODEENROLL / device cert issuance
- Re-bind after revoke (new enrollment cycle)
- CometBFT / libp2p gossipsub
- Full Rust Windows agent
- Findings UI changes

## Related

- [ADR-0005](adr/0005-correlation-bridge-provenance-and-finality.md) — signed-only
  live path, historical bridge provenance, monotonic upgrade, single finality
  materializer
- [Post-deletion notes](correlation-bridge-narrowing-checklist.md)
