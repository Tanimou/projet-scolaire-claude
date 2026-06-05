# E6-S2 — Parent dashboard reads snapshots (snapshot-first read switch + additive freshness, behind live fallback)

> **Self-contained story spec.** A developer implements this slice from THIS file
> alone — no other context required. Mode: `epic-slice`. Epic: **E6 — Analytics
> Snapshots & pre-computation**. Slice **S2** of S1→S5. `[api]` · **P1** · ~M.
> **touchesUi: false · touchesBackend: true · touchesWorker: false.**
>
> **The one-line intent.** Rewire `GET /api/v1/analytics/parent-dashboard/:studentId`
> to assemble the EXACT same `ParentDashboardResponse` from the S1
> `StudentGlobalSnapshot` + `StudentSubjectSnapshot` (+ `ClassSubjectDistribution`
> for the "vs classe" context) **snapshot-first**, with **transparent
> fall-through-to-live on any miss/stale** (never an error), keeping the parent
> `StudentAccessService.canAccessStudent` ABAC checked FIRST and full tenant/RLS
> scoping — collapsing the class-wide live grade `findMany` into indexed point-reads
> for the headline <2 s-on-mobile NFR win; add ONLY the additive optional
> `freshness { source, computedAt, recomputing }` block (additive on the response,
> ignorable by the UI). API-only: **no schema change, no new endpoint, no permission
> change, no UI/chip** (the chip is S4).
>
> **Reuse-first / STOP-list.** If you are tempted toward any of these, STOP — they are
> explicit non-goals and each would break the slice or trip an ADR:
> - **any schema change / `db push` / new migration** — S1 already shipped every
>   table this slice reads; S2 is read-only over them;
> - **a new endpoint, controller, or permission** — reuse the existing
>   `@Get('parent-dashboard/:studentId')` + `students.read` + the parent ABAC wall;
> - **moving / removing / loosening the `StudentAccessService.canAccessStudent`
>   check** — it stays in the controller, BEFORE the service call, unchanged;
> - **rewiring teacher/admin reads** (that is S3) or **the other parent feeds**
>   `parent-comments` / `parent-upcoming` (out of scope — see §3 "sibling reads");
> - **the freshness CHIP UI** (that is S4 — S2 touches NO `apps/web` code, only adds
>   the `freshness` field to the JSON);
> - **a second normalise/coefficient formula** — byte-parity is the gate; assemble
>   the payload from the snapshot's already-computed figures, do not re-derive;
> - **a recompute / write of any snapshot row from the read path** (optionally you
>   MAY best-effort enqueue a backfill trigger on a miss — see §4.6 — but never write
>   a snapshot row from the API);
> - **changing the publish/recompute worker** (S2 is `apps/api` only);
> - **a websocket / real-time freshness push** (ADR-019 deferral — the field updates
>   on the next fetch).

---

## 1. Context — ground truth (read before coding)

### 1.1 The endpoint + its guard (DO NOT change the guard)

`apps/api/src/modules/analytics/analytics.controller.ts`, `parentDashboard`:

```ts
@Get('parent-dashboard/:studentId')
@RequiresPermission('students.read')
async parentDashboard(@Param('studentId') studentId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
  const me = await this.users.ensureUser(jwt);
  const { schoolId } = await this.ctx.forUser(me);
  const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
  if (!allowed) throw new ForbiddenException();           // ABAC wall — STAYS FIRST, UNCHANGED
  return this.analytics.parentDashboard({ tenantId: me.tenantId, studentId });
}
```

**Invariant:** the ABAC check (`canAccessStudent`) runs in the controller BEFORE
the service call, and the service is called with a server-derived `tenantId` (from
the JWT, never client-supplied). S2 does NOT touch the controller method body except
optionally to keep the same call shape — the snapshot read lives **inside**
`AnalyticsService.parentDashboard`, which is only reached *after* the ABAC passes.
The cache never widens access (FR-7 / AC-7).

