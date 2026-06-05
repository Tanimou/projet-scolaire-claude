# E6 — Data model & migration plan (Architect: Winston)

> Companion to [`spec.md`](./spec.md) / [`plan.md`](./plan.md) / [`contracts/openapi.yaml`](./contracts/openapi.yaml) / [`tasks.md`](./tasks.md).
> E6 "Analytics Snapshots & pre-computation" is a **non-functional** epic: hold the parent-dashboard
> **<2 s NFR at scale** by materialising the per-student averages that the dashboards compute **live**
> today, recomputed by a **tenant-scoped worker cron/event handler** on `GradePublished` /
> `GradeRevised` / coefficient change — mirroring the proven `alerts-cron` / `notifications-digest`
> worker-module pattern.
>
> **Migration convention (repo-wide, verified):** `prisma db push`, **no SQL `migrations/` folder**
> (`apps/api/prisma/migrations/` does not exist — same as E1-S3, E2-S1, E2-S4, E3-S1, E3-S2, E5-S2).
> Every E6 table is **net-new and additive** (no column added to an existing table, no existing
> column changed) ⇒ safe on existing rows, **no backfill required for correctness** (a missing
> snapshot row simply means "fall through to the live computation" — see §4 read path), zero-downtime
> (expand-only). The first recompute pass (cron tick) lazily fills the tables; the dashboards keep
> working from the live path until a row exists.

---

## 0. What already exists (the live computation E6 materialises)

E6 does **not** invent new analytics — it **caches** numbers the platform already derives live. The
inputs and the consumers are all in place:

| Asset | Location | Role for E6 |
|---|---|---|
| `AnalyticsService` (live aggregates) | `apps/api/src/modules/analytics/analytics.service.ts` | computes `parentDashboard`, `teacherReports`, `adminDashboard`, `school-performance-drilldown` **live** over `Grade` rows on every request. **E6 caches its per-student / per-subject outputs**; the read path falls back to it on a cache miss (§4). |
| `model Grade` | `schema.prisma` (`@@map("grade")`) | `status in (published, revised)`, `isAbsent`, `value`, `comment`, `publishedAt`. The **source rows** the snapshots aggregate. |
| `model Assessment` | `schema.prisma` (`@@map("assessment")`) | `maxScore`, `coefficientOverride`, `termId`, `teachingAssignmentId`. Normalises a grade to /20 and resolves its subject/term/coefficient. |
| `model SubjectCoefficient` / `Subject.defaultCoefficient` | `schema.prisma` | the **coefficient** resolution (`(gradeLevel × subject)` override else subject default). **A change here invalidates global snapshots** → a recompute trigger (§3). |
| `model TeachingAssignment` | `schema.prisma` | `(teacher × classSection × subject × academicYear)` — resolves a grade's `subjectId`, `classSectionId`, `academicYearId`. |
| `model OutboxEvent` + `DOMAIN_EVENTS` | `schema.prisma` (`@@map("outbox_event")`) · `packages/contracts/src/events/index.ts` | `GRADE_PUBLISHED`, `GRADE_REVISED`, and **`SNAPSHOT_RECOMPUTED: 'analytics.SnapshotRecomputed'` already reserved**. The outbox→BullMQ listener is **NOT yet wired** (see the `AlertsCronService` comment) — E6's recompute trigger therefore **rides the proven cron-poll pattern**, not the unbuilt outbox path (§3, ADR-watch). |
| `AlertsCronService` / `NotificationsDigestCronService` / `ParentDigestCronService` | `apps/worker/src/modules/{alerts-cron,notifications-digest,parent-digest}/*` | the **structural template** the E6 recompute worker mirrors: plain `setInterval` cron, `OnApplicationBootstrap`/`OnModuleDestroy`, re-entrancy `running` guard, per-tenant→per-entity loop, best-effort (one failure never aborts the tenant loop), `tenantsTo…()` resolver. **E6 adds a sibling module, does not fork these.** |

> **Ruling — E6 is a CACHE over an existing live computation, not a new analytics surface.** The
> snapshot tables are a *derived materialisation* whose source of truth stays the `Grade`/`Assessment`
> rows. Every snapshot value is reproducible from a full recompute; the cache is **disposable** (it can
> be truncated and rebuilt). This framing drives every decision below: no new permission (reads stay on
> the existing analytics permissions), no destructive migration, fall-through-to-live on a miss.

