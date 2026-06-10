# E8-S3 — "Les annonces" + "Mon objectif" (the actionable student dashboard)

> **Self-contained story spec.** A developer implements this slice from THIS file alone.
> Epic: **E8 — Student Portal**. Slice: **S3** (the final E8 slice). Mode: `epic-slice`.
> Risk tier: **P2**. Tags: `[web][a11y][analytics][rgpd][abac]`.
> `touchesUi: true · touchesBackend: true · touchesWorker: false`
> **No schema. No new permission. No new ADR. No second BullMQ queue. No new metric.**

---

## 1. Intent (one sentence)

Ship two read-only student surfaces behind the proven S1 student-self wall — `GET /student/announcements`
(receipt-scoped, self-scoped mark-read) and `GET /student/dashboard` ("Mon objectif": one aggregate
composing the per-subject trend + upcoming assessments + the E7 remediation progress re-framed
second-person, in a narrowed DTO that structurally lacks every peer-relative field) — plus the matching
`/student/announcements` and `/student/dashboard` pages (kind, non-stigmatising, forward-looking FR copy,
WCAG 2.2 AA, mobile-first, <2 s, reuse-first on `@pilotage/ui`).

## 2. Why (ties to the cahier)

E8-S1 and E8-S2 are shipped and green: the learner can read their own grades, upcoming assessments and
attendance. S3 is the **payoff** — the cahier's promise "turn information into action", now *for the
person the data is about*. The student gets (a) the **announcements addressed to them**, and (b) a calm,
first-person **"Mon objectif"** dashboard answering *"where am I, which subject is moving, what's coming,
and is the support helping?"* — **never** a rank, **never** a class-average framed against them, **never**
another child's data. Everything reuses producers that already exist; S3 re-scopes them to self and
narrows the payload shape.

---

## 3. What already exists (read these before coding — exact paths)

