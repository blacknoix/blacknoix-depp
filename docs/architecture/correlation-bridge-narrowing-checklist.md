# Correlation bridge narrowing — test-title checklist

Companion to [ADR-0005](adr/0005-correlation-bridge-provenance-and-finality.md).

Implementation target: keep the correlation bridge one more slice; enforce
**single finality-gated materializer** and **mandatory provenance**
(`detection_source = "bridge_correlation"` for bridge only).

No implementation in this file — titles only. Each title is a required test
case (unit and/or dbtest as appropriate).

---

## Finality gate

1. `bridge materialization does not insert a finding when finality.finalize returns failure`
2. `signed materialization does not insert a finding when finality.finalize returns failure`
3. `finding insert is not invoked before finality.finalize resolves successfully`
4. `finality rejection leaves threat_events in a terminal non-finalized state without a finding_id`

## Single materializer

5. `correlation evaluateAfterIngest creates findings only through the shared finality-gated materializer`
6. `silence evaluate creates findings only through the shared finality-gated materializer`
7. `no correlation or telemetry path calls insertFindingIgnoreDup directly for detection materialization`
8. `submitFromDetection and submitSigned both reach findings insert only via the same post-finality helper`

## Agent-identity gate

9. `bridge submitFromDetection fails closed when device identity is missing`
10. `bridge submitFromDetection fails closed when device identity is revoked`
11. `bridge submitFromDetection fails closed when device identity status is not active`
12. `signed submitSigned fails closed when device identity is missing or revoked before verify`

## Tenant isolation

13. `bridge materialization under tenant A cannot create or read findings for tenant B`
14. `signed materialization under tenant A cannot attach device identity or finding to tenant B`
15. `RLS: threat_events and correlation_findings rows for bridge path are invisible across tenants`

## Provenance integrity

16. `bridge-created finding persists detection_source equal to bridge_correlation`
17. `signed-created finding never persists detection_source equal to bridge_correlation`
18. `bridge-created finding never persists a signed-detection provenance value`
19. `bridge-created finding never records an Ed25519-verified or signature-valid marker for the placeholder signature`
20. `attempting to materialize bridge path with a signed provenance label fails closed`
21. `attempting to materialize signed path with detection_source bridge_correlation fails closed`

## Idempotency

22. `duplicate bridge submit for same tenant agent rule window_bucket does not create a second finding`
23. `duplicate signed submit for same tenant agent rule window_bucket does not create a second finding`
24. `bridge then signed on same key upgrades detection_source to agent_signed without a second finding`
24b. `signed then bridge on same key retains agent_signed (no downgrade)`

## Caller restriction

25. `HTTP agent routes cannot invoke submitFromDetection`
26. `POST /v1/threat-events uses submitSigned only`
27. `operator principals cannot submit bridge-correlation findings via a public API`

## Flag off behavior

28. `when the bridge feature flag is off, submitFromDetection does not insert threat_events pending for materialization intent that yields a finding`
29. `when the bridge feature flag is off, submitFromDetection does not insert a correlation_findings row`
30. `when the bridge feature flag is off, submitSigned continues to verify Ed25519 and materialize after finality`
31. `when the bridge feature flag is off, post-ingest correlation does not create bridge_correlation findings`

## Audit presence

32. `bridge successful materialization emits a structured log or audit field identifying detection_source bridge_correlation`
33. `signed successful materialization emits a structured log or audit field identifying non-bridge signed provenance`
34. `persisted finding detection_source is sufficient to distinguish bridge vs signed without inspecting signature bytes`

## Bridge-replacement (additive)

See `backend/api-gateway/tests/threat-events/bridge-replacement.test.ts`:

- signed correlation inserts `agent_signed` through the materializer
- bridge fallback still inserts `bridge_correlation`
- provenance upgrade is audited (`finding_detection_source_upgraded`)
- tenant-aware bridge disablement does not affect signed correlation
- re-enabling bridge does not damage existing `agent_signed` findings

---

## Implementation notes (for the executing agent)

- Normative bridge label string: `bridge_correlation` (exact match; property name
  `detection_source`).
- Signed path MUST use a different provenance value; MUST NOT use
  `bridge_correlation`.
- Prefer asserting call-graph / dependency injection in unit tests for “single
  materializer” and “no direct insertFindingIgnoreDup” where static enforcement
  is unavailable.
- Do not add CometBFT, libp2p, UI, or response-action work in the narrowing slice.
- Update `docs/architecture/threat-event-contract.md` to point at ADR-0005 when
  implementing.