---

## 1. New models (3 snapshot tables + 1 recompute-trigger queue)

All four tables follow the repo conventions verified across the schema: `uuid @db.Uuid` PK,
`tenantId @map("tenant_id") @db.Uuid` first column, `@@map("snake_case")`, `Decimal @db.Decimal(p,s)`
for scores, `Timestamptz(6)` timestamps, **tenant-first composite indexes** (ADR-002), `onDelete`
matching the parent's lifecycle. **No relation is added to an existing model's relation block** (the
snapshot FKs reference existing rows but the back-relations are declared minimally — see §1.5).

### 1.1 `model StudentSubjectSnapshot` — per (student × subject × term) materialised average

The grain that backs the parent dashboard's **per-subject cards** and the teacher reports' per-class
rows. One row per `(student, subject, term)` within an academic year. `termId` nullable so a
**year-level** (all-terms) roll-up can be stored as a `termId = null` row alongside the per-term rows.

```prisma
/// E6 — materialised per-(student × subject × term) average. A disposable CACHE
/// over published/revised Grade rows (source of truth stays Grade). A null termId
/// row is the year-level roll-up across all terms. `computedAt` + `sourceEventId`
/// power the dashboard freshness chip (the visionary signal). Recomputed by the
/// worker on GradePublished / GradeRevised / coefficient change.
model StudentSubjectSnapshot {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  academicYearId    String   @map("academic_year_id") @db.Uuid
  studentId         String   @map("student_id") @db.Uuid
  classSectionId    String   @map("class_section_id") @db.Uuid
  subjectId         String   @map("subject_id") @db.Uuid
  termId            String?  @map("term_id") @db.Uuid          // null = year-level roll-up

  /// Weighted/normalised average on /20 over the source grades. Null when no graded source.
  average           Decimal? @db.Decimal(5, 2)
  /// Coefficient applied at compute time (resolved: SubjectCoefficient override else Subject default).
  coefficient       Decimal  @default(1.0) @db.Decimal(4, 2)
  /// Count of published/revised, non-absent grades that fed this average (sample size).
  gradeCount        Int      @default(0) @map("grade_count")
  /// Rank of the student in the class for this subject/term (1 = best); null if not ranked.
  classRank         Int?     @map("class_rank")
  /// Number of ranked students (rank denominator).
  classSize         Int      @default(0) @map("class_size")
  /// Signed delta vs the previous term's average for this subject (/20); null if not computable.
  trendDelta        Decimal? @map("trend_delta") @db.Decimal(5, 2)

  /// --- Freshness signal (visionary) ---
  computedAt        DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  /// The recompute trigger that produced this row (a SnapshotRecomputeTrigger.id), for explainability.
  sourceEventId     String?  @map("source_event_id") @db.Uuid
  /// Optimistic generation counter — bumped each recompute; lets a read detect staleness cheaply.
  revision          Int      @default(1)

  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([studentId, subjectId, termId])
  @@index([tenantId, academicYearId, classSectionId, subjectId])  // class-level reads (teacher reports / distribution)
  @@index([tenantId, studentId, academicYearId])                  // parent-dashboard read for one child
  @@map("student_subject_snapshot")
}
```

**Decisions / rationale**

- **`@@unique([studentId, subjectId, termId])`** is the upsert key (the recompute `upsert`s on it).
  `studentId` already implies `(tenantId, schoolId, academicYearId)` via the source rows, so the
  unique stays lean; the **tenant scoping for reads** is carried by the two composite `@@index`es,
  which are **tenant-first** per ADR-002. (Postgres treats `NULL` as distinct in a unique index — so
  two `termId = null` rows for the same `(student, subject)` could in principle coexist; the recompute
  guarantees a single year-level row by **deleting then inserting** the `termId IS NULL` row in the
  same transaction, documented in §3.4. This is the one nullable-unique caveat, called out explicitly.)
- **Decimal precision mirrors the source.** `average` is `Decimal(5,2)` like `Grade.value`/
  `Assessment.maxScore`; `coefficient` is `Decimal(4,2)` like `Subject.defaultCoefficient`/
  `SubjectCoefficient.coefficient`. No precision drift between the cache and the live path.
- **`gradeCount` / `classSize` are sample sizes**, not display sugar — they let the read path decide
  "is this snapshot trustworthy or should I fall through to live?" and let the freshness chip say
  "à jour il y a Xs (N notes)".