| Concern | File | What it gives you |
|---|---|---|
| Student-self ABAC wall | `apps/api/src/modules/students/student-access.service.ts` | `canAccessStudent(me, jwt, studentId, schoolId)` — true only for the caller's own `Student` on a `student` token (deny-by-default `[ownId]`/`[]`, never `null`, never a peer). |
| S1/S2 producer + the `resolveSelf` pattern | `apps/api/src/modules/student-portal/student-portal.service.ts` | `resolveSelf(me)` → the single `Student` with `userProfileId === me.id` (tenant-scoped, `null` when unlinked). The `grades`/`upcoming`/`attendance` methods are the exact shape to mirror: `resolveSelf` → if null return kind-empty → `canAccessStudent(ownId)` defence-in-depth → read → narrowed DTO. |
| S1/S2 controller | `apps/api/src/modules/student-portal/student-portal.controller.ts` | `@Controller('student')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`, `@RequiresPermission('<x>.read.self')`, `this.users.ensureUser(jwt)` + `this.ctx.forUser(me)` for `{ schoolId }`. No `:studentId` path param anywhere — keep it that way. |
| Module | `apps/api/src/modules/student-portal/student-portal.module.ts` | already imports `AuthModule, StudentsModule, SchoolStructureModule, AnalyticsModule`. Add `PrismaService` is already available via the providers' DI; `AnalyticsModule` exports `AnalyticsService`; you need `RemediationService` only transitively through `AnalyticsService.parentDashboard` (DO NOT inject `RemediationService` directly — see §6). |
| Per-subject trend producer | `apps/api/src/modules/analytics/analytics.service.ts` → `parentDashboard({ tenantId, studentId })` | Returns `ParentDashboardResponse` whose `subjectPerf: StudentSubjectPerf[]` carries `{ subjectId, subjectName, subjectColor, coefficient, studentAverage, trend, badge, classAverage, studentRank, classSize }`. **`classAverage`/`studentRank`/`classSize` are the forbidden peer fields — you project them OUT.** It already composes the E7 `remediation?: RemediationProgressDto[]` block best-effort (a throw → `[]`, see lines ~993–1007) and the E6 `freshness?` envelope. Snapshot-first / live fall-through is internal to this producer. |
| Upcoming producer (reused in S2) | `analytics.service.ts` → `parentUpcoming({ tenantId, studentId })` | already re-scoped to self in `StudentPortalService.upcoming`. The dashboard composes a **short preview** of this (next 3). |
| Remediation progress DTO | `packages/contracts/src/dto/remediation.ts` → `RemediationProgressDto` (+ `IMPROVEMENT_DELTA_THRESHOLD = 1.5`) | `{ planId, subjectId, subjectCode, subjectName, objective, baselineAvg, currentAvg, trendDelta, improved, sessionsPlanned, sessionsDone, nextSessionAt, createdAt }`. `improved` is the E3 emerald-lane trigger. **Already peer-free** — reuse verbatim, re-framed second-person in the UI only. |
| Announcement read (parent) | `apps/api/src/modules/announcements/announcements.controller.ts` → `list()` (lines ~138–188) + `markRead()` (lines ~557–571) | The **receipt-scoped** read: `announcementReceipt.findMany({ where: { userProfileId: me.id, announcement: { tenantId, publishedAt: { not: null }, OR:[expiresAt null/gte] } } })` + author enrichment. `markRead` flips the caller's own receipt `readAt`. **This is the exact logic to re-scope to a `student` token's `me.id`.** |
| Recipient computation | `apps/api/src/modules/announcements/announcements.service.ts` → `AnnouncementRecipientsService.computeRecipients` + `recipientsForClassSections` (lines ~95–106) | **CRITICAL GAP (see §5):** today recipients = guardians + teachers (+ all profiles for `school_wide`). A student's `UserProfile` gets a receipt ONLY for `school_wide` / `individual_user`-targeted-at-them — **NOT** for class/grade/cycle/individual_student scopes. S3 must additively include the student's own `UserProfile`. |
| Existing student page pattern | `apps/web/src/app/student/upcoming/page.tsx` (+ `attendance/page.tsx`, `grades/page.tsx`) | The exact FE pattern: `force-dynamic`, `fetchStudentMe()` → activation gate, `PortalShell portal="student"`, `api<…>(…, { cache:'no-store' })` with `ApiError` → `ErrorState`, `EmptyState tone="violet"`, reuse-first `@pilotage/ui`. |
| Student FE libs | `apps/web/src/app/student/_lib/student-me.ts`, `apps/web/src/app/student/_components/StudentActivationGate.tsx`, `apps/web/src/app/student/grades/kinds.ts` | `fetchStudentMe()`, the activation gate, `kindLabel(kind)`. |
| Sidebar | search `studentSidebarItems` in `apps/web` | S1/S2 added "Mes notes", "À venir", "Mon assiduité". S3 adds "Mon tableau de bord" (the dashboard, ideally first) + "Annonces". |
| Contracts | `packages/contracts/src/dto/student.ts` | The S1/S2 DTOs (`StudentGradeRow`, `StudentUpcomingRow`, `StudentAttendanceRecord`, …). S3 adds the two new DTOs (§7). |
| Permissions (already seeded in S1) | `apps/api/src/shared/auth/permissions.constants.ts` lines 118–122, 285–290 | `announcements.read.self` + `analytics.read.self` already exist and are already in `REALM_ROLE_PERMISSIONS.student`. **No permission change needed.** |

---

## 4. Functional requirements (this slice)

- **FR-S3-1 — `GET /student/announcements`** (`announcements.read.self`). Returns the announcements addressed
  to the caller (newest first; pinned first within that), self-resolved behind the wall: read the
  caller's own `AnnouncementReceipt` rows (`userProfileId === me.id`) for published, non-expired
  announcements in the caller's tenant. Project into a **narrowed peer-free DTO** (`StudentAnnouncementRow`,
  §7) carrying title/body/priority/scope-label/author display name/publishedAt/`readAt` — **no** recipient
  roster, **no** read-stats, **no** other-class leak. An unlinked caller (`resolveSelf` → null) gets
  `{ data: [] }`. A `student` whose `UserProfile` simply has no receipts gets `{ data: [] }` (kind empty).
