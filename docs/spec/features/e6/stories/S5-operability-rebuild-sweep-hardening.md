# E6-S5 — Operability: idempotent full rebuild + sweep hardening

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone — no other context required. Mode: `epic-slice`. Epic: **E6 — Analytics
> Snapshots & pre-computation**. Slice **S5** of S1→S5 (the **final** E6 slice).
> `[worker]` (+ small additive `[api]`) · **P2** · ~S-M.
> **touchesUi: false · touchesBackend: true · touchesWorker: true.**
>
> **The one-line intent.** Make the analytics-snapshot worker **self-healing and
> operable at scale**: a missed event or a fresh/migrated tenant **always
> converges**, a **full rebuild is always idempotent** (re-run → identical rows,
> same `revision`), failed work is **parked with a retry cap**, orphan snapshot rows
> are **pruned**, every sweep is **per-tenant re-entrant + bounded**, and the worker
> **logs counts + emits `analytics.SnapshotRecomputed`** for observability — plus an
> **optional, additive admin operational surface** (`GET /analytics/snapshots/recompute-status`
> + `POST /analytics/snapshots/rebuild`) reusing the existing `schools.read`
> permission and writing **one append-only `analytics.snapshot_rebuild` audit row**.
> **No schema change beyond S1**; **no second BullMQ queue**; **no new permission**;
> **no new contract field/type beyond what S1 already shipped** (`SnapshotFreshness`,
> `SnapshotRecomputeScope`, `snapshotCoalesceKey`, `SNAPSHOT_TRIGGER_REASON/STATUS`).
> Tenant + RLS + byte-parity-with-live fall-through preserved throughout.

---

## 1. Why this slice (the operability gap S1–S4 leave open)

S1 stood up the snapshot store + the dirty-queue + the cron drain; S2/S3 wired the
reads (parent snapshot-first, teacher/admin live with a freshness probe); S4 surfaced
the chip. The recompute spine **works on the happy path** — a publish/revise/coefficient
change enqueues a coalesced trigger, the cron drains it, the snapshot refreshes — but
the **operability story is incomplete**. Five concrete gaps a production school will hit:

1. **Stale-logic snapshots are never refreshed.** The S1 `backfillLaggingTenants` sweep
   only backfills a class **that has NO snapshot at all** (`if (hasSnapshot) continue;` —
   `snapshot-drain-cron.service.ts:185`). A class whose snapshot exists but is **older
   than its newest published grade** (a dropped enqueue, a worker that was down during
   the publish, a `revision` bump from a logic change) is **never re-swept**. The
   `computedAt < lastGradeAt` staleness signal the spec's FR-3/AC-3 require is **not
   implemented**.
2. **No idempotent full-rebuild path.** There is no way to say "rebuild the snapshots
   for this scope from scratch, deterministically" — needed after a logic change, a
   migrated/imported tenant, or a manual recovery. A re-run must produce **identical
   rows with the same `revision`** (idempotent), which the current
   `revision: { increment: 1 }` upsert **cannot guarantee** (every re-run bumps the
   counter even when nothing changed).
3. **Parked triggers accumulate silently.** A trigger that exceeds `MAX_ATTEMPTS` is set
   `status: 'failed'` and **left forever** with no observability — no count is logged,
   no admin signal, and a `failed` row is never retried even after the underlying cause
   is fixed.
4. **Orphan snapshot rows leak.** Per the S1 cache-row convention (`data-model.md` §1.5),
   snapshot scope ids are plain `@db.Uuid` with **no `@relation`/`onDelete`** — so when
   a `Student`/`ClassSection` is hard-deleted, its snapshot rows become **orphans that
   are never reaped**. The spec promises a "periodic prune (or the next full rebuild)
   reaps them" (`data-model.md` §1.5) — **not yet built**.
5. **No admin visibility into backlog health.** An operator cannot see how many triggers
   are pending/processing/failed, how stale the oldest one is, or force a rebuild — the
   `contracts/openapi.yaml` admin surface (`recompute-status` + `rebuild`) is **specced
   but unimplemented**.

S5 closes all five. The first four are **worker-only** (the core of the slice); the
fifth is the **optional admin surface** (small additive api). Everything stays behind
the universal **fall-through-to-live** read path — a snapshot that is missing, stale,
parked, or pruned is **never an error** (the dashboards always serve a correct number).

