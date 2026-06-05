# E6 — Slice backlog (tasks)

> The shippable vertical slices for **E6 — Analytics Snapshots & pre-computation**. Each slice = one PR
> + one build, demoable end-to-end. Ship **in order** (S1 → S2 → S3 → S4 → S5). Per-slice self-contained
> `story` specs land in [`stories/`](./stories/) on each slice's run. See [`spec.md`](./spec.md) for AC,
> [`plan.md`](./plan.md) for architecture, [`data-model.md`](./data-model.md) for the three snapshot
> tables + the dirty-queue, [`ux.md`](./ux.md) for the freshness-chip UX contract,
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) for the additive `freshness` delta,
> [`quickstart.md`](./quickstart.md) for the manual demo.

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc:** S1 stands up the store + recompute spine **without reading it** (zero behaviour change);
> S2/S3 flip the read sources one surface at a time behind the live fallback; S4 surfaces the freshness
> chip; S5 hardens operability.

---

## [ ] S1 — Snapshot schema + recompute spine + publish trigger · `[schema][worker]` · P1 · ~M

**Goal:** the foundation — the three snapshot tables + the dirty-queue exist, and a published grade
**enqueues a recompute** the worker drains into byte-parity snapshot rows. **No read wiring yet**
(dashboards still compute live), so the slice is **provably zero behaviour change** (FR-8); demoable by
publishing a grade and watching the snapshot rows refresh.

**Scope (schema + worker + small api):**
- **Schema (`db push`):** add `enum SnapshotTriggerReason`, `enum SnapshotTriggerStatus`, the three
  snapshot models `StudentSubjectSnapshot`, `StudentGlobalSnapshot`, `ClassSubjectDistribution`, and the
  `SnapshotRecomputeTrigger` dirty-queue (see `data-model.md` §1). Each tenant-scoped, freshness columns
  (`computedAt` + `sourceEventId` + `revision`), natural-key `@@unique` + tenant-first read indexes. **No
  existing table changes.** Add the 4 RLS policies; `prisma generate`.
- **Contracts:** add the snapshot/trigger types + `SNAPSHOT_TRIGGER_REASON` const to `packages/contracts`.
- **API enqueue (additive, best-effort):** at the grade-publish seam (`assessments.controller.ts`
  publish path), **after** commit, idempotently `upsert` a `SnapshotRecomputeTrigger` on
  `(tenantId, coalesceKey, status='pending')`. Failure is caught + logged, **never** blocks the publish.
- **Worker:** a new `apps/worker/src/modules/analytics-snapshots/*` module — structural sibling of
  `alerts-cron`:
  - `SnapshotRecomputeService` — recompute one scope by **reusing the live `AnalyticsService`
    normalise/coefficient formula** (extracted to one shared pure helper, no second formula); upsert the
    affected snapshot rows in **one transaction** (per-term rows + delete-then-insert year-roll-up +
    cascade global + refresh distribution; bump `revision`, set `computedAt` + `sourceEventId`).
  - `SnapshotDrainCronService` — poll-and-drain pending triggers per tenant (re-entrant, best-effort per
    tenant) **+ backfill** any tenant whose snapshots lag its latest published grade; emit
    `analytics.SnapshotRecomputed`.

**Acceptance (folds spec AC-1/2/3/7/8):**
- Schema lands additive via `db push`; the three snapshot tables + the trigger table are tenant-scoped
  with freshness columns + RLS + indexes; no existing table touched; no backfill of other tables.
- **Byte-parity test (Murat-picked):** snapshot output (`average` / weighted global / `classAverage` /
  `classRank` / distribution histogram / trend) equals `AnalyticsService` live output on a seeded fixture;
  recompute is **idempotent** (re-run unchanged grades → no-op upsert); a per-scope failure never aborts
  the tenant loop and never blocks the publish; `SnapshotRecomputed` emitted per pass.
- Recompute mirrors the worker cron/poll-drain pattern; tenant-scoped throughout; the enqueue coalesces a
  burst into one pending row.
