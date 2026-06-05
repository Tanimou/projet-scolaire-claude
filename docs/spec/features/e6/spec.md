# E6 — Analytics Snapshots & pre-computation

> **Status:** in-progress (spec run) · **Size:** ~M · **Tier:** 3 (Scale & new surfaces)
> **Audit:** analytics ~40% — every dashboard payload is computed **live** on each request
> (`AnalyticsService.parentDashboard` / `teacherReports` / `schoolPerformanceDrilldown` fan out
> dozens of `grade.findMany` + per-student/per-subject in-memory aggregation on the hot path).
> There are **no** `*_snapshot` models in any `.prisma`. The worker already runs the cron/event
> recompute pattern E6 mirrors (`alerts-cron`, `notifications-digest`, `parent-digest`).

## Vision

The cahier de charges names **one non-functional requirement above all others**: the parent
dashboard must answer its five questions **in under 2 seconds**, on mobile, *at scale*. Today it
does — but only because the demo tenants are small. The parent payload is recomputed from raw
`Grade` rows **on every page load**: it pulls every published grade for the child **and** every
published grade for the **whole class** (to derive class averages and ranks), groups them by
subject and by term in memory, computes per-subject rank by scanning every classmate, then does it
again for the recent-grades table. That is acceptable for a 25-pupil class and a handful of
families; it is an O(class × grades) live scan that degrades exactly when a school grows — the
moment the <2 s promise matters most.

E6 makes the dashboards **read pre-computed results instead of recomputing them live.** A
tenant-scoped worker **materialises** three snapshot tables — `student_subject_snapshot` (one row
per student × subject × term: the student average, the class average, rank, trend), 
`student_global_snapshot` (one row per student × term: weighted overall average, class average,
rank, attendance, progression), and `class_subject_distribution` (one row per class × subject ×
term: the low/mid/high histogram + class average + sample size that powers admin/teacher
distribution charts). The worker **recomputes the affected slice** when grades change —
on **GradePublished**, **GradeRevised**, and **coefficient change** — mirroring the exact
cron/event recompute pattern already proven by `alerts-cron`. The `/api/v1/analytics/*` aggregate
endpoints the dashboards already call are **rewired to read the snapshot** when one is fresh, and
**fall back to the live computation** when it is missing or stale — so the contract never breaks
and the parent <2 s NFR holds as the data grows.

**The visionary spine — freshness as a trust signal.** Pre-computation is normally an *invisible*
performance trick. E6 makes it **legible and reassuring**: every snapshot carries `computedAt` +
`sourceEventId`, and each dashboard surfaces a subtle, kind **freshness chip** — *"à jour il y a
12 s"* when fresh, *"recalcul en cours…"* while the worker catches up after a grade publish. This
turns the optimisation into the cahier's **explainability promise made visible**: a parent *sees*
that they are looking at the latest published grades, not a cached guess. Zero new queue, zero new
permission — the chip rides the snapshot's own metadata.

## Users & why

- **Parent — the core user.** Benefits directly: the dashboard the cahier centres on stays **under
  2 s** even when the school scales to hundreds of classes, because the payload is a handful of
  indexed snapshot reads, not a class-wide live scan. The freshness chip reassures them the numbers
  are current ("à jour il y a quelques secondes") and tells them, kindly, when a just-published
  grade is still being folded in ("recalcul en cours") — no stale-data anxiety, no spinner.
- **Teacher.** The `/teacher/reports` distribution charts and per-class averages (today a live
  multi-class aggregation) read the `class_subject_distribution` snapshot — faster reports, same
  numbers. The teacher's act of **publishing** a grade is what *triggers* the recompute, so by the
  time they switch to reports the snapshot is fresh (or visibly recalculating).
- **Admin / school.** The `/admin/analytics` drill-down and school-performance donuts read snapshot
  aggregates instead of re-scanning every grade per request, so the admin analytics page scales with
  the school. No admin action is required by E6 — recompute is automatic and tenant-scoped.
- **The platform itself.** E6 is the **scale enabler** for every later epic: once analytics are
  materialised, new read surfaces (student portal, exports, OneRoster) read cheap snapshots instead
  of multiplying the live-scan cost.

## Concrete scenarios

1. **Parent dashboard at scale (the headline).** A school has grown to 600 pupils across 24 classes.
   A parent opens `/parent/dashboard`. The aggregate endpoint reads **one** `student_global_snapshot`
   row + a handful of `student_subject_snapshot` rows (indexed by `(tenantId, studentId,
   academicYearId)`) + the matching `class_subject_distribution` rows — **no class-wide grade scan**.
   The page renders well under 2 s. A small chip reads *"Données à jour il y a 3 min"*. Every number
   (overall average, per-subject average vs class, rank, trend) is identical to what the live
   computation would have produced — the snapshot **is** that computation, persisted.