---

## 2. Reuse-first / STOP-list

If you are tempted toward any of these, **STOP** — each is an explicit non-goal that
would break the slice scope or trip an ADR:

- **A schema change beyond S1.** S5 adds **zero** new tables/columns/enums. The
  `SnapshotRecomputeTrigger` already has `attempts`, `lastError`, `status`,
  `processedAt`, `reason` (incl. `manual_rebuild` + `backfill`), and `coalesceKey`;
  the snapshot tables already have `revision` + `computedAt` + `sourceEventId`. Use
  what exists. (If you find yourself wanting a new column, you are over-scoping —
  re-read §3.)
- **A second BullMQ queue / the unbuilt `OutboxEvent`→BullMQ listener.** The dirty-queue
  table + cron-poll IS the mechanism (ADR-019). Keep draining the
  `SnapshotRecomputeTrigger` table on the existing `setInterval`.
- **A new permission.** The admin surface (if shipped) reuses **`schools.read`** — the
  exact permission the existing `/analytics/dashboard` + `/analytics/school-performance-drilldown`
  endpoints already use (`analytics.controller.ts:33,69`). Do **not** add a
  `snapshots.*` permission.
- **A new contract type/field.** Reuse the S1 `packages/contracts` exports
  (`SnapshotRecomputeScope`, `snapshotCoalesceKey`, `SNAPSHOT_TRIGGER_REASON`,
  `SNAPSHOT_TRIGGER_STATUS`). The admin DTOs (`RebuildSnapshotsRequest/Response`,
  `SnapshotRecomputeStatusResponse`) are **response/request shapes local to the
  controller** (plain DTO classes or inline types) — they are NOT new shared analytics
  metrics and need not live in `packages/contracts` (mirror the existing analytics
  controller, which returns service objects without dedicated shared DTOs). If you do
  add them to contracts, keep them additive and in `dto/snapshot.ts`.
- **A `MATERIALIZED VIEW` / external warehouse / read-through cache.** Out of scope
  (ADR tripwires / non-goals, `spec.md` Non-goals).
- **Touching the live `AnalyticsService` formula or the read switch.** S5 does **not**
  change any read path. The recompute formula (`snapshot-formula.ts`) and
  `SnapshotRecomputeService.recomputeScope` stay byte-parity with live — the **only**
  recompute-service change allowed is the idempotent-`revision` adjustment in §3.2
  (and it must keep byte-parity of every value column).
- **A new audit row per recompute / per sweep.** Cron/sweep writes are derived
  bookkeeping → **no `AuditLog`** (consistent with `alerts-cron`/`notifications-digest`).
  The **only** audited action is the explicit **admin manual rebuild** (one
  `analytics.snapshot_rebuild` row — §4.3).
- **A UI surface.** S5 is `[worker]` + small `[api]`. **No `apps/web` change.** The
  admin status/rebuild endpoints are API-only this slice (a future polish run may add
  an admin panel — out of scope here).

---

## 3. Worker scope (the core of S5) — `apps/worker/src/modules/analytics-snapshots/*`

All worker work lives in the existing module
(`apps/worker/src/modules/analytics-snapshots/`). Follow the established structural
sibling pattern (`AlertsCronService`): plain `setInterval`, `running` re-entrancy
guard, per-tenant best-effort loop, every query carries explicit `where: { tenantId }`.

### 3.1 Precise stale detection in the sweep (gap #1) — `snapshot-drain-cron.service.ts`

Replace the S1 "only backfill classes with NO snapshot at all" rule
(`if (hasSnapshot) continue;`, line 185) with **precise staleness**: a class scope is
**stale** when its freshest snapshot is **older than the newest published/revised grade
for that class** (`computedAt < lastGradeAt`) **OR** its `revision` is below the current
sweep generation (logic-bump lazy refresh — see §3.4). Concretely, in
`backfillLaggingTenants` (rename it `sweepStaleTenants` for honesty, or keep the name —
your call, but document it):

- For each candidate class scope (tenant has no open trigger for it; bounded probe,
  keep the existing `take: 500` cap), resolve **`lastGradeAt`** = the max
  `Grade.updatedAt` (or `publishedAt` — pick the column the live path treats as the
  freshness watermark; `updatedAt` is safest since a revise mutates it) over
  `status in (published, revised)`, `isAbsent = false` for that class+year, and
  **`snapshotComputedAt`** = the max `StudentSubjectSnapshot.computedAt` (or the
  `ClassSubjectDistribution.computedAt`) for that class.
