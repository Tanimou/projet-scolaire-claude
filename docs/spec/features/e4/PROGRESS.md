# E4 — PROGRESS

| Slice | State | PR | Notes |
|---|---|---|---|
| S1 — Admin exports surface | shipped (pre-epic) | — | `/admin/exports` generate + poll + signed download over `exports.execute`. Reference pattern. |
| S2 — Parent term-summary PDF (bulletin) | **shipped** (needs human review) | — | Parent-permitted enqueue/list/download surface (`exports.execute.parent`, NOT admin `exports.execute`), guardianship ABAC at enqueue, server-derived `classSectionId`, additive single-`studentId` generator narrowing, parent-narrowed `ParentExportJobDto` (top-level `termId`/`studentId`, no `errorMessage`/`fileUrl`), append-only `export.bulletin.request` audit, child-scoped `report_card_pdf`. No schema change. **Branch label desynced** (`e4-s1`) — diff ships S2; reconcile on land. |
| S3 — Teacher class grade-grid export | **next** | — | Spec on the S3 run. Teacher gradebook → class grade-grid XLSX over the existing exports engine. |

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
