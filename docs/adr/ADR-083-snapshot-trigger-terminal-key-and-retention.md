# ADR-083 — A settled recompute trigger leaves the coalescing slot, and the row it leaves behind has an expiry

- **Status** Accepted (architecture ruling, `S-E03-10b`)
- **Date** 2026-08-29
- **Story** `S-E03-10b` — the terminal-key convention gets its retention bound, its ADR, and its executed proof
  (`docs/spec/features/v3-e03/stories/S-E03-10b.md`)
- **Epic** `V3-E03` — Canonical truth and query contracts (layer L0), fourteenth slice
- **Documents, retroactively** the key convention introduced by `S-E03-10` (run 89) in code only. `GUARDRAILS §2`
  makes an undocumented cross-cutting decision a blocking finding; `PF-386` is that finding, and this file is its
  remedy.
- **Advances, does NOT close** `PF-24` (*"the snapshot queue has no consumer"* — a stale title: the consumer
  existed and could not COMPLETE). Its remaining condition is an **executed** proof, against Postgres, that a scope
  recomputed twice ends `done` twice and that `recomputing` returns to `false`. That proof is not in this slice;
  `closed ≠ fixed` (run 93) forbids claiming it.
- **Closes** `PF-380` (the retention bound), `PF-382` (the dropped status predicate), `PF-383` (`lastError`
  retained on success), `PF-386` (this ADR + the stale schema comment).
- **Raises** `PF-451` (no supporting index on `processed_at`) · `PF-452` (`recomputed` counts an attempted settle)
  · `PF-453` (`backfillLaggingTenants` hand-writes the coalesce key) · `PF-454` (`countFailed()` /
  `tenantsWithPending()` are cross-tenant reads) · `PF-455` (`ORPHAN_PRUNE_EVERY_TICKS=0` disables the orphan prune
  silently) · `PF-456` (`pruneOrphanSnapshots` samples with no `orderBy` and no tenant key). See §D7.