- Enqueue a coalesced `backfill` trigger when **`snapshotComputedAt` is null** (no
  snapshot — S1 behaviour, preserved) **OR `snapshotComputedAt < lastGradeAt`** (stale —
  the new case) **OR** `revision < SWEEP_REVISION_FLOOR` (logic bump — §3.4). Use the
  **exact** `snapshotCoalesceKey(tenantId, 'backfill', scope)` from `@pilotage/contracts`
  / `snapshot-keys.ts` (one formula, no drift) and the same idempotent
  `upsert` on `(tenantId, coalesceKey, status='pending')` the S1 sweep uses.
- Keep the sweep **bounded** (`take` cap on the probe, ≤ one trigger per class per
  sweep) and **per-tenant resilient** (a per-class probe throw is caught + logged, never
  aborts the tenant loop — wrap each class probe in try/catch, mirroring the existing
  `catch` around the upsert).

> **Why this is the headline fix:** it is what makes "a missed event always converges"
> true. Today a dropped enqueue on a class that already has *a* snapshot is permanent;
> after S5 the next sweep cycle detects `computedAt < lastGradeAt` and re-enqueues.

### 3.2 Idempotent full-rebuild path (gap #2) — `snapshot-recompute.service.ts`

Add an **idempotent rebuild** semantics so re-running a recompute for an unchanged scope
yields **identical rows AND the same `revision`** (AC-S5-2). Today every upsert does
`revision: { increment: 1 }` — so a manual rebuild or a re-sweep of unchanged grades
**bumps `revision` for nothing**, defeating "re-run → identical rows".

Implement **conditional revision bump**: in `recomputeScope`, when upserting each
snapshot row, **only bump `revision` when a value column actually changed**. Two
acceptable implementations (pick one, document it):

- **(A) Read-compare-write (preferred for clarity):** before the transaction, read the
  existing row's value columns; in the `update`, set `revision` to the existing value
  when every value column is byte-identical (within the Decimal tolerance the read path
  already uses, ≤ 0.01 — see `analytics.service.spec.ts` E6-S2 cases), else
  `{ increment: 1 }`. Keep `computedAt`/`sourceEventId` refreshed **only when something
  changed** (an unchanged row keeps its old `computedAt` so the freshness chip does not
  flicker "à jour il y a 0 s" on a no-op rebuild).
- **(B) Content-hash guard:** store a derived hash of the value columns and compare;
  `revision`/`computedAt` advance only on a hash change. (Avoids the extra read but is
  more code; only choose if (A) is measurably hot — it is not.)

The rebuild itself **reuses `recomputeScope` unchanged** for the class-scoped path and
the existing `fanOutCoefficientChange` for the wide path — there is **no new
recompute formula**. A `manual_rebuild` trigger (§4.2) is drained by the **same**
`drainTenant` loop: route `manual_rebuild` exactly like `grade_published` (class-scoped
`recomputeScope`) when it carries a `classSectionId`, and like `coefficient_changed`
fan-out when it is class-less but carries `(subjectId, academicYearId)`; a **fully
class-less, subject-less `manual_rebuild`** (whole-tenant rebuild) fans out over **every
active `ClassSection` in the tenant** (bounded by the existing `take` caps + the batch
loop — never unbounded; remaining classes converge over later ticks).

> **Idempotency contract (AC-S5-2):** `recomputeScope(scope)` then
> `recomputeScope(scope)` again with unchanged grades ⇒ the second call writes the
> **same value columns** and leaves **`revision` unchanged** (no-op upsert in effect).
> The byte-parity-with-live guarantee from S1 is **unchanged** — value columns still
> equal the live `AnalyticsService` output.

### 3.3 Failed-row parking + retry cap + recovery (gap #3) — `snapshot-drain-cron.service.ts`

The S1 cron already parks at `MAX_ATTEMPTS` (`status: 'failed'`). S5 hardens this:

