# E11 — Standards interop (OneRoster/LTI) + async imports

> **Epic spec (BMAD).** Vision · users · scenarios · acceptance · non-goals. The detailed plan,
> data-model, OpenAPI contract, UX and slice backlog live alongside this file in
> `docs/spec/features/e11/`. Authored on the **epic-spec run** (docs-only — no code/schema/build);
> slices ship one PR each on later runs.

## 1. Vision

Onboarding and keeping a school's roster in sync is the slowest, scariest part of adopting Pilotage.
Today bulk import (ADR-017) works but runs **synchronously in the HTTP request** — `ImportsService.apply()`
is a single `await prisma.$transaction(…, { timeout: 60_000 })` on the API thread (verified in
`apps/api/src/modules/imports/imports.service.ts`). A 5 000-row apply can hold a request open for tens of
seconds, block the event loop, and die on a gateway timeout — exactly when an admin is onboarding a whole
school and most needs it to feel calm and safe.

E11 does two things, both rooted in the cahier's interoperability chapter and its **"turn information into
action"** promise applied to onboarding:

1. **Move bulk import onto the worker.** The validated batch is enqueued as a BullMQ job; the worker drains
   it; the admin watches a **calm, live progress view** instead of a frozen spinner. The apply transaction,
   the 24h rollback, the per-row audit — all preserved, just relocated off the request path.
2. **Add a OneRoster roster-sync surface.** An admin connects a OneRoster CSV/REST source, the worker pulls
   the roster, **reconciles it idempotently** against the existing school structure (students, classes,
   enrollments), and surfaces the result the same way an import does.

The product payoff — the **visionary spine** — is the **"Import & sync health" reconciliation panel**:
after every async import or OneRoster sync, a calm, auditable summary of **exactly what changed**
(`created / updated / unchanged / conflict / skipped`) with one-click per-row drill-down and the existing
24h rollback. A bulk/sync operation stops being a scary, opaque, irreversible event and becomes a
**reviewable, non-stigmatising, reversible** one. This is the cahier's information→action contract applied
to interop: every reconciliation decision is explainable (what, why, from which source) and leads to a next
step (apply, skip, roll back, re-run).

**The one new architectural decision** = *async import/sync execution + idempotent reconciliation* — a third
BullMQ queue (the platform deliberately runs only two today: `exports`, `notifications-email`) plus the
reconciliation contract that guarantees re-running a sync converges instead of duplicating. This is a
genuine tripwire → **`docs/adr/ADR-024-async-import-sync-and-idempotent-reconciliation.md`** (ADR-023 is
confirmed last on disk, so 024 is next-free).

## 2. Users & jobs-to-be-done

| Persona | Portal | Job-to-be-done |
|---|---|---|
| **School admin** (onboarding) | `/admin` | "Import 800 students from our old tool without the page freezing or timing out, and **see exactly what happened** before I trust it." |
| **School admin** (steady state) | `/admin` | "Keep our roster in sync with the district's OneRoster source **without re-creating duplicates** every term, and review what changed each time." |
| **Super admin / IT** | `/admin` | "Connect a OneRoster source once, run it on demand, and have a **safe, reversible** reconciliation I can audit." |

