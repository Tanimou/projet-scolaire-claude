# E6 — Progress

> Epic: **E6 — Analytics Snapshots & pre-computation** · Tier 3 (Scale & new surfaces) · Size ~M
> Spec-kit run: **2026-06-05** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored) → **shipped** (all 5 slices landed; S5 = operability
> hardening + admin status/rebuild surface). **S1–S5 all shipped → E6 complete.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Snapshot schema + recompute spine + publish trigger | `[schema][worker]` | P1 | ✅ shipped | — |
| S2 | Parent dashboard reads snapshots (headline perf win) | `[api]` | P1 | ✅ shipped | — |
| S3 | Admin & teacher reads + revise/coefficient triggers | `[api][worker]` | P1-P2 | ✅ shipped | — |
| S4 | Freshness chip (the visionary trust signal) | `[web][a11y]` | P2 | ✅ shipped | — |
| S5 | Operability: idempotent full rebuild + sweep hardening | `[worker][api]` | P2 | ✅ shipped | — |

## What landed this run (spec run)

- `docs/spec/features/e6/` spec-kit authored: `spec.md`, `plan.md`, `data-model.md`, `ux.md`,
  `contracts/openapi.yaml`, `tasks.md`, `quickstart.md`, this `PROGRESS.md`. **Docs only** — no code, no
  schema, no migration, no build.

## What landed (S1 — snapshot schema + recompute spine + publish trigger)

- **Schema** (`apps/api/prisma/schema.prisma`, additive `db push`): 2 enums (`SnapshotTriggerReason`,
  `SnapshotTriggerStatus`) + 4 tenant-scoped models (`StudentSubjectSnapshot`, `StudentGlobalSnapshot`,
  `ClassSubjectDistribution`, `SnapshotRecomputeTrigger`) with freshness columns
  (`computedAt`/`sourceEventId`/`revision`), natural-key `@@unique`, tenant-first indexes, `@@map`. Scope
  ids are plain `@db.Uuid` (no `@relation` → no existing model touched).
- **Contracts** (`packages/contracts`): `SNAPSHOT_TRIGGER_REASON`/`SNAPSHOT_TRIGGER_STATUS`/`SNAPSHOT_SOURCE`
  consts+types (`enums/index.ts`); new `dto/snapshot.ts` (`SnapshotFreshness`, `SnapshotRecomputeScope`,
  shared deterministic `snapshotCoalesceKey`) wired through the barrels. Reuses the already-declared
  `analytics.SnapshotRecomputed` event (no new event).
- **API enqueue** (`assessments.controller.ts` publish path): a SEPARATE best-effort try/catch AFTER commit
  + the notification fan-out idempotently upserts a class-wide `SnapshotRecomputeTrigger`
  (`grade_published`, coalesced on `(tenantId, coalesceKey, status='pending')`); an enqueue failure is
  caught+logged and NEVER fails the publish. Publish fetch extended to select
  `classSectionId/subjectId/academicYearId`.
- **Worker** (`apps/worker/.../analytics-snapshots/*`, registered in `app.module.ts`): `snapshot-formula.ts`
  (one pure byte-parity helper), `snapshot-keys.ts` (re-exports the shared coalesce key),
  `SnapshotRecomputeService.recomputeScope` (per-scope class-wide recompute in ONE transaction — per-term +
  delete-then-insert null-term roll-up + weighted global cascade + distribution; one class-grade findMany),
  `SnapshotDrainCronService` (alerts-cron mirror: ~60s setInterval, atomic pending→processing claim, per-tenant
  FIFO bounded batch, stale-processing reclaim, lagging-tenant backfill, references
  `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` — no queue), `snapshot-recompute.spec.ts` (byte-parity + idempotency +
  coalesce-key).
- **ADR** `docs/adr/ADR-019-analytics-snapshots.md` (next free filesystem number; reconciles the dangling
  narrative "ADR-019 real-time deferral" reference).
