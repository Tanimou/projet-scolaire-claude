# E6 — Quickstart (manual demo per slice)

> How to **see** each E6 slice working end-to-end, locally. The app runs hybrid (infra in Docker,
> web local on `:3100`, api `:4000`, worker alongside). Demo login (full `voltaire-demo` data):
> admin `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`. E6 is a pre-computation epic, so most proofs
> are about **the snapshot tables refreshing** and **the dashboard staying identical but fast** — the
> only new UI is the freshness chip (S4).

---

## Prereqs (once)

- API + worker + web running; Postgres reachable. No build is run by the routine — assume the stack is
  already up (project-context §4). To inspect rows, use a read-only SQL console against dev Postgres. The
  tables are `student_subject_snapshot`, `student_global_snapshot`, `class_subject_distribution`, and the
  dirty-queue `snapshot_recompute_trigger`.
- After S1's `db push`, the four tables exist but are **empty**; they lazily fill on the first recompute
  (a grade publish) or the cron backfill. The dashboards' **live fallback** serves correct data meanwhile,
  so there is **no backfill blocker** to shipping S1.

---

## S1 — Snapshot schema + recompute spine + publish trigger

**Prove a grade publish enqueues a trigger that the worker drains into byte-parity snapshot rows.**

1. Confirm the schema landed: the three snapshot tables + `snapshot_recompute_trigger` are present with
   the freshness columns (`computed_at`, `source_event_id`, `revision`) and the trigger's
   `coalesce_key` / `status` columns.
2. Log in as a **teacher** of a `voltaire-demo` class. Open the gradebook, enter + **publish** a grade.
3. Immediately query `snapshot_recompute_trigger`: a `pending` row exists scoped to that
   `(tenantId, classSectionId, termId)` with `reason = grade_published`. Publish a second grade for the
   same scope **before** the worker drains → it **coalesces** (still one `pending` row, no storm).
4. Within one cron interval the worker drains it (`status: pending → processing → done`) and the
   snapshot rows appear: `student_subject_snapshot` for that `(student, subject, term)` (`average`,
   `grade_count`, `class_rank`, `revision=1`, `computed_at` ≈ now, `source_event_id` = trigger id), the
   matching `class_subject_distribution` row (low/mid/high + class average), the student's
   `student_global_snapshot` row.
5. **Byte-parity check:** compare the snapshot's `average` / global / `class_average` / rank for that
   student against the value the **live** parent dashboard shows for the same subject — they match.
6. **Idempotency:** re-trigger a recompute for the same scope with unchanged grades → the same row values,
   `revision` bumped, no duplicate rows.
7. **Backfill / crash recovery:** stop the worker, publish a grade (the trigger is enqueued but not
   drained), restart the worker — within one cycle the pending trigger drains **and** the lagging-tenant
   backfill catches any snapshot older than the latest published grade.

> S1 changes **no** dashboard behaviour (still live-computed) — the proof is entirely in the tables. The
> `ADR-0NN-analytics-snapshots` ADR lands in `docs/adr/` on this run.

---

## S2 — Parent dashboard reads snapshot-first (headline perf win)

