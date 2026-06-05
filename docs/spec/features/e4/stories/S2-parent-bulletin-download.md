# E4-S2 — Parent self-service term-summary PDF (bulletin) download

> **Self-contained story.** A developer can implement this slice from this file
> alone. Read `bmad/project-context.md` first (hard constraints: tenant + RLS,
> ABAC, append-only audit, reuse `@pilotage/ui`, React-19 server/client boundary,
> `packages/contracts` for shared types). **Do NOT build the rest of E4** — only S2.

- **Epic:** E4 — Async Exports & Bulletins · **Slice:** S2 · **Risk:** P1 `[auth]`
- **touchesUi:** true · **touchesBackend:** true · **touchesWorker:** true (one
  additive, optional generator filter — *no new worker module/processor*)
- **Portal:** parent

---

## 1. Intent (one sentence)

A parent can one-click **download their own child's term bulletin PDF** from
`/parent/documents` via a parent-permitted, guardianship-ABAC export surface that
enqueues the **existing** `report_card_pdf` worker generator scoped to
`{studentId, termId}`, polls job status, and returns a signed download — with
append-only audit and tenant/RLS scoping, reusing the shipped `ExportJob` +
signed-URL + polling machinery and adding **zero new worker/generator module**.

## 2. Why (cahier de charges)

The cahier asks for the **"synthèse parent PDF par enfant et période"** — a
per-child, per-term bulletin the parent can pull themselves. Today the exports
engine is 100% built but only the **admin** can trigger it (`exports.execute`,
unscoped). The parent documents page shows a placeholder
("Les bulletins PDF … arriveront via le worker R7"). This slice closes that gap
while keeping children's-data access **minimal** (one child, own jobs only).

## 3. What already exists (REUSE — do not rebuild)

| Asset | Path | Reuse as |
|---|---|---|
| `ExportJob` model (`kind`, `parameters` JSON, `status`, `fileName`, `fileUrl`, `fileSizeBytes`, `requestedBy`, tenant/school scope) | `apps/api/prisma/schema.prisma` (model `ExportJob`, enums `ExportKind`/`ExportStatus`) | the persistence row — **no schema change** |
| `ExportsService` — `enqueue`, `findOne`, `listForTenant`, `signedDownloadUrl`, `toDto`, `buildFileName`, `extractS3Key` | `apps/api/src/modules/exports/exports.service.ts` | the enqueue + sign helpers — **reuse directly** |
| `ExportJobPayload` / `ExportJobDto` / `ExportKindCode` / `EXPORT_DEFAULT_FILENAME` | `apps/api/src/modules/exports/exports.types.ts` | payload + DTO shapes |
| BullMQ `QUEUE_EXPORTS` + `ExportsProcessor` | `apps/worker/src/modules/exports/exports.processor.ts` | the async runner — untouched |
| `report_card_pdf` generator | `apps/worker/src/modules/exports/generators/report-card-pdf.generator.ts` | the PDF builder — **one additive optional filter only** (see §7) |
| `S3Service.signedGetUrl({ key, filename })` | `apps/api/src/shared/storage/s3.service.ts` | on-demand signed URL (1 h TTL) |
| `StudentAccessService.canAccessStudent(user, jwt, studentId, schoolId)` + `scopeForUser` (returns active-guardianship `studentIds` for parents) | `apps/api/src/modules/students/student-access.service.ts` | the **guardianship ABAC** gate |
| `UserSyncService.ensureUser(jwt)` → `{ id, tenantId, … }` ; `SchoolContextService.forUser(me)` → `{ schoolId }` | `apps/api/src/shared/auth/*`, `school-structure/school-context.service.ts` | resolve caller identity + school |
| Admin polling/download client components — `ExportsRefresher` (auto `router.refresh()` while jobs in-flight), `ExportDownloadButton` (resolve signed URL on click, `window.open`) | `apps/web/src/app/admin/exports/*` | **copy the pattern** into parent components |
| Parent `ChildSelector` (child picker, writes `?studentId=`) | `apps/web/src/app/parent/_components/ChildSelector.tsx` | the child picker — reuse |
| Parent documents page (placeholder to replace) | `apps/web/src/app/parent/documents/page.tsx` | host surface (see §6) |
| Inline append-only audit convention (`prisma.auditLog.create`, no shared AuditService; `hash`/`prevHash` unset) | `apps/api/src/modules/alerts/alerts.service.ts` `writeAuditEntry` | the audit pattern to mirror |