- **Observability:** the per-tick summary log (line 97-100) already reports `recomputed`
  + `failed`; **add a `parked` count** (triggers that crossed the cap this tick) and a
  **standing `failedBacklog`** count (total `status='failed'` rows for the tenant) so an
  operator/log scraper can alarm on a growing parked backlog. Keep referencing
  `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` on the structured log line (the observability
  "emit" — **no** queue/outbox write, PM-13 from S1).
- **Recovery (un-park):** add a bounded **`failed`-row revival** at the **top** of the
  sweep — a `failed` trigger older than `FAILED_RETRY_AFTER_MIN` (e.g. 30 min) is
  reset to `pending` with `attempts` **reset to 0** (so a transient cause that has since
  cleared gets a fresh retry budget). Bound it (`take` cap), tenant-scoped, idempotent
  via the existing claim path. This makes parking a **back-off, not a death sentence**.
  (If a reviewer prefers parked rows stay parked until an explicit admin rebuild, gate
  the revival behind `FAILED_RETRY_AFTER_MIN > 0` and default it on — document the
  choice.)
- Keep the existing **stale-`processing` reclaim** (`reclaimStaleProcessing`, line 121)
  unchanged — it already covers crash-mid-tick recovery.

### 3.4 `revision` lazy-refresh of stale-logic rows (part of gap #1) — both files

Introduce a module constant **`SNAPSHOT_REVISION_FLOOR`** (env-overridable, default `1`).
A snapshot row whose `revision < SNAPSHOT_REVISION_FLOOR` is treated as **stale logic**
by the sweep (§3.1) and re-enqueued for recompute. When the recompute formula changes in
a future slice, bumping the floor (an env/deploy constant, **not** a schema change) makes
the sweep lazily refresh every row over subsequent ticks — convergence without a manual
mass rebuild. In S5 the floor is `1` (no-op for existing rows) — it is the **seam** that
makes a future logic bump operable. Document it; do not force a rebuild this slice.

### 3.5 Orphan-snapshot prune (gap #4) — `snapshot-drain-cron.service.ts`

Add a bounded, tenant-scoped **orphan prune** to the sweep: delete snapshot rows whose
`studentId` (for `StudentSubjectSnapshot`/`StudentGlobalSnapshot`) or `classSectionId`
(for `ClassSubjectDistribution`) **no longer exists** in the live `Student`/`ClassSection`
tables for the tenant. Implementation (cheap, indexed, bounded):

- Per tenant, collect a bounded page of snapshot `studentId`s/`classSectionId`s, resolve
  which still exist (`student.findMany where id in (...) select id`), and `deleteMany`
  the snapshot rows for the missing ids. Bound the page (`ORPHAN_PRUNE_BATCH`, e.g. 500)
  so a tenant with a large delete converges over several ticks, never wedges one.
- Orphan prune is **purely a cache hygiene op** — deleting an orphan row degrades nothing
  (the read path joins from the live `Student`/enrollment, so an orphan is never read;
  `data-model.md` §1.5). It writes **no audit row**. Per-tenant try/catch; a prune throw
  never aborts the loop.
- Run the prune **at most once per N ticks** (or gate on a cheap "are there candidates"
  probe) so it does not add load every minute — match the cadence the existing sweep
  uses (the sweep already runs each tick; you may run the prune on a coarser interval via
  a tick counter or a `lastPruneAt` guard).

### 3.6 Per-tenant re-entrant resilience + bounded batch (gaps #1/#5, mostly already present)

The S1 cron is already re-entrant (`running` guard), per-tenant best-effort
(one tenant's failure never aborts the loop), and bounded (`BATCH_SIZE`,
`COEFFICIENT_FANOUT_TAKE`, the probe `take: 500`). S5 must **preserve all of these** and
extend them to the new sweep work: the stale-detection probe, the failed-revival, and the
orphan prune are **each** bounded + per-tenant try/caught + tenant-scoped. **No new sweep
may be unbounded.** Add bounds as module constants (env-overridable) alongside the
existing ones (`BATCH_SIZE`, `MAX_ATTEMPTS`, `STALE_PROCESSING_MIN`,
`COEFFICIENT_FANOUT_TAKE`).

### 3.7 Observability (gap #5, worker side)

Every sweep/drain pass logs **structured counts**: `{ tenants, recomputed, failed,
parked, revived, pruned, backfilled, durationMs }` on the existing tick-complete log
line, referencing `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED`. This is the worker's contribution
to the spec's "counts logged + `analytics.SnapshotRecomputed`" observability AC. No new
event name (reuse the already-declared `analytics.SnapshotRecomputed`).