- **`computedAt` + `sourceEventId` + `revision`** are the **freshness spine** (the visionary idea): the
  dashboard surfaces "à jour il y a Xs / recalcul en cours" from `computedAt` and the open-trigger
  state (§1.4). `sourceEventId` ties a snapshot to the exact recompute trigger that produced it —
  explainability ("you're seeing the latest published grades"), reinforcing the cahier's promise.

### 1.2 `model StudentGlobalSnapshot` — per (student × term) materialised global average

The grain that backs the parent dashboard's **hero / global-performance KPIs** and the global rank.
One row per `(student, term)`; `termId = null` = the year-level global average.

```prisma
/// E6 — materialised per-(student × term) GLOBAL average (coefficient-weighted across
/// subjects). Backs the parent-dashboard hero KPIs + global rank. Disposable cache over
/// the StudentSubjectSnapshot rows (or directly over Grade on a full rebuild).
model StudentGlobalSnapshot {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  academicYearId    String   @map("academic_year_id") @db.Uuid
  studentId         String   @map("student_id") @db.Uuid
  classSectionId    String   @map("class_section_id") @db.Uuid
  termId            String?  @map("term_id") @db.Uuid          // null = year-level global

  /// Coefficient-weighted global average on /20 across all subjects. Null when no graded source.
  globalAverage     Decimal? @map("global_average") @db.Decimal(5, 2)
  /// Class global average on /20 for the same term (the "vs classe" comparison).
  classAverage      Decimal? @map("class_average") @db.Decimal(5, 2)
  /// Global rank of the student in the class (1 = best); null if not ranked.
  classRank         Int?     @map("class_rank")
  classSize         Int      @default(0) @map("class_size")
  /// Signed progression vs the previous term's global average (/20); null if not computable.
  progressionDelta  Decimal? @map("progression_delta") @db.Decimal(5, 2)
  /// Attendance rate 0–100 over recorded sessions (cached alongside; cheap, read on the same card).
  attendanceRate    Decimal? @map("attendance_rate") @db.Decimal(5, 2)
  /// Number of subjects that fed the global average (sample size).
  subjectCount      Int      @default(0) @map("subject_count")

  computedAt        DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  sourceEventId     String?  @map("source_event_id") @db.Uuid
  revision          Int      @default(1)

  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([studentId, termId])
  @@index([tenantId, academicYearId, classSectionId])  // class-level reads + global-rank recompute
  @@index([tenantId, studentId, academicYearId])        // parent-dashboard hero read
  @@map("student_global_snapshot")
}
```

**Decisions** — same conventions as §1.1. `globalAverage` is derived from the per-subject snapshots
(coefficient-weighted), so a `StudentSubjectSnapshot` recompute for a student **cascades** to its
`StudentGlobalSnapshot` row in the same transaction (§3.4) — they never drift. `classAverage` /
`classRank` are stored here so the hero card needs **one** row read, not a class scan.

### 1.3 `model ClassSubjectDistribution` — per (classSection × subject × term) distribution

The grain that backs the **class-distribution** charts (admin drill-down L3/L4, teacher reports'
low/mid/high buckets, and the "vs classe" context). One row per `(classSection, subject, term)`.

```prisma
/// E6 — materialised per-(classSection × subject × term) distribution + class average.
/// Backs the admin drill-down + teacher-reports distribution charts and the parent
/// "moyenne de classe" context. Disposable cache over Grade rows for the class.
model ClassSubjectDistribution {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  academicYearId    String   @map("academic_year_id") @db.Uuid
  classSectionId    String   @map("class_section_id") @db.Uuid
  subjectId         String   @map("subject_id") @db.Uuid
  termId            String?  @map("term_id") @db.Uuid          // null = year-level distribution

  /// Class average on /20 for this subject/term. Null when no graded source.
  average           Decimal? @db.Decimal(5, 2)
  /// Median / min / max on /20 (cheap to cache, expensive to recompute live per request).
  median            Decimal? @db.Decimal(5, 2)
  minScore          Decimal? @map("min_score") @db.Decimal(5, 2)
  maxScore          Decimal? @map("max_score") @db.Decimal(5, 2)
  /// Histogram buckets — counts of grades in [0,10), [10,14), [14,20] on /20.
  countLow          Int      @default(0) @map("count_low")
  countMid          Int      @default(0) @map("count_mid")
  countHigh         Int      @default(0) @map("count_high")
  /// Pass rate 0–100 (>= 10/20) over graded, non-absent source grades.
  passRate          Decimal? @map("pass_rate") @db.Decimal(5, 2)
  /// Total graded, non-absent grades feeding the distribution (sample size).
  gradeCount        Int      @default(0) @map("grade_count")
  /// Distinct students who have at least one grade in this cell.
  studentCount      Int      @default(0) @map("student_count")

  computedAt        DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  sourceEventId     String?  @map("source_event_id") @db.Uuid
  revision          Int      @default(1)

  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([classSectionId, subjectId, termId])
  @@index([tenantId, academicYearId, classSectionId])  // admin drill-down + teacher-reports class reads
  @@index([tenantId, schoolId, academicYearId])         // school-wide distribution roll-ups
  @@map("class_subject_distribution")
}
```