2. **A grade is published → recompute → freshness chip (the trust signal).** A teacher publishes an
   assessment for class 4eB. The publish path (best-effort, after the existing notification fan-out)
   **enqueues a snapshot-recompute job** scoped to `(tenantId, classSectionId, termId)` with a
   `sourceEventId`. The worker consumer recomputes the affected `student_subject_snapshot` /
   `student_global_snapshot` / `class_subject_distribution` rows for that class+subject+term and
   stamps each with `computedAt = now` + that `sourceEventId`. A parent of a 4eB pupil who is on the
   dashboard at that moment sees the chip flip to *"Recalcul en cours…"* (the snapshot's
   `computedAt` predates the latest published grade) and then settle back to *"à jour il y a quelques
   secondes"* on the next poll/refresh. No parent ever sees a wrong number — only "fresh" or
   "catching up", never "stale and pretending to be fresh".

3. **A grade is revised (correction after publication).** A teacher corrects a published grade (a
   `GradeRevision` row). The same recompute job fires for the affected class+subject+term; the
   snapshot rows are recomputed in place (upsert keyed on `(tenant, student, subject, term)`), so the
   parent's average/rank reflect the correction within the recompute window. The freshness chip
   covers the gap honestly.

4. **A coefficient changes (admin edits `SubjectCoefficient`).** An admin changes the coefficient of
   a subject for a grade level. Every student's **weighted overall** average in every class of that
   grade level is now stale. The coefficient-change path enqueues a **grade-level-scoped** recompute
   (broader than a single class), and the worker rebuilds the `student_global_snapshot` rows for the
   affected classes+terms. The dashboards reflect the new weighting after the recompute; until then
   the chip says "recalcul en cours" and the endpoint can transparently fall back to live.