---

## 4. Optional admin operational surface (small additive `[api]`)

> **Ship this if the slice has budget after the worker hardening (§3) is done and
> tested.** The worker hardening (§3) is the **must-ship core**; the admin endpoints are
> the **nice-to-have** that makes the backlog observable + manually recoverable. If you
> ship them, they are **additive, admin-only, reuse `schools.read`, and audited** exactly
> as below. If you do not ship them this slice, record it in PROGRESS as a follow-up — the
> worker self-heals without them.

Two endpoints on the **existing** `AnalyticsController`
(`apps/api/src/modules/analytics/analytics.controller.ts`), both guarded by the existing
`JwtAuthGuard + PermissionsGuard` and **`@RequiresPermission('schools.read')`** (the same
guard the admin dashboard uses — **no new permission**). The recompute itself runs in the
worker; these endpoints only **enqueue** / **observe**. Add a small
`SnapshotOpsService` (new file in the analytics module, or methods on `AnalyticsService`)
so the controller stays thin. tenant/schoolId server-derived via
`SchoolContextService.forUser(me)` — never client-supplied.

### 4.1 `GET /analytics/snapshots/recompute-status` — backlog health (read-only)

- Permission: `schools.read`. Tenant-scoped (`where: { tenantId }` on every count).
- Returns (matching `contracts/openapi.yaml` `SnapshotRecomputeStatusResponse`):
  `{ generatedAt, pending, processing, failed, oldestPendingAt, recent[] }` where
  `recent` = up to 20 newest `SnapshotRecomputeTrigger` rows
  (`id, reason, status, enqueuedAt, processedAt, attempts`), newest first.
- Counts via `prisma.snapshotRecomputeTrigger.count({ where: { tenantId, status } })`
  per status (or one `groupBy`); `oldestPendingAt` =
  `findFirst({ where:{tenantId,status:'pending'}, orderBy:{enqueuedAt:'asc'}, select:{enqueuedAt:true} })`.
- **No side effect, no audit row** (it is a read).

### 4.2 `POST /analytics/snapshots/rebuild` — admin manual rebuild (enqueue, audited)

- Permission: `schools.read` (admin-only via the existing guard). Body =
  `RebuildSnapshotsRequest` (all fields OPTIONAL + narrowing:
  `classSectionId?, subjectId?, termId?, studentId?, academicYearId?`). Omitting all
  fields = whole-tenant rebuild (`academicYearId` defaults to the active year via
  `ctx.forUser`).
- **Validate every supplied scope id against the caller's tenant BEFORE enqueue** (e.g.
  `classSectionId` must resolve in `classSection.findFirst({ where:{ id, tenantId } })`,
  else `404`/`400` per the openapi). A stale/foreign id must **never** widen scope or
  cross tenants.
- **Idempotent enqueue:** build the coalesce key with the **shared**
  `snapshotCoalesceKey(tenantId, 'manual_rebuild', scope)` and `upsert` on
  `(tenantId, coalesceKey, status='pending')` — an identical still-pending rebuild is
  **coalesced** (returned `coalesced: true`), never duplicated. Returns
  `{ triggerId, status, coalesced }` (`202`).
- **Writes ONE append-only `analytics.snapshot_rebuild` audit row** (the only audited E6
  action — this is an explicit admin action, unlike the derived cron writes). Mirror the
  exports audit shape (`exports.service.ts:185` `writeBulletinAudit`):
  `prisma.auditLog.create({ data: { tenantId, actorId: me.id, actorRole, portal,
  action: 'analytics.snapshot_rebuild', resourceType: 'snapshot_recompute_trigger',
  resourceId: trigger.id, after: { scope..., coalesced } } })`. Wrap in try/catch so an
  audit-write failure never fails the enqueue (best-effort, matching the exports pattern).
- The worker `drainTenant` already routes by `reason`/scope (§3.2) — a `manual_rebuild`
  trigger drains exactly like the analogous event trigger. **No worker change is needed
  to consume it beyond the §3.2 routing.**

### 4.3 Audit & RGPD

- The `analytics.snapshot_rebuild` audit row is **append-only** (the existing `AuditLog`
  convention — no update/delete). It records **who** rebuilt **what scope**, no child
  personal data (scope ids only).