### 1.4 `model SnapshotRecomputeTrigger` — the dirty-queue that drives the worker (recompute spine)

The **recompute spine** of S1. Because the **outbox→BullMQ listener is not yet wired** (verified — see
`AlertsCronService` comment and the empty `outboxEvent.create` grep), E6 does **not** depend on it.
Instead, every mutation that invalidates a snapshot **enqueues a lightweight, idempotent "dirty" row**
that the worker cron drains tenant-by-tenant — the exact poll-and-drain shape of the existing crons,
but with a durable, queryable backlog (so a recompute survives a worker restart, and the freshness chip
can show "recalcul en cours" when an open trigger exists for a student).

```prisma
/// E6 — what kind of source change invalidated a snapshot. Maps to the roadmap's
/// "recomputed on GradePublished / GradeRevised / coefficient change".
enum SnapshotTriggerReason {
  grade_published      // a Grade moved draft→published (gradebook.GradePublished)
  grade_revised        // a published Grade's value changed (gradebook.GradeRevised)
  coefficient_changed  // a SubjectCoefficient / Subject.defaultCoefficient changed (global recompute)
  manual_rebuild       // an admin-triggered full rebuild for a scope
  backfill             // the initial lazy fill on first deploy
}

enum SnapshotTriggerStatus {
  pending     // enqueued, not yet processed
  processing  // claimed by a worker tick (re-entrancy guard)
  done        // recompute committed
  failed      // recompute errored; retried next tick up to a cap, then parked
}

/// E6 — append-enqueue "dirty" marker. The worker cron drains pending rows per tenant,
/// recomputes the affected snapshot scope, and marks the row done — mirroring the
/// alerts-cron / notifications-digest poll-drain pattern WITHOUT depending on the
/// (unbuilt) outbox→BullMQ listener. Idempotent: a coalescing unique key collapses
/// duplicate dirties for the same scope into one pending row.
model SnapshotRecomputeTrigger {
  id              String                 @id @default(uuid()) @db.Uuid
  tenantId        String                 @map("tenant_id") @db.Uuid
  schoolId        String?                @map("school_id") @db.Uuid
  reason          SnapshotTriggerReason
  status          SnapshotTriggerStatus  @default(pending)

  /// Scope of what to recompute (any may be null = "wider"): a coefficient change
  /// scopes by subject across a grade level; a grade publish scopes by student/class/subject/term.
  studentId       String?  @map("student_id") @db.Uuid
  classSectionId  String?  @map("class_section_id") @db.Uuid
  subjectId       String?  @map("subject_id") @db.Uuid
  termId          String?  @map("term_id") @db.Uuid
  academicYearId  String?  @map("academic_year_id") @db.Uuid

  /// Coalescing key — a deterministic hash of (tenant, reason, scope). A duplicate
  /// dirty for the same still-pending scope is a no-op (upsert), so a burst of grade
  /// publishes for one class collapses into ONE pending recompute.
  coalesceKey     String   @map("coalesce_key")

  attempts        Int      @default(0)
  lastError       String?  @map("last_error")
  enqueuedAt      DateTime @default(now()) @map("enqueued_at") @db.Timestamptz(6)
  processedAt     DateTime? @map("processed_at") @db.Timestamptz(6)

  @@unique([tenantId, coalesceKey, status])  // one PENDING row per scope (idempotent enqueue)
  @@index([tenantId, status, enqueuedAt])     // the worker drain query (tenant-first, FIFO)
  @@map("snapshot_recompute_trigger")
}
```

