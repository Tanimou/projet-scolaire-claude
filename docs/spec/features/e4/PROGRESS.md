# E4 — PROGRESS

| Slice | State | PR | Notes |
|---|---|---|---|
| S1 — Admin exports surface | shipped (pre-epic) | — | `/admin/exports` generate + poll + signed download over `exports.execute`. Reference pattern. |
| S2 — Parent term-summary PDF (bulletin) | **shipped** (needs human review) | — | Parent-permitted enqueue/list/download surface (`exports.execute.parent`, NOT admin `exports.execute`), guardianship ABAC at enqueue, server-derived `classSectionId`, additive single-`studentId` generator narrowing, parent-narrowed `ParentExportJobDto` (top-level `termId`/`studentId`, no `errorMessage`/`fileUrl`), append-only `export.bulletin.request` audit, child-scoped `report_card_pdf`. No schema change. **Branch label desynced** (`e4-s1`) — diff ships S2; reconcile on land. |
| S3 — Teacher class grade-grid export | **shipped** (needs human review) | — | NEW teacher-permitted surface (`exports.execute.teacher`, NEVER admin `exports.execute` nor parent `exports.execute.parent`) `POST/GET /api/v1/teacher/exports*` (`apps/api/src/modules/teacher-exports/*`); enqueue input is the **`teachingAssignmentId`** (gradebook route key) + optional `termId`, teaching-assignment ABAC re-checked at enqueue (assignment `teacherProfileId == me.TeacherProfile.id`, else 403; 404-before-403), `classSectionId` SERVER-derived from the OWNED assignment (never client-supplied). Reuses the `grades_xlsx` generator UNCHANGED (`{classSectionId, termId?}`) + the proven enqueue/poll/signed-download client pattern (`GradeGridExportButton` in the gradebook `PageHeader` actions). Narrow `TeacherExportJobDto`/`TeacherExportJobSchema` (top-level `classSectionId`/`termId`, no `errorMessage`/`fileUrl`). Append-only `export.grade_grid.request` audit. Own-job re-scoping (`requestedBy = me`) on list/findOne/download; `grades_xlsx`-only. **No worker/queue/schema change.** Risk **P1 `[auth][public-api][ui]`**. |

## MURAT (Test Architect) — S3 pre-assessment

- **Risk tier: P1.** Tags: `[auth]` (net-new AuthZ surface + teaching-assignment ABAC
  wall over children's published grades), `[public-api]` (net-new `/api/v1/teacher/exports*`
  routes), `[ui]`. **NOT `[schema]`** (no migration). `[auth]` P1 → escalation panel applies.
- **Top failure modes:** (PM-1) cross-section data leak if the enqueue trusted a client
  `classSectionId` or skipped the teacher-ownership re-check → input is `teachingAssignmentId`-only
  + server-derived section + ownership re-check; (PM-2) cross-teacher IDOR on a job id → all
  read/download re-scoped `requestedBy = me`; (PM-3) permission bleed if `exports.execute.teacher`
  attaches to `parent` or the controller reuses `exports.execute` → distinct perm, teacher-role only.
- **Single most valuable targeted test (NO E2E, NO build):** controller unit spec
  `apps/api/src/modules/teacher-exports/teacher-exports.controller.spec.ts`, mirroring the shipped
  `parent-exports.controller.spec.ts` — (1) owned assignment → `enqueueTeacherGradeGrid` called once,
  no client `classSectionId`, DTO carries top-level `classSectionId`/`termId` (`kind: 'grades_xlsx'`);
  (2) non-owned assignment → 403 + nothing enqueued; (3) list/findOne/download each pass
  `requestedBy = me.id` and list is `grades_xlsx`-scoped. Locks PM-1/PM-2/PM-3 at the exact regressing
  seam, no DB/queue/build — the same shape that caught the S2 regressions.

## Decisions / context for the next run

- **Backend exports engine is 100% reused.** `ExportJob` model, `QUEUE_EXPORTS`,
  `ExportsProcessor`, all 5 generators, `S3Service.signedGetUrl`, the tenant-scoped
  `ExportsService` enqueue/find/list/sign helpers — all exist (see
  `apps/api/src/modules/exports/*`, `apps/worker/src/modules/exports/*`).
- **S2 does NOT reuse the admin controller** (`exports.execute` is admin-wide /
  unscoped). It adds a parent-permitted, guardianship-checked surface so a parent's
  data access stays minimal (one child, own jobs only).
