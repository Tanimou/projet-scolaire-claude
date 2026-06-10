# E8-S2 — "Mes prochaines évaluations" + "Mon assiduité" (story spec)

> **Self-contained.** A developer can implement this slice from THIS file alone. It builds on the
> already-shipped, GREEN E8-S1 (the `student` realm-role, the deny-by-default student-self ABAC, the
> `*.read.self` permission family, the `/student/*` route group + AppShell, the `StudentPortalController`,
> the `@pilotage/contracts` `dto/student.ts`). **No schema change. No new permission. No new ADR.**
> One PR + one build.

- **Epic:** E8 — Student Portal · **Slice:** S2 · **Mode:** epic-slice
- **Risk tier:** P1 · **Tags:** `[auth][api][web][rgpd][abac]`
- **touchesUi:** true · **touchesBackend:** true · **touchesWorker:** false
- **Portal:** student (a new audience; parent/teacher/admin untouched)

---

## 1. Intent (one sentence)

Add two read-only student-portal surfaces — `GET /student/upcoming` (reusing
`AnalyticsService.parentUpcoming` verbatim, re-scoped to the self-resolved `studentId`) and
`GET /student/attendance` (the caller's own attendance summary + recent records, factual/kind framing)
— both behind the **existing proven S1 student-self ABAC wall** (studentId server-resolved from
`Student.userProfileId === me.id`, never a path param, never a peer), on the S1-seeded
`assessments.read.self` / `attendance.read.self` permissions, with `/student/upcoming` +
`/student/attendance` FE pages reusing `@pilotage/ui` and narrowed, peer-free contract DTOs;
tenant-scoped, no N+1, non-stigmatising FR copy, **no schema change**.

## 2. Why (value)

E8-S1 gave the learner "Mes notes" (own published grades). S2 answers the next two learner questions
from the cahier's five — *"what's coming up that I should revise?"* (upcoming assessments) and *"how is
my attendance?"* (assiduité) — for **the person the data is about**, self-scoped and kind. It is pure
read re-scoping behind the wall S1 already proved: no new security surface, no schema, no new permission.

## 3. What already exists (reuse map — do NOT rebuild)

| Asset | Path | How S2 reuses it |
|---|---|---|
| Student-self ABAC wall | `apps/api/src/modules/students/student-access.service.ts` — `scopeForUser` / `canAccessStudent` (the `student` branch returns `[ownId]`/`[]`, never `null`/peer) | call `canAccessStudent(me, jwt, ownId, schoolId)` as defence-in-depth before each read, exactly as `StudentPortalService.grades` does |
| `resolveSelf` pattern | `apps/api/src/modules/student-portal/student-portal.service.ts` (lines 36–44) — `student.findFirst({ where: { tenantId, userProfileId: me.id } })` | add the same private `resolveSelf` usage; unlinked → `{ data: [] }`-shaped empty payload, never a 500 |
| Upcoming producer | `apps/api/src/modules/analytics/analytics.service.ts` — `parentUpcoming({ tenantId, studentId })` (line 566) returns `{ classSectionName, gradeLevelName, data: UpcomingRow[] }` with `data[]` = `{ id, title, description, scheduledAt, kind, maxScore, coefficient, subjectId, subjectCode, subjectName, subjectColor, classSectionName, termId, termName }` | call **verbatim** with `studentId: ownId`; project into the narrowed student DTO (drop nothing peer-relative exists, but the DTO is its own canonical shape) |
| `AnalyticsService` export | `apps/api/src/modules/analytics/analytics.module.ts` — `exports: [AnalyticsService, …]` | import `AnalyticsModule` into `StudentPortalModule` so `StudentPortalService` can inject `AnalyticsService` |
| Attendance read logic | `apps/api/src/modules/attendance/attendance.controller.ts` — `studentAttendance` (line 344): `attendanceRecord.findMany` + a `summary` reduce `{ total, present, absent, absentExcused, late, leftEarly }` | re-implement the **read + summary** inline in `StudentPortalService.attendance` (the existing endpoint is on `attendance.read` with a `:studentId` path param + a parent guardianship check — DO NOT call it; the student path is self-resolved on `attendance.read.self`, no path param). RGPD: expose status/justification/date/subject/class only, never `recordedBy`/`recordedAt` actor metadata, never a comment field that could carry staff notes |
| Contracts DTO file | `packages/contracts/src/dto/student.ts` (re-exported via `dto/index.ts` → `index.ts` `export * from './dto'`) | add the new S2 zod schemas + types here (same file, same narrowed-shape discipline as `StudentGradeRowSchema`) |
| Permissions (already seeded in S1) | `apps/api/src/shared/auth/permissions.constants.ts` — `assessments.read.self` (line 119), `attendance.read.self` (line 120) both in `REALM_ROLE_PERMISSIONS.student` (lines 286–287) | use `@RequiresPermission('assessments.read.self')` / `@RequiresPermission('attendance.read.self')` — **no permission change needed** |
| FE page pattern | `apps/web/src/app/student/grades/page.tsx` + `_lib/student-me.ts` + `_components/StudentActivationGate.tsx` | mirror exactly: `force-dynamic`, `fetchStudentMe()` activation gate first, `PortalShell portal="student"`, `api<…>('/api/v1/student/…', { cache: 'no-store' })`, `ApiError` → `ErrorState`, kind `EmptyState` |
| Sidebar | `apps/web/src/components/shell/sidebar-items.ts` — `studentSidebarItems` (line 245) | add two items: "À venir" (`/student/upcoming`) + "Mon assiduité" (`/student/attendance`) with `matches` regexes; the S1 comment says items are added per-slice (never render a nav item that 404s) |
| `@pilotage/ui` | `packages/ui` (PageHeader, SectionHeader, EmptyState, ErrorState, SubjectChip, Badge, formatGrade, formatRelativeTime, etc.) | reuse-first; **no `packages/ui` change anticipated** |

## 4. Functional requirements

**FR-1 — `GET /student/upcoming`.** New endpoint on `StudentPortalController`, guarded
`@RequiresPermission('assessments.read.self')`. Resolves self (`resolveSelf`), runs
`canAccessStudent(me, jwt, ownId, schoolId)` (defence-in-depth — true only for own id), then calls
`AnalyticsService.parentUpcoming({ tenantId: me.tenantId, studentId: ownId })` **verbatim** and maps to
the narrowed `StudentUpcomingResponse`. Unlinked caller → `{ classSectionName: null, gradeLevelName: null, data: [] }`. No `:studentId` path param; a client-supplied id is structurally impossible to inject. Ordered soonest-first (the producer already `orderBy: scheduledAt asc`).

**FR-2 — `GET /student/attendance`.** New endpoint on `StudentPortalController`, guarded
`@RequiresPermission('attendance.read.self')`. Resolves self, runs `canAccessStudent`, then reads the
caller's own `attendanceRecord.findMany` (tenant-scoped, `studentId: ownId`) with the same `summary`
reduce as `attendanceController.studentAttendance`. Returns the narrowed `StudentAttendanceResponse`:
`{ summary: {...}, records: AttendanceRecordRow[] }`. Unlinked → `{ summary: <all-zero>, records: [] }`.
Cap recent records (e.g. `take: 100`, `orderBy: { classSession: { date: 'desc' } }`) — no unbounded read.

**FR-3 — Narrowed, peer-free DTOs.** Add to `packages/contracts/src/dto/student.ts`:
`StudentUpcomingRowSchema` / `StudentUpcomingResponseSchema` and `StudentAttendanceRecordSchema` /
`StudentAttendanceSummarySchema` / `StudentAttendanceResponseSchema`. The attendance DTO **structurally
lacks** any peer-relative field (no class average, no rank, no other student), and exposes only the
learner's own factual record: `status`, `justification` (read-only, the learner's own), date, subject,
class section. **No `recordedBy`/`justifiedBy`/`comment` actor/staff metadata** in the DTO (RGPD
minimisation — the student sees a subset of what the parent sees).

