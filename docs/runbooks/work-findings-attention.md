# Work / Findings / Attention — operational runbook

Operational invariants for the current operator stack. **Preserve these when extending.**  
Not a product brief, SLA policy, or notification platform design.

**Audience:** maintainers and operators extending Work, Findings, or Attention.  
**Behavior source of truth:** code under `backend/api-gateway/src/correlation`, `backend/api-gateway/src/routes/{findings,work}.ts`, `frontend/src/{work,findings,shell,routing}`.  
**This doc must not invent behavior.** If code and this note disagree, fix the note (or the bug) — do not “paper over” ambiguity.

---

## Surfaces (map)

| Surface | Route / API | Role |
| --- | --- | --- |
| Work home | `/work` (shell default) | Daily queues + section focus + views + tiny bulk |
| Findings console | `/findings` | List/detail triage, filters, saved views |
| Attention popover | Shell → `GET /v1/findings/attention` | Pull digest: change feed + follow-ups |
| Work views | `GET/POST/DELETE /v1/work/views` | Tenant-shared section allowlists |
| Tenant Work default | `PUT/DELETE /v1/work/default` | Pointer to one shared Work view |
| Findings views | `GET/POST/DELETE /v1/findings/views` | Shared Findings filters (status/ruleId/agentId) |

Work **composes** Findings + Attention. It is not a separate inbox, case system, or BI product.

---

## Identity and auth boundaries

| Rule | Fail-closed behavior |
| --- | --- |
| Tenant from principal only | Never accept `tenantId` / `tid` in body or query |
| Operator vs agent | Agents rejected on Work views/default, Attention, findings triage/dashboard/suppressions, ownership/reminders |
| Operator identity (`userId`) | Required for `ownerScope=me`, claim, Action needed / Reminders due / Mine, bulk actions, Attention follow-up dismiss |
| Missing identity | Owner-aware Work sections show unavailable; Unowned open still loads; Attention follow-up buckets empty |
| Reassign to others | Requires users repository seam; omitted → reassignment fails closed |
| Raw `ownerUserId` query | Rejected — use `ownerScope=me\|none` only |

---

## Work landing precedence

Effective Work sections resolve in this order (deterministic):

| Priority | Source | When |
| --- | --- | --- |
| 1 | Explicit URL `sections` | Param present, including `sections=all` |
| 2 | Applied local or shared Work view | Apply writes URL → becomes (1) |
| 3 | Tenant default shared view | Bare `/work` only (`sections` **absent** = unset) |
| 4 | Product fallback | All fixed sections |

**Must preserve**

- After toggle / apply / Show all, always write `sections` (product-all → `sections=all`) so Show all does **not** re-trigger the tenant default.
- Bare `/work` (no `sections`) remains the only tenant-default-eligible landing.
- Invalid section tokens fail closed toward a safe explicit set (invalid flag + non-empty sections).
- Never leave Work with an empty section set.
- Selection / `findingId` / Attention cursors never ride the Work URL.

**Tenant default model:** references an existing shared Work view id only (no duplicated section payload). Deleted shared view clears the default (`ON DELETE CASCADE`). Stale id not in the list → treat as unset → product all.

---

## Shared vs local Work views

| Kind | Storage | Payload | Who |
| --- | --- | --- | --- |
| Local | Browser `localStorage` (tenant-scoped key) | `sections` only | This browser |
| Shared | `work_shared_views` (RLS) | `sections` only | Any tenant operator |
| Tenant default | `work_tenant_defaults` | FK to shared view | Any tenant operator (set/clear) |

**Rejected on Work views:** `findingId`, `ownerScope`, `ownerUserId`, selection, Attention state.

**Findings saved views are separate:** local/shared Findings views store list filters (`status` / `ruleId` / `agentId`; local may include `ownerScope`). Do not conflate with Work section views.

---

## Fixed Work sections (priority order)

| Id | Needs identity | Source |
| --- | --- | --- |
| `action_needed` | Yes | Attention `actionNeeded` |
| `reminders_due` | Yes | Attention `dueReminders` (soft due only) |
| `mine` | Yes | `GET /v1/findings?ownerScope=me` |
| `unowned_open` | No | `GET /v1/findings?ownerScope=none&status=open` |

Display soft-cap: 8 items per section (`WORK_QUEUE_SECTION_LIMIT`). Queue-health counters derive from the same fetches (pre-cap lists); aged unowned = open unowned older than 7 days.

---

## Findings `ownerScope`

| Value | Meaning | Requirements |
| --- | --- | --- |
| (absent) | No owner filter | Operator or agent (agent self-scoped separately) |
| `none` | `owner_user_id IS NULL` | Operator principal |
| `me` | `owner_user_id = principal.userId` | Operator principal **and** `userId` |

