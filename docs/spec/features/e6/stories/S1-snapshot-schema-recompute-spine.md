# E6-S1 — Snapshot schema + recompute spine + publish trigger

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone — no other context required. Mode: `epic-slice`. Epic: **E6 — Analytics
> Snapshots & pre-computation**. Slice **S1** of S1→S5. `[schema][worker]` · **P1** · ~M.
> **touchesUi: false · touchesBackend: true · touchesWorker: true.**
>
> **The one-line intent.** Stand up the three tenant-scoped snapshot read models +
> the durable `snapshot_recompute_trigger` dirty-queue (`db push`, additive, RLS,
> tenant-first indexes, freshness columns), mirror the snapshot/trigger types +
> `SNAPSHOT_TRIGGER_REASON` into `packages/contracts`, enqueue a best-effort
> coalescing trigger after the grade-publish commit (never blocks publish), and add a
> new `apps/worker` `analytics-snapshots` module (a `SnapshotRecomputeService` reusing
> ONE shared extracted normalise/coefficient helper for byte-parity with
> `AnalyticsService` + a `SnapshotDrainCronService` poll-drain mirroring `alerts-cron`,
> emitting `analytics.SnapshotRecomputed`) — with **NO read-path wiring** (dashboards
> still compute live, provably zero behaviour change). Lands with the new ADR
> **ADR-019** (next free filesystem number — 018 is the highest on disk).
>
> **Reuse-first / STOP-list.** If you are tempted toward any of these, STOP — they are
> explicit non-goals and each would require its own ADR or break the slice:
> - a **second BullMQ queue** / wiring the unbuilt `OutboxEvent`→BullMQ listener
>   (the dirty-queue TABLE + cron-poll is the deliberate mechanism);
> - a Postgres **`MATERIALIZED VIEW`** or an external/OLAP store;
> - **rewiring any `/analytics/*` read path** (that is S2/S3 — snapshots are WRITTEN
>   but NOT READ in S1);
> - a **second copy of the normalise/coefficient formula** (extract ONE shared helper);
> - a **new permission**, a **new HTTP endpoint**, or a **new `NotificationKind`/event name**
>   (`analytics.SnapshotRecomputed` already exists in contracts — emit it, do not add one);
> - **GradeRevised / coefficient-change triggers** (that is S3 — S1 ships the
>   **GradePublished** trigger only);
> - the **freshness chip** UI (that is S4 — S1 touches no web code);
> - an **audit row per recompute** (recompute is derived bookkeeping — NO `AuditLog` write).

---

## 1. Context — ground truth (read before coding)

### 1.1 What already exists (the live computation E6 caches)

- **`AnalyticsService`** — `apps/api/src/modules/analytics/analytics.service.ts`.
  Computes `parentDashboard` / `teacherDashboard` / `teacherReports` /
  `adminDashboard` / school-performance drill-down **live** over `Grade` rows on
  every request. `parentDashboard` (≈ L641–1063) is the canonical formula source.
  The exact arithmetic S1 must reproduce **byte-for-byte**:
  - **Normalise to /20:** `onTwenty = (Number(grade.value) / Number(assessment.maxScore)) * 20`,
    over `status in ('published','revised')` and `isAbsent = false`, skipping
    `g.value == null/0` exactly as the live code does (`if (!g.value) continue;`).
  - **Coefficient resolution (the `resolveCoef` closure, L721–726):**
    `coefficientOverride` on the assessment if non-null/undefined, else the
    `SubjectCoefficient(gradeLevel × subject).coefficient`, else
    `Subject.defaultCoefficient`.
  - **Per-subject average:** simple mean of the student's `onTwenty` grades for that
    `(subject, term)` (L764).
  - **Global average:** coefficient-weighted mean of the **per-subject averages** —
    `weightedSum / totalCoef`, where `totalCoef` only sums coefficients of subjects
    that HAVE a non-null average (L873–875). NOT a flat mean of all grades.
  - **Class average per subject:** `agg.sum / agg.n` over all class grades (L846).
  - **Class rank (per subject AND global):** competition ranking — `higher + 1`
    where `higher` = count of students with a strictly greater average (ex-æquo share
    a rank, L851–857 per-subject, L862–869 global). `classSize` = distinct graded
    student count.
  - **Trend / progression:** `lastTerm.avg − previousTerm.avg` (the `termEvolution`
    delta, L1048–1050) — last minus second-to-last term-ordered average.