**FR-4 — `/student/upcoming` FE page.** Server component under `apps/web/src/app/student/upcoming/page.tsx`
mirroring `grades/page.tsx`: activation gate → `PortalShell portal="student"` → fetch
`/api/v1/student/upcoming` → list upcoming assessments grouped or sorted soonest-first, each showing
subject (`SubjectChip`), title, absolute FR date, coefficient. Kind `EmptyState`
("Aucune évaluation prévue pour l'instant — profite-en !") and `ErrorState`.

**FR-5 — `/student/attendance` FE page.** Server component under
`apps/web/src/app/student/attendance/page.tsx`: activation gate → shell → fetch
`/api/v1/student/attendance` → a calm summary strip (present / absences / retards, factual counts, never
"mauvais", never a disciplinary verdict, never a peer compare) + a recent-records list (status badge +
date + subject + justified/justifiable flag). Kind copy throughout.

**FR-6 — Sidebar.** Add "À venir" + "Mon assiduité" to `studentSidebarItems` with matching `matches`
regexes (`/^\/student\/upcoming(\/|$)/`, `/^\/student\/attendance(\/|$)/`). Use existing lucide icons
(e.g. `CalendarClock` for upcoming, `CheckSquare`/`ClipboardCheck` for assiduité — whatever is already
imported / available in that file).

