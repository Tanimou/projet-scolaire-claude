# E4-S3 — Teacher class grade-grid export (story spec)

> **Self-contained slice spec.** The dev agents implement from THIS file alone.
> Mirrors the proven E4-S2 parent-export pattern (`stories/S2-parent-bulletin-download.md`)
> — same enqueue→poll→signed-download spine, a NEW role-permitted surface, its own
> ABAC wall, append-only audit, and **zero new generator / queue / schema**.

## Intent (one sentence)

A teacher one-clicks **"Exporter la grille"** from their gradebook
(`/teacher/classes/[id]/grades`, where `[id]` is a **teachingAssignmentId**) and
downloads that class section's grade-grid as **XLSX**, generated asynchronously by
the **existing** `grades_xlsx` worker generator, over a **NEW teacher-permitted**
export surface — never the admin `exports.execute` nor the parent
`exports.execute.parent`.

## Users & why

- **Teacher** — the cahier's "grille de notes de la classe en XLSX." Wants the same
  matrix they see in the gradebook (élèves × évaluations publiées + moyenne) as a
  downloadable spreadsheet, scoped to **one** of their own teaching assignments,
  without asking an admin and without touching the tenant-wide admin export surface.

## Scope decision (the load-bearing call — no AskUserQuestion)

The gradebook route is keyed by **`teachingAssignmentId`** (one teacher × one class
× one subject), NOT by `classSectionId`. Therefore the teacher enqueue input is the
**`teachingAssignmentId`** (+ optional `termId`). The server:

1. resolves the `TeachingAssignment` in-tenant (404 if missing / cross-tenant),
2. **re-checks teaching-assignment ABAC at enqueue**: the assignment's
   `teacherProfileId` must equal the caller's own `TeacherProfile.id`
   (`teachers.ensureForUser(me)`), exactly as `GradesController.assertCanRead`
   does — admins bypass (`super_admin`/`school_admin`), any other teacher → **403**,
3. **server-derives** `classSectionId` (and `academicYearId`) from that assignment —
   **never** trusts a client-supplied `classSectionId` (anti-IDOR / cross-section
   roster leak),
4. enqueues the **existing** `grades_xlsx` generator scoped to
   `{ classSectionId, academicYearId, termId? }` — a single class section
   (the generator already accepts these optional params; **no worker change**).

This is the teacher analogue of S2's "server-derive `classSectionId` from the child's
active enrollment." The teacher never names a class section directly; they name an
assignment they provably own, and the section falls out of it.

## API surface (NEW — teacher-permitted; mirrors S2 controller shape)

New permission: **`exports.execute.teacher`** (`['exports.execute.teacher',
'Générer la grille de notes de sa classe', 'export', 'execute.teacher']`), granted
to the **`teacher`** realm role ONLY (and `super_admin` via the all-perms map). NEVER
attach to `parent`; admins keep `exports.execute`.

Controller `@Controller('teacher/exports')`, `@UseGuards(JwtAuthGuard, PermissionsGuard)`,
every route `@RequiresPermission('exports.execute.teacher')`:

- `POST /api/v1/teacher/exports/grade-grid` — body `{ teachingAssignmentId, termId? }`.
  Resolves+ABAC-checks the assignment (404-before-403), derives the section, enqueues
  `grades_xlsx`, writes the audit row, returns a narrow `TeacherExportJob` DTO.
- `GET  /api/v1/teacher/exports` — the caller's OWN `grades_xlsx` jobs (newest first),
  `requestedBy = me.id` + `kind = grades_xlsx`-scoped (no cross-teacher visibility).
- `GET  /api/v1/teacher/exports/:id` — one OWN job (404 otherwise).
- `GET  /api/v1/teacher/exports/:id/download-url` — fresh 1 h signed URL, re-checked
  `requestedBy = me.id` (no cross-teacher IDOR on a job id).

Reuse `ExportsService` with **additive** teacher-narrowed helpers mirroring the parent
ones: `enqueueTeacherGradeGrid`, `listForTeacher`, `findOneForTeacher`,
`signedDownloadUrl({ id, tenantId, requestedBy })` (already ownership-aware), and a
`toTeacherDto` projection (top-level `classSectionId`/`termId`, drop
`errorMessage`/`fileUrl`/requester identity — same RGPD-minimal exposure as `toParentDto`).
The teacher TeacherProfile resolution reuses `TeachersService.ensureForUser` (already
injected in the grades module; add it to the exports/teacher-exports module imports).

## Contracts (`packages/contracts/src/dto/export.ts` — additive)

Add, next to the parent shapes (no edit to existing exports):
- `CreateTeacherGradeGridInputSchema = z.object({ teachingAssignmentId: UuidSchema, termId: UuidSchema.optional() })`.
- `TeacherExportJobSchema` = same status model, `kind: z.literal('grades_xlsx')`,
  top-level `classSectionId: UuidSchema.nullable()`, `termId: UuidSchema.nullable()`,
  `fileName`, `fileSizeBytes`, `createdAt`, `finishedAt`. No `errorMessage`/`fileUrl`.

## UI (`/teacher/classes/[id]/grades` — reuse the proven client pattern)