- **Zero read-path wiring** — snapshots are written but never read in S1 (provably zero behaviour change).
- **Build/migration left to the orchestrator** (agents don't build): `prisma generate` + `db push` must run
  once so the new snapshot/trigger Prisma clients exist for the typecheck gate + runtime.

## What landed (S2 — parent dashboard reads snapshots)

- **Read switch** (`apps/api/src/modules/analytics/analytics.service.ts`): the `parentDashboard`
  class-context block (per-subject `classAverage` / `studentRank` / `classSize` + the global
  `studentRank` / `classRankTotal`) now resolves **snapshot-first**. The original ~90-line live
  class-wide `grade.findMany` + in-memory ranking is extracted **verbatim** into
  `computeParentClassContextLive` (behaviour-preserving cut-paste) and gated behind a new
  `resolveParentClassContext`, which serves the materialised
  `StudentGlobalSnapshot` / `StudentSubjectSnapshot` / `ClassSubjectDistribution` point-reads when a
  fresh snapshot exists, collapsing the O(class × grades) scan (the <2 s NFR win).
- **Fall-through-to-live, never an error.** Any snapshot miss/throw, or an open
  (`pending`/`processing`) `SnapshotRecomputeTrigger` on the child's class scope, short-circuits to
  the byte-identical live scan — no mixed-generation reads. All-or-nothing gate: a global YEAR row +
  a subject YEAR row for **every** graded subject. Each snapshot/trigger query carries explicit
  `where: { tenantId }` (ADR-002 defence-in-depth).
- **Additive `freshness` envelope.** `ParentDashboardResponse.freshness?: SnapshotFreshness`
  (reuses the S1 contract type) — `source: 'snapshot' | 'live'`, `computedAt`, `recomputing`.
  Optional/ignored by today's clients (S4 wires the chip); excluded from the byte-parity contract
  test.
- **ABAC + tenant unchanged.** Controller `GET parent-dashboard/:studentId` still gates on
  `studentAccess.canAccessStudent(...)` before the service; `classSectionId`/`academicYearId` stay
  server-derived from the child's own active enrollment. No schema change, no new endpoint, no
  controller change, no `packages/ui` drift.
- **Tests** (`analytics.service.spec.ts`, +10 E6-S2 cases): byte-parity (≤0.01 tolerance for the
  Decimal-backed `ClassSubjectDistribution.average`), no-class-scan-on-hit, fall-through,
  tenant-scoping of every snapshot/trigger query, all-or-nothing gate (missing subject row **and**
  missing distribution row), degrade-to-live-on-throw, and freshness-provenance propagation.
- **Two review findings folded in before land** (orchestrator pass over the verify gate): (1) the
  snapshot-hit `freshness` now carries the **served snapshot's real** `computedAt` /
  `sourceEventId` / `revision` / `gradeCount` (was `new Date()` / partial), so the S4 chip can
  render "à jour il y a Xs" instead of always "0 s"; (2) `ClassSubjectDistribution` presence is now
  part of the all-or-nothing gate, so a partial recompute can never emit a `null` `classAverage`
  while still claiming `source:'snapshot'` (AC-S2-3 "never a wrong number").

## What landed (S3 — admin & teacher reads + revise/coefficient triggers)

- **Two new recompute-trigger enqueue seams (the deliverable value of S3):**
  - **GradeRevised** (`apps/api/.../grades/grades.controller.ts`): a shared best-effort
    `enqueueGradeRevisedRecompute(tenantId, assessmentId)` helper is called AFTER commit on BOTH
    revise seams — the single `POST :id/revise` and the `batch` path when ≥1 published grade flips to
    `status='revised'` (`wasPublished && valueChanged`). Resolves `(classSectionId, subjectId,
    academicYearId, termId)` from the assessment→teachingAssignment, idempotently upserts a class-wide
    `SnapshotRecomputeTrigger` (`reason:'grade_revised'`, coalesced on `(tenantId, coalesceKey,
    status='pending')`). A burst of revisions for one scope collapses to ONE pending row; an enqueue
    failure is caught+logged and NEVER fails the revise. Mirrors the S1 publish seam exactly.
  - **Coefficient change** (`apps/api/.../school-structure/subjects.controller.ts` `upsertCoefficients`):
    AFTER the matrix `$transaction` commits, for each DISTINCT changed `subjectId` × each active
    `academicYear`, idempotently upserts a **class-LESS** `SnapshotRecomputeTrigger`
    (`classSectionId:null`, `reason:'coefficient_changed'`, carrying `subjectId`+`academicYearId`,
    coalesced). A 30-entry matrix save collapses to one trigger per subject. Best-effort, never fails
    the coefficient save; writes NO audit row (the existing `coefficient.upsert` audit is untouched).
- **Worker fan-out for class-less `coefficient_changed`** (`apps/worker/.../snapshot-drain-cron.service.ts`):
  `drainTenant` now detects a class-less `coefficient_changed` trigger and calls a new
  `fanOutCoefficientChange` that resolves every distinct `ClassSection` teaching the subject in the
  year (`teachingAssignment.findMany` where `tenantId+subjectId+academicYearId`, `distinct`,
  `take=COEFFICIENT_FANOUT_TAKE=200`) and invokes the unchanged `recomputeScope` once per class (each
  class-scoped recompute rebuilds the whole slice incl. the re-weighted global). The trigger is marked
  `done` only after the whole fan-out; a class failure follows the existing attempts/parking path. The
  drain's per-trigger `findFirst` select gained `reason`. **No schema change** (the locked S1 trigger
  table has no `gradeLevelId` — the worker re-derives classes from subject+year, the architect's C-1
  worker-fan-out reading).
