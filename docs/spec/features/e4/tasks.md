# E4 — Slice backlog (tasks)

> One vertical slice per run. A slice = DB + API + UI + worker as needed, demoable
> end-to-end, fitting ONE PR. Detailed self-contained specs live in `stories/`.

- [x] **S1 — Admin exports surface** *(web)* — `/admin/exports` generate buttons
  (`ExportLauncher`), `ExportsRefresher` status polling, `ExportDownloadButton`
  signed downloads over `POST/GET /api/v1/exports*` (`exports.execute`). Already
  live in the admin portal; serves as the reference pattern for S2/S3.

- [ ] **S2 — Parent term-summary PDF (bulletin)** *(web + small api)* ← **next**
  Story: `stories/S2-parent-bulletin-download.md`. A parent one-click downloads
  **their own child's** term bulletin. New parent-permitted API surface
  (`exports.execute.parent` permission, NOT admin `exports.execute`):
  `POST /api/v1/parent/exports/bulletin` (guardianship-ABAC enqueue of a
  `report_card_pdf` job scoped to {studentId, termId}),
  `GET /api/v1/parent/exports` (own jobs only),
  `GET /api/v1/parent/exports/:id` + `GET /api/v1/parent/exports/:id/download-url`
  (own-job re-check). Append-only audit on enqueue. UI on `/parent/documents`
  (replace the "worker R7" placeholder) reusing the existing polling/download
  client pattern. Worker note: an additive, optional `studentId` filter on the
  existing `report_card_pdf` enrollment query so the PDF contains only the child
  (RGPD minimal-data) — no new generator/worker module. `[auth]` P1.

- [ ] **S3 — Teacher class grade-grid export** *(web + small api)* — teacher
  gradebook "Exporter la grille" → `grades_xlsx` for a teaching-assigned class
  section, polled signed download. Teaching-assignment ABAC; reuse the same
  enqueue/poll/download pattern. (Spec to be written on the S3 run.)