- **report_card_pdf is class-wide today** (one page per student in a class section).
  For a parent single-child bulletin (RGPD minimal-data), S2 narrows it with an
  *additive optional* `studentId` parameter on the generator's enrollment query —
  the only worker touch, and it is parameter-narrowing, not new generator logic.
  Documented as the slice's autonomous decision (no AskUserQuestion).

## S2 ship notes (for the S3 run + human reviewer)

- **Producer/consumer DTO truthfulness (the blocker fixed in-flight).** The generic `ExportJobDto`
  only nests `termId`/`studentId` inside `parameters`, but the parent page reads them top-level → the
  poll/download flow was dead. Fixed at the *producer*: a new `ParentExportJobDto` + `toParentDto`/
  `listForParent`/`findOneForParent` in `ExportsService` hoist them to top-level (and drop
  `errorMessage`/`fileUrl` for RGPD minimal-exposure), so the contract (`ParentExportJobSchema`) is now
  truthful. The controller spec asserts the real DTO shape.
- **Two human-review items carried into the PR (not blocking, accepted for v1):**
  1. **Branch/slice label desync** — branch `ci/2026-06-05-e4-s1-admin-exports` ships **S2**; reconcile.
  2. **No enqueue idempotency** — every "Régénérer" click creates a new `ExportJob`; the UI mitigates
     (optimistic disable, keep-most-recent-per-term) but the API has no
     `{tenant,requestedBy,student,term}` in-flight dedup. Cost/abuse vector only (fully
     ownership/tenant/guardianship-scoped). Decide on the S3 run whether to add a "reuse pending/running"
     short-circuit before enqueue.
- **The one must-check (security):** confirm `exports.execute.parent` is granted to the `parent` role
  **only** in the live Keycloak realm / DB — the whole wall depends on `canAccessStudent` returning a
  `null` (unrestricted) scope for admin/teacher; if this perm ever attaches to a non-parent role, that
  holder could enqueue a single-child bulletin for ANY student in the tenant.
- **S3 reuses the same exports engine** (`ExportJob` + worker + generators + `S3Service.signedGetUrl`);
  it is teacher-permitted (teaching-assignment scope), not parent — do NOT reuse `exports.execute.parent`.

## S3 ship notes (for the human reviewer + E4 close-out)

- **Zero worker / queue / schema change — fully verified.** The existing `grades_xlsx`
  generator already accepts `{ classSectionId, academicYearId?, termId? }`; S3 enqueues it
  scoped to `{ classSectionId, termId? }` (one class-section sheet). No generator edit, no new
  BullMQ queue, no `ExportJob` column, no migration. This is the cleanest of the E4 slices.
- **Autonomous decision — strict teacher-ownership, no admin bypass (tightening vs the story note).**
  The MURAT/story plan suggested mirroring `GradesController.assertCanRead`'s `super_admin`/
  `school_admin` bypass. The shipped controller instead enforces a STRICT
  `teachingAssignment.teacherProfileId === me.TeacherProfile.id` with **no** admin bypass, because
  (a) the surface is gated by `exports.execute.teacher` which is granted to `teacher` (+ super_admin
  all-map) only — `school_admin` does NOT hold it, so a school_admin never reaches this code, and
  (b) admins already have the tenant-wide `/admin/exports` (`exports.execute`) surface for the same
  XLSX. Keeping the wall strict means the teacher surface can only ever export a class the caller
  literally teaches — the safest reading of the slice's intent. Documented here per the
  "no AskUserQuestion → decide + log" rule.
- **The one must-check (security, mirrors S2):** confirm `exports.execute.teacher` is granted to the
  `teacher` role **only** (+ super_admin all-map) in the live Keycloak realm / DB. If it ever attaches
  to `parent` or `school_admin`, the teaching-ownership wall is the only remaining guard (still holds:
  a non-owned `teachingAssignmentId` → 403, server-derived `classSectionId`), but the surface should
  stay teacher-scoped by design. Constants (`permissions.constants.ts`) + `seed.ts` both updated.
- **No enqueue idempotency (same accepted-for-v1 stance as S2).** Each "Régénérer" creates a new
  `ExportJob`; the button mitigates with optimistic disable + polling the newest own-job per class.
  Cost/abuse vector only (fully tenant/ownership-scoped). Carry the same future "reuse pending/running"
  short-circuit decision across the whole exports epic.
- **E4 is now complete** (S1 pre-epic + S2 + S3 all shipped). Next: advance the roadmap to **E5 —
  Advanced Notifications** (or close E4 → `shipped`).
