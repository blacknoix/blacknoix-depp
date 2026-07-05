# Correlation v2

Correlation **v1** runs inline during telemetry ingest (`evaluateRules`) and produces per-event or per-batch alerts. **v2** detects higher-level **incidents** by correlating existing signals across agents over time.

v1 behavior is unchanged. v2 detection runners are **not** wired into the ingest hot path; scheduling (interval/worker) is deferred.

---

## Implemented patterns

| Pattern | Callable | New telemetry required? |
|---|---|---|
| `malware_outbreak` | `runOutbreakDetection(tenantId)` | Yes — `payload.fileHash` → `Alert.indicator` |
| `lateral_movement_privilege_escalation` | `runLateralMovementDetection(tenantId)` | Yes — `auth.remote_logon` / `auth.privilege_change` |
| `telemetry_gap_after_alert` | `runTelemetryGapDetection(tenantId)` | **No** — uses existing `TelemetryEvent` volume + high/critical `Alert` rows |

---

## Malware outbreak (`malware_outbreak`)

## Indicator dependency (honest limitation)

Outbreak detection groups on **`Alert.indicator`**, populated at ingest from optional `payload.fileHash` on telemetry events.

**There is no endpoint agent in this repository.** All telemetry today is synthetic or seeded. No production traffic emits `fileHash`, so **`indicator` is null on live ingest paths until a real agent is built**. The engine is tested against **seeded alerts with indicators**; it will fire on real traffic only once agents emit structured IOCs.

This is intentional — do not invent alternate data sources.

---

## Incident type: `malware_outbreak`

| Field | Description |
|---|---|
| `id` | Deterministic SHA-256 of `tenantId \| indicator \| windowBucketStart` |
| `tenantId` | Owning tenant |
| `type` | Always `malware_outbreak` in this slice |
| `indicator` | Shared malware hash / IOC |
| `agentIds` | Distinct agents involved |
| `alertIds` | Contributing alerts |
| `agentCount` | `agentIds.length` |
| `firstSeen` / `lastSeen` | Earliest / latest alert `createdAt` in the cluster |
| `createdAt` | When the incident was first persisted |

---

## Pure engine

`detectOutbreaks(alerts, { windowMs, minAgents })` in `src/lib/correlationEngineV2.ts`:

- **Pure** — no DB, no side effects, deterministic sort order
- Ignores alerts with `indicator: null`
- Groups by `(tenantId, indicator)`
- Sliding-window: qualifies when **≥ minAgents distinct `agentId`** within **windowMs**
- Emits one incident per qualifying cluster (merged overlapping windows)

### Deterministic id (idempotent persistence)

```
windowBucketStart = floor(firstSeen / windowMs) * windowMs
id = SHA-256(`${tenantId}|${indicator}|${windowBucketStart}`)
```

Re-running detection over the same outbreak yields the **same id**, enabling upsert without duplicates.

---

## Runner (callable, scheduling deferred)

`runOutbreakDetection(tenantId)` in `src/services/outbreakDetectionService.ts`:

1. Reads tenant-scoped alerts with non-null `indicator` within **`OUTBREAK_LOOKBACK_MS`**
2. Calls `detectOutbreaks`
3. **Upserts** each incident by deterministic `id`

Invoke manually or from tests. **Interval/worker scheduling is future work** — not implemented in this slice. Whether detection runs inline vs background on a schedule is also deferred.

---

## Tuning defaults

| Constant | Value | Rationale |
|---|---|---|
| `OUTBREAK_WINDOW_MS` | 24 hours | Aligns with tenant-overview rolling window; typical malware spread horizon |
| `OUTBREAK_MIN_AGENTS` | 3 | Reduces false positives from coincidental duplicate hashes on one or two hosts |
| `OUTBREAK_LOOKBACK_MS` | 24 hours | Matches detection window; runner reads alerts that can participate in a full window |

---

## Telemetry gap after alert (`telemetry_gap_after_alert`)

Detects a **near-zero telemetry volume drop** on an agent after a high/critical alert, when peer agents in the same tenant remain at their own baselines — distinguishing isolated tampering/silencing from shared infrastructure failure.

**No new agent telemetry is required.** This pattern uses `TelemetryEvent.occurredAt` counts and existing `Alert` severity — it can fire on real traffic today, unlike outbreak and lateral-movement patterns that depend on structured fields agents do not yet emit.

### Logic

1. **Trigger:** high/critical alert at time `T` (`Alert.createdAt`).
2. **Baseline:** triggering agent's average events/hour over the preceding 24h (`GAP_BASELINE_LOOKBACK_MS`).
3. **Gap check:** in `[T, T + GAP_WINDOW_MS)`, volume hourly rate below `DROP_THRESHOLD_FRACTION` of baseline.
4. **Peer check:** fraction of other tenant agents also degraded in the same window:
   - **Fire** if `degradedPeerFraction < MIN_PEER_NORMAL_FRACTION` (agent is outlier).
   - **Suppress** if `degradedPeerFraction >= MAX_PEER_DEGRADED_FRACTION` (shared outage).
   - **Ambiguous band** between those thresholds → suppress in v1.
5. **Small-fleet floor:** when tenant has fewer than `SMALL_FLEET_SIZE` agents, require at least `SMALL_FLEET_MIN_NORMAL` other agents clearly normal; otherwise suppress.

### Tuning defaults (first guesses — not validated on production data)

These constants are exported from `src/types/correlationIncident.ts`. They are honest starting points meant to be tuned once real tenant baselines exist — do not treat them as production-validated.

| Constant | Value |
|---|---|
| `GAP_BASELINE_LOOKBACK_MS` | 24 hours |
| `GAP_WINDOW_MS` | 20 minutes |
| `DROP_THRESHOLD_FRACTION` | 0.10 |
| `MIN_PEER_NORMAL_FRACTION` | 0.25 |
| `MAX_PEER_DEGRADED_FRACTION` | 0.50 |
| `SMALL_FLEET_SIZE` | 5 |
| `SMALL_FLEET_MIN_NORMAL` | 2 |

### Deterministic id

```
windowBucketStart = floor(alertTime / GAP_WINDOW_MS) * GAP_WINDOW_MS
id = SHA-256(`${tenantId}|${agentId}|${windowBucketStart}`)
```

### Runner

`runTelemetryGapDetection(tenantId)` in `src/services/telemetryGapDetectionService.ts` — reads recent qualifying alerts whose gap window has elapsed, computes per-agent volumes, calls pure `detectTelemetryGaps`, upserts by deterministic id.

---

## Future patterns (not built)

Each requires structured telemetry or alert fields not yet captured:

| Pattern | Prerequisite |
|---|---|
| Credential spray | Structured auth-failure events with `payload.targetUser` |
| C2 beaconing | Periodic network events with `payload.destinationHost` + timing |
| Data exfiltration spike | Egress volume fields (`payload.bytesOut`) per agent |

---

## Testing

- **Unit:** `src/__tests__/correlationEngineV2.test.ts`, `correlationEngineV2Lateral.test.ts`, `correlationEngineV2Gap.test.ts`
- **Integration:** `integration/outbreakDetection.integration.test.ts`, `lateralMovementDetection.integration.test.ts`, `telemetryGapDetection.integration.test.ts`

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration
```