- **Related** `ADR-019` (snapshots are a disposable cache; the trigger table is transient bookkeeping, not a domain
  aggregate — the anchor that makes deletion no-op-correct and audit-free) · `ADR-002` (tenant scoping) ·
  `ADR-014` (Postgres 15 — the pin that makes §D5 true) · `ADR-001` (modular monolith) · `DNC-01` (KPI/ledger
  divergence) · `GUARDRAILS.md` §1 (children's data, data minimisation), §2 (ADR rule), §4 (no agent builds)

---

## Verdict

**Accepted.** No schema change, no migration, no index, no new dependency, no contracts change, no `apps/web` edit,
and no byte of any response payload changes. Two decisions are genuinely new and are what make this ADR mandatory:

1. **`coalesceKey` stops being a pure function of `(tenant, reason, scope)`** once a row settles (§D1). The format
   lives in `packages/contracts/src/dto/snapshot.ts` and is consumed by `apps/api` at enqueue and `apps/worker` at
   drain — cross-cutting by construction.
2. **The table gains a retention policy** (§D2). `snapshot_recompute_trigger` holds per-scope grading activity for
   children's schooling; a data-minimisation rule on it is a governance decision, not an implementation detail.

Everything else in the slice restores previously-documented behaviour and needs no decision: the bounded,
coarse-cadence, tenant-scoped sweep copies `pruneOrphanSnapshots`; `expectedStatus` puts back a predicate two call
sites already carried; `lastError: null` is one argument.

---

## D1 — A settled row leaves the coalescing slot, by construction

`snapshot_recompute_trigger` carries `@@unique([tenantId, coalesceKey, status])`. That unique is what makes the
**pending** slot coalescing: a burst of dirties for one still-pending scope collapses into ONE row, which is the
whole point of the enqueue-side upsert.

It was never meant to constrain anything else. But `coalesceKey` was a pure function of `(tenant, reason, scope)`,
so it constrained every status: at most one `done` and one `failed` row per scope, **for the lifetime of the
table**. The consequence was `PF-24`: the second recompute of any scope raised `P2002` on the terminal write, the
row stayed `processing`, and the three freshness derivations pinned `recomputing: true` forever.

**Decision.** A row that reaches a TERMINAL status (`done` / `failed`) takes
`terminalCoalesceKey(key, id)` — the canonical key suffixed with `#terminal:` and the row's own primary key. A row
returning to `pending` takes `canonicalCoalesceKey(key)` back.

**Collision-freedom BY CONSTRUCTION, not by retry.** The alternative — catch `P2002` on the terminal write and
retry with a nonce — was rejected: it makes a normal, reachable transition depend on an error path, and the error
path is the one that had already been shown to abort a whole tenant's batch. Suffixing with the primary key means
no two rows can ever derive the same terminal key, so the terminal write has no failure mode to handle. The
separator cannot occur inside a canonical key (which is a tenant id, a snake_case reason and five
uuid-or-`-` fields joined with `|`), and `canonicalCoalesceKey` is idempotent, so a pre-fix row still holding a
canonical key on a `done` status keeps working with no migration.

**The cost, stated plainly:** the invariant "`coalesceKey` identifies a scope" now holds only for `pending` and
`processing`. Any future reader that groups by `coalesceKey` across statuses will over-count. The schema's own
`///` comment (`apps/api/prisma/schema.prisma`) is corrected in this slice to say so; it previously stated the
invariant with no exception.

## D2 — The unique was ALSO the only retention bound; a TTL replaces it

The bug and the ceiling were the **same mechanism**. Before `S-E03-10`, terminal rows could not accumulate because
the constraint forbade it. After it, the table grows **one permanent row per recompute, per scope, forever**, and
the only `snapshotRecomputeTrigger` delete anywhere in the repository was the redundant-row drop in
`requeueCanonical`.

**Decision.** `SnapshotDrainCronService.sweepTerminalTriggers()` deletes rows with
`status IN ('done','failed') AND processed_at < now() - SNAPSHOT_TERMINAL_RETENTION_DAYS`.

| Knob | Default | Meaning |
|---|---|---|
| `SNAPSHOT_TERMINAL_RETENTION_DAYS` | `30` | the retention window |
| `SNAPSHOT_TERMINAL_SWEEP_TAKE` | `500` | rows deleted per sweep, shared across tenants |
| `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS` | `10` | cadence (every Nth drain tick) |

30 days is defensible rather than arbitrary: a `failed` row that has survived 30 days has survived ~720
`reviveFailedTriggers` passes at the 60-minute `FAILED_RETRY_AFTER_MIN` default — it is dead, not awaiting triage.
A `done` row is pure history.

Capacity is `TAKE × (1440 / interval_minutes) / EVERY_TICKS` = **72 000 rows/day** at the 60 s tick default. That
is a *retention* bound, not back-pressure: a first run against an aged table converges over `backlog / 72000` days.
A sweep able to clear an arbitrary backlog in one tick would be an unbounded delete, which is the thing being
avoided.

**This ADR records a reversal.** `OPEN.md`'s `PF-380` row says the finding was *recorded rather than fixed because
the TTL is a retention decision a human owns, not a code choice*. This slice picks a default autonomously. The
reconciliation is that the human decision now lives in a **named environment variable with a documented default**,
not in an unbounded table. Leaving the table unbounded until someone chose a number was itself a decision, and a
worse one.

Each knob is **clamped** to a positive whole number (`positiveKnob`). Copying the file's older
`Number(process.env.X ?? D)` verbatim would have given four silent failures: `RETENTION_DAYS=0` deletes terminal
rows seconds old; a non-numeric value yields `NaN`, then `new Date(NaN)`, then a Prisma throw that `safe()`
swallows — retention never runs again, with no signal; `EVERY_TICKS=0` makes `tickCount % 0` be `NaN`, so the
cadence gate never fires.

## D3 — What the sweep may NEVER delete, and why that is a UI invariant

`recomputing` is derived in **three** places, each filtering `status IN ('pending','processing')`:

- `apps/api/src/modules/analytics/analytics.service.ts:1473-1482` — the inline probe on the child / student-rank path;
- `apps/api/src/modules/analytics/analytics.service.ts:4480-4492` — `resolveTeacherReportsFreshness`;
- `apps/api/src/modules/analytics/school-performance-drilldown.service.ts:241` — `resolveFreshness`.

(The name `computeSnapshotFreshness`, cited by `OPEN.md` and by the slice brief, **does not exist**. A future
grep-based audit must look for the three above.)

All three feed `FreshnessChip`, rendered by the parent dashboard, the teacher reports page and the admin
drilldown. A sweep restricted to terminal statuses cannot change any of those result sets, so **every chip state is
bit-identical before and after** and no `aria-live` transition announces a change that did not happen. Deleting a
`pending` or `processing` row would drop queued work *and* flip a chip out of "Recomputing…" mid-recompute — the
KPI/ledger divergence `DNC-01` forbids. The `status` pin is therefore a **UI-facing invariant**, not data hygiene.

`processed_at < cutoff` also excludes `processed_at IS NULL` for free (SQL `NULL < x` is `NULL`, never `true`), so
a never-processed row is never a candidate. No `NOT NULL` clause is added — partly because it is redundant, partly
because the sibling `reclaimStaleProcessing` deliberately writes `OR [{ lt }, { null }]` two hundred lines away and
copying that shape here would delete exactly the rows this rule protects.

**Tenant scoping (G-TENANT, ADR-002 §Tenant-isolation).** One bounded read collects the candidates, and they are
then grouped by the `tenantId` **each row itself carries**; a group is deleted under that same value, so a row of
tenant B can never fall inside tenant A's `where`. This is structural, not incidental: it must not be flattened into
one `deleteMany({ where: { id: { in: allIds } } })`. (An earlier cut enumerated tenants first and read each tenant's
candidates under its own key. That gave the same isolation guarantee but paid an unbounded scan for it — see §D5,
`PF-457`. Grouping by the carried `tenantId` is the stronger form: the key and the ids come from the same row.) RLS
covers this table (`20260813120000_tenant_rls_policies`), but the worker's connection posture is not a defence this
layer may rely on. The sweep is driven by rows that are **terminal and past the TTL**, never by
`tenantsWithPending()` — a tenant whose queue is entirely terminal is the exact steady state `PF-380` describes and
would otherwise never be swept.

**The delete re-asserts the full predicate** rather than trusting the selected ids, because terminal-ness *flips*.
`reviveFailedTriggers` selects `status: 'failed'` in the same tick and returns rows to `pending` under the
canonical key, onto which a fresh dirty immediately folds; deleting by id alone could therefore erase queued work
with no error at all. Postgres re-checks a DELETE's predicate at write time under read committed, which closes that
window.

**Audit (G-AUDIT).** No audit row is written and none is required: the trigger table is transient bookkeeping, not
a domain aggregate (`ADR-019 §Non-goals`). The retention *rule* is this section. Two consequences follow for
governance:

- a hard-deleted pupil's `student_id` could previously survive here indefinitely, invisible to the orphan prune and
  to any erasure path — that is now bounded by the TTL;
- `last_error` stores `(err as Error).message.slice(0, 500)`, i.e. raw Prisma text, which can quote names and
  identifiers. `S-E03-10b` clears it on the `done` transition (`PF-383`), so error text no longer survives on a row
  whose work succeeded. `attempts` is deliberately kept — it is history, not error text.

## D4 — The one operator-visible consequence (accepted)

`SnapshotOpsService.getRecomputeStatus` (`apps/api/src/modules/analytics/snapshot-ops.service.ts:38-80`, admin ops,
`schools.read`) reads this table. Retention therefore changes its response, and this was **confirmed in source, not
assumed**:

- `failed` (`:45`) is a `count` over `status: 'failed'`. It now excludes rows past the TTL: a correct number whose
  growth stops.
- `recent` (`:51-65`) is the 20 newest rows by `enqueuedAt desc`, at **any** status. Unchanged on an active tenant;
  it can go empty on a tenant dormant longer than the TTL.

Accepted: the ops view now shows the retention window, not all history. No `apps/web` file reads that endpoint, so
there is **no UI change** — but there is an API-visible one, and saying "no portal-visible change" would have been
false.

## D5 — The index reality, stated honestly

`OPEN.md`'s `PF-380` row claims `@@index([tenantId, status, enqueuedAt])` *"already supports it"*. **It does not**,
for the query shape a naïve implementation would use: a global
`WHERE status IN (…) AND processed_at < $1 LIMIT n` omits the index's leading column, and Postgres 15 (pinned,
`ADR-014`) has **no index skip scan**, so it would sequential-scan the very table this finding says grows without
bound. `processed_at` appears in no index under any shape.