## 4. The ONE net-new thing

A **parent-permitted, guardianship-checked** export surface — distinct from the
admin-only `exports.execute` controller — so the parent can enqueue/list/download
**only** their own child's bulletin. New permission `exports.execute.parent`
granted to the `parent` realm role (admin keeps `exports.execute`; the two never
overlap). Everything else is reuse.

## 5. Backend (apps/api)

### 5.1 Permission

In `apps/api/src/shared/auth/permissions.constants.ts`:

- Add to the `PERMISSIONS` catalog (Ops section):
  `['exports.execute.parent', 'Générer ses exports (parent)', 'export', 'execute.self']`.
- Add `'exports.execute.parent'` to `REALM_ROLE_PERMISSIONS.parent` and to
  `REALM_ROLE_PERMISSIONS.super_admin` is automatic (super_admin = all). Do **not**
  add it to `school_admin`/`teacher` (out of scope for S2).
- The seed reads this catalog, so no separate seed edit is needed; mention in PR
  that a permission re-seed is required for the demo realm.

### 5.2 New parent-scoped controller

New module folder `apps/api/src/modules/parent-exports/` (keep the admin exports
module untouched), or a new controller inside the existing exports module that
imports `StudentAccessService`. Either way:

`@Controller('parent/exports')`, guarded by `JwtAuthGuard + PermissionsGuard`,
every route `@RequiresPermission('exports.execute.parent')`. Inject
`ExportsService`, `StudentAccessService`, `UserSyncService`, `SchoolContextService`,
`PrismaService`.

**Routes** (all tenant-scoped via `me.tenantId`):

1. `POST /api/v1/parent/exports/bulletin`
   Body DTO `CreateParentBulletinDto`: `{ studentId: uuid (required), termId: uuid (required) }`
   (class-validator `@IsUUID()`; both required — no class-wide fallback for parents).
   Flow:
   - `me = ensureUser(jwt)`; `{ schoolId } = ctx.forUser(me)`.
   - **ABAC:** `await studentAccess.canAccessStudent(me, jwt, body.studentId, schoolId)` →
     if false, `403 ForbiddenException`. (Resolve student-in-tenant first so a
     non-existent / cross-tenant student is `404` *before* `403`: a
     `prisma.student.findFirst({ where: { id: studentId, tenantId: me.tenantId } })`
     → `404` if null, then the guardianship check → `403`.)
   - **Resolve the child's class section for the term's academic year** (server-side,
     never trusted from the client): find the student's **active** enrollment for
     the term's academic year:
     ```
     const term = await prisma.term.findFirst({
       where: { id: body.termId, tenantId: me.tenantId },
       select: { id: true, name: true, academicYearId: true },
     });               // 404 if null
     const enrollment = await prisma.enrollment.findFirst({
       where: {
         tenantId: me.tenantId,
         studentId: body.studentId,
         academicYearId: term.academicYearId,
         status: 'active',
       },
       select: { classSectionId: true },
     });               // 404 "Aucune inscription active pour cette période" if null
     ```
   - **Enqueue via the existing service** (reuse `ExportsService.enqueue`):
     ```
     const job = await exports.enqueue({
       dto: {
         kind: 'report_card_pdf',
         parameters: {
           classSectionId: enrollment.classSectionId,
           termId: term.id,
           studentId: body.studentId,   // NEW narrowing param — see §7
         },
       },
       tenantId: me.tenantId,
       userProfileId: me.id,            // requestedBy = the parent → own-job scoping
       schoolIdFallback: schoolId,
     });
     ```
   - **Append-only audit** (mirror `alerts.service writeAuditEntry`, best-effort,
     post-enqueue, swallow errors):
     `prisma.auditLog.create({ data: { tenantId: me.tenantId, actorId: me.id,
     actorRole: 'parent', portal: 'parent', action: 'export.bulletin.request',
     resourceType: 'export_job', resourceId: job.id,
     after: { studentId, termId: term.id, classSectionId } } })`.
   - Return the `ExportJobDto` (status `pending`).