**Decisions / rationale**

- **Why a dirty-queue table and not the existing `OutboxEvent`?** `OutboxEvent` exists but **has no
  consumer wired** (no `outboxEvent.create` call anywhere; the alerts cron explicitly notes the outbox
  listener is future work). Building E6 on an unbuilt path would couple a perf feature to an
  unrelated, unfinished cross-cutting mechanism. The dirty-queue is **the same poll-drain pattern the
  three existing crons already use**, just made durable so a recompute is not lost on restart and the
  "recalcul en cours" chip is truthful. **This is the one decision that touches an architectural
  question → see plan.md §ADR-watch and the ADR recommendation in §6.**
- **`@@unique([tenantId, coalesceKey, status])` = idempotent enqueue.** The producer `upsert`s on it,
  so N grade publishes for the same `(class, subject, term)` while a recompute is still `pending`
  collapse into **one** pending row (no recompute storm). Once that row flips to `processing`/`done`, a
  fresh dirty can enqueue a new `pending` row (the `status` in the key makes the post-processing dirty
  distinct). This mirrors the `AlertInstance` 7-day-window dedup intent, applied to recompute work.
- **Scope columns are all nullable = "recompute this slice or wider".** A `grade_published` dirty
  carries `(studentId, classSectionId, subjectId, termId)`; a `coefficient_changed` dirty carries only
  `(subjectId, academicYearId)` and fans out to every affected student in the worker. The worker reads
  the scope and runs the **narrowest** correct recompute.
- **No FK relations declared** on the trigger (all scope ids are plain `@db.Uuid`, like `Grade.flaggedBy`
  / `AuditLog.actorId` precedent) — the trigger is a transient work item, not a domain aggregate; it is
  routinely deleted/aged out, so cascading FKs would add lock contention for no integrity benefit. The
  ids are validated at enqueue against the tenant.

### 1.5 Back-relations on existing models — minimal, additive

The snapshot FKs reference `Student`, `Subject`, `ClassSection`, `AcademicYear`, `Term`, `School`. Per
Prisma, a relation needs a back-relation field on the referenced model **only if you declare the
forward `@relation`**. To keep the change **fully additive and low-blast-radius**, E6 declares the
snapshot scope ids as **plain `@db.Uuid` columns WITHOUT a Prisma `@relation`** (same precedent as
`Grade.flaggedBy`, `AuditLog.actorId/resourceId`, `MeetingRequest`-era scope ids). Consequences:

- **No edit to any existing model's relation block** (no `studentSubjectSnapshots Student[]` line added
  to `Student`, etc.) → zero risk of touching a working model. Referential integrity is enforced by the
  **recompute logic** (it only writes snapshots for rows it just read from the source), and orphaned
  snapshots after a hard delete are **harmless** (a disposable cache row pointing at a gone student is
  never read because the read path joins from the live `Student`/enrollment). A periodic prune (or the
  next full rebuild) reaps them.
- If a reviewer prefers DB-level FKs, the fallback is `onDelete: Cascade` from `Student`/`ClassSection`
  (a deleted student/class drops its cache rows). **Recommendation: ship without FKs** (cache-row
  convention), and note the cascade option in the S1 story for the implementer to decide with the DBA
  lens. Either way it is additive `db push`.

---

## 2. The recompute computation (what each snapshot stores) — parity with the live path

The worker recompute MUST produce the **same numbers** the live `AnalyticsService` produces today, so a
dashboard reading the cache is byte-equivalent to one reading live (no visible jump when a snapshot
appears). The canonical formulas, lifted from `analytics.service.ts`:

- **Normalise to /20:** `onTwenty = (grade.value / assessment.maxScore) * 20`, over
  `status in (published, revised)` and `isAbsent = false`.
- **Coefficient resolution:** `coefficientOverride` on the assessment, else `SubjectCoefficient
  (gradeLevel × subject)`, else `Subject.defaultCoefficient`. **A change to either invalidates the
  global average** ⇒ `coefficient_changed` trigger.
- **Per-subject average (`StudentSubjectSnapshot.average`):** mean of the student's `onTwenty` grades
  for that `(subject, term)` (the live path uses a simple mean per subject — matched).
- **Global average (`StudentGlobalSnapshot.globalAverage`):** coefficient-weighted mean of the
  per-subject averages (matched to the live `weightedSum / totalCoef`).