E11 lives **entirely inside the existing `/admin` portal**. No parent/teacher/student surface changes; no
new portal, no new token ramp. (The downstream beneficiary is still the parent — a clean, deduplicated
roster is what makes the parent dashboard's five-questions promise hold — but E11 ships no parent UI.)

## 3. Scenarios (end-to-end, demoable)

**S-A — Async apply, calm progress.** Admin validates a 2 000-row student CSV (the existing
upload→validate path, unchanged). On the preview screen they click **Appliquer** → instead of a frozen
request, the batch goes to `queued`, the admin lands on the batch detail page, and a **live progress strip**
ticks `applied / skipped` upward as the worker drains. On completion the **reconciliation summary** shows
`created / updated / unchanged / skipped`, each drillable to the rows. The 24h rollback is offered exactly as
today.

**S-B — OneRoster sync, idempotent.** Admin opens **Intégrations → OneRoster**, connects a source (CSV
bundle upload or a REST base-URL + key), and clicks **Synchroniser**. The worker pulls the roster, maps it
to the school's structure, and produces a reconciliation plan: *N students to create, M to update, K
unchanged, J conflicts to review*. The admin reviews the plan, applies it, and the same reconciliation
summary appears. **Re-running the sync the next day converges** — the unchanged rows stay unchanged, no
duplicate students are created (the idempotency contract).

**S-C — Conflict, kindly surfaced.** A OneRoster row matches an existing student by `externalRef` but the
name differs. The reconciliation panel marks it `conflict` (amber, **never** red/danger), shows the
source value vs the current value side-by-side, and lets the admin choose *keep current* or *take source*.
No silent overwrite of children's data; every decision is audited.

**S-D — Reversible.** An admin applies a sync, then realises a mapping was wrong. Within 24h they click
**Annuler** on the run; the worker compensates exactly as the import rollback does today (reverse-order
per-row compensation, `rolled_back` status, audit row). The scary operation was reversible.

## 4. Acceptance criteria (epic-level — refined per slice in `tasks.md`)

- **AC-1 (async, no behaviour regression).** `apply` no longer runs the write transaction in-request: the
  validated batch is enqueued to a **third BullMQ queue** and drained by the worker. The apply result
  (created/updated/skipped counts, per-row `createdEntityId`, audit row, batch status machine) is
  **byte-equivalent** to today's in-request outcome for the same input. The synchronous path is removed,
  not merely shadowed.
- **AC-2 (calm progress, never a frozen request).** The admin never waits on a long-held request to apply.
  The batch detail page reflects `queued → applying → applied|failed` and shows live `applied/skipped`
  progress; a page reload mid-run shows accurate intermediate state (the worker writes progress to the
  batch row, the UI polls).
- **AC-3 (reconciliation summary, explainable).** Every async import **and** every OneRoster sync produces a
  summary classifying each row as exactly one of `created | updated | unchanged | conflict | skipped`, each
  drillable to the source vs target values and the reason. No bucket is a silent black box.
- **AC-4 (idempotent reconciliation).** Re-running the same OneRoster sync against an unchanged source
  produces **zero** `created`, **zero** duplicate entities — only `unchanged` (and `updated` only where the
  source genuinely changed). The match key (`externalRef` first, then a deterministic natural key) is the
  idempotency anchor; an interrupted/retried worker job converges, never double-applies (BullMQ at-least-once
  ⇒ the reconciliation write must be idempotent per row).
- **AC-5 (reversible).** An applied async run (import or sync) is roll-back-able within 24h with the same
  reverse-order compensation + `rolled_back` status + audit as ADR-017's import rollback.
- **AC-6 (tenant + audit + permission, non-negotiable).** Every read/write is `tenant_id`-scoped; every
  apply/sync/rollback writes an append-only `AuditLog` row; the admin import surface stays on
  `imports.execute`, the OneRoster surface rides the **existing** `integrations.write` permission (admin
  already holds it — **no new permission**); no children's data crosses tenants or is exposed beyond the
  reconciliation panel.
- **AC-7 (kind, non-stigmatising UX, WCAG 2.2 AA).** A failed row, a conflict, a no-match are **factual and
  reversible**, never blame: amber `conflict`/`warning`, neutral `unchanged`/`skipped`, success `created`/
  `updated`, destructive red reserved for genuine failure only. Reuse `@pilotage/ui`; status carries
  text+icon (not colour alone); ≥44px targets; focus-trapped drawers; `role=status` live region on progress
  and results.
- **AC-8 (no second-queue surprise, ADR-gated).** The third queue + reconciliation contract land **with**
  `ADR-024`; no other off-convention pattern is introduced (no new datastore, no websocket, no LTI launch
  runtime, no payments).

## 5. Non-goals (hard)

- **No LTI launch/runtime/grade-passback.** The epic title names LTI as the *standards umbrella*; E11 ships
  **OneRoster roster-sync only**. An LTI 1.3 tool/launch is explicitly out of scope (recorded as a future
  epic seed) — it needs an OIDC launch dance, a deep-linking surface and grade-passback that dwarf this
  epic. Naming it here prevents scope creep.
- **No new product capability for parents/teachers/students.** No new dashboard, no new portal, no new token
  ramp. E11 is an **admin onboarding/interop** epic; its value reaches the parent only indirectly (a clean
  roster).
- **No second datastore, no websocket, no real-time push.** Progress is **poll-based** (the import-detail
  page already polls; reuse that), not SSE/WebSocket — consistent with the platform's deliberate simplicity.
- **No payments / no SIS write-back.** OneRoster is **read-from-source** into Pilotage; Pilotage never writes
  back to the SIS. (Finance stays parked — E12/ADR-018.)
- **No schema explosion.** Reuse `ImportBatch`/`ImportRow`/their enums as the substrate where possible; add
  the **minimum** additive schema for the sync source + reconciliation classification (named in
  `data-model.md`). No rename/removal of existing columns/enums.
- **No new Keycloak role, no new realm/client.** Admin-only, existing permissions.
- **No build/rebuild in any slice** (routine constraint).

## 6. Reuse map (build on what exists — verified on disk)

| Need | Reuse |
|---|---|
| Batch/row substrate + status machine + rollback | `ImportBatch` / `ImportRow` + `ImportStatus` / `ImportRowStatus` (Prisma) — ADR-017 |
| Validation + per-type handlers | `apps/api/src/modules/imports/handlers/*` (`parseRow`/`validateRow`/`applyRow`/`rollbackRow`) — unchanged |
| Enqueue→worker→status pattern | `ExportsService.enqueue` + `ExportsProcessor` (BullMQ producer/consumer, `attempts`/`backoff`/`removeOn*`) |
| Worker cron/drain idiom | `apps/worker/src/modules/{analytics-snapshots,parent-digest}` |
| Admin import wizard + batch detail | `apps/web/src/app/admin/imports/**` (wizard, timeline, KPI cards, rows table, rollback block) |
| Admin permission for interop | **existing** `integrations.write` (admin-held; `permissions.constants.ts`) |
| UI primitives | `@pilotage/ui` (`PageHeader`, `KpiCard`, `StatusBadge`, `Timeline`, `ProgressBar`, `EmptyState`, `Drawer`/`FormDrawer`, `Pagination`) |
| Append-only audit | `AuditLog` rows on apply/sync/rollback (existing `import.apply` / `import.rollback` precedent) |

## 7. Slices (overview — full backlog in `tasks.md`)

- **S1** — Async import execution: third BullMQ queue + worker import processor + enqueue-on-apply + live
  progress on the batch detail page (→ **ADR-024**). `[schema?][worker][async]`
- **S2** — Reconciliation classification + the "Import & sync health" summary panel (created/updated/
  unchanged/conflict/skipped + per-row drill-down), reusing the batch detail surface. `[api][web][a11y]`
- **S3** — OneRoster source connect + pull + map-to-`ImportBatch` (CSV bundle first; REST base-url optional)
  on `integrations.write`. `[schema][api][integration]`
- **S4** — OneRoster idempotent reconciliation apply + 24h rollback + the sync-health panel reuse +
  conflict resolution. `[api][worker][web]`

Each slice is one shippable PR (DB + API + UI + worker as needed), demoable end-to-end. S1 is the
load-bearing architectural slice (it authors ADR-024 and proves the async spine on the *existing* import
path before OneRoster is layered on).
