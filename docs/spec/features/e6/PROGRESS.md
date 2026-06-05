# E6 — Progress

> Epic: **E6 — Analytics Snapshots & pre-computation** · Tier 3 (Scale & new surfaces) · Size ~M
> Spec-kit run: **2026-06-05** (docs-only; no code, no schema, no build). Roadmap status: `proposed`
> → promoted to **in-progress** (spec authored). Next action: ship **S1** (`epic-slice`).

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Snapshot schema + recompute spine + publish trigger | `[schema][worker]` | P1 | ✅ shipped | — |
| S2 | Parent dashboard reads snapshots (headline perf win) | `[api]` | P1 | ⬜ not started | — |
| S3 | Admin & teacher reads + revise/coefficient triggers | `[api]` | P1-P2 | ⬜ not started | — |
| S4 | Freshness chip (the visionary trust signal) | `[web][a11y]` | P2 | ⬜ not started | — |
| S5 | Operability: idempotent full rebuild + sweep hardening | `[worker]` | P2 | ⬜ not started | — |

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