5. **Snapshot missing or stale → graceful live fallback (never a broken dashboard).** A brand-new
   tenant has no snapshots yet (the first recompute hasn't run), or a snapshot is older than the most
   recent published grade for that scope. The aggregate endpoint **falls back to the existing live
   computation** for that payload — byte-for-byte the current behaviour — so the dashboard is
   **always** correct and **never** blocked on the worker. E6 is a *read accelerator with a safety
   net*, not a load-bearing single point of failure.

## Functional requirements

**FR-1 — Three materialized snapshot tables (tenant-scoped, additive).** E6 adds
`student_subject_snapshot`, `student_global_snapshot`, and `class_subject_distribution` (Prisma
models, `prisma db push`, repo convention — no SQL `migrations/` folder). Each is **tenant-scoped**
(`tenant_id` + RLS, ADR-002), carries the freshness metadata `computedAt` + `sourceEventId`, and is
**purely derived** — every row can be rebuilt from raw `Grade`/`SubjectCoefficient` data, so the
tables are a cache, never a source of truth. No existing model changes shape (additive-only).

**FR-2 — Snapshot content mirrors today's live payload exactly.** Each snapshot stores precisely the
figures the live `AnalyticsService` already derives, so swapping read paths is byte-identical:
- `student_subject_snapshot(student, subject, term)`: `studentAverage`, `classAverage`,
  `studentRank`, `classSize`, `coefficient`, `trend` (delta vs previous term).
- `student_global_snapshot(student, term)`: weighted `overallAverage`, `classAverage`,
  `studentRank`, `classRankTotal`, `attendanceRate`, `progression` (delta vs previous term),
  `percentageOnTwenty`.
- `class_subject_distribution(classSection, subject, term)`: `low`/`mid`/`high` histogram counts,
  `classAverage`, `passRate`, `sampleSize`.
The **same** on-/20 normalisation, the **same** coefficient resolution (override → `SubjectCoefficient`
→ default), and the **same** published-only / non-absent filters as the live code (the recompute
**reuses** the existing aggregation logic; see plan.md §2 — it does not re-derive the formulas).

**FR-3 — Tenant-scoped recompute spine on grade events (mirrors `alerts-cron`).** A worker
recompute consumer rebuilds the **affected slice** of snapshots, triggered on:
- **GradePublished** — `POST /assessments/:id/publish` (the existing best-effort fan-out seam) →
  recompute scoped to `(tenantId, classSectionId, termId)`.
- **GradeRevised** — grade revision/correction → same class+subject+term scope.
- **Coefficient change** — `SubjectCoefficient` create/update → recompute scoped to the affected
  `(tenantId, gradeLevelId)` (broader: every class of that grade level, current terms).
Each trigger is recorded as a durable, idempotent **dirty row** in a `snapshot_recompute_trigger`
table (a *queryable backlog*, **not** a second BullMQ queue) that a **safety-net cron** (structural
sibling of `AlertsCronService`) drains tenant-by-tenant — so a recompute survives a worker restart
and the freshness chip can truthfully show "recalcul en cours" while an open trigger exists. The cron
**also** backfills any tenant whose snapshots are older than its latest published grade (covers missed
enqueues, new tenants, crash recovery). Recompute is **idempotent** (a coalescing unique key collapses
a burst of publishes for one scope into one pending row; the snapshot upsert is keyed on its natural
key) and **best-effort** (a recompute enqueue failure never blocks the publish, exactly like the
notification fan-out — see scenario 2). **No second BullMQ queue is introduced** — the durable
dirty-queue table + the existing cron-poll pattern is the deliberate mechanism (it avoids coupling E6
to the still-unwired `OutboxEvent`→BullMQ listener; see data-model.md §1.4 / plan.md §ADR).

**FR-4 — Aggregate endpoints read snapshot-first with live fallback.** The existing
`/api/v1/analytics/*` endpoints (`parent-dashboard/:studentId`, `teacher-reports`,
`school-performance-drilldown`, …) are rewired to **read the snapshot when it is fresh**, and **fall
back to the existing live computation** when the snapshot is **missing** or **stale** (its
`computedAt` predates the most recent relevant published grade / coefficient change). The
**response shape is unchanged** — the dashboards do not know whether they got a snapshot or a live
result, except for the new optional freshness metadata (FR-5). No new endpoint, no permission
change; the endpoints keep their current `students.read` / `teaching_assignments.read` /
`schools.read` guards + the parent `StudentAccessService` ABAC.

**FR-5 — Freshness as a first-class signal (the visionary spine).** Each snapshot row carries
`computedAt` (when the worker last rebuilt it) and `sourceEventId` (the event that triggered the
rebuild). The aggregate payloads expose an **additive, optional** `freshness` block
(`{ source: 'snapshot' | 'live', recomputing: boolean, computedAt, sampleSize? }` — see
`contracts/openapi.yaml`) the dashboards render as a kind chip — *"à jour il y a Xs"* (fresh
snapshot), *"recalcul en cours…"* (`recomputing=true`: a newer grade exists than the snapshot's
`computedAt`, fallback served live), or **absent/neutral** (live, no snapshot yet).
The chip is **non-alarming, non-stigmatising, reassuring** — it says *"you're seeing the latest"*,
never *"data may be wrong"*.

**FR-6 — Snapshot is a cache, never the truth.** Snapshots are **derived and disposable**: deleting
every snapshot row degrades only performance (the endpoints fall back to live), never correctness.
Recompute is the **only** writer of snapshot rows (no API write path, no manual edit). RGPD: snapshots
hold the **same** minimal derived figures the dashboards already show (averages, ranks, counts) — **no
new personal data**, and they inherit `Student`/grade deletion via the recompute scope + tenant RLS.

**FR-7 — Tenant / RLS / RBAC / ABAC / audit guardrails.** Every snapshot read and every recompute
query is **tenant-scoped** (`where: { tenantId }` + RLS). The endpoints keep their existing RBAC
permissions and the parent **ABAC** wall (`StudentAccessService.canAccessStudent` before any
`parent-dashboard` read — the snapshot read is **behind** that check, never around it). The recompute
worker resolves recipients/scope per-tenant (like `alerts-cron`/`notifications-digest`). **Append-only
audit** is preserved: recompute writes only the derived snapshot cache (no audit row per recompute —
it is bookkeeping, exactly as the digest sent-marker is not audited), and no E6 code path touches the
`AuditLog` write convention of the events it observes.

**FR-8 — Backward compatible by default; ship-able in thin slices.** Until a snapshot exists for a
scope, **every** endpoint behaves **exactly as today** (live). The first slice (S1) ships the schema
+ recompute spine + the publish-event trigger **without** rewiring any read path (snapshots are
built but not yet read) — provably zero behaviour change. Later slices wire the reads one surface at
a time (parent dashboard first — the NFR that matters most), each behind the live fallback, so any
slice can land and be reverted independently.

## Acceptance criteria (epic-level)

- **AC-1 (snapshot schema, additive).** Three tenant-scoped models
  (`student_subject_snapshot`, `student_global_snapshot`, `class_subject_distribution`) land via
  `prisma db push` (no SQL `migrations/` folder), each with `tenantId` (+ RLS), the FR-2 derived
  columns, `computedAt`, `sourceEventId`, a natural-key `@@unique`, and a tenant-first index for the
  dashboard read. No existing model changes shape. Safe on existing rows (new tables, no backfill of
  others).
- **AC-2 (recompute is correct & idempotent).** For a given `(tenant, class, subject, term)`, the
  recompute produces snapshot figures **byte-identical** to the live `AnalyticsService` output for the
  same inputs (a unit test pins student average, class average, rank, trend, and the distribution
  histogram against the live computation on a fixture). Re-running the recompute for the same scope
  with unchanged grades is a no-op upsert (idempotent). A per-scope recompute failure never aborts the
  tenant loop and never blocks the triggering publish.
- **AC-3 (event + cron triggers, tenant-scoped).** GradePublished, GradeRevised, and coefficient
  change each enqueue/trigger a recompute scoped to the affected slice; a periodic safety-net cron
  (sibling of `AlertsCronService`) backfills any tenant whose snapshots lag its latest published
  grade. Every trigger and query is tenant-scoped; recompute is best-effort and isolated per scope.
- **AC-4 (snapshot-first read with live fallback).** Each rewired `/analytics/*` endpoint returns the
  snapshot when fresh and the **existing live result** when the snapshot is missing/stale, with an
  **unchanged response shape** (plus the additive `freshness` block). A test proves: snapshot present
  + fresh → served from snapshot; snapshot absent → served live (identical payload); snapshot stale
  (older than newest grade) → served live + `freshness.recomputing = true`.
- **AC-5 (freshness chip — the visionary signal).** The parent/teacher/admin dashboards render a
  subtle, kind freshness chip from the additive `freshness` metadata: *"à jour il y a Xs"* /
  *"recalcul en cours…"* / neutral. WCAG-AA: not colour-alone (icon + text), `aria-live="polite"` on
  the "recalcul en cours" transition, ≥ 4.5:1 contrast; mobile-first; non-stigmatising copy.
- **AC-6 (NFR — parent <2 s at scale).** The parent-dashboard aggregate, served from snapshot, does
  **no** class-wide live grade scan (it reads O(subjects) indexed snapshot rows + one global row).
  The quickstart documents the manual proof; the targeted test asserts the snapshot path issues no
  class-grade `findMany`.
- **AC-7 (tenant / RLS / ABAC / RGPD / cache-not-truth).** Every read/recompute is tenant-scoped + RLS;
  the parent `StudentAccessService` ABAC check precedes every snapshot read; snapshots carry no new
  personal data and are fully rebuildable (deleting them degrades only speed); recompute writes no
  audit row (bookkeeping) and never alters the observed events' audit. French, kind,
  non-stigmatising freshness copy.
- **AC-8 (the one new architectural decision is filed).** E6 reuses the cron/poll-drain recompute
  pattern (`alerts-cron`), the best-effort publish-fan-out seam, the `AnalyticsService` aggregation
  logic, the snapshot-as-derived-cache idea, and `@pilotage/ui`. Its **one** new cross-cutting decision
  — a *durable materialized snapshot cache + dirty-queue recompute + fall-through-to-live* — **lands
  with a new `docs/adr/` ADR** (Winston gate; authored on the S1 implementation run — it documents the
  decision being made; see plan.md §ADR / data-model.md §6). E6 introduces **no** second BullMQ queue
  (the `snapshot_recompute_trigger` table is a queryable backlog, not a queue), **no** new permission,
  **no** new HTTP style, **no** Postgres `MATERIALIZED VIEW` / external store — those remain non-goals.

## Non-goals

- **No real-time / WebSocket push** of freshness or recompute status. The chip updates on the
  dashboard's existing fetch/refresh cadence (or a light poll), not a live socket (same ADR-019
  deferral as messaging/notifications). Per-second live freshness is a future refinement.