**The first cut of this decision was wrong, and the correction is the interesting part.** It proposed recovering
the `(tenant_id, status)` prefix by enumerating tenants first and then reading each tenant's candidates under its
own key — "the tenant loop is a performance decision as much as an isolation one". The escalation panel measured
that the enumeration *itself* carried **no `take` and no `tenant_id`** (`findMany({ where: { status IN TERMINAL },
distinct: ['tenantId'] })`), so it sequential-scanned the whole terminal population — unbounded — on **every** sweep
tick, whether or not a single row was due. The shape bought an index prefix for the second query by paying an
unbounded scan for the first. Worse, the sweep runs inside `safe()`, so a statement timeout there is **swallowed**:
retention would stop running with no signal, which is precisely the failure mode `PF-380` describes. Recorded as
`PF-457` and fixed in this same slice.

**What ships:** one bounded read of the candidates themselves —
`{ status IN TERMINAL, processedAt < cutoff }, select: { id, tenantId }, take: TERMINAL_SWEEP_TAKE` — grouped by the
`tenantId` each row carries, then one `deleteMany` per group. This is strictly cheaper than what it replaces: one
scan that Postgres stops early once `LIMIT` is satisfied, instead of one unbounded scan plus N indexed reads. And
G-TENANT gets *stronger*, not weaker — the grouping key **is** the row's own tenant rather than a value carried in
from an outer loop, so a group's ids and its `where` cannot disagree by construction.