### 1.2 The live computation S2 caches (the source of truth for byte-parity)

`apps/api/src/modules/analytics/analytics.service.ts`, `async parentDashboard(opts: { tenantId; studentId; academicYearId? }): Promise<ParentDashboardResponse>` (~line 641). The shape it returns is the **`ParentDashboardResponse` interface** (~line 352). Key fields and how live derives them (these are the parity targets):

- **`student`** — `{ id, firstName, lastName, photoUrl, classSectionName, gradeLevelName, schoolName, externalRef, birthDate, rank, classSize }`. From the live `student.findFirst` + active enrollment. **Not snapshot data** — keep fetching it live (it is one indexed row read, not a class scan). `rank` = `studentRank` (global competition rank), `classSize` = `classRankTotal || subjectPerf[0]?.classSize || 0`.
- **`globalPerformance`** — `{ studentAverage, classAverage, progression, attendanceRate, percentageOnTwenty }`:
  - `studentAverage` = **coefficient-weighted** overall (`weightedSum/totalCoef` over `subjectPerf`, lines 873–875).
  - `classAverage` = **coefficient-weighted** class overall (`classOverall`, lines 877–881) — weighted over `subjectPerf[].classAverage`.
  - `progression` = `termEvolution.last.student − termEvolution.prev.student` (delta of the last two terms' STUDENT averages; lines 1048–1050).
  - `percentageOnTwenty` = `(studentAverage / 20) * 100`.
  - `attendanceRate` = live (see §4.5 — NOT reliably in the snapshot; keep live).
- **`subjectPerf[]`** (`StudentSubjectPerf`) — `{ subjectId, subjectCode, subjectName, subjectColor, coefficient, studentAverage, classAverage, studentRank, classSize, trend, badge }`. Per `(subject, year roll-up)`: `studentAverage` = simple mean of the student's on-/20 grades for the subject (line 764); `classAverage` = class mean; `studentRank` = competition rank over per-student subject means; `trend` = last-term − prev-term subject avg.
- **`termEvolution[]`**, **`subjectEvolution[]`**, **`subjectTeachers[]`**, **`previousYearComparison`**, **`annualProgression`**, **`recentGrades[]`**, **`upcomingAssessments[]`** — see §4.4 (which are snapshot-servable vs. which stay live).

### 1.3 The snapshot rows S1 already writes (what S2 reads)

S1 shipped these Prisma models (in `apps/api/prisma/schema.prisma`, already `db push`-ed; Prisma client regenerated). Read them tenant-scoped.

**`StudentSubjectSnapshot`** — one row per `(studentId, subjectId, termId)`; `termId = null` = **year roll-up** (the grain the parent subject cards use). Columns: `tenantId, schoolId, academicYearId, studentId, classSectionId, subjectId, termId, average (Decimal?/20), coefficient (Decimal), gradeCount, classRank, classSize, trendDelta (Decimal?), computedAt, sourceEventId, revision`. Read index: `@@index([tenantId, studentId, academicYearId])` (the parent-dashboard read for one child).

**`StudentGlobalSnapshot`** — one row per `(studentId, termId)`; `termId = null` = year-level global. Columns: `tenantId, schoolId, academicYearId, studentId, classSectionId, termId, globalAverage (Decimal?/20, coefficient-weighted), classAverage (Decimal?, MEAN-OF-MEANS — see ⚠ §4.3), classRank, classSize, progressionDelta (Decimal?), attendanceRate (Decimal?, currently NOT populated by S1 — see §4.5), subjectCount, computedAt, sourceEventId, revision`. Read index: `@@index([tenantId, studentId, academicYearId])`.

**`ClassSubjectDistribution`** — one row per `(classSectionId, subjectId, termId)`. Columns include `average, median, minScore, maxScore, countLow/Mid/High, passRate, gradeCount, studentCount, computedAt, sourceEventId, revision`. Used here ONLY for the "vs classe" subject `classAverage` context where the global snapshot does not carry it.

**`SnapshotRecomputeTrigger`** — the dirty-queue. S2 reads it (NOT writes, except the optional §4.6 backfill) to compute `recomputing`: an **open** trigger (`status IN (pending, processing)`) for the student's `(classSectionId | studentId)` scope ⇒ `recomputing = true`.

> **Decimal handling.** Snapshot averages are Prisma `Decimal`. The live path returns plain `number | null`. Convert every snapshot Decimal with `Number(x)` (and `x == null ? null : Number(x)`) so the assembled payload's numeric types are byte-identical to live (no `Decimal` leaks into the JSON). Round consistently with live: live computes raw floats and lets JSON serialize them; S1 rounds snapshot figures with `round2`. **Parity rule:** the contract test (§5) compares snapshot-vs-live with a tolerance ≤ 0.01 on each numeric field, OR you align rounding — pick the approach the test in §5 enforces (round both to 2 decimals before compare).

### 1.4 The contracts type (already declared in S1 — USE it, do not redefine)

`packages/contracts/src/dto/snapshot.ts` exports `SnapshotFreshness` (and `SnapshotFreshnessSchema`):

```ts
{ source: 'snapshot' | 'live';
  computedAt: string;            // ISO 8601; "now" on a live miss
  recomputing: boolean;          // open trigger for the scope, OR served live
  gradeCount?: number;
  sourceEventId?: string | null;
  revision?: number; }
```

`SNAPSHOT_SOURCE` is the enum backing `source`. Import the existing type — do NOT
add a new one. The `freshness` field is **additive + optional** on the response.

---

## 2. Goal & non-goals

**Goal.** When fresh snapshots exist for the child, serve `/parent/dashboard` from a
handful of **indexed point-reads** (one `StudentGlobalSnapshot` year-roll-up row +
the child's `StudentSubjectSnapshot` year-roll-up rows + per-term rows for evolution +
the matching `ClassSubjectDistribution` rows) — **no class-wide `grade.findMany`** —
holding the <2 s-on-mobile NFR at scale; and add the additive `freshness` block. When
a snapshot is missing or stale, fall through to the EXACT existing live computation
(byte-identical payload), `freshness.source = 'live'`, `freshness.recomputing = true`.
The existing UI renders unchanged.

**Non-goals (this slice):** the freshness chip UI (S4); teacher/admin read switches
and the GradeRevised/coefficient triggers (S3); any schema change; any new endpoint
or permission; the `parent-comments`/`parent-upcoming` feeds; populating
`attendanceRate` into the global snapshot (S2 keeps attendance live — §4.5).

---

## 3. Scope of work (api only)

1. **`AnalyticsService.parentDashboard`** (`apps/api/src/modules/analytics/analytics.service.ts`) — add a snapshot-first path with live fallback (§4). Keep the current method signature and return type (`ParentDashboardResponse`) — only ADD the optional `freshness` field to the returned object.
2. **`ParentDashboardResponse` interface** — add `freshness?: SnapshotFreshness` (additive, optional). Import `SnapshotFreshness` from `@pilotage/contracts`.
3. **A small private helper** (e.g. `parentDashboardFromSnapshot(...)`) that assembles the response from snapshot rows, and a **freshness/staleness resolver** (`resolveFreshness(...)`) that decides snapshot-vs-live and builds the `freshness` block. Keep these private to the service (or a co-located pure helper file if cleaner) — no new module/provider.
4. **"Sibling parent reads" clarification.** The intent mentions "and sibling parent reads". For S2, the ONLY sibling that reads snapshot averages is the main `parentDashboard`. `parent-comments` and `parent-upcoming` are list feeds over raw grades/assessments (no averaged snapshot grain) — leave them live and untouched. If a reviewer reads "sibling parent reads" as those two: explicitly note in the PR they are out of S2 scope (no snapshot grain to serve them from).

**No worker change. No web change. No schema change. No new endpoint. No new permission.**

---

## 4. Detailed design — the snapshot-first read switch

### 4.1 Resolve the student context (live, cheap, unchanged)

Keep the existing `student.findFirst` (student + active enrollment + school + grade
level + academic year) — it is one indexed row read and supplies `student.*`,
`classSectionId`, `academicYearId`, `gradeLevelId`, `classSectionName`,
`gradeLevelName`, `schoolName`. This is NOT the class-wide scan; keep it. Derive
`academicYearId` and `classSectionId` exactly as today (lines 681–685). If there is
no active enrollment / no `academicYearId` ⇒ there is no snapshot scope ⇒ go live
(empty-ish payload, same as today).

### 4.2 Decide snapshot-vs-live (the gate)

Read the child's **year-roll-up** `StudentGlobalSnapshot` (`where: { tenantId, studentId, termId: null, academicYearId }`) and the child's `StudentSubjectSnapshot` rows for the year (`where: { tenantId, studentId, academicYearId }`, both per-term and `termId: null`).

Serve **from snapshot** only when BOTH hold:
- a `StudentGlobalSnapshot` year-roll-up row exists AND at least one
  `StudentSubjectSnapshot` row exists for the child this year (a non-empty cache); AND
- the snapshot is **not stale**: there is no published/revised grade for the child's
  class+year newer than the snapshot's `computedAt`. **Cheap staleness probe:** rather
  than scanning all class grades (which would defeat the win), check for an **open
  `SnapshotRecomputeTrigger`** for the scope (`status IN (pending, processing)` AND the
  trigger's `classSectionId = thisClass` OR `studentId = thisStudent`). An open trigger
  ⇒ a recompute is in flight ⇒ treat as stale ⇒ serve live + `recomputing = true`.
  (Optionally also compare `computedAt` to a single `grade.aggregate _max publishedAt`
  filtered to the class+year — ONE indexed aggregate, not a row scan — if you want
  staleness detection independent of the trigger backlog. The trigger probe alone
  satisfies AC-4; document whichever you ship.)

Otherwise ⇒ **fall through to live** (call the existing live computation unchanged).

### 4.3 ⚠ Byte-parity nuance you MUST handle — weighted vs. mean-of-means

There is a **real discrepancy** between the live payload and the S1 snapshot for the
GLOBAL figures. You must reconcile it so the contract test passes:

- **Live `globalPerformance.studentAverage`** = coefficient-WEIGHTED overall
  (`weightedSum/totalCoef`). **Live `globalPerformance.classAverage`** =
  coefficient-WEIGHTED class overall (`classOverall`).
- **Snapshot `StudentGlobalSnapshot.globalAverage`** = coefficient-weighted (✅ matches
  `studentAverage`). **BUT `StudentGlobalSnapshot.classAverage`** = **mean-of-means**
  (unweighted — the S1 worker computes the global rank denominator over an unweighted
  mean-of-means, and stores that as `classAverage`; see `snapshot-recompute.service.ts`
  §"Global rank … PM-7"). And `StudentGlobalSnapshot.classRank` is over **mean-of-means**,
  whereas live `student.rank` is also over **mean-of-means** (`overallByStudent`,
  lines 837–868) — so **rank matches**, but **`globalPerformance.classAverage` does NOT**
  (weighted live vs. unweighted snapshot).

**Resolution (pick ONE, document it; the test §5 is the judge):**
- **(A — preferred, no schema change) Re-derive the weighted `classAverage` from the
  per-subject snapshot rows at read time:** `subjectPerf[]` is assembled from
  `StudentSubjectSnapshot` (which carries per-subject `classAverage` + `coefficient`),
  so compute the weighted class overall the SAME way live does
  (`Σ classAvg·coef / Σ coef over subjects with a classAvg`). This makes
  `globalPerformance.classAverage` byte-identical to live WITHOUT touching the global
  snapshot. Use `StudentGlobalSnapshot.globalAverage` for `studentAverage` (already
  weighted-correct) — or likewise re-derive it from `subjectPerf[]` for symmetry.
- **(B — rejected for S2)** Changing the S1 snapshot to also store a weighted
  `classAverage` is a worker/recompute change ⇒ out of S2's api-only scope; do NOT.

Net: **assemble `globalPerformance` from the per-subject snapshot rows the same way the
live path assembles it from `subjectPerf`** — that is the cleanest parity. The
`StudentGlobalSnapshot` row is then used for `student.rank` / `student.classSize`
(competition rank + denominator) and `progression` (its `progressionDelta`) and the
freshness `computedAt`/`revision`.

### 4.4 Field-by-field assembly map (what comes from where)

| Response field | Snapshot source | Notes |
|---|---|---|
| `student.*` (name, class, school, birthDate, externalRef, photoUrl) | LIVE (student row) | one indexed read; keep live |
| `student.rank`, `student.classSize` | `StudentGlobalSnapshot` (year roll-up) `classRank` / `classSize` | matches live (mean-of-means rank) |
| `subjectPerf[]` | `StudentSubjectSnapshot` (year roll-up rows) | map `average→studentAverage`, `classAverage`, `classRank→studentRank`, `classSize`, `coefficient`, `trendDelta→trend`; `subjectCode/Name/Color` need a `subject` lookup (one `subject.findMany where id in (...)`, tenant-scoped — cheap, bounded by #subjects, NOT a class scan); `badge` = recompute as live does (derive from average if live derives it; else null) |
| `globalPerformance.studentAverage` | re-derive weighted from `subjectPerf[]` (= `StudentGlobalSnapshot.globalAverage`) | §4.3 |
| `globalPerformance.classAverage` | re-derive WEIGHTED from `subjectPerf[].classAverage` | §4.3 (A) — NOT the snapshot's mean-of-means classAverage |
| `globalPerformance.progression` | `StudentGlobalSnapshot.progressionDelta` | matches live last−prev term delta |
| `globalPerformance.percentageOnTwenty` | `(studentAverage/20)*100` | derived |
| `globalPerformance.attendanceRate` | LIVE | §4.5 — snapshot does not reliably carry it |
| `termEvolution[]` | per-term `StudentSubjectSnapshot` + `ClassSubjectDistribution` rows, OR LIVE | the term-grouped student/class curve; if assembling from per-term snapshot rows is non-trivial, **serve `termEvolution` live even on the snapshot path** (it is small + the win is the class scan removal, which the per-subject/global reads already deliver). Document the choice. |
| `subjectEvolution[]` | first 4 `subjectPerf` × per-term snapshot averages, OR LIVE | same pragmatic option as `termEvolution` |
| `subjectTeachers[]` | LIVE (`teacherPerSubject`) | teaching-assignment lookup, not grade-derived; keep live |
| `previousYearComparison` | LIVE | cross-year; keep live (it already reads its own year) |
| `annualProgression` | LIVE (`annualProgression(bySubject)`) | derived from per-subject term deltas; keep live OR from snapshot per-term rows — keep live for S2 |
| `recentGrades[]` | LIVE (`grade.findMany` newest 10) | a bounded `take`-limited list, NOT the class scan; keep live |
| `upcomingAssessments[]` | LIVE | future assessments, not grade-derived; keep live |
| `freshness` | computed (§4.7) | additive |

> **The NFR win is specifically removing the O(class × grades) class-wide
> `grade.findMany`** that today computes per-subject class averages + ranks (the live
> path's `classGrades` scan, lines ~780–870 region). On the snapshot path you read the
> child's own snapshot rows instead. Fields kept live above (recentGrades take-10,
> upcoming, teachers, prev-year) are all **bounded** reads, not class scans — keeping
> them live is acceptable for the <2 s target and keeps the diff small. **AC-6 asserts
> the snapshot path issues NO class-wide grade `findMany`** — make sure your snapshot
> branch does not call the class-wide scan (the take-10 `recentGrades` is fine; a
> `where: { studentId }`-filtered read is fine; a `where: { classSectionId }` over ALL
> grades is the thing to avoid on the hit path).

### 4.5 `attendanceRate` — keep live

`StudentGlobalSnapshot.attendanceRate` exists as a column but S1's recompute does NOT
populate it (the worker computes no attendance). On the snapshot path, compute
`attendanceRate` the SAME way the live path does today (its existing attendance query)
— it is one student-scoped read, not a class scan. Do not invent a value; do not block
on it.

### 4.6 (Optional) backfill-on-miss — best-effort, never blocks

On a cache MISS (no snapshot rows for a child who has grades), you MAY best-effort
`upsert` a `SnapshotRecomputeTrigger` (`reason: backfill`, scope = the child's
`classSectionId`/`academicYearId`, coalesced via the shared `snapshotCoalesceKey`) so
the next visit is cached — wrapped in its own try/catch that NEVER affects the
response (mirror the S1 enqueue posture). This is optional polish; if it adds risk,
omit it (the S1 safety-net cron already backfills lagging tenants). Do NOT write a
snapshot row from the API under any circumstance.

### 4.7 The `freshness` block

- **Snapshot path served:** `{ source: 'snapshot', computedAt: globalSnapshot.computedAt.toISOString(), recomputing: <open trigger exists?>, gradeCount: <Σ subject gradeCount or globalSnapshot subjectCount>, sourceEventId: globalSnapshot.sourceEventId, revision: globalSnapshot.revision }`. Even on a snapshot hit, `recomputing` is `true` if an open trigger exists for the scope (a newer recompute is queued).
- **Live path served (miss/stale):** `{ source: 'live', computedAt: new Date().toISOString(), recomputing: true }`. `recomputing: true` on the live path signals "catching up" (S4's chip shows "recalcul en cours…"). When there is simply no snapshot infrastructure for the scope and no open trigger (e.g. a brand-new tenant), `recomputing` MAY be `false` with `source: 'live'` — but defaulting live to `recomputing: true` is acceptable and matches the spec's "served live ⇒ recomputing" wording (FR-5). Pick one and make the §5 test assert it.

---

## 5. Tests (the gate)

Add/extend `apps/api/src/modules/analytics/analytics.service.spec.ts` (it already
exists). The Murat-picked P1 test is the **byte-parity contract test**:

- **Contract / byte-parity (AC-4, the headline test):** seed a fixture (a student with
  graded subjects across terms in a class). Run the **live** `parentDashboard`
  (snapshots absent) → capture payload `L`. Then seed/recompute the snapshot rows for
  the same fixture (call the worker `SnapshotRecomputeService.recomputeScope`, or insert
  equivalent snapshot rows) and run `parentDashboard` again → payload `S`. Assert
  `S` minus `freshness` is **byte-identical** to `L` minus `freshness` (deep-equal,
  numeric tolerance ≤ 0.01 or both rounded to 2 dp). This is the gate that proves the
  snapshot payload == live payload (intent's "gated by a byte-parity contract test").
- **Fall-through (AC-4):** snapshots ABSENT → served live, `freshness.source === 'live'`,
  `freshness.recomputing === true`, payload identical to today.
- **Stale → live (AC-4):** an OPEN `SnapshotRecomputeTrigger` for the scope → served
  live, `freshness.recomputing === true`.
- **No class-wide scan on the hit path (AC-6):** with fresh snapshots, assert the
  snapshot branch issues **no** `grade.findMany` filtered by `classSectionId` over all
  students (spy/mock the prisma `grade.findMany` and assert it is not called with a
  class-wide where, or assert the snapshot branch's prisma calls are the bounded set).
- **ABAC unchanged:** a controller-level test (or reasoning note if a controller test
  is heavy) that `canAccessStudent === false` ⇒ `403` BEFORE the service is called
  (the existing guard test, unchanged) — the snapshot read never runs for a
  non-guardian.

> **Only the Murat gate runs `pnpm typecheck`** (once). Do not run typecheck/build
> yourself. Write the targeted spec; the gate runs it.

---

## 6. Acceptance criteria (S2 — folds spec AC-4 / AC-6 / AC-7)

- **AC-S2-1 (byte-parity contract).** The snapshot-assembled `ParentDashboardResponse`
  is byte-identical to the live payload **minus** the additive `freshness` block
  (deep-equal, 2-dp tolerance) — proven by the §5 contract test. The existing
  `/parent/dashboard` UI renders unchanged.
- **AC-S2-2 (snapshot-first, no class scan).** When fresh snapshots exist, the read is
  served from `StudentGlobalSnapshot` + `StudentSubjectSnapshot` (+
  `ClassSubjectDistribution` for vs-classe context) via indexed point-reads, issuing
  **no** class-wide grade `findMany` (AC-6 / the <2 s NFR). The quickstart documents
  the query collapse.
- **AC-S2-3 (fall-through-to-live, never an error).** A missing or stale snapshot
  transparently serves the existing live computation (identical payload) with
  `freshness.source = 'live'`, `freshness.recomputing = true` — never a 4xx/5xx, never
  a wrong number.
- **AC-S2-4 (additive freshness).** The response gains ONLY the additive optional
  `freshness { source, computedAt, recomputing, gradeCount?, sourceEventId?, revision? }`
  block (the existing `SnapshotFreshness` contracts type); every existing field keeps
  its exact shape and meaning; a client ignoring `freshness` sees today's payload.
- **AC-S2-5 (ABAC + tenant/RLS first, unchanged).** `StudentAccessService.canAccessStudent`
  runs in the controller BEFORE any snapshot read (a non-guardian gets `403`, the
  snapshot read never executes); every snapshot/trigger query carries explicit
  `where: { tenantId }` (server-derived from the JWT). No permission change, no new
  endpoint, no schema change, no UI change.
- **AC-S2-6 (`recomputing` truth).** `freshness.recomputing` is `true` exactly when an
  open `SnapshotRecomputeTrigger` (`pending`/`processing`) exists for the child's
  scope OR the response was served live; `false` only on a fresh snapshot hit with no
  open trigger.

---

## 7. Pre-mortem / failure modes folded into AC

- **"It broke production by changing numbers."** → the byte-parity contract test
  (AC-S2-1) + the weighted-vs-mean-of-means reconciliation (§4.3) are the guard. If the
  test can't reach parity, serve live (fall-through) rather than ship a divergent
  snapshot payload — a slower-but-correct dashboard beats a fast-but-wrong one.
- **"The snapshot path still scans the class."** → AC-S2-2 / the §5 no-class-scan test.
  Audit every prisma call on the snapshot branch; the only class-keyed read allowed is
  the bounded `ClassSubjectDistribution` point-read, never a `grade.findMany` over the
  class.
- **"ABAC was bypassed because the snapshot read is keyed by studentId."** → AC-S2-5:
  the controller guard is untouched and runs first; the service is only reachable after
  it passes. Add the reasoning/test note.
- **"Stale snapshot showed yesterday's average as fresh."** → AC-S2-3/6: the open-trigger
  staleness probe forces a live fall-through with `recomputing = true` while a recompute
  is queued; the snapshot is never served when an open trigger exists for the scope.
- **"A `Decimal` leaked into the JSON / a rank drifted by rounding."** → §1.3 Decimal
  rule + the 2-dp tolerance in the parity test.

---

## 8. Out of scope (explicit)

The freshness CHIP UI (S4); teacher/admin read switches + GradeRevised/coefficient
triggers (S3); any schema change / migration; any new endpoint or permission; the
`parent-comments` / `parent-upcoming` feeds; populating `attendanceRate` into the
snapshot; websocket/real-time freshness; an admin rebuild surface (S5).