- **`model Grade`** (`schema.prisma`, `@@map("grade")`): `value Decimal?`, `status`,
  `isAbsent`, `publishedAt`, `studentId`, `assessmentId`, `tenantId`. The source rows.
- **`model Assessment`**: `maxScore Decimal`, `coefficientOverride Decimal?`, `termId`,
  `teachingAssignmentId`, `isPublished`, `publishedAt`.
- **`model TeachingAssignment`**: resolves a grade's `(subjectId, classSectionId, academicYearId, teacherProfileId)`.
- **`model SubjectCoefficient`** (`(gradeLevelId × subjectId) → coefficient`) and
  **`Subject.defaultCoefficient`**: the coefficient inputs.
- **`DOMAIN_EVENTS`** in `packages/contracts/src/events/index.ts` **already** declares
  `SNAPSHOT_RECOMPUTED: 'analytics.SnapshotRecomputed'` (L22) — unwired. S1 emits it; do **not** add a new event.

### 1.2 The worker cron template S1 mirrors (do NOT fork these)

- `apps/worker/src/modules/alerts-cron/alerts-cron.service.ts` — the canonical
  cron shape: plain `setInterval(INTERVAL_MS)` armed in `onApplicationBootstrap()`
  after a `STARTUP_DELAY_MS`, cleared in `onModuleDestroy()`, a `private running`
  re-entrancy guard, per-tenant loop where **one tenant's failure is caught and never
  aborts the loop**.
- `apps/worker/src/modules/notifications-digest/notifications-digest.module.ts` and
  `...-cron.service.ts` — the canonical **new worker module** shape: `@Module` with
  the cron service as a provider, `PrismaService` from the global `PrismaModule`,
  per-tenant resolver (`tenantsWith…(): Promise<string[]>` via
  `findMany({ ..., distinct: ['tenantId'] })`).
- The worker app wires modules in `apps/worker/src/app.module.ts` (add
  `AnalyticsSnapshotsModule` to the `imports` array).
- Worker Prisma: `apps/worker/src/shared/prisma/prisma.service.ts` (global
  `PrismaModule`). **Note the worker uses the plain client** — it does NOT use the
  API's `withTenant()` SET-LOCAL wrapper. Every query MUST carry an explicit
  `where: { tenantId }` (defence-in-depth; matches every existing worker cron).

### 1.3 The grade-publish seam (where S1 enqueues the trigger)

`apps/api/src/modules/grades/assessments.controller.ts`, method `publish()`
(`@Post(':id/publish')`, ≈ L257–350). After the `$transaction` commits and **after**
the existing best-effort notification fan-out `try/catch`, `result` holds the
re-fetched assessment with `teachingAssignment` included. S1 adds a **second**
best-effort `try/catch` that enqueues the recompute trigger. The publish path already
loads `a.grades` (so `studentIds` are available) and `result.teachingAssignment`.

### 1.4 Migration convention (verified)

`prisma db push`, **no SQL `migrations/` folder** (`apps/api/prisma/migrations/`
does not exist — same as E1-S3…E5-S2). RLS is "configurée séparément via migration
SQL" (ADR-002): `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` + a policy
`USING (tenant_id = current_setting('app.current_tenant_id')::uuid)` per tenant table.
The API runs queries inside `withTenant()` which does `SET LOCAL app.current_tenant_id`.
S1 adds the 4 RLS policy statements alongside the `db push` (see §6).

### 1.5 ADR number — RECONCILED