**The residual, stated rather than hidden:** in the steady state where nothing is past the TTL, `LIMIT` cannot
short-circuit and the scan runs to completion once every `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS` ticks. `processed_at`
appears in no index under any shape, so the correct fix remains `@@index([tenantId, status, processedAt])`, recorded
as `PF-451` and deferred to the first migration that touches this table. **No migration is created here**,
deliberately: a migration is an operator artefact with its own drill-baseline obligation, and this slice ships none.
The shared per-tick budget is also not tenant-fair (`PF-458`, the `PF-385` shape in new code); retention is measured
in days and converges over later ticks, so that is unfairness rather than starvation.

## D6 — Interaction with the sibling sweeps

- **`reviveFailedTriggers`** competes with retention for the same rows, in the same tick. Retention runs first
  (both are pre-loop sweeps), and the delete re-asserts the predicate, so a row revived between the select and the
  delete survives (§D3). A `failed` row is only ever swept after it has outlived ~720 revive attempts; the two
  sweeps are ordered by *time*, not by lock.
- **`backfillLaggingTenants`** is the safety net that makes deletion safe in the first place: a scope whose
  history was swept is not a scope that is stale. If a snapshot ever lags its grades, backfill re-enqueues a fresh
  `pending` trigger regardless of what the ledger remembers. Retention can therefore delete freely without risking
  a permanently-unrecomputed scope. (It hand-writes its coalesce key instead of calling the shared helper —
  recorded as `PF-453`, not fixed here.)