**FR-7 — Aggregate, no N+1.** Each endpoint assembles its full payload server-side in bounded queries
(upcoming reuses the existing producer's queries; attendance is one `findMany` + an in-memory reduce).
The FE makes **one** fetch per page.

**FR-8 — Tenant scope + wall on every read.** Every query is tenant-scoped (`me.tenantId`, server-derived
from the JWT via `UserSyncService.ensureUser` + `SchoolContextService.forUser`). The student-self wall runs
before each read; the `studentId` is server-resolved, never request-supplied.

## 5. Contract (shared `@pilotage/contracts` types — `packages/contracts/src/dto/student.ts`)

Add (zod-first, the file's existing style):

```ts
// --- "À venir" (S2) ---
export const StudentUpcomingRowSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  scheduledAt: z.string(),            // ISO; the producer always returns a date
  kind: z.string(),                   // assessment-type code → FR label in UI
  maxScore: z.number(),
  coefficient: z.number(),
  subjectId: UuidSchema,
  subjectCode: z.string().nullable(),
  subjectName: z.string(),
  subjectColor: z.string().nullable(),
  termId: UuidSchema.nullable(),
  termName: z.string().nullable(),
  // NO classAverage, NO rank, NO peer field.
});
export type StudentUpcomingRow = z.infer<typeof StudentUpcomingRowSchema>;

export const StudentUpcomingResponseSchema = z.object({
  classSectionName: z.string().nullable(),
  gradeLevelName: z.string().nullable(),
  data: z.array(StudentUpcomingRowSchema),
});
export type StudentUpcomingResponse = z.infer<typeof StudentUpcomingResponseSchema>;

// --- "Mon assiduité" (S2) ---
export const StudentAttendanceRecordSchema = z.object({
  id: UuidSchema,
  status: z.string(),                 // present|absent|absent_excused|late|left_early
  justification: z.string().nullable(),
  date: z.string(),                   // ISO (classSession date)
  subjectName: z.string().nullable(),
  subjectColor: z.string().nullable(),
  classSectionName: z.string().nullable(),
  // NO recordedBy/justifiedBy/comment actor metadata (RGPD minimisation).
});
export type StudentAttendanceRecord = z.infer<typeof StudentAttendanceRecordSchema>;

export const StudentAttendanceSummarySchema = z.object({
  total: z.number(),
  present: z.number(),
  absent: z.number(),
  absentExcused: z.number(),
  late: z.number(),
  leftEarly: z.number(),
});
export type StudentAttendanceSummary = z.infer<typeof StudentAttendanceSummarySchema>;

export const StudentAttendanceResponseSchema = z.object({
  summary: StudentAttendanceSummarySchema,
  records: z.array(StudentAttendanceRecordSchema),
});
export type StudentAttendanceResponse = z.infer<typeof StudentAttendanceResponseSchema>;
```

> **Build note (Paige/orchestrator):** `packages/contracts` is built to CJS (`dist/`). After adding
> these types, the single post-Workflow `pnpm build` rebuilds `dist` so the API + web pick them up at
> runtime. (Agents never build.)

## 6. Files (create / edit)

**Backend (`apps/api`):**
- `apps/api/src/modules/student-portal/student-portal.controller.ts` — **edit**: add `@Get('upcoming')`
  (`assessments.read.self`) + `@Get('attendance')` (`attendance.read.self`), each resolving identity via
  `users.ensureUser(jwt)` + `ctx.forUser(me)` and delegating to the service.
- `apps/api/src/modules/student-portal/student-portal.service.ts` — **edit**: inject `AnalyticsService`;
  add `upcoming(me, jwt, schoolId)` (resolveSelf → canAccessStudent → `parentUpcoming` verbatim → map)
  and `attendance(me, jwt, schoolId)` (resolveSelf → canAccessStudent → `attendanceRecord.findMany` +
  summary reduce → map).
- `apps/api/src/modules/student-portal/student-portal.module.ts` — **edit**: add `AnalyticsModule` to
  `imports`.
- `apps/api/src/modules/student-portal/student-portal.service.spec.ts` — **create** (or extend the S1
  spec if one exists): the targeted tests in §8.

**Contracts (`packages/contracts`):**
- `packages/contracts/src/dto/student.ts` — **edit**: add the §5 schemas/types.

**Frontend (`apps/web`):**
- `apps/web/src/app/student/upcoming/page.tsx` — **create**.
- `apps/web/src/app/student/attendance/page.tsx` — **create**.
- (optional, mirror grades) small presentational components under each folder
  (`UpcomingRow.tsx` / `AttendanceRecordRow.tsx`) if they keep the page clean — reuse-first on `@pilotage/ui`.
- `apps/web/src/components/shell/sidebar-items.ts` — **edit**: add the two `studentSidebarItems` entries.

**Disjoint-file-set note (resource budget):** BE edits live under `apps/api`, FE under `apps/web`, the
shared contract under `packages/contracts` — coordinate the DTO shape via §5 so the two implement agents
never conflict.

## 7. Acceptance criteria

- **AC-1 (upcoming, self-scoped).** `GET /student/upcoming` returns the caller's **own** upcoming
  assessments (subject / date / coefficient, soonest-first), produced by `parentUpcoming` re-scoped to the
  self-resolved id; no `:studentId` path param exists; a client cannot inject a foreign id; tenant-scoped;
  one aggregate, no N+1.
- **AC-2 (attendance, self-scoped).** `GET /student/attendance` returns the caller's **own** attendance
  summary + recent records (status / justification / date / subject), self-resolved behind the wall;
  bounded read; tenant-scoped; no other-student leak.
- **AC-3 (deny-by-default holds).** Both endpoints run `canAccessStudent` which, for a `student` token,
  is true **only** for the resolved own id (`[ownId]`); an unlinked student → kind empty payload
  (`{ data: [] }` / `{ summary: <zeros>, records: [] }`), never a 500, never peer data. A `student` token
  on a parent/teacher/admin endpoint stays denied (missing permission + the guardianship/teaching wall —
  unchanged from S1).
- **AC-4 (RGPD / non-stigmatising, payload shape).** Both DTOs **structurally lack** every peer-relative
  field (no class average, no rank, no other student). The attendance DTO exposes **no**
  `recordedBy`/`justifiedBy`/`comment` actor/staff metadata. Copy is factual and kind — no "échec / nul /
  mauvais / en retard chronique / classement"; an absence is stated, never a verdict.
- **AC-5 (FE pages).** `/student/upcoming` and `/student/attendance` render behind the activation gate
  (unlinked → the calm S1 `StudentActivationGate`, never a crash), reuse `@pilotage/ui` + `PortalShell
  portal="student"`, show kind empty/error states, are mobile-first and WCAG-AA (icon+text not
  colour-alone, ≥4.5:1). The two sidebar items appear and route correctly.
- **AC-6 (no regression / no scope creep).** **No schema change.** **No new permission** (uses the
  S1-seeded `assessments.read.self` / `attendance.read.self`). **No new ADR.** No parent/teacher/admin
  capability moved, loosened, or removed; the existing `attendance.read` `:studentId` endpoint is
  untouched. No student write verb is added. No new BullMQ queue, no new metric, no new HTTP style.
- **AC-7 (gate).** `pnpm typecheck` GREEN (Murat, once); `git diff --check` clean; one PR + one build.

## 8. Targeted tests (Murat — the single most valuable)

`student-portal.service.spec.ts` (extend or create), mocking `PrismaService` + `StudentAccessService` +
`AnalyticsService`:
1. **upcoming — self resolved + producer reuse.** `resolveSelf` returns `{ id: ownId }`,
   `canAccessStudent` → true, `parentUpcoming` called with `{ tenantId, studentId: ownId }` and its rows
   mapped 1:1 into `StudentUpcomingRow[]`.
2. **upcoming — unlinked → empty.** `resolveSelf` → null ⇒ `{ classSectionName: null, gradeLevelName: null, data: [] }`, `parentUpcoming` NOT called.
3. **attendance — self resolved + summary.** records mocked ⇒ the `summary` counts are correct and
   `records` carry no actor metadata (assert the mapped object keys).
4. **attendance — unlinked → zero summary + empty records.**
5. **(optional) defence-in-depth.** if `canAccessStudent` → false (shouldn't happen for a student token,
   but the wall is asserted), the producer throws `ForbiddenException` rather than leaking.

## 9. Out of scope (S3 / non-goals)

- Announcements (`/student/announcements`) + the "Mon objectif" dashboard (`/student/dashboard`) → **S3**.
- Any student **write** (no attendance self-justify, no booking, no messaging, no ack) — read-only.
- Any schema change, new permission, new ADR, second queue, new metric, provisioning UI, 4th OIDC client.
- No peer comparison anywhere (hard RGPD wall, enforced in the DTO shape).

## 10. Demo (quickstart)

1. (Operator pre-req from S1) `student` realm-role + demo user activated, additive `db push` applied,
   a `Student.userProfileId` linked to the demo student.
2. Log in to `/student/login` as the linked student → land on `/student/grades`.
3. Click **"À venir"** → see own upcoming assessments soonest-first (subject, date, coefficient).
4. Click **"Mon assiduité"** → see own attendance summary + recent records, factual/kind.
5. Confirm no endpoint accepts a `:studentId`; an unlinked student sees the calm activation gate.