2. `GET /api/v1/parent/exports?limit&offset` — list the **caller's own** jobs only:
   `prisma.exportJob.findMany({ where: { tenantId: me.tenantId, requestedBy: me.id,
   kind: 'report_card_pdf' }, orderBy: { createdAt: 'desc' }, … })` mapped through
   the **same** DTO shape as `ExportsService.toDto`. (Add a thin
   `listForRequester({ tenantId, requestedBy, limit, offset })` to `ExportsService`
   rather than duplicating the query — symmetric with `listForTenant`.)

3. `GET /api/v1/parent/exports/:id` — `ExportsService.findOne` **plus** a guard that
   `job.requesterId === me.id` (else `404` — never leak existence of another
   parent's job). Implement as a new `findOneForRequester({ id, tenantId, requestedBy })`
   on `ExportsService` (findFirst with `requestedBy` in the `where`).

4. `GET /api/v1/parent/exports/:id/download-url` — re-check own-job
   (`requestedBy = me.id` in the `where`), then `ExportsService.signedDownloadUrl`
   (which already 404s unless `status==='succeeded' && fileUrl`). Return
   `{ url, expiresInSec: 3600 }`. Add a `signedDownloadUrlForRequester` variant (or
   pass an optional `requestedBy` into the existing `signedDownloadUrl` `where`) so a
   parent can never sign another parent's file.

> **Module wiring:** register the new controller in `AppModule` (or extend
> `ExportsModule` imports with `StudentsModule`/`StudentAccessService` provider).
> Keep the admin `ExportsController` and its `exports.execute` routes unchanged.

### 5.3 Shared contracts (optional but preferred)

If a shared type is worth it, add `packages/contracts/src/dto/export.ts` with
`CreateParentBulletinInput` (`studentId`, `termId`) + a `ParentExportJob` view type
and export it from `index.ts`. The web app already imports from `@pilotage/ui`; the
parent server actions can reuse these types. Keep it minimal — a `z.object` +
inferred type is enough. **Do not** revert `packages/contracts` `main` to source.

## 6. Frontend (apps/web) — `/parent/documents`

Replace the **placeholder paragraph** at the bottom of
`apps/web/src/app/parent/documents/page.tsx` (the two "arriveront via le worker R7"
branches) with a real **"Bulletins"** card section. Keep the existing documents
aggregation untouched — this is an additive section above or in place of the
placeholder `<p>`.

- **Server component** (the page is already `async` / `force-dynamic`): the page
  already resolves `children` (via `/api/v1/students`) and `activeStudentId`. Fetch
  the available **terms for the active child's active academic year** so the parent
  can pick a period. Reuse an existing endpoint that returns terms (the analytics
  child-overview already exposes `terms: {id,name,orderIndex}` — see
  `apps/api/src/modules/analytics/analytics.service.ts:282`); if no clean parent
  terms endpoint exists, add a tiny `GET /api/v1/parent/exports/terms?studentId=`
  returning the active-year terms for a guarded child (same ABAC), OR derive terms
  from the existing child-overview aggregate the dashboard already calls. Prefer
  reusing an existing aggregate over adding an endpoint.
- Also fetch the parent's recent bulletin jobs: `GET /api/v1/parent/exports` →
  render a small list (term · status badge · download button).
- **New client components** under `apps/web/src/app/parent/documents/` (mirror the
  admin trio):
  - `BulletinLauncher.tsx` (`'use client'`) — term `<select>` + a **"Télécharger le
    bulletin"** button calling a server action `requestBulletinAction(studentId,
    termId)` (`'use server'`, `POST /api/v1/parent/exports/bulletin`,
    `revalidatePath('/parent/documents')`). Success → feedback "Génération en
    cours…" + `router.refresh()`. Error → inline message from the API
    (403/404/HTTP).
  - `ParentExportsRefresher.tsx` — copy `ExportsRefresher` (auto `router.refresh()`
    every ~3 s while any job is `pending`/`running`, pauses when tab hidden).
  - `ParentBulletinDownloadButton.tsx` — copy `ExportDownloadButton` (server action
    `fetchBulletinUrlAction(id)` → `GET …/:id/download-url` →
    `window.open(url, '_blank', 'noopener')`). Never bake signed URLs into HTML.
  - `actions.ts` (`'use server'`) — `requestBulletinAction`, `fetchBulletinUrlAction`
    (mirror `apps/web/src/app/admin/exports/actions.ts` error handling via
    `api`/`ApiError`).
- **UI quality:** reuse `@pilotage/ui` primitives (`KpiCard`/card styling,
  `EmptyState`, status badge colors consistent with admin: pending=slate,
  running=blue, succeeded=emerald, failed=rose). Premium, colorful, responsive,
  mobile-first (<2 s), animated affordance on the button; WCAG AA — the term
  `<select>` has a `<label>`, the download/generate buttons have discernible names,
  focus-visible rings, `role="status"` on feedback, 44px touch targets.
- The card copy is **kind / factual**: e.g. "Téléchargez le bulletin de
  {childName} pour la période sélectionnée. Le document est généré en quelques
  secondes." Replace the R7 placeholder entirely.

## 7. Worker note (the only worker touch — additive, optional)

The existing `report_card_pdf` generator
(`apps/worker/src/modules/exports/generators/report-card-pdf.generator.ts`) builds a
**class-wide** PDF (one page per enrolled student). For a parent single-child
bulletin, RGPD **minimal-data** requires the PDF to contain **only the parent's
child**. Make a **single additive, optional** change:

- Read `const studentIdFilter = parameters.studentId as string | undefined;`
- In the `enrollments` query, when `studentIdFilter` is set, add
  `studentId: studentIdFilter` to the `where` (so exactly one enrollment / one page).
  When absent (the admin class-wide path), behavior is **unchanged**.

This is **parameter narrowing on an existing query**, not new generator logic, no
new generator file, no new processor, no new queue, no new export kind. The admin
path (no `studentId`) is byte-for-byte unchanged. This is the documented autonomous
decision resolving the "reuse the generator for a single child" vs "minimal access"
tension — chosen over leaking the whole class into a parent download.

## 8. ABAC / security / tenancy (P1 `[auth]`)

- **Guardianship wall at enqueue:** `canAccessStudent` (active `Guardianship`) — a
  parent can only request a bulletin for their own child. 404-before-403.
- **Own-job wall at read/download:** every `GET /parent/exports*` re-checks
  `requestedBy = me.id` — one parent never sees/downloads another's job or signed
  URL. (Defence in depth: enqueue already stamps `requestedBy = me.id`.)
- **Tenant + RLS:** every query carries `tenantId: me.tenantId`; the worker upload
  key is already `exports/{tenantId}/{jobId}/{fileName}`.
- **Append-only audit** on enqueue (`export.bulletin.request`, `resource_type =
  export_job`), best-effort/swallowed, mirroring the alerts convention; no audit on
  reads (consistent with admin).
- **Minimal data:** PDF restricted to the single child (§7); no class roster leaks.
- The signed URL is short-lived (1 h), signed on demand, never persisted — same as
  admin.

## 9. Acceptance criteria (testable)

1. A guardian POSTing `/parent/exports/bulletin` for **their** child + a valid term
   creates a `report_card_pdf` `ExportJob` with `requestedBy = parentProfileId`,
   `parameters = { classSectionId, termId, studentId }`, `status: pending`, and an
   append-only `audit_log` row `export.bulletin.request`.
2. A parent requesting a bulletin for a child they do **not** guardian → `403`
   (and a student not in their tenant → `404`, before the 403).
3. A request for a term/child with **no active enrollment** in that academic year →
   `404` with a clear message; no job is created.
4. `GET /parent/exports` returns **only** the caller's own `report_card_pdf` jobs
   (never another parent's), tenant-scoped, newest first.
5. `GET /parent/exports/:id/download-url` for a **succeeded own** job returns a fresh
   1 h signed URL; for another parent's job id → `404`; for a non-succeeded job →
   `404` ("Export not ready").
6. The generated PDF for a parent job contains **exactly one student** (the child) —
   the additive `studentId` filter; the admin class-wide path is unchanged.
7. `/parent/documents` shows a "Bulletins" section (placeholder text gone), the
   button enqueues + the list auto-polls pending→running→succeeded, then a
   "Télécharger" button opens the PDF in a new tab.
8. Parent realm role has `exports.execute.parent`; parent surfaces never hit the
   admin `exports.execute` routes; admin `/admin/exports` is unaffected.
9. Tenant scoping holds across all routes; no cross-tenant or cross-parent read is
   possible. WCAG AA on the new UI (labelled select, named buttons, focus rings,
   `role="status"` feedback, ≥44px targets).

## 10. Pre-mortem → extra criteria (Critic lens)

- *"It leaked the whole class to a parent."* → §7 `studentId` filter + AC #6 is the
  guard; a test asserts the PDF/enrollment query is narrowed.
- *"A parent downloaded another parent's bulletin."* → own-job `requestedBy` re-check
  on `:id` and `:id/download-url` (AC #4, #5).
- *"No active enrollment → opaque 500 from the generator."* → resolve enrollment in
  the API and 404 early (AC #3) so the worker never runs a doomed job.
- *"Parent got admin-wide export powers."* → distinct `exports.execute.parent`
  permission, separate controller, no `exports.execute` on the parent surface (AC #8).
- *"Signed URL leaked via referrer / persisted."* → on-demand sign, `window.open`
  with `noopener`, never stored (mirrors admin).

## 11. Targeted test (Murat — single most valuable)

A controller/service unit test for `POST /parent/exports/bulletin`:
- guardian + valid term + active enrollment → enqueues with
  `parameters.studentId` set and writes the audit row;
- non-guardian child → `403`;
- guardian but term with no active enrollment → `404`.
Mock `StudentAccessService.canAccessStudent`, `PrismaService` (student/term/
enrollment/exportJob/auditLog), and `ExportsService.enqueue`. (Pattern:
`apps/api/src/modules/alerts/alerts.controller.spec.ts`.)

## 12. Out of scope (do NOT do)

- No new generators / export kinds / BullMQ queue / ExportJob columns.
- No email-on-complete, no bulk/zip multi-child, no scheduled exports.
- No change to the admin exports controller, routes, or permission.
- No teacher surface (that is S3).
- No `AskUserQuestion` — the §7 minimal-data decision is the documented autonomous call.

## 13. Files (expected touch set)

**Backend (api):**
- `apps/api/src/shared/auth/permissions.constants.ts` (add `exports.execute.parent` + grant to parent)
- `apps/api/src/modules/parent-exports/parent-exports.controller.ts` (new)
- `apps/api/src/modules/parent-exports/parent-exports.module.ts` (new) — or extend `exports.module.ts`
- `apps/api/src/modules/parent-exports/dto/create-parent-bulletin.dto.ts` (new)
- `apps/api/src/modules/exports/exports.service.ts` (add `listForRequester`, `findOneForRequester`, requester-scoped `signedDownloadUrl`)
- `apps/api/src/app.module.ts` (register new module/controller)
- `apps/api/src/modules/parent-exports/parent-exports.controller.spec.ts` (new — Murat test)

**Worker:**
- `apps/worker/src/modules/exports/generators/report-card-pdf.generator.ts` (additive optional `studentId` filter)

**Frontend (web):**
- `apps/web/src/app/parent/documents/page.tsx` (replace R7 placeholder with Bulletins section + fetch parent exports)
- `apps/web/src/app/parent/documents/actions.ts` (new — server actions)
- `apps/web/src/app/parent/documents/BulletinLauncher.tsx` (new)
- `apps/web/src/app/parent/documents/ParentExportsRefresher.tsx` (new — copy of admin refresher)
- `apps/web/src/app/parent/documents/ParentBulletinDownloadButton.tsx` (new — copy of admin download button)

**Contracts (optional):**
- `packages/contracts/src/dto/export.ts` + `index.ts` export

**Spec:**
- `docs/spec/features/e4/PROGRESS.md` (tick S2 on land)