- **`reclaimStaleProcessing`** is untouched by retention: it reads only `processing` rows, which are never
  candidates.
- **Placement in `tick()`.** The sweep sits with the pre-loop sweeps, beside `orphanPrune`, and runs through
  `safe('terminalSweep', …, 0)`. `tenantsWithPending()` is the one call in the tick **not** wrapped in `safe()`, so
  anything sequenced after it is skipped whenever that scan throws — retention placed after the drain loop would be
  silently disabled by a transient failure, which is the exact shape of the finding it exists to fix. Its count
  appears as `sweptTerminal` in the tick's single structured log line.

## D7 — What this slice does NOT do

`expectedStatus` closes the recorded resurrection defect. It does **not** close ABA: a row reclaimed to `pending`
and then re-claimed by a second drain is `processing` again, so the predicate matches the *wrong* claim. Closing
that needs the claim instant compared alongside the status. Not race-free — and the docblock says so rather than
overclaiming.

Out of scope by instruction, recorded not fixed: `PF-384` (`MAX_ATTEMPTS` parking unreachable for a continuously
dirtied scope) · `PF-385` (stale-reclaim `NULLS LAST` starvation, tenant-unfair take) · `PF-451` … `PF-456` (§front
matter) · `PF-458` (§D5). `packages/contracts/src/dto/snapshot.ts` is **unchanged**: this ADR documents that format,
it does not alter it.

## D8 — The sweep has an OFF switch, and it had to be added deliberately

**Decision: `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS=0` disables the retention sweep entirely.**

This is the first **destructive** delete in `snapshot-drain-cron.service.ts`, and it merges without a human
reviewer. `positiveKnob` (§D2) exists to stop a `0` or non-numeric knob from silently disarming a sweep — correct
for `SNAPSHOT_TERMINAL_RETENTION_DAYS`, where `0` would put the cutoff at `now` and delete rows seconds old. Applied
to the *cadence*, though, it meant **no value of any env var could stop the sweep**.

That is a trap rather than merely a gap. The sibling idiom two lines away, `ORPHAN_PRUNE_EVERY_TICKS=0`, *does*
disable its prune — accidentally, via `tickCount % 0` being `NaN` (`PF-455`). An operator reaching for the one
lever this file had already taught them would have kept on deleting, and believed otherwise.

The gate is therefore `!TERMINAL_SWEEP_DISABLED && tickCount % TERMINAL_SWEEP_EVERY_TICKS === 0`, with the switch
matched on the **raw string** `'0'` rather than `Number(...) === 0`, because `Number('')` is `0` and an empty value
in a compose file means *unset* — which must never disable retention.

Recorded as `PF-459`, raised and closed in this slice. It was flagged by the escalation panel as "decide before
merge"; under the routine's no-reviewer rule the decision is made here and written down, not deferred.

## D9 — The wiring is under test, not just the sweep

Every sweep assertion originally called the private `sweepTerminalTriggers()` directly, so all of them stayed green
if the single line in `tick()` that invokes it were deleted, moved after the unwrapped `tenantsWithPending()` (which
would silently disable retention whenever that scan threw — the §D6 placement argument), or had its cadence gate
inverted. The suite was structurally blind to the only line that decides whether retention *ever runs*.

A `serviceWithEnv` helper now re-requires the module through `jest.isolateModules` and returns the **service**, so
tests (10) and (11) drive the real `tick()`. Both carry anti-vacuity controls: (10) asserts the aged row survives
tick 1 and is gone after tick 2 at `EVERY_TICKS=2`, and (11) proves the identical 12 ticks *do* delete when the
switch is unset. Recorded as `PF-460`, raised and closed in this slice.
