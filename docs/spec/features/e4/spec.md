# E4 — Async Exports & Bulletins — wire the UI

> **Status:** in-progress · **Size:** ~S-M (high ROI) · **Tier:** 2 (MVP pillars / R7)
> **Audit:** the exports **backend is 100% done** — `ExportJob` model, BullMQ
> `QUEUE_EXPORTS`, the worker `ExportsProcessor` + **5 generators**
> (`grades_xlsx`, `attendance_xlsx`, `enrollment_xlsx`, `report_card_pdf`,
> `audit_csv`), MinIO/S3 upload, on-demand pre-signed download URLs (1 h TTL),
> and tenant scoping. The only gap is the **frontend / access surfaces**:
> the admin surface exists; the **parent** has none, and the parent documents
> page still shows the "arriveront via le worker R7" placeholder.

## Vision

Turn the finished async-export engine into a capability the people who need it can
actually *use*. The cahier de charges asks for a **"synthèse parent PDF par enfant
et période"** (a per-child, per-term bulletin a parent can download). E4 wires the
existing engine to real one-click buttons, status polling and signed downloads —
**reusing** the `ExportJob` model + signed-URL + polling machinery already shipped,
adding **zero new worker/generator code**.

## Users & why

- **Admin** — already has `/admin/exports` (generate buttons, status polling,
  signed downloads) over `exports.execute`. *(E4-S1 — shipped as part of the admin
  portal; this epic only formalises it as the reference pattern.)*
- **Parent** — the core user. Wants to one-click **download their own child's term
  bulletin PDF** without asking the school. This is the cahier's "synthèse parent
  PDF". *(E4-S2 — this epic's headline slice.)*
- **Teacher** — wants a class grade-grid XLSX straight from the gradebook.
  *(E4-S3.)*

## Scenarios

1. **Parent downloads a bulletin (S2).** A guardian opens `/parent/documents`,
   picks a child (existing `ChildSelector`) and a term, clicks **"Télécharger le
   bulletin"**. The button enqueues a `report_card_pdf` `ExportJob` scoped to *that
   one child* + term, the surface polls job status (pending → running →
   succeeded), then shows a **"Télécharger"** button that resolves a fresh signed
   URL and opens the single-child PDF. The "worker R7" placeholder is replaced.
2. **Guardianship wall (S2).** A parent may only request a bulletin for a child
   they hold an **active** `Guardianship` for; any other `studentId` → `403`
   (404-before-403 if the student isn't even in-tenant). The download URL endpoint
   re-checks ownership of the job (job.requestedBy = me) so one parent can never
   pull another parent's signed file.
3. **Teacher class grid (S3).** A teacher opens a class in the gradebook, clicks
   "Exporter la grille", gets a `grades_xlsx` for that class section, polls, downloads.

## Acceptance (epic-level)

- Every export is enqueued through the **existing** `ExportJob` + BullMQ path; the
  worker and all 5 generators are reused **without new worker code** (S2 adds at
  most a tiny *additive, optional* `studentId` narrowing to the existing
  `report_card_pdf` enrollment query so a parent's PDF contains **only their
  child** — see S2 story, "Worker note").
- Parent and teacher surfaces never call the admin-only `exports.execute` path.
  Each new surface enforces its own ABAC (guardianship for parent; teaching for
  teacher) at enqueue **and** at download.
- Tenant + RLS scoping on every read/write; append-only `AuditLog` row on every
  parent/teacher enqueue (children's data — RGPD).
- Signed URLs are never persisted; they are signed on demand (1 h TTL) from the
  stored `file_url` S3 key, exactly like the admin path.
- Reuse `@pilotage/ui` + the existing exports polling/download client components;
  no new architectural decision (no new ADR needed).

## Non-goals

- No new generators, no new export kinds, no new BullMQ queue, no new ExportJob
  columns, no new email/notification on export-complete (a later polish slice could
  add it).
- No PDF parameter-picker beyond {child, term} for the parent (S2) and {class} for
  the teacher (S3).
- No bulk/zip multi-child download; no scheduled/recurring exports.

## Slices

- **S1** — Admin `/admin/exports`: real generate buttons + `ExportJob` status
  polling + signed downloads. *(web — already live; reference pattern.)*
- **S2** — **Parent term-summary PDF (bulletin)**: one-click "download my child's
  bulletin" — guardianship-ABAC enqueue/list/download over a parent-permitted
  surface (NOT `exports.execute`) → `report_card_pdf` job scoped to that child +
  term → polled signed download, on `/parent/documents`. *(web + small api)* ← **this run**
- **S3** — Teacher class grade-grid export from the gradebook. *(web)*

See `tasks.md` for the slice backlog and `stories/` for the self-contained per-slice specs.