`docs/adr/` contains 001–004, 013–018 — the highest ADR **file** on disk is **018**.
The "ADR-019 — real-time messaging transport" line in `docs/spec/features/e2/plan.md`
is **informal spec prose: there is NO `ADR-019-*.md` file** (verified by `ls docs/adr/`).
So **019 is the next free filesystem number** and is the one used here:
`docs/adr/ADR-019-analytics-snapshots.md`. The dangling "ADR-019 real-time deferral"
reference is reconciled inside the ADR (it remains an un-filed narrative note, not a
collision). *(The earlier "use ADR-020" guidance was based on the myth that 019 was
taken on disk — it is not; filing 020 would leave a 019 gap.)*

---

## 2. Scope — exactly what S1 ships

### 2.1 Schema (`apps/api/prisma/schema.prisma`) — additive only

Add **2 enums + 4 models**. **No existing model changes shape. No relation field is
added to any existing model's relation block** (snapshot scope ids are plain `@db.Uuid`
columns WITHOUT a Prisma `@relation` — the cache-row convention, same precedent as
`Grade.flaggedBy` / `AuditLog.actorId`; orphan cache rows after a hard delete are
harmless and reaped by a later rebuild; DBA-lens decision recorded below as **plain
ids, no FK**).

```prisma
enum SnapshotTriggerReason {
  grade_published
  grade_revised
  coefficient_changed
  manual_rebuild
  backfill
}

enum SnapshotTriggerStatus {
  pending
  processing
  done
  failed
}

/// E6 — materialised per-(student × subject × term) average. Disposable CACHE over
/// published/revised Grade rows (source of truth stays Grade). termId null = year roll-up.
model StudentSubjectSnapshot {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  schoolId        String   @map("school_id") @db.Uuid
  academicYearId  String   @map("academic_year_id") @db.Uuid
  studentId       String   @map("student_id") @db.Uuid
  classSectionId  String   @map("class_section_id") @db.Uuid
  subjectId       String   @map("subject_id") @db.Uuid
  termId          String?  @map("term_id") @db.Uuid
  average         Decimal? @db.Decimal(5, 2)
  coefficient     Decimal  @default(1.0) @db.Decimal(4, 2)
  gradeCount      Int      @default(0) @map("grade_count")
  classRank       Int?     @map("class_rank")
  classSize       Int      @default(0) @map("class_size")
  trendDelta      Decimal? @map("trend_delta") @db.Decimal(5, 2)
  computedAt      DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  sourceEventId   String?  @map("source_event_id") @db.Uuid
  revision        Int      @default(1)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([studentId, subjectId, termId])
  @@index([tenantId, academicYearId, classSectionId, subjectId])
  @@index([tenantId, studentId, academicYearId])
  @@map("student_subject_snapshot")
}

/// E6 — materialised per-(student × term) GLOBAL (coefficient-weighted) average. termId null = year.
model StudentGlobalSnapshot {
  id                String   @id @default(uuid()) @db.Uuid
  tenantId          String   @map("tenant_id") @db.Uuid
  schoolId          String   @map("school_id") @db.Uuid
  academicYearId    String   @map("academic_year_id") @db.Uuid
  studentId         String   @map("student_id") @db.Uuid
  classSectionId    String   @map("class_section_id") @db.Uuid
  termId            String?  @map("term_id") @db.Uuid
  globalAverage     Decimal? @map("global_average") @db.Decimal(5, 2)
  classAverage      Decimal? @map("class_average") @db.Decimal(5, 2)
  classRank         Int?     @map("class_rank")
  classSize         Int      @default(0) @map("class_size")
  progressionDelta  Decimal? @map("progression_delta") @db.Decimal(5, 2)
  attendanceRate    Decimal? @map("attendance_rate") @db.Decimal(5, 2)
  subjectCount      Int      @default(0) @map("subject_count")
  computedAt        DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  sourceEventId     String?  @map("source_event_id") @db.Uuid
  revision          Int      @default(1)
  createdAt         DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt         DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([studentId, termId])
  @@index([tenantId, academicYearId, classSectionId])
  @@index([tenantId, studentId, academicYearId])
  @@map("student_global_snapshot")
}

/// E6 — materialised per-(classSection × subject × term) distribution + class average.
model ClassSubjectDistribution {
  id              String   @id @default(uuid()) @db.Uuid
  tenantId        String   @map("tenant_id") @db.Uuid
  schoolId        String   @map("school_id") @db.Uuid
  academicYearId  String   @map("academic_year_id") @db.Uuid
  classSectionId  String   @map("class_section_id") @db.Uuid
  subjectId       String   @map("subject_id") @db.Uuid
  termId          String?  @map("term_id") @db.Uuid
  average         Decimal? @db.Decimal(5, 2)
  median          Decimal? @db.Decimal(5, 2)
  minScore        Decimal? @map("min_score") @db.Decimal(5, 2)
  maxScore        Decimal? @map("max_score") @db.Decimal(5, 2)
  countLow        Int      @default(0) @map("count_low")
  countMid        Int      @default(0) @map("count_mid")
  countHigh       Int      @default(0) @map("count_high")
  passRate        Decimal? @map("pass_rate") @db.Decimal(5, 2)
  gradeCount      Int      @default(0) @map("grade_count")
  studentCount    Int      @default(0) @map("student_count")
  computedAt      DateTime @default(now()) @map("computed_at") @db.Timestamptz(6)
  sourceEventId   String?  @map("source_event_id") @db.Uuid
  revision        Int      @default(1)
  createdAt       DateTime @default(now()) @map("created_at") @db.Timestamptz(6)
  updatedAt       DateTime @updatedAt @map("updated_at") @db.Timestamptz(6)

  @@unique([classSectionId, subjectId, termId])
  @@index([tenantId, academicYearId, classSectionId])
  @@index([tenantId, schoolId, academicYearId])
  @@map("class_subject_distribution")
}

/// E6 — durable dirty-queue. Best-effort enqueued on a snapshot-invalidating mutation;
/// the worker cron drains pending rows tenant-by-tenant. NOT a BullMQ queue.
model SnapshotRecomputeTrigger {
  id              String                @id @default(uuid()) @db.Uuid
  tenantId        String                @map("tenant_id") @db.Uuid
  schoolId        String?               @map("school_id") @db.Uuid
  reason          SnapshotTriggerReason
  status          SnapshotTriggerStatus @default(pending)
  studentId       String?  @map("student_id") @db.Uuid
  classSectionId  String?  @map("class_section_id") @db.Uuid
  subjectId       String?  @map("subject_id") @db.Uuid
  termId          String?  @map("term_id") @db.Uuid
  academicYearId  String?  @map("academic_year_id") @db.Uuid
  coalesceKey     String   @map("coalesce_key")
  attempts        Int      @default(0)
  lastError       String?  @map("last_error")
  enqueuedAt      DateTime @default(now()) @map("enqueued_at") @db.Timestamptz(6)
  processedAt     DateTime? @map("processed_at") @db.Timestamptz(6)

  @@unique([tenantId, coalesceKey, status])
  @@index([tenantId, status, enqueuedAt])
  @@map("snapshot_recompute_trigger")
}
```