- **Lands with the new `docs/adr/ADR-0NN-analytics-snapshots.md`** (Winston gate — the durable dirty-queue
  + materialised-cache + fall-through decision; reconcile the ADR number against the index).
- **No second BullMQ queue, no `MATERIALIZED VIEW`, no read-path change, no new permission.**

**Out of scope:** any dashboard read rewire (S2/S3), the freshness chip (S4), the GradeRevised +
coefficient-change triggers (S3), the admin rebuild surface (S5).

---

## [ ] S2 — Parent dashboard reads snapshots (headline perf win) · `[api]` · P1 · ~M

**Goal:** the headline NFR win — `/parent/dashboard` serves from snapshots behind the **exact existing
contract** (with live fallback), collapsing the class-wide live scan into indexed point-reads. **No chip
yet** (S4) — the UI is unchanged; the win is the snapshot-served path + the additive `freshness` field.

**Scope (api only):**
- Rewire `GET /analytics/parent-dashboard/:studentId` (and sibling parent reads) to assemble the **same**
  `ParentDashboardResponse` from `student_global_snapshot` + `student_subject_snapshot`
  (+ `class_subject_distribution` for the "vs classe" context), **behind the existing
  `StudentAccessService.canAccessStudent` ABAC** (check first), with **fall-through-to-live** when the
  snapshot is missing/stale (never an error).
- Add the additive optional `freshness { source, computedAt, recomputing, gradeCount? }` block to the
  payload (`recomputing` = open trigger exists for the scope, or served live).

**Acceptance (folds spec AC-4/6):**
- **Contract test:** the snapshot-assembled payload is byte-identical to the live payload (minus the
  additive `freshness`); the existing UI renders unchanged.
- Snapshot present+fresh → served from snapshot (no class-wide grade `findMany`, AC-6); snapshot
  absent/stale → served live, `freshness.recomputing = true`. The query collapse is shown in
  `quickstart.md`, holding **<2 s on mobile at scale**.
- Tenant + ABAC preserved; `freshness` additive/optional; **no schema change, no new endpoint, no
  permission change.**

**Out of scope:** the chip (S4), teacher/admin reads (S3).

---

## [ ] S3 — Admin & teacher aggregates read snapshots + revise/coefficient triggers · `[api]` · P1-P2 · ~M

**Goal:** complete the read-rewiring — teacher reports + admin dashboard/drill-down read the
`class_subject_distribution` (+ `student_subject_snapshot`) snapshots (snapshot-first + live fallback),
and add the remaining recompute triggers so those views stay fresh under corrections and re-weighting.

**Scope (api + small worker):**
- Wire the distribution snapshots into `/analytics/teacher-reports`, `adminDashboard`, and the
  `/admin/analytics` school-performance drill-down, snapshot-first with live fallback; add the additive
  `freshness` block to those payloads.
- Add the **GradeRevised** + **coefficient-change** recompute-trigger enqueues (the GradeRevised path
  scopes to the affected class+subject+term; coefficient change scopes to the affected grade level's
  students — broader, fanned out in the worker).

**Acceptance (folds spec AC-4):**
- Teacher reports + admin dashboard/drill-down read distribution snapshots with live fallback; output
  unchanged (contract test); the parent read (S2) keeps working.
- GradeRevised + coefficient-change each enqueue a tenant-scoped, coalesced recompute; corrections and
  re-weighting reflect after the recompute.
- **No schema change beyond S1.**

**Out of scope:** the chip (S4), the admin rebuild surface + operability hardening (S5).

---

## [ ] S4 — Freshness chip (the visionary trust signal) · `[web][a11y]` · P2 · ~S

**Goal:** turn pre-computation into a **visible** trust signal — a calm `@pilotage/ui` `FreshnessChip` on
the parent + admin (+ teacher) dashboards, rendered from the additive `freshness` field (ux.md §1–§5).