- A single **"Exporter la grille"** button in the gradebook `PageHeader` `actions`
  slot (next to "Retour à la classe"), reusing the existing exports client trio
  pattern (launcher → status refresher → download button) the parent documents page
  uses (`BulletinLauncher` / `ParentExportsRefresher` / `ParentBulletinDownloadButton`).
- Server action posts `{ teachingAssignmentId: id, termId? }` (the page already has
  `id` = the teachingAssignmentId). Optimistic disable + poll pending→running→
  succeeded, then a "Télécharger" that resolves the signed URL. Reuse `@pilotage/ui`;
  premium/colorful/responsive/WCAG-AA; no new shared component unless it improves the DS.
- Keep it scoped to the current assignment/subject grid the teacher is viewing — one
  XLSX per assignment's class section.

## Acceptance criteria

1. A teacher can enqueue a grade-grid for a `teachingAssignmentId` they **own**;
   the job is `grades_xlsx`, `requestedBy = me`, scoped to the **server-derived**
   `classSectionId` (client `classSectionId` is impossible — not in the input).
2. A teacher requesting a `teachingAssignmentId` they do **not** teach → **403**,
   and **nothing is enqueued** (the wall is the S2-style controller assertion).
3. A missing / cross-tenant `teachingAssignmentId` → **404** (404-before-403).
4. List / findOne / download are all re-scoped to `requestedBy = me` (no cross-teacher
   IDOR within the tenant); the teacher list is `grades_xlsx`-only.
5. `exports.execute.teacher` is granted to **`teacher`** only (+ super_admin all-map);
   never to `parent`. The teacher surface never calls `exports.execute` /
   `exports.execute.parent`.
6. Append-only `AuditLog` row on enqueue (`action: 'export.grade_grid.request'`,
   `resourceType: 'export_job'`, `after: { teachingAssignmentId, classSectionId, termId, kind }`),
   best-effort/post-create (never rolls back the enqueue), tenant-scoped.
7. Signed URLs signed on demand (1 h TTL), never persisted — reuses
   `S3Service.signedGetUrl` via `ExportsService.signedDownloadUrl`.
8. No new generator, no new BullMQ queue, **no schema change**, no new ExportJob column,
   no new ADR (reuses the documented exports pattern).

## Pre-mortem failure modes → extra criteria

- **PM-1 (cross-section data leak — P0 of this slice).** If the enqueue trusted a
  client `classSectionId`, or skipped the teacher-ownership re-check, a teacher could
  export ANY class section's published grades (children's data). → criteria 1–3:
  input is `teachingAssignmentId`-only; section is server-derived; ownership re-checked.
- **PM-2 (cross-teacher IDOR on a job id).** A teacher guessing/replaying another
  teacher's export-job id must get 404 on read/download. → criterion 4 (`requestedBy = me`).
- **PM-3 (permission bleed).** If `exports.execute.teacher` ever attaches to `parent`
  (or the teacher controller reuses `exports.execute`), the whole wall collapses. →
  criterion 5 (perm granted to `teacher` only; distinct permission string).
- **PM-4 (worker drift).** The grade-grid must reuse `grades_xlsx` unchanged. The
  generator already filters by `classSectionId`/`academicYearId`/`termId` — passing all
  three yields exactly one class-section sheet. → criterion 8 (no worker code).

## touchesUi / touchesBackend

- `touchesUi: true` — gradebook export button + client poll/download trio (`apps/web`).
- `touchesBackend: true` — new `teacher-exports` controller + module + `ExportsService`
  teacher helpers + permission + contracts DTO (`apps/api`, `packages/contracts`).
  **No `apps/worker` change.**

## Risk (MURAT pre-assessment)

- **Tier: P1.** Content tags: **`[auth]`** (new AuthZ surface + ABAC wall over
  children's grades), `[public-api]` (net-new `/api/v1/teacher/exports*` routes),
  `[ui]`. NOT `[schema]` (no migration). Escalation panel applies (`[auth]` P1).
- **Single most valuable targeted test** (NO E2E, NO build): a **controller unit spec**
  `apps/api/src/modules/teacher-exports/teacher-exports.controller.spec.ts`, mirroring
  the shipped `parent-exports.controller.spec.ts`, asserting the auth seams that ARE
  the slice's whole value:
  1. **owned assignment** → `enqueueTeacherGradeGrid` called once with
     `{ tenantId, teacherProfileId: me.id, teachingAssignmentId, termId }` and the
     parent passes **no** `classSectionId` (server derives it) — and the returned DTO
     carries top-level `classSectionId`/`termId` (`kind: 'grades_xlsx'`).
  2. **non-owned assignment** (ownership check returns false / wrong `teacherProfileId`)
     → **403**, and `enqueueTeacherGradeGrid` is **not** called.
  3. **list / findOne / download** are each invoked with `requestedBy = me.id` (anti
     cross-teacher IDOR), and `list` is `grades_xlsx`-scoped.
  This is the highest-ROI test because it locks PM-1/PM-2/PM-3 (the data-leak + IDOR +
  permission-bleed modes) at the exact seam where they would regress, with no DB/queue
  and no build — the same shape that caught the S2 regressions.