After editing: run `prisma generate` (so `@prisma/client` types exist) — **the
orchestrator** runs `generate` + `db push`; **agents never build**. The implementer
edits the schema only.

**Nullable-`termId` unique caveat (must handle in code).** Postgres treats `NULL` as
distinct in a unique index, so `@@unique([studentId, subjectId, termId])` does NOT stop
two `termId = null` rows. The recompute guarantees a single year-roll-up row by
**delete-then-insert** of the `termId IS NULL` row inside the same transaction (§4.3).
Do NOT use a sentinel non-null termId.

### 2.2 Contracts (`packages/contracts`) — additive types only

In `packages/contracts/src/enums/index.ts`, add (mirroring the `NOTIFICATION_CADENCE`
1:1 pattern at L62–64):

```ts
// E6 — Prisma SnapshotTriggerReason / SnapshotTriggerStatus mirrored 1:1.
export const SNAPSHOT_TRIGGER_REASON = [
  'grade_published', 'grade_revised', 'coefficient_changed', 'manual_rebuild', 'backfill',
] as const;
export type SnapshotTriggerReason = (typeof SNAPSHOT_TRIGGER_REASON)[number];

export const SNAPSHOT_TRIGGER_STATUS = [
  'pending', 'processing', 'done', 'failed',
] as const;
export type SnapshotTriggerStatus = (typeof SNAPSHOT_TRIGGER_STATUS)[number];
```