- No other E6 path writes audit (cron/sweep are derived bookkeeping — §2 STOP-list).

---

## 5. Tenant / RLS / ABAC / guardrail invariants (every change)

- **Every** new query (stale probe, failed-revival, orphan prune, status counts, rebuild
  validation/enqueue) carries explicit `where: { tenantId }` (ADR-002 defence-in-depth,
  matching the S1 cron + the S2 read switch).
- **No read-path change** — the dashboards keep serving snapshot-first-with-live-fallback
  exactly as S2/S3 left them. A pruned/parked/stale snapshot ⇒ the read falls through to
  live (never an error, never a wrong number). Byte-parity-with-live is preserved (the
  §3.2 idempotent-revision change must not alter any value column).
- **Admin endpoints reuse `schools.read`** — no permission is loosened or added; the
  rebuild validates scope ids in-tenant before enqueue (cannot cross tenants).
- **Snapshots stay a disposable cache** — orphan prune + rebuild are safe-by-construction
  (deleting/rebuilding degrades only latency). No source table is touched.
- **No new schema, no new BullMQ queue, no new permission, no new contract type, no UI.**

---

## 6. Acceptance criteria (folds spec operability + AC-3/7/8)

- **AC-S5-1 (precise stale detection → convergence).** After a snapshot's grades change
  but its enqueue was dropped (snapshot `computedAt < lastGradeAt`), the next sweep cycle
  detects the staleness and enqueues a coalesced `backfill` trigger; the following drain
  recomputes it. A class with no snapshot at all still backfills (S1 behaviour preserved).
  A unit/spec test seeds a stale snapshot (computedAt in the past, a newer grade) and
  asserts the sweep enqueues exactly one `backfill` trigger for that scope (tenant-scoped,
  coalesced — a second sweep does not duplicate it).
- **AC-S5-2 (idempotent full rebuild).** `recomputeScope(scope)` run twice on unchanged
  grades writes **identical value columns** and leaves **`revision` unchanged** on the
  second run (no-op); a `manual_rebuild` trigger drains via the same loop and is itself
  idempotent. Value columns stay **byte-parity with live** `AnalyticsService` (the S1
  parity test still passes). Spec test pins: run recompute, capture rows; run again;
  assert every value column equal **and** `revision` unchanged.
- **AC-S5-3 (failed-row parking + recovery).** A scope that throws is retried up to
  `MAX_ATTEMPTS` then parked (`status: 'failed'`, existing); a parked trigger older than
  `FAILED_RETRY_AFTER_MIN` is revived to `pending` with `attempts = 0`; the per-tick log
  reports `parked` + `failedBacklog` counts. Test: a trigger past the cap is parked, then
  (with the clock advanced past the revival window) revived to pending on the next sweep.
- **AC-S5-4 (orphan prune).** A `StudentSubjectSnapshot` (or distribution) row whose
  `studentId`/`classSectionId` no longer exists in the tenant is deleted by the sweep,
  bounded per tick, tenant-scoped, with no audit row; a row whose owner still exists is
  **never** pruned. Test: seed an orphan + a live-owned row, run prune, assert only the
  orphan is gone.
- **AC-S5-5 (per-tenant re-entrant + bounded).** Every new sweep op (stale probe,
  revival, prune, fan-out) is bounded by a module constant and wrapped per-tenant
  try/catch; one tenant's or one scope's failure never aborts the loop; the `running`
  re-entrancy guard still prevents overlapping ticks. (Asserted by the existing
  best-effort test pattern extended to the new paths.)
- **AC-S5-6 (observability).** Each tick logs structured counts
  (`{tenants, recomputed, failed, parked, revived, pruned, backfilled, durationMs}`)
  referencing `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED`; no new event name, no queue/outbox
  write.
- **AC-S5-7 (admin surface, if shipped).** `GET /analytics/snapshots/recompute-status`
  returns tenant-scoped backlog counts + oldest-pending + a recent feed under
  `schools.read`; `POST /analytics/snapshots/rebuild` validates scope ids in-tenant,
  idempotently coalesces a `manual_rebuild` trigger (`coalesced` flag truthful), returns
  `202`, and writes exactly one append-only `analytics.snapshot_rebuild` audit row (best-
  effort). Neither endpoint adds a permission or crosses tenants. (If not shipped this
  slice: recorded as a follow-up in PROGRESS — the worker self-heals without it.)
