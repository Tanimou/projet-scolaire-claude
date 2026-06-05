# ADR-019 — Analytics snapshots: durable dirty-queue + materialised cache + fall-through-to-live

- **Status:** Accepted
- **Date:** 2026-06-05
- **Epic:** E6 — Analytics Snapshots & pre-computation (slice S1)
- **Deciders:** Winston (Architect), with the E6 pre-mortem (Critic) and test-architect (Murat)

## Context

The cahier de charges names **one non-functional requirement above all others**: the
parent dashboard must answer its five questions **in under 2 seconds**, on mobile,
**at scale**. Today every analytics payload is computed **live** on each request:
`AnalyticsService.parentDashboard` pulls every published grade for the child **and**
every published grade for the **whole class** (for class averages and ranks) and
aggregates in memory — an `O(class × grades)` scan that degrades exactly when a school
grows. The same is true of `teacherReports` / `adminDashboard` / the school-performance
drill-down.

E6 materialises the figures the dashboards already compute into three tenant-scoped
read models, recomputed by the worker when grades change, so the reads become a handful
of indexed point-lookups. This is a **new cross-cutting pattern** (a derived cache + a
recompute mechanism + a cache-coherency contract), so per project-context §3 it lands
with this ADR.

### ADR-number reconciliation

The highest ADR file on disk before this slice is **ADR-018**, so **019 is the next
free filesystem number**. Earlier E2/E5 spec prose informally references an
"ADR-019 real-time/WebSocket deferral" — but **no `ADR-019-*.md` file was ever
written**; that reference is an aspirational placeholder, not a real ADR. The E6
data-model draft proposed "ADR-019 … take the next free number if 019 is taken" — on
inspection 019 is **not** taken on disk, so this analytics-snapshots ADR correctly
claims 019. The real-time-transport deferral remains an un-filed narrative note (a
candidate for a future ADR); it does not collide with this file.

## Decision

E6 adds, **additively** (`prisma db push`, no SQL `migrations/` folder, no existing
table reshaped):

1. **Three materialised, tenant-scoped, derived snapshot read models** over
   published/revised `Grade` rows — `student_subject_snapshot` (student × subject ×
   term), `student_global_snapshot` (student × term, + year roll-up),
   `class_subject_distribution` (class × subject × term histogram). Each carries the
   freshness spine `computed_at` + `source_event_id` + `revision`, a natural-key
   `@@unique`, and tenant-first read indexes. Scope ids are **plain `@db.Uuid`**
   (cache-row convention — **no `@relation`**, so no back-relation field is added to any
   existing model; orphaned cache rows are harmless and reaped by the next rebuild).

2. **A durable `snapshot_recompute_trigger` dirty-queue** drained by a worker cron
   poll (`apps/worker/.../analytics-snapshots`), the **structural sibling** of
   `alerts-cron` / `notifications-digest` / `parent-digest`. Every snapshot-invalidating
   mutation best-effort `upsert`s an idempotent, **coalescing** dirty row
   (`@@unique([tenant_id, coalesce_key, status])` → a burst of publishes for one scope
   collapses into ONE pending row). The worker claims a per-tenant FIFO bounded batch
   (atomic `pending → processing` guarded update), recomputes the scope in **one
   transaction**, marks the row `done`/`failed`, and reclaims stale `processing` rows.

3. **A snapshot-first read with fall-through-to-live** cache-coherency rule (wired in
   later slices S2/S3, **not** S1): the existing `/api/v1/analytics/*` aggregate
   endpoints serve the snapshot when fresh and **fall back to the existing live
   computation** when the snapshot is missing/stale. A miss is **never** an error — the
   cache is a read accelerator with a safety net, never a load-bearing single point of
   failure. **In S1 the snapshots are written but never read** (provably zero behaviour
   change, FR-8).

4. **A freshness signal** — an additive, optional `freshness { source, computedAt,
   recomputing, … }` block (declared in `packages/contracts` in S1, returned in S2/S3)
   the dashboards render as a kind chip ("à jour il y a Xs" / "recalcul en cours…").

### Why a durable dirty-queue table, not the `OutboxEvent` → BullMQ listener?

`OutboxEvent` exists in the schema but has **no consumer wired** (`outboxEvent.create`
is called nowhere; the alerts cron explicitly notes the outbox listener is future work).
Building a perf feature on an unbuilt cross-cutting mechanism would couple E6 to
unrelated, unfinished work. The dirty-queue is the **same poll-drain pattern the three
existing crons already use**, made durable so a recompute survives a worker restart and
the freshness chip can truthfully show "recalcul en cours" while an open trigger exists.
The trigger table is a **queryable backlog, not a second BullMQ queue** — no new queue is
introduced. When the outbox→BullMQ listener is eventually wired (out of E6 scope), it can
enqueue the **same** trigger rows as a drop-in, with no second mechanism.

