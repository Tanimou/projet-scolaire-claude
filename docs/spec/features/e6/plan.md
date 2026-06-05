# E6 — Architecture & plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`data-model.md`](./data-model.md) / [`ux.md`](./ux.md) /
> [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> E6 is a **non-functional / pre-computation** epic: hold the parent-dashboard **<2 s** NFR at scale by
> materialising the per-student averages the dashboards compute **live** today, recomputed by a
> tenant-scoped worker on `GradePublished` / `GradeRevised` / coefficient change — mirroring the proven
> `alerts-cron` / `notifications-digest` / `parent-digest` worker-module pattern. **It is additive,
> reversible, and non-destructive:** the snapshot tables are a *disposable cache* over `Grade` rows, and
> every read falls through to the live computation on a miss.

---

## 1. Where this fits (reuse map)

| Concern | Reuse (do NOT reinvent) | E6 addition |
|---|---|---|
| Live analytics | `apps/api/src/modules/analytics/analytics.service.ts` (`parentDashboard`, `teacherReports`, `schoolPerformanceDrilldown`, aggregates) | a snapshot-read layer that returns the **same shapes** from the tables; **live compute stays as the fallback** and as the source of the recompute formulas |
| Aggregate-endpoint convention | dashboards read pre-aggregated `/api/v1/analytics/*`, no client N+1 (project-context §2) | unchanged — only the data source behind the endpoint changes (snapshot-first, live fallback) |
| Worker recompute substrate | `apps/worker/src/modules/alerts-cron/*` (tenant-scoped, re-entrant `OnApplicationBootstrap` cron + `running` guard + per-tenant loop), `notifications-digest/*`, `parent-digest/*` | a **structural sibling** `analytics-snapshots/*` module: a poll-and-drain cron over a durable dirty-queue |
| Coefficient resolution / /20 normalisation | the `resolveCoef` + on-/20 logic in `analytics.service.ts` / `grades.service.ts` | the recompute **reuses the same helpers** (extract to a pure module) so the cache is byte-parity with live — one formula, not two that drift (E3 "byte-parity evaluator in both api+worker" discipline) |
| Domain event | `analytics.SnapshotRecomputed` already declared (unwired) in `packages/contracts/src/events/index.ts`; `gradebook.GradePublished` / `GradeRevised` likewise declared | E6 emits `SnapshotRecomputed` after a recompute; the **outbox→BullMQ listener is NOT yet wired** (verified), so E6 does **not** depend on it (see §2) |
| Best-effort publish seam | the existing publish-path fan-out (`assessments.controller.ts`) that already enqueues notifications best-effort | E6 adds a best-effort **recompute-trigger enqueue** at the same seam (a failure never blocks the publish) |
| Migration convention | `prisma db push`, **no SQL `migrations/` folder** (verified: `apps/api/prisma/migrations/` does not exist — same as E1-S3…E5-S2) | the 3 snapshot tables + the trigger table land via `db push`, additive |
| Tenancy / RLS / ABAC | ADR-002 RLS, `StudentAccessService` (parent guardianship), per-endpoint `RequiresPermission` | unchanged — the snapshot read happens **after** the access check; the cache never widens access |

---

## 2. The recompute spine — durable dirty-queue + cron poll-drain (S1)

**Why a dirty-queue table, not the `OutboxEvent`→BullMQ listener?** `OutboxEvent` exists but **has no
consumer wired** (no `outboxEvent.create` call anywhere; `AlertsCronService` explicitly notes the outbox
listener is future work). Coupling a perf feature to an unbuilt cross-cutting mechanism would be a
mistake. E6 instead uses **the same poll-and-drain pattern the three existing crons already use**, made
**durable**: every snapshot-invalidating mutation enqueues an idempotent `SnapshotRecomputeTrigger`
("dirty") row; the worker cron drains pending rows tenant-by-tenant. This makes a recompute survive a
worker restart and lets the freshness chip truthfully show "recalcul en cours" while a trigger is open.
This is **the one new architectural decision** in E6 → it lands with an ADR (§5).

```
apps/worker/src/modules/analytics-snapshots/
  analytics-snapshots.module.ts        # NestJS module (mirrors alerts-cron.module.ts)
  snapshot-recompute.service.ts        # the recompute engine (one scope → upsert snapshot rows, parity w/ live)
  snapshot-recompute.spec.ts           # byte-parity + idempotency unit spec (Murat-picked)
  snapshot-drain-cron.service.ts       # poll-and-drain pending triggers + lagging-tenant backfill (mirrors AlertsCronService)
  snapshot-keys.ts                      # deterministic coalesce key + REVISION constant + scope helpers
```

**Enqueue (API side, S1) — additive, best-effort, non-blocking.** At the grade-publish
(`assessments.controller.ts` publish path), grade-revise (`grades.service`), and coefficient-edit seams,
**after** the source write commits, `upsert` a `SnapshotRecomputeTrigger` on
`(tenantId, coalesceKey, status='pending')`. A burst of publishes for one `(class, subject, term)` while
a recompute is still pending **coalesces into one** pending row (no recompute storm). Enqueue failure is
caught + logged, **never** fails the publish (E3-S4 "Redis/SMTP failure never touches the in-app
fan-out" posture).

**Drain (worker side, S1) — mirrors the existing crons.** A `setInterval`
(`SNAPSHOT_RECOMPUTE_INTERVAL_MS`, default ~60 s) + `STARTUP_DELAY_MS`, `OnApplicationBootstrap` /
`OnModuleDestroy`, a `running` re-entrancy guard. Per tick: `tenantsWithPending()` → per tenant, claim a
bounded FIFO batch (`pending → processing`), recompute each scope, upsert the affected snapshot rows in
**one transaction** (per-term `student_subject_snapshot`, the delete-then-insert year-roll-up row,
cascade `student_global_snapshot`, refresh `class_subject_distribution`; bump `revision`, set
`computedAt = now()` + `sourceEventId = trigger.id`), mark the trigger `done`; on error bump `attempts`,
set `failed` past a cap. **Best-effort per tenant** — one tenant's failure never aborts the loop
(matched to every existing cron). The same cron **also backfills** any tenant whose snapshots lag its
latest published grade (covers a missed enqueue, a new tenant, crash recovery) and emits
`analytics.SnapshotRecomputed`.

**Minimal-affected-set discipline.** A single publish recomputes O(class size) rows once; the class-wide
scan the **live** parent dashboard runs **on every page-load** is run **once per publish** here and
stored — that is the entire perf thesis. A coefficient change scopes broader (the affected grade level's
students) and fans out in the worker.

---

## 3. Read-source switch (S2/S3) — same contract, snapshot-first, live fallback

The analytics endpoints keep their **exact** controller + response DTO. Inside the service, the data
source becomes snapshot-first with a deterministic fall-through:

```
read snapshot for (student, term/year):
  if a fresh row exists (revision current AND no open recompute trigger for the scope):
      assemble the SAME response shape from snapshot rows     # fast path — the <2 s NFR
      freshness = { source:'snapshot', computedAt, recomputing:false }
  else:
      result = <existing live computation>                    # unchanged code path — never an error
      freshness = { source:'live', computedAt: now, recomputing:true }
      (optionally enqueue a backfill trigger so the next read is cached)
```

- The **fall-through-to-live** is what makes S1 safe to ship before any read switches: a not-yet-computed
  or stale snapshot **degrades to today's behaviour**, not an error. This is the cache-coherency rule
  that keeps the whole epic non-destructive (deleting the tables degrades latency, never correctness).
- A **byte-parity test** (S1) asserts the snapshot-assembled shape equals the live shape (AC-2/AC-4) — the
  UI cannot tell which path served it, except for the additive `freshness` field.
- Parent path: the `StudentAccessService.canAccessStudent` ABAC check runs **before** any snapshot read.

## 4. Freshness signal (S2/S3) — additive, optional

The response gains an **additive optional** `freshness` block (see contracts):
`{ source: 'snapshot' | 'live', computedAt, recomputing, gradeCount?, sourceEventId?, revision? }`.
`recomputing` is true when an open `SnapshotRecomputeTrigger` exists for the scope (or the response was
served live). The web chip (ux.md) renders `recomputing ? "Recalcul en cours…" : "À jour il y a {Xs}"`.
Additive ⇒ pre-S2 UI ignores it; no permission needed (freshness is a property of data the caller already
reads).

---

## 5. ADR posture & tripwires (Winston gate)

**E6 introduces exactly ONE new architectural decision → it lands with a new ADR** (authored on the S1
implementation run, since it documents a decision being *made*, not the spec):

> **`docs/adr/ADR-0NN-analytics-snapshots.md`** (next free ADR number — `data-model.md` §6 proposes
> `ADR-019`; reconcile the number against the ADR index at authoring time, since other docs reference an
> ADR-019 real-time deferral) — recording: (a) **why a durable dirty-queue table** rather than the
> unbuilt `OutboxEvent`→BullMQ listener; (b) the **fall-through-to-live cache-coherency rule** that keeps
> the cache non-destructive; (c) the **snapshot↔live byte-parity** requirement (one shared formula);
> (d) the **freshness-signal contract**.

Everything else stays inside documented conventions and trips **no other** ADR:
- **Aggregate-endpoint convention** — endpoints stay pre-aggregated; only the source changes. ✅
- **ADR-002 RLS / tenancy** — every snapshot row + recompute query + read is tenant-scoped. ✅
- **ADR-014 Postgres 15** — snapshots are plain in-Postgres tables, **no `MATERIALIZED VIEW`**, no new
  datastore. ✅
- **Worker cron pattern** — recompute mirrors `alerts-cron` / `notifications-digest`. ✅
- **No new permission** — reads keep `students.read` / `teaching_assignments.read` / `schools.read`. ✅

**Tripwires that would require a SECOND, separate decision (and are therefore non-goals):**
1. **A second BullMQ queue / wiring the `OutboxEvent`→BullMQ listener** for snapshot recompute (vs. the
   durable dirty-queue + cron-poll). The `snapshot_recompute_trigger` table is a *queryable backlog*, not
   a queue — staying on the cron pattern is the deliberate choice the ADR records.
2. **An external analytics store** (ClickHouse / warehouse / OLAP) or a Postgres `MATERIALIZED VIEW` — out
   of scope (ADR-014; plain tables rebuilt by the worker).
3. **A read-through cache tier** (Redis dashboard-payload cache) on top of snapshots — the snapshot *is*
   the cache; a second tier is a new decision, deferred.

---

## 6. Risk & sequencing

- **Parity risk (highest).** Snapshot output must equal live output, or the dashboard silently shows
  different numbers. Mitigation: the recompute and the live `AnalyticsService` **share one extracted
  normalise/coefficient formula**; S1 ships a **byte-parity test** (snapshot vs live on a seeded fixture)
  **before** any read switches in S2. The read switch is gated on that parity holding.
- **Staleness risk.** A dropped trigger → a stale dashboard. Mitigation: the cron's lagging-tenant
  backfill (S1) **self-heals** within one cycle, and the freshness chip (S2) makes any catch-up
  **visible** rather than silent; the live fallback means stale never means *wrong* (it serves live).
- **Ordering.** S1 (schema + recompute spine + publish trigger, **no reads**) → S2 (parent read + the
  chip — the headline NFR win) → S3 (teacher/admin reads + distribution + the GradeRevised /
  coefficient-change triggers). Each is independently demoable and revertible; S1 delivers value (correct,
  fresh, parity-tested snapshots) even before any read switches.
- **Resilience.** Per-tenant / per-scope recompute failure is isolated (alerts-cron parity); a recompute
  crash leaves the **previous** snapshot in place (upsert is the last step) and the read's live fallback
  still serves a valid result.