- **Class average / rank:** competition ranking (ex-æquo share a rank), `classSize` = distinct graded
  students — matched to the live ranking block.
- **Trend / progression delta:** `lastTerm.avg − previousTerm.avg` (matched to the live
  `termEvolution` delta).

> **Acceptance hook (Murat/Critic):** a P1 test must assert **snapshot value == live value** for a
> seeded student across all three tables, so the cache can never silently diverge from the source of
> truth. The recompute and the live `AnalyticsService` SHOULD share the normalise/coefficient helpers
> (extract to a pure module) so there is **one** formula, not two that drift (mirrors the E3 "byte-parity
> evaluator in both api + worker" discipline).

---

## 3. Recompute trigger & worker drain (the S1 spine; later slices wire reads)

### 3.1 Enqueue (API side, S1) — additive, best-effort, non-blocking

At the existing grade-publish / grade-revise seams (`assessments.controller.ts` publish path +
`grades.service` revise path) and the coefficient-edit seam, **after** the source write commits, enqueue
a `SnapshotRecomputeTrigger` via an idempotent `upsert` on `(tenantId, coalesceKey, status='pending')`.
Strictly **additive + best-effort**: a failure to enqueue NEVER fails the grade publish (it is caught
and logged, exactly like the E3-S4 "Redis/SMTP failure never touches the in-app fan-out" posture). The
worst case of a missed enqueue is a stale cache that the next full rebuild / fallback-to-live covers.

### 3.2 Drain (worker side, S1) — mirrors the existing crons

A new `apps/worker/src/modules/analytics-snapshots/*` module, a **structural sibling** of
`alerts-cron` / `notifications-digest`:

- plain `setInterval` (`SNAPSHOT_RECOMPUTE_INTERVAL_MS`, default e.g. 60 s) + `STARTUP_DELAY_MS`,
  `OnApplicationBootstrap` / `OnModuleDestroy`, a `running` re-entrancy guard;
- per tick: `tenantsWithPending()` (distinct `tenantId` where `status='pending'`) → per tenant, claim a
  FIFO batch of pending triggers (`status: pending → processing`, bounded `take`), recompute each
  scope, `upsert` the affected snapshot rows in a transaction, mark the trigger `done`; on error bump
  `attempts` + set `failed` past a cap (parked, surfaced for admin). **Best-effort per tenant** — one
  tenant's failure never aborts the loop (matched to every existing cron).

### 3.3 Event-driven freshness (optional, later) — same enqueue, no new path

When the outbox→BullMQ listener is eventually wired (out of E6 scope), it can enqueue the **same**
`SnapshotRecomputeTrigger` rows reacting to `GRADE_PUBLISHED` / `GRADE_REVISED` for near-real-time
freshness — **without a second mechanism**. E6 ships the cron-poll path; the trigger table is the seam
that makes a future event path a drop-in. (`SNAPSHOT_RECOMPUTED` domain event is already reserved in
`packages/contracts` — the worker emits it after a recompute for any future consumer.)

### 3.4 Transactional consistency (the nullable-`termId` caveat)

Per recompute scope, in **one** `prisma.$transaction`: recompute the per-term `StudentSubjectSnapshot`
rows (upsert on `(studentId, subjectId, termId)`), **delete-then-insert** the `termId = null` year-roll-up
row (to dodge the NULL-not-unique caveat from §1.1), cascade the `StudentGlobalSnapshot` for that
`(student, term)` and the year roll-up, and refresh the `ClassSubjectDistribution` cell. Bump `revision`,
set `computedAt = now()` and `sourceEventId = trigger.id`. Atomic ⇒ a reader never sees a half-updated
snapshot set.

---

## 4. Read path — fall-through-to-live (the safety net that makes the cache non-destructive)

The dashboards (parent + admin, later slices) read snapshots via the **existing
`/api/v1/analytics/*` aggregate endpoints** — the contract surface stays the aggregate-endpoint
convention (project-context §2, ADR drift-safe). Internally `AnalyticsService` gains a **cache-first
read** with a deterministic fallback:

```
read snapshot for (student, term/year):
  if a row exists AND row.revision matches no open recompute trigger for the scope:
      serve the snapshot  (fast path — the <2 s NFR)            + freshness = {computedAt, fresh}
  else:
      compute live (today's path) and serve that                + freshness = {computedAt: now, recomputing}
      (optionally enqueue a backfill trigger so the next read is cached)
```

- **A cache miss is never an error** — it transparently serves the live computation (today's behaviour),
  so E6 can ship S1 (schema + recompute spine) **before** any dashboard is rewired, and a partially
  filled cache is always correct. This is what makes the whole epic **non-destructive**: deleting the
  snapshot tables at any time degrades latency, never correctness.
- The **freshness payload** (`computedAt`, `recomputing: boolean`, `gradeCount`) is added to the
  analytics response envelopes (additive fields — see contracts) and drives the "à jour il y a Xs /
  recalcul en cours" chip.

---

## 5. Index / RLS / tenancy checklist

- Every new table carries `tenantId @db.Uuid` as its **first** column and a **tenant-first** composite
  read index (ADR-002). The same RLS policy template applied to existing per-tenant tables
  (`@@map`-ed tables) is added for the 4 new tables in the RLS policy SQL (the repo applies RLS by a
  uniform `tenant_id` policy per table — the implementer adds the 4 policies alongside the `db push`,
  matching how every prior schema slice extended RLS).
- No cross-tenant read is possible: the recompute claims triggers `where tenantId = …`, writes
  snapshots stamped with that `tenantId`, and the read path filters `where tenantId = ctx.tenantId`
  (server-derived from the JWT via `SchoolContextService.forUser`, never client-supplied — matched to
  every existing analytics endpoint).
- **ABAC unchanged.** The parent read still passes `StudentAccessService.canAccessStudent` **before**
  the snapshot read (the cache does not widen access — it serves the same numbers the parent could
  already see live). Admin reads stay on `schools.read`; teacher reads on `teaching_assignments.read`.
- **Append-only audit unchanged.** Snapshots are a derived cache, not a domain mutation → recompute
  ticks do **not** write `AuditLog` rows (consistent with the alerts/notifications crons, which also do
  not audit their derived writes). An **admin manual rebuild** (S-later, `manual_rebuild` reason) **is**
  an explicit user action → it writes one append-only `analytics.snapshot_rebuild` audit row, mirroring
  the export-request audit precedent.

---

## 6. Migration steps (per slice) + the ADR

- **S1 (snapshot schema + recompute spine):** edit `schema.prisma` — add the 3 snapshot models + the
  `SnapshotRecomputeTrigger` model + the 2 enums → `prisma generate` → `prisma db push`. **All additive,
  no existing column changed, no backfill needed** (lazy fill on first ticks; reads fall through to live
  until a row exists). Add the 4 RLS policies. Add the snapshot/trigger types + `SNAPSHOT_TRIGGER_REASON`
  const to `packages/contracts`. Wire the API enqueue (additive, best-effort) + the worker
  `analytics-snapshots` cron module (mirror of `alerts-cron`). **No dashboard rewire in S1.**
- **S-later (wire parent dashboard read):** `AnalyticsService.parentDashboard` reads cache-first with
  fall-through (§4) + freshness fields on the response (contract delta, additive). **No schema step.**
- **S-later (wire admin/teacher reads + distribution charts + freshness chip + admin manual-rebuild
  endpoint):** cache-first reads on `adminDashboard` / `school-performance-drilldown` / `teacherReports`;
  the manual-rebuild endpoint enqueues a `manual_rebuild` trigger (audited). **No schema step beyond S1.**

### ADR recommendation (Winston gate)

E6 introduces **one new cross-cutting pattern**: a **durable snapshot recompute queue + materialised
analytics cache with fall-through-to-live**. That is a *new architectural decision* (a new persistence
+ derivation pattern, a new worker module, a cache-coherency contract) → per project-context §3 it
**should land with a new ADR**: **`docs/adr/ADR-019-analytics-snapshots.md`** — recording (a) why a
durable dirty-queue table rather than the unbuilt `OutboxEvent`→BullMQ listener; (b) the
fall-through-to-live cache-coherency rule that keeps the cache non-destructive; (c) the
snapshot↔live byte-parity requirement; (d) the freshness-signal contract. Everything else in E6 is
within existing conventions (aggregate endpoints, RLS, `db push`, cron pattern, no new permission). The
ADR is authored on the **S1 implementation run** (it documents a decision being made, not the spec). No
*other* ADR is tripped: no new HTTP style (reads stay on `/api/v1/analytics/*` aggregates), no new state
lib, no new permission, no off-convention path.