Frontend Findings chips: **Mine** / **Unowned open**. Invalid enums/UUIDs fail closed.

---

## Attention partitions

Pull-based digest (`GET /v1/findings/attention`). Max lookback **24h**. Change feed + follow-ups are distinct.

### Change feed (`items`)

- Kinds: `finding.created`, `finding.status_changed`
- Cursor: browser `since`; Mark caught up = **localStorage only** (does not clear follow-ups)

### Soft follow-ups (exclusive bands)

| Bucket | Kind | Meaning | Constants |
| --- | --- | --- | --- |
| Needs revisit | `finding.needs_revisit` | Owned finding quiet ≥24h and **&lt;48h** | `REMINDER_QUIET_HOURS=24` |
| Reminders due | `finding.reminder_due` | Explicit `remind_at` due, **not** yet ≥4h overdue | — |
| Action needed | `finding.action_needed` | Explicit reminder ≥4h overdue **or** owned quiet ≥48h | `REMINDER_OVERDUE_HOURS=4`, `ESCALATION_QUIET_HOURS=48` |

**Must preserve**

- Soft Needs revisit and soft Reminders due are **exclusive of** Action needed for the same condition band.
- A finding escalated via overdue reminder is excluded from ownership soft/escalation duplicate.
- Empty follow-up buckets when operator identity is absent.
- Caps: change feed 20; reminders 20; action needed 20 (newest/oldest-quiet rules as coded).
- Not email/Slack, not websockets, not an inbox store, not an SLA engine.

### Explicit reminder vs derived revisit

| Concept | Persistence | How it appears |
| --- | --- | --- |
| Explicit reminder | `finding_revisit_reminders` via `PATCH` `remindAt` (future) / `null` clear | Soft due → Action needed when overdue |
| Derived revisit | Read-time from last investigation touch | Soft Needs revisit → Action needed when long-quiet |

Last investigation touch includes claim/reassign, note, status, or create (as implemented in repository). Do not treat derived quiet as a scheduled job.

---

## Dismiss-until-change

| Item | Mechanism |
| --- | --- |
| Change feed | Mark caught up (local cursor) |
| Follow-ups | `POST /v1/findings/attention/dismiss` with `{ findingId, kind, conditionAt }` |

Dismissable kinds only: `finding.needs_revisit`, `finding.reminder_due`, `finding.action_needed`.

**Semantics:** hide while `item.at <= conditionAt` for that `(kind, findingId)`. Reappears when `at` advances or kind changes. Does not resolve the finding.

---

## Finding triage (operator)

| Capability | Notes |
| --- | --- |
| Status | `open` ↔ `acknowledged` → `resolved`; reopen → `open`; same-status idempotent |
| Ownership | `claimOwner: true`, clear (`ownerUserId: null`), reassign (tenant user validated) |
| Note | One current plain-text note (bounded replace/clear) — not a thread |
| Reminder | `remindAt` future timestamp or `null` |
| Snooze | Rule-level `finding_suppressions` (max 30d); skips **new** finding creation for that rule |

Agent principals rejected on PATCH / Attention / suppressions / dashboard / evaluate-silence.

---

## Work bulk actions

| Action | PATCH shape | Limits |
| --- | --- | --- |
| Claim to me | `{ claimOwner: true }` | Max **20** selected; identity required |
| Clear owner | `{ ownerUserId: null }` | Sequential single-item PATCH composition |
| Mark resolved | `{ status: "resolved" }` | Confirm in UI; partial failure keeps failed ids |

Not a mass-edit engine. No bulk notes, reminders, or assign-to-others on Work.

---

## Fail-closed checklist (do not break)

1. Tenant isolation via `withTenantTransaction` + RLS — never session-level `app.current_tenant`.
2. No tenant identity in client bodies/queries.
3. No existence oracles for unknown tenants/agents/findings beyond existing envelopes.
4. Work URL precedence and “always write `sections` after mutation” landing rules.
5. Exclusive Attention soft vs escalation bands and dismiss watermark semantics.
6. `ownerScope=me` requires identity; reject raw `ownerUserId` list filters.
7. Agent principals stay off operator triage / Work views / Attention mutate paths.
8. Invalid enums/UUIDs/section tokens fail closed (safe empty or product default — never invent access).
9. Correlation failures never fail telemetry ingest.
10. Docs and features must not silently widen into preferences, inbox, SLA, live push, or admin RBAC without an explicit slice.

---

## Deferred (explicit)

Preferences center · per-user homepage customization · rich admin/RBAC · onboarding wizards · live updates · email/Slack · case management / comment threads · queue balancing / SLA · charts/export · rule DSL · notification platform · docs-site redesign.

When a deferred item ships, update **this runbook** in the same change as the behavior.
