# Correlation v2 — Malware Outbreak Detection

## Overview

Correlation **v1** runs inline during telemetry ingest (`evaluateRules`) and produces per-event or per-batch alerts. **v2** detects higher-level **incidents** by correlating existing alerts across agents over time.

This slice implements one pattern: **`malware_outbreak`** — when the same malware indicator appears on **≥ N distinct agents** within a rolling window in one tenant, raise **one outbreak incident** instead of treating each alert in isolation.

v1 behavior is unchanged. Outbreak detection is **not** wired into the ingest hot path.

See also: [alerts.md](./alerts.md) (`Alert.indicator`), [telemetry.md](./telemetry.md) (`payload.fileHash`).

---

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

## Future patterns (not built)

Each requires structured telemetry or alert fields not yet captured:

| Pattern | Prerequisite |
|---|---|
| Lateral movement chain | `payload.parentProcessId` / process tree links across agents |
| Credential spray | Structured auth-failure events with `payload.targetUser` |
| C2 beaconing | Periodic network events with `payload.destinationHost` + timing |
| Privilege escalation burst | `payload.elevatedTo` / role-change events across agents |
| Data exfiltration spike | Egress volume fields (`payload.bytesOut`) per agent |

---

## Testing

- **Unit:** `src/__tests__/correlationEngineV2.test.ts` — pure engine cases
- **Integration:** `integration/outbreakDetection.integration.test.ts` — seeded alerts, double-run idempotency against real Postgres

```bash
docker compose -f docker-compose.test.yml up -d --wait
npm run test:integration
```