Add a small snapshot/trigger TS type surface (a new file
`packages/contracts/src/dto/snapshot.ts`, re-exported from
`packages/contracts/src/dto/index.ts` and `src/index.ts` following the existing
barrel-export pattern). Minimal shape — the additive `freshness` block the read
slices (S2/S3) will populate, so it is declared once here:

```ts
import type { SnapshotTriggerReason } from '../enums';

/** Additive freshness metadata exposed by analytics payloads from S2 onward. */
export interface SnapshotFreshness {
  source: 'snapshot' | 'live';
  computedAt: string;          // ISO
  recomputing: boolean;
  gradeCount?: number;
  sourceEventId?: string | null;
  revision?: number;
}

/** Shape of a recompute scope (mirrors SnapshotRecomputeTrigger nullable scope cols). */
export interface SnapshotRecomputeScope {
  tenantId: string;
  schoolId?: string | null;
  reason: SnapshotTriggerReason;
  studentId?: string | null;
  classSectionId?: string | null;
  subjectId?: string | null;
  termId?: string | null;
  academicYearId?: string | null;
}
```

> The `freshness` block is **declared** in S1 but **not yet returned** by any
> endpoint (no read is rewired in S1). S2/S3 consume it.

### 2.3 API — best-effort coalescing enqueue at the publish seam

In `assessments.controller.ts` `publish()`, **after** the existing notification
fan-out `try/catch`, add a **separate** best-effort block. It must never throw into the
publish path.