- **AC-S5-8 (no regression / no new architecture).** No schema change beyond S1; no
  second BullMQ queue; no new permission; no new contract type; no UI; the read path +
  byte-parity-with-live fall-through are unchanged. `pnpm typecheck` clean (Murat, once);
  no `git diff --check` errors. **No new ADR** — S5 operates entirely within the
  ADR-019 (analytics-snapshots) pattern already filed in S1 (the durable dirty-queue +
  materialised cache + fall-through). Reference ADR-019 in the cron/service comments.

---

## 7. Pre-mortem failure modes (turned into extra acceptance / guardrails)

- **PM-S5-1 — rebuild storm.** A whole-tenant `manual_rebuild` (no scope) fans out over
  every class and floods the cron. *Mitigation:* the fan-out is bounded by the existing
  `take` caps + `BATCH_SIZE` per tick; remaining classes converge over later ticks; the
  enqueue is a single coalesced trigger (one row, not N) that the worker expands lazily.
- **PM-S5-2 — revision churn.** A naive rebuild bumps `revision` every run, making the
  freshness chip perpetually flip "à jour il y a 0 s" and breaking idempotency.
  *Mitigation:* §3.2 conditional bump — `revision`/`computedAt` advance **only** on a real
  value change (AC-S5-2). Pin with a test.
- **PM-S5-3 — orphan prune deletes a live row.** A race (snapshot for a just-created
  student) or a tenant-scope miss prunes a valid row. *Mitigation:* prune only deletes
  rows whose owner id is **absent** from a tenant-scoped `findMany`; the read path
  fall-through means even an erroneous prune degrades only latency (the next recompute
  re-creates the row). Bounded + tenant-scoped + tested (AC-S5-4).
- **PM-S5-4 — failed-revival thrash.** Reviving a genuinely-broken trigger every window
  re-fails it forever, spamming logs. *Mitigation:* revival resets `attempts=0` but the
  cap re-parks it after `MAX_ATTEMPTS` — so it back-offs to one revival per
  `FAILED_RETRY_AFTER_MIN`, not a tight loop; the `failedBacklog` count surfaces a
  persistently-broken scope for an operator.
- **PM-S5-5 — stale-probe cost.** The new `computedAt < lastGradeAt` probe adds a grade
  scan every tick. *Mitigation:* keep the existing `take: 500` bound + the
  "tenants with no open trigger only" filter; the probe uses the tenant-first indexes
  (`@@index([tenantId, academicYearId, classSectionId])`) the snapshot tables already
  carry; run the heavier orphan prune on a coarser cadence (§3.5).
- **PM-S5-6 — admin rebuild crosses tenants.** A forged/stale scope id rebuilds another
  tenant's data. *Mitigation:* every supplied scope id is validated
  `findFirst({ where:{ id, tenantId } })` before enqueue (404/400 on miss); the
  coalesce key + the trigger both carry the caller's `tenantId`; the worker drains
  `where: { tenantId }`.
- **PM-S5-7 — audit-write failure blocks rebuild.** *Mitigation:* the audit write is
  best-effort try/catch (mirrors `exports.service.ts`) — the enqueue is the source of
  truth; a missing audit row is logged, never fatal.

---

## 8. Test plan (Murat-picked, the single most valuable + the supporting set)

> Tests live beside the worker module
> (`apps/worker/src/modules/analytics-snapshots/snapshot-recompute.spec.ts` already
> exists with the S1 byte-parity/idempotency/coalesce-key cases + the S3 fan-out cases —
> **extend it**; do not fork). If the admin endpoints ship, add an api spec
> (`analytics.service.spec.ts` or a small `snapshot-ops.service.spec.ts`).

**The single most valuable test (Murat pick): idempotent rebuild + parity (AC-S5-2).**
Seed a fixture class; run `recomputeScope`; snapshot the rows (value columns +
`revision`). Run `recomputeScope` again on unchanged grades; assert **every value column
is identical** AND **`revision` is unchanged** (no-op), while still equalling the live
`AnalyticsService` output (parity carried from S1). This is the test that proves "re-run →
identical rows, same revision" — the operability promise of the slice.