- **No new analytics *metrics*.** E6 **materialises the figures the dashboards already compute** — it
  does not invent new KPIs, new charts, or new comparisons. (New metrics are a separate epic.)
- **No cross-tenant / org-wide analytics, no benchmarking against other schools.** Snapshots are
  strictly within-tenant, within-class, exactly like today's live computation.
- **No snapshot-write API, no manual snapshot editing, no admin "rebuild now" button** in the first
  slices (the safety-net cron + events cover staleness). An admin trigger is a possible later refinement,
  not a goal.
- **No rewrite of the live `AnalyticsService`** — it stays as the fallback and the **source of the
  aggregation logic** the recompute reuses. E6 wraps it, it does not replace it.
- **No second BullMQ queue without an ADR** (AC-8 tripwire). Per-student real-time recompute, columnar
  store, or a materialized-view DB feature (Postgres `MATERIALIZED VIEW`) are out of scope —
  E6 uses plain tenant-scoped tables rebuilt by the worker, mirroring the existing cron pattern.
- **No change to how grades are entered/published/revised** beyond adding the best-effort recompute
  enqueue at the existing seam (the publish/revise behaviour itself is untouched).

## Slices (ship in order; each ≤ a day, one PR, demoable end-to-end)

> Five slices: S1 stands up the store + recompute spine **without reading it** (zero behaviour change);
> S2/S3 flip read sources one surface at a time behind the live fallback; S4 surfaces the freshness chip;
> S5 hardens operability. See [`tasks.md`](./tasks.md) for the authoritative slice backlog + AC.