**Prove the dashboard is identical but reads snapshots, with a live fallback. (No chip yet — that's S4.)**

1. Log in as a **parent** of a child with published grades (snapshots populated after S1). Open
   `/parent/dashboard`.
2. The five answers render exactly as before — **unchanged** numbers, **no new UI** (the chip is S4).
3. Inspect `GET /api/v1/analytics/parent-dashboard/:studentId`: the body matches the pre-E6 shape **plus**
   the additive `freshness { source:'snapshot', computedAt, recomputing:false }` block.
4. **Snapshot-served + <2 s:** verify via api logs / query timing that the request issues **no class-wide
   grade `findMany`** — a handful of indexed snapshot point-reads — fast even on a large seeded class.
5. **Recomputing state:** as the teacher, publish a grade for the child's class; immediately re-fetch the
   parent payload **before** the recompute lands → `freshness.recomputing = true` (the snapshot
   `computed_at` predates the new grade / an open trigger exists), served via the **live fallback** so the
   numbers are already the latest. After the worker drains, a re-fetch shows `source:'snapshot'`,
   `recomputing:false`.
6. **Fallback never breaks:** delete the child's `student_global_snapshot` row, reload — the dashboard
   still renders correctly (served live), `freshness.source = 'live'`, `recomputing = true`. No 500.

---

## S3 — Teacher & admin analytics read snapshots + revise/coefficient triggers

1. Log in as a **teacher**. Open `/teacher/reports`: the per-class averages + low/mid/high distribution
   render unchanged but read from `class_subject_distribution` / `student_subject_snapshot` (snapshot-first,
   live fallback); the payload carries the additive `freshness` block.
2. Log in as **admin**. Open `/admin/analytics`: the school-performance drill-down (L3/L4 distribution)
   reads `class_subject_distribution` with live fallback; the payload carries `freshness`.
3. **GradeRevised:** as the teacher, correct a published grade → a recompute trigger
   (`reason = grade_revised`) enqueues for that class+subject+term; after the drain the parent's
   average/rank and the teacher distribution reflect the correction.
4. **Coefficient change:** as admin, edit a `SubjectCoefficient` for a grade level → a broader trigger
   (`reason = coefficient_changed`) enqueues; the worker rebuilds the affected `student_global_snapshot`
   rows so weighted overall averages reflect the new coefficient.

---

## S4 — Freshness chip (the visionary trust signal)

1. As a **parent** on `/parent/dashboard`, see the calm chip near the global-performance hero: **"À jour
   il y a {Xs}"** when the snapshot is fresh.
2. Publish a grade as the teacher, then immediately reload the parent dashboard **before** the recompute
   lands → the chip reads **"Recalcul en cours…"** (non-alarming; the live fallback already shows the
   latest numbers). After the worker drains, a reload settles to "À jour il y a quelques secondes."
3. The same chip idiom appears on `/admin/analytics` and `/teacher/reports` (over the S3 reads).
4. **A11y:** the chip pairs an icon + text label (not colour-alone), `role="status"`/`aria-live="polite"`
   announces only the recomputing↔fresh transition (not every relative-time tick), ≥4.5:1 contrast, no
   spin under `prefers-reduced-motion`; degrades to **no chip** when `freshness` is absent.

---

## S5 — Operability: idempotent full rebuild + sweep hardening

1. Trigger a **full-tenant/scope rebuild** (the documented operator path, or `POST
   /analytics/snapshots/rebuild` if shipped) for `voltaire-demo`.
2. Snapshot the row counts + a few `(student, subject, term)` values, run the rebuild **again** → identical
   rows, same `revision`, no duplicates (idempotent).
3. Bump the `revision` constant (simulating a logic change) → the sweep lazily recomputes the
   now-"older-revision" rows, without a manual migration.
4. **(If shipped) admin status:** `GET /analytics/snapshots/recompute-status` returns the tenant's
   pending/processing/failed backlog; the `manual_rebuild` write produces one append-only
   `analytics.snapshot_rebuild` audit row.
5. Confirm per-tenant resilience: a forced failure on one tenant's recompute is logged and does **not**
   abort the others; a failed trigger parks after the retry cap.

---

## Cross-slice sanity (every slice)

- Every snapshot row + trigger is tenant-scoped; a parent can only ever read their own child's dashboard
  (guardianship ABAC runs **before** the snapshot read); no endpoint loosens a permission.
- No build is run by agents; `pnpm typecheck` is the single gate (Murat).
- The snapshot tables are a **disposable cache**: truncating them and reverting the read source returns the
  platform to its current live-compute behaviour with **no data loss** (snapshots are derived from
  `Grade` rows). A worker outage degrades **latency**, never **correctness** or **availability** (the read
  falls through to live).