### Byte-parity discipline (the highest epic risk)

A cache that shows different numbers than the live path is worse than no cache. The
recompute therefore reproduces the live `AnalyticsService` arithmetic **exactly**, via a
single pure formula module (`snapshot-formula.ts`) pinned by a byte-parity unit test
(`snapshot-recompute.spec.ts`) against the live output on a seeded fixture — the E3
"byte-parity evaluator in both api + worker" discipline. Two subtleties are pinned: the
**hero global is coefficient-weighted** (`weightedSum/totalCoef`) while the **global
rank denominator uses an unweighted mean-of-per-subject-means** (the live path uses two
different aggregations); and all figures are **rounded to `Decimal(5,2)` at the write
boundary** so a snapshot read never differs from a live render in the 3rd decimal.

## Tenant isolation posture (honest record)

The data model calls for "RLS policies (ADR-002 template)". On inspection, the
repository has **no RLS policy DDL anywhere** and `PrismaService.withTenant` (the
`SET LOCAL app.current_tenant_id` mechanism) is **defined but never called** — tenant
isolation is enforced **at the application layer** by explicit `where: { tenant_id }`
clauses on every query (the de-facto model every prior per-tenant table relies on, e.g.
`conversation_report`, `alert_instance`, `notification`). E6 follows that prevailing
pattern exactly: the publish-seam enqueue stamps `tenantId: me.tenantId`, and **every**
worker query (`grade.findMany`, `classSection.findFirst`, `subjectCoefficient.findMany`,
`student.findMany`, the trigger claim, the snapshot writes) carries an explicit
`where: { tenantId }`. We deliberately **did not fabricate `current_setting`-based RLS
DDL that nothing in the codebase sets** — that would be inert security theatre (or, if
the DB role enforced it, would break every snapshot write because no session var is set).
Introducing true Postgres RLS is its own cross-cutting task (an ADR-002 follow-up), not
an E6 concern.

## Consequences

**Positive**
- The parent dashboard (and teacher/admin reads, later slices) collapse an
  `O(class × grades)` live scan into indexed point-reads — the <2 s NFR holds at scale.
- The cache is **fully disposable**: truncating the snapshot tables degrades only
  latency, never correctness (fall-through-to-live). Deleting + rebuilding is always safe.
- The recompute survives worker restarts (durable backlog) and self-heals (stale-row
  reclaim + lagging-tenant backfill).
- Reuses the proven cron poll-drain pattern, the best-effort publish-fan-out seam,
  `packages/contracts`, and the additive-`db push` convention — minimal blast radius.

**Negative / accepted trade-offs**
- Snapshots are **eventually consistent** — there is a recompute-window lag between a
  publish and a fresh snapshot. The fall-through-to-live + the freshness chip make the
  lag honest and harmless (a parent sees "recalcul en cours", never a wrong number).
- A missed enqueue leaves a stale cache until the safety-net backfill / next full
  rebuild; covered by the fall-through and the sweep.
- The recompute logic is a **faithful duplicate** of the live formula (cross-app share is
  impractical: the worker does not depend on `apps/api`). The byte-parity test is the
  drift tripwire that keeps the two from diverging.

## Non-goals (tripwires this ADR does NOT cross)

- **No second BullMQ queue** (the trigger table is a queryable backlog).
- **No Postgres `MATERIALIZED VIEW`** / columnar store / external warehouse — plain
  tenant-scoped tables rebuilt by the worker.
- **No new permission, no new HTTP style, no new domain event name** (reuses the already
  reserved `analytics.SnapshotRecomputed`, referenced on the drain log line — NOT written
  to the unconsumed `OutboxEvent` table).
- **No new analytics metrics** — E6 materialises the figures the dashboards already
  compute; it invents no KPI.
- **No `AuditLog` row per recompute** (derived bookkeeping, like the alerts/digest crons).
  A future admin "rebuild now" action *is* an explicit user action → one append-only
  `analytics.snapshot_rebuild` audit row (S5).

## References

- `docs/spec/features/e6/{spec,plan,data-model,tasks}.md`
- ADR-001 (modular monolith), ADR-002 (multi-tenancy + RLS intent), ADR-014 (Postgres 15)
- Precedent: `alerts-cron` / `notifications-digest` / `parent-digest` worker crons;
  the E3 byte-parity-evaluator-in-both-api-and-worker discipline.