- **S1 — Snapshot schema + recompute spine.** *(schema + worker + small api; `[schema][worker]` P1)*
  Add the three additive snapshot read-models (`student_subject_snapshot`, `student_global_snapshot`,
  `class_subject_distribution`) + the durable `snapshot_recompute_trigger`
  dirty-queue (`db push`, freshness metadata `computedAt` + `sourceEventId` + `revision`) +
  a tenant-scoped **recompute service** that rebuilds the affected slice by **reusing the live
  `AnalyticsService` aggregation logic**, enqueued on **GradePublished** at the existing best-effort
  publish seam, drained by a re-entrant cron (sibling of `AlertsCronService`) plus a safety-net sweep
  that backfills lagging tenants. **Snapshots are written but not yet read** — provably zero behaviour
  change (FR-8). Targeted test: recompute == live (byte-identical, AC-2), idempotent, tenant-scoped.
  Lands **with the analytics-snapshots ADR** (Winston gate). **No second BullMQ queue.**

- **S2 — Parent dashboard reads snapshots (headline perf win).** *(api; `[api]` P1)* Rewire
  `GET /analytics/parent-dashboard/:studentId` to read `student_global_snapshot` +
  `student_subject_snapshot` (+ distribution where needed) **behind the existing `StudentAccessService`
  ABAC**, with the **live fallback** when the snapshot is missing/stale; add the additive `freshness`
  block to the payload. Identical numbers, a snapshot-served path (no class-wide live scan) holding the
  <2 s NFR; the existing UI renders unchanged (the chip is S4). **No schema change.**

- **S3 — Admin & teacher aggregates read snapshots.** *(api; `[api]` P1-P2)* Wire
  `class_subject_distribution` (+ `student_subject_snapshot`) into `/analytics/teacher-reports`,
  `adminDashboard`, and the `/admin/analytics` school-performance drill-down (snapshot-first + live
  fallback + `freshness`); add the GradeRevised + coefficient-change recompute triggers so teacher/admin
  views stay fresh under corrections and re-weighting. **No schema change.**

- **S4 — Freshness chip (the visionary trust signal).** *(web; `[web][a11y]` P2)* Render a calm
  `@pilotage/ui` **`FreshnessChip`** on the parent + admin (+ teacher) dashboards from the additive
  `freshness` field — *"à jour il y a Xs"* (fresh) / *"recalcul en cours…"* (stale, live fallback) /
  neutral — turning pre-computation into a visible *"you're seeing the latest published grades"* signal.
  WCAG-AA (icon+text, `role="status"`+`aria-live="polite"`, ≥4.5:1, `prefers-reduced-motion`),
  mobile-first, non-stigmatising FR copy; degrades to no-chip when `freshness` is absent. **No schema,
  no new endpoint, no permission.**

- **S5 — Operability: idempotent full rebuild + sweep hardening.** *(worker; `[worker]` P2)* Make the
  recompute self-healing at scale: an idempotent full-rebuild path per scope (admin `manual_rebuild`
  trigger, audited) + sweep hardening (`revision` lazy-refresh of stale-logic rows, failed-row
  parking/retry caps, orphan-snapshot prune). A missed event or a fresh tenant always converges. **No
  schema beyond S1.**

See [`tasks.md`](./tasks.md) for the slice backlog, [`plan.md`](./plan.md) for the architecture,
[`data-model.md`](./data-model.md) for the snapshot tables + dirty-queue, [`contracts/openapi.yaml`](./contracts/openapi.yaml)
for the (additive `freshness`) API delta, [`ux.md`](./ux.md) for the freshness-chip UX contract, and
[`quickstart.md`](./quickstart.md) for the manual demo per slice. Per-slice self-contained specs live
in `stories/` (written on each slice's run).