- Derive scope from the committed data:
  - `studentIds = [...new Set(a.grades.map((g) => g.studentId))]` (already computed above — reuse).
  - `ta = result?.teachingAssignment` → `classSectionId`, `subjectId`, `academicYearId`.
    (`result.teachingAssignment` currently `include`s `subject`; **extend the publish
    `tx.assessment.findUnique` include** to also select
    `teachingAssignment: { select: { classSectionId, subjectId, academicYearId } }`
    plus `result.schoolId` is on the assessment row directly via `a.tenantId`/`schoolId` —
    use `a.schoolId` if present, else resolve from the class section; keep it best-effort,
    a null schoolId is acceptable on the trigger.)
  - `termId = a.termId` (assessment's term).
- **Coalesce key** = a deterministic string of the scope, so a burst of publishes for
  the same `(class, subject, term)` while a recompute is still `pending` collapses into
  ONE pending row. Build it in a tiny shared helper (see §3) and `upsert`:

```ts
try {
  const ta = result?.teachingAssignment;
  if (ta?.classSectionId) {
    const reason = 'grade_published' as const;
    const scope = {
      tenantId: me.tenantId,
      reason,
      classSectionId: ta.classSectionId,
      subjectId: ta.subjectId,
      termId: a.termId ?? null,
      academicYearId: ta.academicYearId,
    };
    const coalesceKey = snapshotCoalesceKey(scope); // deterministic, see §3
    await this.prisma.snapshotRecomputeTrigger.upsert({
      where: { tenantId_coalesceKey_status: { tenantId: me.tenantId, coalesceKey, status: 'pending' } },
      create: { ...scope, schoolId: a.schoolId ?? null, status: 'pending', coalesceKey },
      update: { enqueuedAt: new Date() }, // touch so FIFO reflects the latest publish
    });
  }
} catch (err) {
  // Recompute enqueue is best-effort — NEVER fails the publish (E3-S4 posture).
  // eslint-disable-next-line no-console
  console.warn('[assessments.publish] snapshot recompute enqueue failed', err);
}
```

> The `tenantId_coalesceKey_status` compound-unique input name is what Prisma
> generates from `@@unique([tenantId, coalesceKey, status])`. Verify the generated name
> after `prisma generate`.

### 2.4 Worker — the `analytics-snapshots` module

New directory `apps/worker/src/modules/analytics-snapshots/`:

```
analytics-snapshots.module.ts     # @Module — providers: [SnapshotRecomputeService, SnapshotDrainCronService]
snapshot-keys.ts                  # snapshotCoalesceKey(scope) + REVISION const + scope helpers (PURE)
snapshot-formula.ts               # the ONE shared normalise/coefficient/aggregate helper (PURE)
snapshot-recompute.service.ts     # recompute one scope → upsert snapshot rows in a transaction
snapshot-drain-cron.service.ts    # poll-drain pending triggers per tenant + lagging-tenant backfill
snapshot-recompute.spec.ts        # the byte-parity + idempotency unit spec (Murat-picked)
```

Register in `apps/worker/src/app.module.ts` `imports`.

**The shared formula helper (`snapshot-formula.ts`) — the byte-parity gate.** Extract
the normalise + coefficient-resolution + aggregation arithmetic into ONE pure module
(no Prisma, no Nest), taking plain rows in and returning plain numbers, so the worker
and any future API caller share **one** formula. It must reproduce §1.1 exactly:
`onTwenty`, `resolveCoef`, per-subject mean, weighted global, competition rank,
trend delta. **Do NOT re-derive — port the exact expressions from `analytics.service.ts`.**

> **Byte-parity discipline (E3 precedent).** The spec's AC-2 requires the snapshot
> output to equal the live `AnalyticsService` output on a seeded fixture. The cleanest
> way to guarantee this is to have BOTH call the same pure helper. If extracting the
> helper into a location both apps import is impractical this slice (the worker and api
> are separate Nest apps; the existing alerts rules are *duplicated* per-app — see the
> `AlertsEvaluatorService` comment), then DUPLICATE the pure helper into the worker
> module AND keep the test asserting equality against the live numbers. Prefer one
> shared helper; a faithful duplicate covered by the parity test is the accepted fallback.

**`SnapshotRecomputeService.recomputeScope(scope)`** — given a trigger's scope:
1. Resolve the affected `(tenant, classSection, subject, term)` set and the class roster
   (the live path's `classGrades` query, filtered `status in (published,revised)`,
   `isAbsent=false`, `tenantId` explicit).
2. Compute, **in one `prisma.$transaction`**:
   - per-term `StudentSubjectSnapshot` rows — `upsert` on `(studentId, subjectId, termId)`;
   - the `termId = null` year-roll-up `StudentSubjectSnapshot` row — **delete-then-insert**
     (the NULL-unique caveat, §2.1);
   - cascade `StudentGlobalSnapshot` (per-term + year roll-up) for each affected student
     (`upsert` on `(studentId, termId)`; delete-then-insert the null-term row);
   - refresh the `ClassSubjectDistribution` cell (`upsert` on `(classSectionId, subjectId, termId)`
     + delete-then-insert null-term);
   - on each written row set `computedAt = now()`, `sourceEventId = trigger.id`, bump
     `revision` (`{ increment: 1 }` on update; `1` on create).
3. Idempotent: re-running with unchanged grades produces identical figures (only
   `computedAt`/`revision` move).

**`SnapshotDrainCronService`** — structural mirror of `AlertsCronService`:
- `private timer`, `private running`, `onApplicationBootstrap()` arms a
  `setInterval(SNAPSHOT_RECOMPUTE_INTERVAL_MS, default 60_000)` after a
  `SNAPSHOT_RECOMPUTE_STARTUP_DELAY_MS` (default ~40_000), `onModuleDestroy()` clears it.
- `tick()` (re-entrancy guarded): `tenantsWithPending()` (`findMany` distinct `tenantId`
  where `status='pending'`) → per tenant (in a `try/catch` that never aborts the loop):
  - claim a **bounded FIFO batch** of pending triggers: `findMany({ where: { tenantId, status:'pending' }, orderBy:{ enqueuedAt:'asc' }, take: N })` then
    `updateMany(... status: 'pending' → 'processing')` (or per-row `update`; the
    `@@unique([tenantId, coalesceKey, status])` means flipping status frees the
    coalesce slot for a fresh pending row);
  - for each claimed trigger: `recomputeScope(scope)`; on success
    `update({ status:'done', processedAt: now })`; on error
    `update({ status:'failed', attempts:{increment:1}, lastError })` (parked past a
    small cap, e.g. 5; below the cap the row may be re-set to `pending` for retry —
    keep it simple, parking is fine for S1).
- **Lagging-tenant backfill:** for any tenant whose newest `student_subject_snapshot.computedAt`
  predates its latest published grade (or has zero snapshots), enqueue a `backfill`
  trigger so the cache lazily fills (covers a missed enqueue / a fresh tenant / crash
  recovery). Keep this a light scan; bound the work per tick.
- After a successful pass, **emit `analytics.SnapshotRecomputed`** — since the
  `OutboxEvent`→BullMQ listener is unwired, "emit" = log it structurally AND (if cheap)
  write nothing to a queue. The minimum is to reference the
  `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` constant in the log so the wiring point is
  explicit for a future consumer. **Do not add a queue.**

`AnalyticsSnapshotsModule` imports nothing beyond what the cron needs (`PrismaModule`
is global). NO `QueueModule` import (no queue).

### 2.5 ADR — `docs/adr/ADR-019-analytics-snapshots.md`

Author the ADR (status: Accepted, dated 2026-06-05). Record the **one** new
cross-cutting decision: a **durable snapshot-recompute dirty-queue + materialised
analytics cache + fall-through-to-live**. Cover: (a) **why a durable dirty-queue table**
rather than the unbuilt `OutboxEvent`→BullMQ listener (no consumer wired anywhere;
coupling a perf feature to an unfinished mechanism is wrong; the dirty-queue is the
same poll-drain the 3 existing crons use, made durable); (b) the
**fall-through-to-live cache-coherency rule** that keeps the cache non-destructive
(deleting the tables degrades latency, never correctness); (c) the **snapshot↔live
byte-parity** requirement (one shared formula); (d) the **freshness-signal contract**
(`computedAt`+`sourceEventId`+`revision`). List the tripwires it does NOT cross (no 2nd
queue, no `MATERIALIZED VIEW`, no external store, no new permission). Follow the format
of `docs/adr/ADR-002-multi-tenancy-rls.md` (Context / Decision / Options / Consequences).

---

## 3. Shared coalesce-key helper (used by API + worker)

`snapshotCoalesceKey(scope)` must be **deterministic** and identical on both sides. The
API enqueue (§2.3) builds the key; the worker reads the scope columns (not the key) to
recompute, so the key only needs to be stable for de-dup. Implement it once; if it
cannot be shared across the api/worker app boundary cheaply, duplicate the pure function
verbatim (it is ~5 lines). Suggested:

```ts
export function snapshotCoalesceKey(s: {
  reason: string; studentId?: string | null; classSectionId?: string | null;
  subjectId?: string | null; termId?: string | null; academicYearId?: string | null;
}): string {
  return [s.reason, s.classSectionId ?? '', s.subjectId ?? '',
          s.termId ?? '', s.academicYearId ?? '', s.studentId ?? ''].join('|');
}
```

---

## 4. Acceptance criteria (folds spec AC-1/2/3/7/8)

- **AC-S1.1 — schema additive.** The 2 enums + 4 models land via `db push`; each table
  is tenant-scoped (`tenant_id` first), has the freshness columns
  (`computedAt`+`sourceEventId`+`revision`), a natural-key `@@unique`, tenant-first
  read `@@index`es, and `@@map("snake_case")`. **No existing table changes shape; no
  relation field added to any existing model.** The 4 RLS policies are added.
- **AC-S1.2 — byte-parity & idempotency (the Murat-picked test).** A unit spec
  (`snapshot-recompute.spec.ts`) seeds a small fixture and asserts the recompute's
  `average` / weighted `globalAverage` / `classAverage` / `classRank` / distribution
  histogram / `trendDelta` are **byte-identical** to the live `AnalyticsService` output
  for the same inputs; a re-run with unchanged grades is a no-op upsert (figures
  identical, only `computedAt`/`revision` move).
- **AC-S1.3 — enqueue is best-effort & coalescing.** GradePublished `upsert`s ONE
  pending trigger per `(tenant, scope)`; a burst collapses to one pending row; an
  enqueue failure is caught + logged and **never fails the publish** (the publish HTTP
  response is byte-unchanged).
- **AC-S1.4 — drain mirrors the cron pattern & is tenant-scoped.** The cron polls
  pending triggers per tenant (FIFO, bounded batch), recomputes each scope in one
  transaction, marks the trigger `done`/`failed`; one tenant's/scope's failure never
  aborts the loop; the backfill enqueues for lagging/empty tenants;
  `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` is referenced on emit. Every query carries an
  explicit `where: { tenantId }`.
- **AC-S1.5 — zero behaviour change (FR-8).** **No `/analytics/*` read path is
  rewired.** Snapshots are written but never read; every dashboard renders exactly as
  before (provably — the only API diff is the additive enqueue block in `publish()`).
- **AC-S1.6 — ADR filed.** `docs/adr/ADR-019-analytics-snapshots.md` lands with the
  decision recorded (Winston gate).
- **AC-S1.7 — guardrails.** Tenant + RLS on every new row/query; **no `AuditLog` write
  per recompute** (derived bookkeeping); snapshots carry no new personal data (aggregates
  only) and are fully rebuildable; **no second BullMQ queue, no `MATERIALIZED VIEW`, no
  new permission, no new event name, no new endpoint**.

---

## 5. Out of scope (later slices — do NOT do here)

- Any `/analytics/*` read rewire / the `freshness` block being returned (S2 parent, S3 teacher/admin).
- The `FreshnessChip` UI (S4) — S1 touches **no** `apps/web` code.
- GradeRevised + coefficient-change triggers (S3).
- Admin manual-rebuild endpoint / sweep hardening / orphan prune (S5).

---

## 6. Migration & build notes (orchestrator runs builds; agents never build)

1. Edit `schema.prisma` (§2.1). The orchestrator runs `prisma generate` + `prisma db push`.
2. RLS — add 4 policy statements (matching ADR-002's per-table template), one per new
   table, applied alongside the `db push` (wherever the repo applies its RLS policy SQL;
   if there is no SQL file, document the 4 `ALTER TABLE … ENABLE ROW LEVEL SECURITY;` +
   `CREATE POLICY …` statements in the slice notes / quickstart so the operator applies
   them). The `snapshot_recompute_trigger` is worker-written via the plain client (no
   `withTenant`); its RLS policy is still added for defence-in-depth, and the worker
   passes explicit `tenantId` filters.
3. Contracts (§2.2) — additive exports; the orchestrator rebuilds `packages/contracts` to CJS.
4. `pnpm typecheck` is run **once** by Murat (the test-architect gate), not by agents.

---

## 7. Risk pre-assessment (Murat-plan)

- **P1 — parity drift (highest).** If the worker formula diverges from live, dashboards
  would silently show different numbers once S2 reads the cache. Mitigation: the shared
  pure helper + the AC-S1.2 byte-parity spec, run **before** any read switch.
- **P1 — publish regression.** The enqueue must be strictly additive/best-effort. A
  thrown error or a blocking await in the publish path would regress grade publication.
  Mitigation: the second isolated `try/catch`, after the response is fully assembled;
  test that a forced enqueue failure leaves the publish response unchanged.
- **P2 — recompute storm / lock contention.** Bound the batch `take`, coalesce on the
  unique key, keep transactions per-scope small. No FK relations on snapshots/trigger
  (avoids cascade lock contention).
- **P2 — null-term duplication.** Handled by delete-then-insert of the `termId IS NULL`
  rows in the same transaction; the spec must cover a year-roll-up recompute twice → one row.