**Scope (`apps/web` only):**
- A small `FreshnessChip` reading `freshness { source, computedAt, recomputing }`: Fresh ("À jour il y a
  {Xs}") / Recomputing ("Recalcul en cours…") / neutral (live, no snapshot). Relative-time tick is the
  only client interactivity (`'use client'` for the chip alone; dashboards stay server components).
- Mount on `/parent/dashboard` (S2 read), then the same idiom on `/admin/analytics` + `/teacher/reports`
  (S3 reads). Degrades to **no chip** when `freshness` is absent.

**Acceptance (folds spec AC-5 + ux S4):**
- The chip renders the three states on each surface from the additive field; "recalcul en cours" while a
  trigger is open / served live, "à jour il y a Xs" when fresh; never a loading gate (data always shown).
- WCAG 2.2 AA: icon+text (not colour-alone), `role="status"` + `aria-live="polite"` announcing **only**
  the recomputing↔fresh transition (not every relative-time tick), ≥4.5:1, `prefers-reduced-motion`
  honoured, ≥44 px if interactive; mobile-first; kind FR copy (no "obsolète/erreur/cache"); never
  names/compares another child.
- No schema, no new endpoint, no permission.

**Out of scope:** real-time auto-refresh of an open dashboard (a reload reflects the newer state).

---

## [ ] S5 — Operability: idempotent full rebuild + sweep hardening · `[worker]` · P2 · ~S-M

**Goal:** close the operability story — a missed event or a fresh/migrated tenant always converges, and a
full rebuild is always safe. Optionally surfaces the admin rebuild/status endpoints (contracts).

**Scope (worker + small api):**
- An **idempotent full-tenant/scope rebuild** path (install / backfill / `revision` bump) — re-run →
  identical rows, same `revision`.
- Sweep hardening: precise stale detection (`computedAt < lastGradeAt` OR `revision <` current), failed-row
  parking + retry cap, orphan-snapshot prune, per-tenant resilience, bounded batch size, observability
  (counts logged + `SnapshotRecomputed`).
- (Optional) the admin operational surface from contracts: `GET /analytics/snapshots/recompute-status`
  (backlog health) + `POST /analytics/snapshots/rebuild` (idempotently-coalesced `manual_rebuild` trigger,
  reusing `schools.read`, **no new permission**, writing one append-only `analytics.snapshot_rebuild`
  audit row).

**Acceptance (folds spec operability):**
- A dropped trigger self-heals within one sweep cycle; the rebuild is idempotent (re-run → identical rows,
  same `revision`); both are tenant-scoped + re-entrant; no double-count.
- If shipped: the admin status/rebuild endpoints are tenant-scoped, reuse the existing analytics
  capability (no new permission), the rebuild is coalesced + audited.

**Out of scope:** external warehouse, a second queue, a read-through cache (all ADR tripwires / non-goals).

---

## Cross-slice invariants (every slice)

- Tenant + RLS on every snapshot row, recompute query, and read; the parent read keeps guardianship ABAC
  (`StudentAccessService.canAccessStudent`) **before** touching a snapshot; no endpoint loosens an
  existing permission.
- Snapshots are a **derived, disposable cache** — never the source of truth; safe to truncate + rebuild;
  no backfill of source tables; the read path keeps a **fall-through-to-live** so a missing/stale snapshot
  never fails or shows a wrong number.
- **Byte-parity with live** (one shared normalise/coefficient formula) is the gate on every read switch.
- Reuse-first: the `alerts-cron` / `notifications-digest` poll-drain pattern, the durable dirty-queue (no
  second BullMQ queue), the `/api/v1/analytics/*` aggregate-endpoint contract, the
  `analytics.SnapshotRecomputed` event name, the `AnalyticsService` aggregation logic, `@pilotage/ui`,
  `packages/contracts`.
- Kind, factual, non-stigmatising FR copy on the freshness chip (no "obsolète/périmé/erreur/cache");
  aggregates only, RGPD-minimal child data (no new personal data; rebuildable cache).
- `pnpm typecheck` (Murat, once/slice); no `git diff --check` errors; **the one new architectural decision
  (durable dirty-queue + materialised cache + fall-through) lands with `docs/adr/ADR-0NN-analytics-snapshots.md`
  on the S1 run** (Winston gate); any *other* new decision → its own ADR (none anticipated; `plan.md` §5).