- **FR-S3-2 — `POST /student/announcements/:id/read`** (`announcements.read.self`). The ONE mutation a
  student may make in E8: flip the caller's OWN receipt `readAt` to now (idempotent; already-read → ok).
  404 when the caller has no receipt for that announcement (never reveals another student's announcement).
  This is **self-scoped on `me.id`** — it can only ever touch the caller's own receipt row.
- **FR-S3-3 — `GET /student/dashboard`** (`analytics.read.self`) — "Mon objectif". **One aggregate** behind
  the wall composing, best-effort:
  - **(a) per-subject trend** — projected from `AnalyticsService.parentDashboard(...).subjectPerf`, keeping
    ONLY `{ subjectId, subjectName, subjectColor, studentAverage, trend }`. **`classAverage`/`studentRank`/
    `classSize` are projected OUT** (the peer-comparison wall lives in the DTO shape — the E4
    `ParentExportJobDto` narrowing precedent). The trend is snapshot-first / live fall-through *inside* the
    reused producer (no new metric, no new class scan).
  - **(b) next assessments to prepare** — a short preview (next 3, soonest-first) from
    `AnalyticsService.parentUpcoming(...)`, projected to the S2 `StudentUpcomingRow` shape (already peer-free).
  - **(c) remediation progress** — when an E7 `RemediationPlan` exists for the student, the
    `RemediationProgressDto[]` block (reused verbatim from `parentDashboard(...).remediation`), re-framed
    second-person in the UI ("Ton soutien en {matière}"). Absent/empty → no support block.
  - A short **identity header** echo (`firstName` + `classSectionName`) so the page renders without a second
    round-trip. NO `birthDate`/`email`/`medicalNotes`/`photoUrl`/`externalRef`.
- **FR-S3-4 — Best-effort composition.** A throw from the snapshot/remediation/upcoming read degrades that
  block to its calm empty state (`subjects: []` / `upcoming: []` / `remediation: []`) — the dashboard
  **NEVER** errors because one block failed (the `freshness?`/`remediation?` posture already used in
  `parentDashboard`). The whole endpoint returns 200 with whatever composed.
- **FR-S3-5 — Aggregate endpoint, no client N+1.** Both reads are single `/api/v1/student/*` aggregates
  assembled server-side; the FE makes one fetch per page.
- **FR-S3-6 — Tenant + wall on every read.** Server-derived `tenantId`; `resolveSelf` (no `:studentId`
  path param → IDOR structurally absent) → `canAccessStudent(ownId)` defence-in-depth → `ForbiddenException`
  rather than leak. Identical posture to S1/S2.

## 5. The one design gap to close: student announcement receipts

**Problem.** `AnnouncementRecipientsService.recipientsForClassSections` (and `guardiansOfStudents`) return
**only guardian + teacher** `UserProfile` ids. So when an announcement targets a class/grade/cycle/student,
the student's own `UserProfile` gets **no `AnnouncementReceipt`** — `GET /student/announcements` would always
be empty for the most common (class/student-scoped) announcements. Only `school_wide` (all active profiles)
and `individual_user` (when targeted at the student) currently reach the student.

**Fix (additive, minimal, no schema).** Extend the recipient computation so that, when a scope reaches a
class/student, the **student's own linked `UserProfile`** is added to the recipient set alongside the
guardians:

- In `recipientsForClassSections`: after resolving enrolled `studentId`s, also fetch those students'
  `userProfileId` (where non-null) and union them in. Add a private helper
  `studentsOwnProfiles(studentIds: string[]): Promise<Set<string>>` reading
  `student.findMany({ where: { id: { in }, userProfileId: { not: null } }, select: { userProfileId: true } })`.
- In `guardiansOfStudents`'s caller for `individual_student`: union the student's own profile too (the
  individual-student announcement reaches the child as well as their guardians).

This is **purely additive** — it only ever adds the data-subject's own profile to scopes that already
reach that student's family; it never widens to other students, never to staff-only scopes. It is the
"additive recipient rule" the E8 PROGRESS.md anticipated. **Guard it behind `userProfileId != null`** so
unlinked students change nothing. **No new receipts are back-filled** — only announcements published AFTER
this change materialise student receipts; that is acceptable for the MVP (documented in PROGRESS).

> **Reviewer note (Drift/Sentinel).** This touches a shared parent/teacher producer. It MUST NOT change
> what guardians/teachers receive (regression). A targeted test pins: a class-scoped announcement now also
> creates a receipt for an enrolled+linked student, and creates NOTHING new for an enrolled student with no
> linked profile, and adds NO non-class student.

## 6. Backend implementation (apps/api)

### 6.1 `StudentPortalService` — three new methods (mirror the S1/S2 shape exactly)

In `apps/api/src/modules/student-portal/student-portal.service.ts`:

- **`announcements(me, jwt, schoolId): Promise<StudentAnnouncementsResponse>`**
  1. `self = await this.resolveSelf(me)`; if `!self` return `{ data: [] }`.
  2. `canAccessStudent(me, jwt, self.id, schoolId)` → `ForbiddenException` if false (defence-in-depth).
  3. Read the caller's receipts exactly like the parent `list()` non-staff branch — keyed on
     `userProfileId: me.id` (NOT `self.id`; receipts are keyed to the *account* profile), published &
     non-expired, tenant-scoped, ordered pinned-desc then publishedAt-desc. Enrich author display name via
     the same single batched `userProfile.findMany` the parent does.
  4. Map to `StudentAnnouncementRow[]` (§7) — **drop** `recipients`/`stats`/`_count`/`authorRoleHint`; keep
     title/body/priority/scopeLabel/author{firstName,lastName}/publishedAt/readAt/pinned/receiptId.
- **`markAnnouncementRead(me, id): Promise<{ ok: true; alreadyRead?: boolean }>`** — copy the parent
  `markRead` verbatim (find the caller's own receipt by `announcementId_userProfileId` on `me.id`; 404 if
  none; idempotent flip). Self-scoped on `me.id` by construction.
- **`dashboard(me, jwt, schoolId): Promise<StudentDashboardResponse>`**
  1. `self = await this.resolveSelf(me)`; if `!self` return the kind-empty dashboard
     `{ student: null, subjects: [], upcoming: [], remediation: [] }`.
  2. `canAccessStudent(me, jwt, self.id, schoolId)` defence-in-depth.
  3. Compose best-effort (each block in its own try/catch → `[]`, mirroring `parentDashboard` lines
     ~993–1007):
     - `const pd = await this.analytics.parentDashboard({ tenantId: me.tenantId, studentId: self.id })`
       (wrap in try/catch). Project `pd.subjectPerf` → `subjects` keeping ONLY
       `{ subjectId, subjectName, subjectColor, studentAverage, trend }`. **Never** copy `classAverage`/
       `studentRank`/`classSize`. Reuse `pd.remediation ?? []` directly (already the peer-free
       `RemediationProgressDto[]`).
     - `const up = await this.analytics.parentUpcoming({ tenantId: me.tenantId, studentId: self.id })`
       (try/catch → `{ data: [] }`). Project `up.data.slice(0, 3)` → the S2 `StudentUpcomingRow` shape.
  4. Return `{ student: { firstName, classSectionName }, subjects, upcoming, remediation }`.

> **Do NOT inject `RemediationService` into `StudentPortalService`.** Reuse `parentDashboard(...).remediation`
> which already composes it best-effort. This keeps the module graph identical to S2 (no new DI edge) and
> guarantees the dashboard's remediation matches the parent dashboard byte-for-byte (re-framed only in copy).

### 6.2 `StudentPortalController` — three new routes

In `apps/api/src/modules/student-portal/student-portal.controller.ts` (same pattern as S1/S2):

```ts
@Get('announcements')
@RequiresPermission('announcements.read.self')
async announcements(@CurrentJwt() jwt): Promise<StudentAnnouncementsResponse> {
  const me = await this.users.ensureUser(jwt);
  const { schoolId } = await this.ctx.forUser(me);
  return this.portal.announcements(me, jwt, schoolId);
}

@Post('announcements/:id/read')
@RequiresPermission('announcements.read.self')
async markRead(@Param('id') id: string, @CurrentJwt() jwt) {
  const me = await this.users.ensureUser(jwt);
  return this.portal.markAnnouncementRead(me, id);
}

@Get('dashboard')
@RequiresPermission('analytics.read.self')
async dashboard(@CurrentJwt() jwt): Promise<StudentDashboardResponse> {
  const me = await this.users.ensureUser(jwt);
  const { schoolId } = await this.ctx.forUser(me);
  return this.portal.dashboard(me, jwt, schoolId);
}
```

(`Post`, `Param` are already importable from `@nestjs/common`.) **No `:studentId` anywhere.** The `:id` on
mark-read is an **announcement** id whose access is gated by "do I own a receipt for it" — not a student id.

### 6.3 `AnnouncementRecipientsService` — the §5 additive student-profile rule

`StudentPortalService` needs `PrismaService` (already injected) for the receipt read; the recipient fix is
in `apps/api/src/modules/announcements/announcements.service.ts` (see §5). Keep it additive + guarded by
`userProfileId != null`.

### 6.4 Module

`StudentPortalModule` already imports `AnalyticsModule` (S2). No new import needed (the recipient fix lives
in the announcements module, which is independently registered; `StudentPortalService` reads receipts via
`PrismaService` directly, matching how S1 reads grades — no `AnnouncementsModule` import required).

## 7. Contracts (`packages/contracts/src/dto/student.ts` — additive)

Add (mirroring the existing S1/S2 DTOs' Zod + `z.infer` style; reuse `UuidSchema`, `StudentUpcomingRowSchema`):

```ts
/** One announcement addressed to the learner ("Les annonces", S3). Narrowed,
 *  peer-free: NO recipient roster, NO read-stats, NO other-class data. */
export const StudentAnnouncementRowSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  body: z.string().nullable(),
  priority: z.string(),            // normal | high | urgent (label in UI)
  scopeLabel: z.string().nullable(), // a kind human label, never a roster
  authorName: z.string().nullable(), // "Mme Dupont" — display only
  pinned: z.boolean(),
  publishedAt: z.string().nullable(),
  readAt: z.string().nullable(),
  receiptId: UuidSchema,
});
export type StudentAnnouncementRow = z.infer<typeof StudentAnnouncementRowSchema>;

export const StudentAnnouncementsResponseSchema = z.object({
  data: z.array(StudentAnnouncementRowSchema),
});
export type StudentAnnouncementsResponse = z.infer<typeof StudentAnnouncementsResponseSchema>;

/** One per-subject trend cell on "Mon objectif". STRUCTURALLY LACKS every
 *  peer-relative field (no classAverage / studentRank / classSize). */
export const StudentDashboardSubjectSchema = z.object({
  subjectId: UuidSchema,
  subjectName: z.string(),
  subjectColor: z.string().nullable(),
  studentAverage: z.number().nullable(), // the learner's OWN average, /20
  trend: z.number().nullable(),          // delta vs previous term, signed
});
export type StudentDashboardSubject = z.infer<typeof StudentDashboardSubjectSchema>;

/** `GET /student/dashboard` — "Mon objectif". Composes the learner's own trend +
 *  next assessments + (when a plan exists) the E7 remediation line. The peer-
 *  comparison wall is in this SHAPE: no rank, no class average. Reuses the E7
 *  RemediationProgressDto verbatim (already peer-free). */
export const StudentDashboardResponseSchema = z.object({
  student: z.object({
    firstName: z.string(),
    classSectionName: z.string().nullable(),
  }).nullable(),
  subjects: z.array(StudentDashboardSubjectSchema),
  upcoming: z.array(StudentUpcomingRowSchema), // next 3, soonest-first
  remediation: z.array(RemediationProgressDtoSchema), // import from ./remediation
});
export type StudentDashboardResponse = z.infer<typeof StudentDashboardResponseSchema>;
```

Import `RemediationProgressDtoSchema` from `./remediation` (sibling DTO). Export the new types from the
contracts barrel if the file is re-exported (check `packages/contracts/src/index.ts` — the S1/S2 student
types are exported there; follow the same export).

## 8. Frontend (apps/web)

Two new server-component pages under the existing `/student` route group, both `force-dynamic`, both using
`fetchStudentMe()` → activation gate, `PortalShell portal="student"`, `api<…>(…, { cache:'no-store' })`
with `ApiError` → `ErrorState`. Reuse-first on `@pilotage/ui` (`PageHeader`, `SectionHeader`, `Badge`,
`SubjectChip`, `EmptyState`, `formatDateLong`/`formatRelativeTime`); **no `packages/ui` change** unless the
DS Guardian agrees.

### 8.1 `apps/web/src/app/student/dashboard/page.tsx` — "Mon objectif"

- Header: "Mon objectif" / kind subtitle ("Où tu en es, ce qui avance, ce qui arrive").
- **Per-subject trend** block: one card/row per subject showing `subjectName` + the learner's own average
  (`studentAverage`/20) + a trend chip. Trend framing (icon + text, never colour-alone):
  - `trend >= +0.5` → emerald "en progrès ↗" ;
  - `-0.5 < trend < +0.5` → neutral slate "stable" ;
  - `trend <= -0.5` → amber **"à consolider"** (the non-stigmatising frame — **never** "en échec/mauvais/
    dernier"). Pair with a short forward action line ("voici sur quoi te concentrer").
  - `studentAverage`/`trend` null → "en attente des prochaines notes".
- **"Ton soutien en {matière}"** block (only if `remediation.length`): per plan, second-person copy —
  `improved` (the E3 emerald lane) → "Le soutien porte ses fruits 🎉 (+X pts)"; positive-but-below-threshold
  → "+X pts — continue comme ça"; null/flat/negative → "les premiers effets prennent quelques semaines"
  (NEVER "échec"). Show `sessionsDone`/`sessionsPlanned` and `nextSessionAt` (absolute FR date via
  `formatDateLong`) when present. Deep-link to `/parent/...`? **No** — the student never books; this is
  read-only encouragement, no CTA, no booking link.
- **"À préparer"** block: the next-3 `upcoming` rows (subject chip + title + `formatDateLong` + coef),
  reusing the `/student/upcoming` card markup. A "Tout voir" link to `/student/upcoming`.
- Empty: no subjects + no upcoming + no remediation → one calm `EmptyState tone="violet"`
  ("Ton tableau de bord se remplira dès tes premières notes").

### 8.2 `apps/web/src/app/student/announcements/page.tsx` — "Annonces"

- Header: "Annonces" / "Les messages de ton établissement et de tes professeurs".
- List newest-first; pinned first. Each item: title, author display name, `formatRelativeTime(publishedAt)`,
  priority badge (urgent/high → distinct tone, icon+text), body (clamped), an unread dot when `readAt == null`.
- **Mark-read**: a small `'use client'` interaction (a button or an on-open server action) that calls
  `POST /api/v1/student/announcements/:id/read` and clears the unread dot. Keep it minimal — a server action
  posting then `revalidate`, or an optimistic client toggle. The `role="status"`/`aria-live="polite"` region
  announces only the read-state transition, NOT on every render.
- Empty → `EmptyState tone="violet"` ("Aucune annonce pour l'instant").

### 8.3 Sidebar

Add to `studentSidebarItems` (search the file in `apps/web`): "Mon tableau de bord" → `/student/dashboard`
(ideally first, the landing surface) and "Annonces" → `/student/announcements`. (Optional, low-risk:
re-point `PORTAL_LANDING.student` to `/student/dashboard` — but S1 set it to `/student/grades` and changing
it is out of scope; leave landing as-is unless trivially safe.)

## 9. Acceptance criteria (folds spec AC-5/AC-6/AC-7 + the §5 fix)

- **AC-S3-1** `GET /student/announcements` returns the announcements addressed to the caller (newest-first,
  pinned-first), self-scoped on `me.id`; an unlinked / no-receipt caller gets `{ data: [] }`; **no
  staff-only or other-class announcement is ever disclosed**; the row shape carries NO recipient roster /
  read-stats.
- **AC-S3-2** `POST /student/announcements/:id/read` flips ONLY the caller's own receipt (idempotent;
  already-read → ok); a caller with no receipt for that id → 404 (never reveals the announcement existed).
- **AC-S3-3** `GET /student/dashboard` composes, in ONE aggregate behind the wall: the per-subject trend
  (own average + delta), the next-3 assessments, and (when a plan exists) the second-person remediation
  line. The response **structurally lacks** `studentRank`/`classAverage`/`classRankTotal`/`classSize` — a
  contract/type-level assertion, not just a UI choice.
- **AC-S3-4** Best-effort: a thrown snapshot/remediation/upcoming read degrades that block to its empty
  state; the endpoint still returns 200. The dashboard holds **<2 s** (reuses the existing snapshot-first
  producers; no new class scan).
- **AC-S3-5 (RGPD / non-stigmatising)** No view discloses another student's data or a peer-relative
  position; copy is encouraging and forward-looking (no "échec / mauvais / dernier / classement /
  leaderboard / redoublement"); a struggling subject reads "à consolider — voici sur quoi te concentrer".
- **AC-S3-6 (§5 regression-safe)** A class-scoped announcement now ALSO materialises a receipt for an
  enrolled+linked student; it materialises NOTHING new for an enrolled student with no linked profile and
  adds NO non-class student; guardians/teachers receive exactly what they received before.
- **AC-S3-7 (WCAG 2.2 AA + reuse)** Icon+text (not colour-alone) for every trend/priority state;
  `role="status"`/`aria-live="polite"` only on the mark-read transition (not every tick); ≥4.5:1 contrast;
  `prefers-reduced-motion` honoured; mobile-first; reuse-first on `@pilotage/ui` (no `packages/ui` change
  unless DS Guardian agrees).
- **AC-S3-8 (no regression / scope)** No parent/teacher/admin capability moved or loosened; no permission
  widened; **no schema change, no new permission, no new ADR, no second queue, no new metric**; read-only
  except the existing self-scoped announcement mark-read.

## 10. Test (the single most valuable, Murat-design)

A new/extended `student-portal.service.spec.ts` case set proving the wall + the narrowing + best-effort:
- `dashboard` projects `subjectPerf` to a shape that **omits** `classAverage`/`studentRank`/`classSize`
  (assert the keys are absent), keeps `studentAverage`/`trend`, and reuses `parentDashboard(...).remediation`
  verbatim.
- a thrown `parentDashboard` → `{ subjects: [], remediation: [] }`, endpoint still resolves (best-effort).
- unlinked (`resolveSelf` → null) → kind-empty dashboard + `{ data: [] }` announcements, no throw, no read.
- `announcements` reads receipts keyed on `me.id`, maps to the peer-free row, drops `recipients`/`stats`.
- `markAnnouncementRead` 404s when the caller owns no receipt for the id (no leak), idempotent on re-read.
- (announcements module) the §5 recipient fix: a class-scoped publish materialises a receipt for an
  enrolled+linked student and nothing for an unlinked one; guardians/teachers unchanged.

## 11. Risk / pre-mortem (failure modes → guardrails)

- **PM-1 (leak via peer field).** If `dashboard` spreads `...subjectPerf[i]` it leaks `classAverage`/
  `studentRank`/`classSize`. → Explicit field-pick projection (§6.1); contract type lacks the fields;
  test asserts absence.
- **PM-2 (empty announcements for everyone).** Without the §5 fix, students see nothing for class/student
  scopes. → The additive recipient rule; test pins it.
- **PM-3 (§5 over-reach regression).** The recipient fix accidentally adds non-class students or staff. →
  Union ONLY the enrolled+linked students of the resolved class set; guard `userProfileId != null`; test
  pins guardians/teachers unchanged and no extra student.
- **PM-4 (dashboard 500 on a missing snapshot/plan/table).** → Per-block try/catch → `[]` (the
  `parentDashboard` posture); endpoint always 200.
- **PM-5 (IDOR via `:id` on mark-read).** The `:id` is an announcement id; access is gated by
  "do I own a receipt" keyed on `me.id`. A foreign announcement id → 404 (no receipt). No student id is ever
  accepted. → Verbatim re-use of the parent `markRead` receipt lookup; test the 404.
- **PM-6 (stigmatising copy slips in).** → The amber state is "à consolider", remediation flat is "les
  premiers effets prennent quelques semaines"; A11y reviewer + the copy lint in AC-S3-5.

## 12. Out of scope (non-goals — do not build)

Any student write beyond the self-scoped announcement mark-read; a booking/messaging/appeal/self-justify
verb; a provisioning UI; real-time/push; LTI/OneRoster; any peer comparison, rank, leaderboard, or
class-average framed against the student; any schema change; any new permission, ADR, queue, or metric;
re-pointing the three existing portals.