- **Additive `freshness` envelope on teacher-reports + drill-down** (`analytics.service.ts`
  `teacherReports`, `school-performance-drilldown.service.ts` `drilldown`): `TeacherReportsResponse`
  and `DrilldownResponse` gain the additive optional `freshness?: SnapshotFreshness` (mirrors S2 on
  `ParentDashboardResponse`). A tenant-scoped open-trigger probe sets `recomputing` (covering EVERY
  class scope in the multi-class/whole-school payload, PM-5); degrades to `recomputing:false` on a
  probe throw.
- **Read switch — honest byte-parity gate (the key S3 judgement).** Per the pre-mortem PM-1/2/3/4 and
  the architect's C-2, the teacher-reports and drill-down figures are **served LIVE**, not from
  snapshots, because the only candidate snapshot grain (`ClassSubjectDistribution`) is a CLASS-WIDE,
  all-teachers, round2 **grade-population** aggregate, whereas teacher-reports aggregates the teacher's
  OWN per-assignment grades at round1, and the drill-down counts **students** by their average
  (successRate / mean-of-means). A snapshot read at those surfaces would serve a *wrong number* under
  ≥2 assignments / partial grading / uneven subject sizes (Simpson's paradox). FR1's own escape clause
  ("if not, the gate must fall through to live for that surface") and FR2 ("snapshot-first only where
  ClassSubjectDistribution covers the exact figure; everything else stays live") authorise this. The
  reads keep their existing guards (`teaching_assignments.read` / `schools.read`); `freshness` is the
  visible S3 win (the S4 chip will render "recalcul en cours" off the trigger probe). **`schoolPerformance`
  also stays live (FR3)** — no cycle-grain snapshot exists (the draft `school_kpi_snapshot` was dropped).
- **Tests:** `analytics.service.spec.ts` (+4 teacher-reports freshness cases: source:'live', open-trigger
  → recomputing:true covering every class scope, tenant-scoped probe, throw-degrades-to-false);
  `snapshot-recompute.spec.ts` Part 4 (+3 drain cases: coefficient fan-out resolves the right classes
  one-recompute-per-class + marks done, a normal class-scoped trigger still routes to recomputeScope,
  an unresolvable class-less trigger is a no-op fan-out).
- **No schema/endpoint/permission/queue/contract change** (reuses S1 `SnapshotFreshness` +
  `snapshotCoalesceKey` + `SNAPSHOT_TRIGGER_REASON`). The parent read (S2) keeps working unchanged.

## What landed (S4 — freshness chip)

- **New app-level client component** `apps/web/src/components/freshness/FreshnessChip.tsx`
  (`'use client'`) — a thin composition over the existing `@pilotage/ui` `Badge` +
  `formatRelativeTime` (reuse-first; no `packages/ui` change, no DS Guardian promotion). Three
  states derived **purely** from the additive `freshness` field, never a fetch / loading gate:
  **Recomputing** (`recomputing === true`, checked first) → neutral Badge + spinning `RefreshCw` +
  "Recalcul en cours…"; **Fresh** (`source === 'snapshot' && !recomputing`) → success Badge +
  `CheckCircle2` + "À jour" with an aria-hidden "il y a {Xs}" suffix (+ optional " · N notes",
  plural toggle at N>1, omitted at 0); **Neutral/live** (`source === 'live'`) → quiet neutral Badge +
  "À jour" with no suffix. `!freshness` or empty `computedAt` → renders `null` (degrade-to-no-chip on
  older payloads / un-rewired surfaces).
- **Mounted on all three E6 read surfaces**, reading the field S2/S3 already put on the wire:
  `/parent/dashboard` (S2 snapshot read) in a new `flex … justify-between` header next to
  "Performance globale"; `/teacher/reports` and `/admin/analytics` (S3 live-served reads) in the
  existing `PageHeader actions` slot. Each page added the additive optional `freshness?` shape to its
  local response interface so an un-rewired payload still type-checks.
- **A11y (folds AC-5 / ux S4):** icon+text (not colour-alone), `role="status"` + `aria-live="polite"`
  with the **state word as the static `aria-label`** so the polite region announces the
  recomputing↔fresh transition but the 30 s relative-time tick (aria-hidden suffix) never
  re-announces; `motion-reduce:animate-none` on the spinner; kind/factual FR copy (no
  "obsolète/erreur/cache"); never names or compares another child.
- **Only client interactivity = a ~30 s `setInterval`** bumping `now` so "il y a 12 s" → "il y a 1 min"
  rolls forward without a refetch (cleared on unmount); the dashboards stay server components. A
  ≤5-line `relativeLabel` shim keeps "il y a {sec} s" sub-minute and defers to the shared
  `formatRelativeTime` from 60 s up; clock-skew (future `computedAt`) clamps to "à l'instant", a NaN
  date returns ''.
- **apps/web ONLY** — no schema, no endpoint, no permission, no contract, no `packages/ui` change.
- **Known limitation (folds the verify gate):** the chip reserves no min-width for the Fresh
  relative-time suffix, so on a snapshot-fresh hydration the pill widens once when the post-mount
  "il y a {Xs}" swaps in (minor CLS the spec's "no layout shift" AC-S4-4 flags). The three surfaces
  are server components that don't refetch, so the documented recomputing↔fresh live-region
  announcement only materialises across a full navigation/reload (informational, not interactive).
  Both recorded for an S5/polish follow-up; functionally the chip conveys state visually + via the
  accessible name on every paint.

## What landed (S5 — operability: idempotent full rebuild + sweep hardening)

- **Idempotent full rebuild — read-compare-write** (`snapshot-recompute.service.ts`): each per-term
  `upsert` (StudentSubjectSnapshot / StudentGlobalSnapshot / ClassSubjectDistribution) now reads the
  stored value columns first and **skips the write entirely** when they are byte-identical to the freshly
  derived figures → a re-run on unchanged grades is a **true no-op** (no `computedAt` move, no `revision`
  bump, AC-S5-2). The first compute / a real change still writes + bumps. Resolves the architect's
  Concern 1 / PM-A #3 (the `revision: { increment: 1 }` upsert previously bumped on every re-run). Year
  roll-up rows keep their delete-then-insert (always rebuilt); byte-parity with live unchanged.
- **Precise stale detection** (`snapshot-drain-cron.service.ts` `backfillLaggingTenants`, PM-B): replaced
  the S1 "only backfill classes with ZERO snapshots" short-circuit (`if (hasSnapshot) continue`) with a
  three-way staleness gate — **no snapshot** (S1 preserved) **OR** freshest snapshot `computedAt <
  lastGradeAt` (a dropped best-effort enqueue on a POPULATED class — the literal missed-event self-heal)
  **OR** `revision < SNAPSHOT_REVISION_FLOOR` (stale-by-logic). `lastGradeAt` = the latest `Grade.updatedAt`
  (moves on publish AND revise) over the bounded `take:500` probe; one coalesced `backfill` trigger per
  affected class; only tenants with no open trigger.
- **`SNAPSHOT_REVISION_FLOOR` operator knob** (PM-A): the spec's "`revision < current`" clause had no
  per-row `current` (revision is a per-row optimistic counter). Resolved as an env-overridable module
  constant (default `1` ⇒ inert, zero behaviour change) reusing the existing `revision` column — **no
  schema change**. Primary stale signal is `computedAt < lastGradeAt`; the floor is the deploy-time
  convergence lever after a recompute-logic change.
- **Claim-time staleness** (PM-C): `drainTenant` now stamps `processedAt = now` **at claim time**
  (pending→processing), and `reclaimStaleProcessing` keys the stale-processing reclaim on `processedAt`
  (how long a row has been RUNNING) instead of `enqueuedAt` (how long it WAITED) — a freshly-claimed row
  with an old `enqueuedAt` is no longer reclaimed mid-run (no double-recompute).
- **Failed-row parking + recovery** (PM-G): `MAX_ATTEMPTS` parking kept; a new `reviveFailedTriggers`
  pass revives a parked (`failed`) trigger older than `FAILED_RETRY_AFTER_MIN` back to `pending` with
  `attempts=0` (bounded by `FAILED_REVIVE_TAKE`) so a transient outage is not a permanent dark backlog.
  Per-tick log reports `parked` (crossed-cap this tick) + standing `failedBacklog`.
- **Orphan-snapshot prune** (PM-F): a new bounded (`ORPHAN_PRUNE_TAKE`), tenant-scoped `pruneOrphanSnapshots`
  on a coarser cadence (`ORPHAN_PRUNE_EVERY_TICKS`) deletes snapshot rows whose `studentId`/`classSectionId`
  has **no live `student`/`class_section` row at all** (HARD delete only — never enrollment/active status;
  a pupil who merely changed class is NOT an orphan). Best-effort, own deleteMany, never blocks a recompute,
  no audit row.
- **`manual_rebuild` routing** (the rebuild spine): `drainTenant` routes a `manual_rebuild` trigger through
  the existing FIFO loop — class-scoped → one `recomputeScope`; class-less `(subjectId, academicYearId)` →
  coefficient-style fan-out; fully unscoped → new bounded `fanOutWholeTenantRebuild` over every active class
  section (`REBUILD_FANOUT_TAKE`, rest converge over later ticks). Never a single mega-transaction.
- **Observability** (AC-S5-6): each tick logs one structured count object `{tenants, recomputed, failed,
  parked, revived, pruned, backfilled, failedBacklog, durationMs}` referencing
  `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` — NO queue/outbox write, no new event. Each new sweep op runs inside a
  `safe()` per-op try/catch so one op's failure never aborts the tick (AC-S5-5); the `running` guard prevents
  overlap.
- **Optional admin surface** (`apps/api/src/modules/analytics`, AC-S5-7): new `SnapshotOpsService` +
  two `@RequiresPermission('schools.read')` endpoints (NO new permission). `GET /analytics/snapshots/
  recompute-status` = tenant-scoped backlog counts + `oldestPendingAt` + a recent feed (read-only, no audit).
  `POST /analytics/snapshots/rebuild` = validates every supplied scope id **in-tenant** (404 on a foreign id,
  PM-E), idempotently coalesces a `manual_rebuild` trigger via the shared `snapshotCoalesceKey`, returns
  `{triggerId, status, coalesced}` (202), and writes exactly ONE append-only `analytics.snapshot_rebuild`
  audit row (best-effort, mirrors the `export.bulletin.request` precedent). `tenantId` is server-derived via
  `ctx.forUser` (never client-supplied).
- **Contracts** (additive only): `RebuildSnapshotsRequest/Response`, `SnapshotRecomputeStatusResponse`,
  `SnapshotRecomputeRecentItem` Zod schemas + types added to `dto/snapshot.ts` (auto-barrel-exported). No
  new enum, no new event, no schema change.
- **Tests** (`snapshot-recompute.spec.ts`, extended — not forked): Part 5 idempotent-rebuild (no-op on
  byte-identical stored rows / re-write on a real change); Part 6 `manual_rebuild` routing (class-scoped /
  coefficient fan-out / whole-tenant fan-out, tenant-scoped); Part 7 failed-row revival, precise stale
  detection (populated-lag self-heal / fresh-no-op / no-snapshot-still-backfills), orphan prune (orphan
  deleted, live row kept, tenant-scoped). The harness gained `findUnique` (read-compare-write) +
  `classSection.findMany` mocks.
- **No schema change beyond S1, no second BullMQ queue, no new permission, no new shared contract
  enum/event, no UI, no new ADR** (within ADR-019). **E6 complete — all 5 slices shipped.**

## Key decisions (locked in the spec)

- **Three snapshot tables + one dirty-queue**, derived from the canonical ERD §12:
  `student_subject_snapshot` (student × subject × term), `student_global_snapshot` (student × term, +
  year roll-up), `class_subject_distribution` (class × subject × term histogram). Plus the
  `snapshot_recompute_trigger` durable dirty-queue. Each tenant-scoped, carrying the freshness spine
  `computedAt` + `sourceEventId` + `revision`. **No existing table changes**; `db push` (no SQL
  `migrations/` folder — repo convention). *(The earlier draft's `school_kpi_snapshot` was dropped — the
  three grains above cover the dashboards' reads; a school-KPI roll-up is a possible later refinement.)*
- **Snapshot = a disposable CACHE over `Grade` rows, never the source of truth.** Every value is
  reproducible from a full recompute; deleting the tables degrades latency, never correctness.
- **Recompute spine = a durable dirty-queue drained by a cron poll** (structural sibling of `alerts-cron`
  / `notifications-digest` / `parent-digest`), **not** a second BullMQ queue and **not** the unbuilt
  `OutboxEvent`→BullMQ listener. Every snapshot-invalidating mutation (`GradePublished`, `GradeRevised`,
  coefficient change) best-effort `upsert`s an idempotent, coalescing `SnapshotRecomputeTrigger`; the
  worker drains it tenant-by-tenant + backfills lagging tenants. Enqueue failure never blocks the publish.
- **Read = snapshot-first with fall-through-to-live.** The `/api/v1/analytics/*` aggregate endpoints keep
  their **exact** contract; on a missing/stale snapshot they transparently serve the existing live
  computation (never an error). **Byte-parity** (one shared normalise/coefficient formula) is the gate on
  every read switch.
- **Visionary spine = freshness as a trust signal:** an additive optional `freshness { source, computedAt,
  recomputing }` block → a calm, non-alarming parent/teacher/admin chip ("à jour il y a Xs" / "recalcul en
  cours…"). Zero new queue, zero new permission (rides the snapshot's own metadata).
- **Wires the already-declared `analytics.SnapshotRecomputed` event** (currently unwired in
  `packages/contracts`). No new event name.
- **One new ADR is required** (the only new architectural decision): a durable dirty-queue + materialised
  analytics cache + fall-through-to-live → **`docs/adr/ADR-0NN-analytics-snapshots.md`**, authored on the
  **S1 implementation run** (it documents a decision being made). `data-model.md` §6 proposes `ADR-019`;
  reconcile the number against the ADR index at authoring time (another doc references an ADR-019
  real-time deferral, so pick the next free number if 019 is taken).
- **Guardrails:** tenant + RLS on every row/query/read; parent guardianship ABAC
  (`StudentAccessService`) **before** the snapshot read; aggregates-only RGPD-minimal child data (no new
  personal data; rebuildable cache); no audit row per recompute (derived bookkeeping, like the alerts/
  digest crons); an **admin manual rebuild** (later) is an explicit action → one append-only
  `analytics.snapshot_rebuild` audit row. Kind/factual/French freshness copy (no "obsolète/erreur/cache").

## Open questions for the slice runs (recorded, not blocking)

- **ADR number** — confirm the next free `docs/adr/` number (data-model §6 says `ADR-019`; verify against
  the index since an ADR-019 real-time deferral is referenced elsewhere).
- **NULL-term uniqueness on the snapshots** — the year-roll-up row (`termId = null`) is singularised at the
  recompute layer via delete-then-insert in the same transaction (`data-model.md` §1.1 / §3.4); the S1
  story confirms keeping the app-layer guarantee vs. a sentinel non-null "year" termId for a pure DB
  unique.
- **Snapshot FKs vs. plain `@db.Uuid` scope ids** — `data-model.md` §1.5 recommends shipping the snapshot
  scope ids **without** Prisma `@relation` (cache-row convention, zero edit to existing models'
  relation blocks; orphan rows are harmless + reaped by rebuild). The S1 story records the DBA-lens call
  (plain ids vs. `onDelete: Cascade`).
- **Exact GradeRevised + coefficient-change enqueue seams** (S3) — the precise service methods to hook for
  the revise + coefficient paths.

## Definition of done (epic)

All five slices shipped: snapshots exist + stay fresh via the dirty-queue + cron, byte-parity with live
(S1); the parent dashboard reads snapshot-first behind the unchanged contract at <2 s scale (S2); teacher/
admin reads + the revise/coefficient triggers land (S3); the freshness chip surfaces the trust signal on
the parent/admin/teacher dashboards (S4); the idempotent full rebuild + sweep hardening make a missed
event or a fresh tenant always converge (S5) — all behind the universal live fallback. On full completion
→ set roadmap E6 `status: shipped`, advance to **E7 — Remediation & Tutoring loop**.