**Supporting tests:**
- **Stale detection (AC-S5-1):** seed a snapshot with `computedAt` in the past + a newer
  grade → sweep enqueues exactly one coalesced `backfill` trigger; a second sweep does not
  duplicate it; a class with no snapshot still backfills.
- **Parking + revival (AC-S5-3):** a trigger forced past `MAX_ATTEMPTS` is parked
  (`failed`); with the clock past `FAILED_RETRY_AFTER_MIN` it is revived to `pending`,
  `attempts=0`.
- **Orphan prune (AC-S5-4):** orphan row deleted, live-owned row kept, tenant-scoped,
  bounded.
- **Tenant scoping (AC-S5-5/8):** every new query asserted to carry `where: { tenantId }`
  (mock-call assertion, mirroring the S2/S3 tenant-scoping cases).
- **Admin rebuild (AC-S5-7, if shipped):** scope-id-in-tenant validation (404 on foreign
  id), idempotent coalesce (`coalesced: true` on a repeat), one `analytics.snapshot_rebuild`
  audit row written, tenant-scoped status counts.

---

## 9. Files (expected touch set)

**Worker (core — must ship):**
- `apps/worker/src/modules/analytics-snapshots/snapshot-drain-cron.service.ts` — precise
  stale detection (§3.1), failed-revival + parked/observability counts (§3.3), orphan
  prune (§3.5), new bounded module constants, structured tick log (§3.7). Reference
  ADR-019 in the class comment.
- `apps/worker/src/modules/analytics-snapshots/snapshot-recompute.service.ts` —
  conditional/idempotent `revision` bump (§3.2); `manual_rebuild` routing reuses the
  existing recompute paths (no new formula).
- `apps/worker/src/modules/analytics-snapshots/snapshot-recompute.spec.ts` — extend with
  the §8 cases (do not fork).

**API (optional admin surface — ship if budget):**
- `apps/api/src/modules/analytics/analytics.controller.ts` — two new `@Get`/`@Post`
  handlers under `@RequiresPermission('schools.read')` (§4.1/§4.2).
- `apps/api/src/modules/analytics/snapshot-ops.service.ts` (new) **or** methods on
  `analytics.service.ts` — status counts + rebuild enqueue/validation/audit (§4).
- `apps/api/src/modules/analytics/analytics.module.ts` — register the new service if a
  new file is added.
- (optional) `apps/api/src/modules/analytics/snapshot-ops.service.spec.ts` (new) — §8
  admin tests.

**Docs (land with the slice):**
- `docs/spec/features/e6/PROGRESS.md` — tick S5, record what shipped (worker hardening
  always; admin endpoints if shipped, else as a recorded follow-up).
- `docs/spec/features/e6/tasks.md` — mark `[x] S5`.
- `bmad/roadmap.md` — set E6 `status: shipped` (all 5 slices landed), advance the
  "next epic" pointer to **E7 — Remediation & Tutoring loop**.

**Explicitly NOT touched:** any `apps/web` file; `schema.prisma` (no schema change beyond
S1); `packages/contracts` enums/schema (reuse S1 exports — only add admin DTOs there if
you choose, kept additive in `dto/snapshot.ts`); any read-path / live-`AnalyticsService`
formula; any new ADR (S5 is within ADR-019); any new permission/queue.

---

## 10. Definition of done (slice)

The analytics-snapshot worker is **operable and self-healing**: a dropped enqueue or a
fresh/migrated tenant converges within one sweep cycle (precise `computedAt < lastGradeAt`
/ `revision` staleness, §3.1/§3.4); a full rebuild is **idempotent** (re-run → identical
rows, same `revision`, byte-parity with live, §3.2); failed work is **parked with a cap
and revived after a back-off** (§3.3); orphan snapshot rows are **pruned** (§3.5); every
sweep is **per-tenant re-entrant + bounded** with **structured count logging +
`analytics.SnapshotRecomputed`** (§3.6/§3.7); and (if shipped) an **admin status/rebuild
surface** reusing `schools.read` makes the backlog observable + manually recoverable with
**one append-only `analytics.snapshot_rebuild` audit row** (§4). All behind the universal
fall-through-to-live read path — no schema change beyond S1, no second queue, no new
permission, no UI. On land → **E6 `status: shipped`**, advance to **E7**.
