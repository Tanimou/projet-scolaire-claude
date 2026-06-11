# E11 — Slice backlog (tasks)

> Shippable vertical slices for **E11 — Standards interop (OneRoster/LTI) + async imports**.
> Each slice = **one PR + one build**, demoable end-to-end (an admin can *do* the new thing). Ship
> **in order** (S1 → S4). The vision/users/scenarios/acceptance/non-goals live in [`spec.md`](./spec.md);
> the architecture posture in [`plan.md`](./plan.md); the additive schema in
> [`data-model.md`](./data-model.md); the screens + a11y targets in [`ux.md`](./ux.md); the API surface in
> [`contracts/openapi.yaml`](./contracts/openapi.yaml). Run status → [`PROGRESS.md`](./PROGRESS.md).

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc (4 slices).** **S1** is the load-bearing, ADR-bearing slice — it stands up the **third
> BullMQ queue** + the **worker `ImportsProcessor`**, moves **apply** off the request onto the worker
> (reusing the *existing* per-row handler contract — no forked apply engine), makes the apply **crash-safe
> and idempotent** (from-status-guarded claim + per-row resume), and authors **ADR-024**. After S1 the
> async spine *exists* and every import already applies without a request-held transaction. **S2** is the
> **visionary spine** — the reconciliation classification + the reusable **"Import & sync health" panel**
> (created/updated/unchanged/conflict/skipped + per-row drill-down + the 24h rollback one click away),
> landing on the *existing* import path. **S3** adds the **OneRoster source connect + pull + map-to-`ImportBatch`**
> so a sync becomes a normal validated batch (inheriting S1+S2 for free). **S4** closes the loop — the
> **idempotent sync apply + conflict resolution + 24h rollback + re-run convergence**. **S1/S2/S3 each carry
> an additive `db push`** (operator pre-req, the E7/E8/E9 precedent); **S4 adds no schema.**
>
> **ADR posture (Winston — authoritative):** **`ADR-024` IS authored on S1 (committed, not conditional).**
> Async execution of a **mutating, transactional, rollback-able** bulk operation on the worker — with an
> **idempotent, crash-safe reconciliation** (a retried/re-claimed job converges, never double-applies; a
> re-sync converges, never duplicates) on a **third BullMQ queue** — is a **net-new cross-cutting pattern**
> the project has not adopted (today's worker queues are read-only generators or fire-and-forget emails;
> none mutate domain entities transactionally). Project-context §3 requires it land **with** a new ADR →
> `docs/adr/ADR-024-async-import-sync-and-idempotent-reconciliation.md` (re-verify next-free after ADR-023
> — ADR-023 is the last on disk this run).
>
> **Permission posture (verified on disk):** CSV import keeps the existing **`imports.execute`**; the
> OneRoster interop surface rides the **existing admin-held `integrations.write`** permission
> (`permissions.constants.ts:112`/`:215` — **no new permission**). No parent/teacher/student ever holds it.

---

## [ ] S1 — Async import execution: 3rd queue + worker processor + enqueue-on-apply + ADR-024 · `[schema][worker][async]` · P1 · ~M

**Goal:** the async spine. Move `apply` (and `rollback`) off the HTTP request onto the worker via a **third
BullMQ queue**, reusing the **existing** per-row handler apply contract (no forked engine), made
**crash-safe + idempotent** by a from-status-guarded claim + per-row resume — and author **ADR-024**.
Demoable by applying a large validated batch: the apply call returns **instantly** (`queued`), the batch
detail page **polls** `queued → applying → applied|failed` with a live `applied/skipped` strip, and a
deliberately re-delivered job does **not** double-apply.

**Scope (`apps/api` + `apps/worker` + small `apps/web` + additive schema):**
- **Schema (additive `db push`):** `ImportStatus += queued` (data-model §1.1). FE status map adds one key.
  *(No other schema this slice — the live progress counter rides the existing `summary` Json, data-model §1.2.)*
- **Third queue (the ADR tripwire):** register `QUEUE_IMPORTS = 'imports'` in **both** the API producer
  (`apps/api/.../shared/queue/queue.module.ts`) and the worker
  (`apps/worker/.../shared/queue/queue.module.ts`), mirroring the `exports` wiring 1:1 (`attempts:3`,
  `backoff exponential`, `removeOnComplete/removeOnFail`). Add a new worker `ImportsModule` +
  `ImportsProcessor` (`@Processor(QUEUE_IMPORTS)`), the structural sibling of `ExportsProcessor`.
- **Enqueue on apply:** `ImportsService.apply()` stops running the `$transaction` in-request — it re-checks
  the `validated`/mode guards (unchanged), flips the batch `validated → queued` via a **from-status-guarded
  `updateMany`** (`WHERE status='validated'`; `count===0` ⇒ already claimed ⇒ idempotent no-op), enqueues
  `{ batchId, kind:'apply', mode, tenantId, schoolId, actorId }`, and returns the batch DTO in `queued`
  immediately (202-style). Same for `rollback` (enqueue `kind:'rollback'`; the **24h window is checked at
  enqueue**, rejecting past-window before queuing).
- **Worker applies (reuse, don't rewrite):** the apply loop that lives in `imports.service.ts` today is
  **relocated to a place both API (validate) and worker (apply) import** (a shared apply module, or the
  worker calls the moved logic) — **the exact same `handler.applyRow`/`rollbackRow` per row**, the same
  `$transaction`, the same `import.apply`/`import.rollback` audit, the same batch `applied|failed` + summary.
  **No second apply implementation.**
- **Crash-safe + idempotent (the ADR-024 core):** the worker claims `queued → applying` (from-status-guarded);
  on redelivery/re-claim it **resumes from `ImportRow.status`** (a row already `applied` with a
  `createdEntityId` is **skipped**, never re-applied); a stale `applying` batch past a lease window is
  reclaimable (the analytics-snapshots / E7-S5 reclaim precedent). Progress (`processedRows`/`applied`/
  `skipped`) is written incrementally to `summary` so a mid-run poll is accurate.
- **FE (small):** the batch-detail page (`apps/web/.../admin/imports/[id]`) replaces the blocking apply call
  with **enqueue → poll** (it already polls / `force-dynamic`); add a `queued|applying` live strip
  (`role=status`). No SSE.
- **ADR (COMMITTED):** author `docs/adr/ADR-024-async-import-sync-and-idempotent-reconciliation.md` (Winston
  gate) — the third queue, the from-status-guarded + lease-reclaimable status machine (crash-safe, no
  double-apply), the reuse-the-existing-`applyRow`-contract rule, and the rejected alternatives (SSE /
  distributed lock / Saga framework / second datastore / a forked apply engine). Re-verify the number.

**Acceptance:** AC-1, AC-2, AC-3, AC-4, AC-5, AC-10, AC-11 (spec.md — async apply/rollback, poll-to-terminal,
crash-safe idempotency, tenant+audit, reuse + ADR).

**Targeted tests (Murat P0):**
- **Byte-parity:** the worker apply produces the **same** created/skipped counts + per-row `createdEntityId`
  + audit as today's in-request apply for the same input (no drift from the relocation).
- **No double-apply on redelivery:** a re-delivered/re-claimed apply job does **not** re-apply already-`applied`
  rows; the batch converges to `applied|failed` exactly once.
- **Claim race:** two concurrent `validated → applying` claims → exactly one wins (`count===0` loser no-ops),
  never two workers applying the same batch.
- **24h window at enqueue:** a rollback past 24h is rejected **before** queuing (never a queued no-op job).

---

## [ ] S2 — Reconciliation classification + the "Import & sync health" panel (the visionary spine) · `[schema][api][web][a11y]` · P2 · ~M

**Goal:** turn the relocated apply into a **calm, auditable, reviewable** event — classify every applied row
as **created / updated / unchanged / conflict / skipped** and render the reusable **"Bilan d'import &
synchronisation"** panel (counts + per-row drill-down + the 24h rollback one click away), **non-stigmatising**.
Lands on the **existing** import path (no OneRoster yet) so **every** import becomes explainable. Demoable by
applying a batch with a mix of new + existing rows and watching the panel show the four buckets with per-row
"what changed / why skipped" drill-down.

**Scope (`apps/api` + `apps/web` + `packages/ui` if shared + additive schema):**
- **Schema (additive `db push`):** `ReconciliationClass` enum (`created/updated/unchanged/conflict/skipped`)
  + `ImportRow.reconciliation ReconciliationClass?` + `ImportRow.conflictFields Json?` +
  `@@index([batchId, reconciliation])` (data-model §2.1). The batch-level roll-up rides the existing
  `summary` Json (**no batch column**).
- **Classify on apply:** the handler `applyRow` result is extended to **report which class it took**
  (`created|updated|unchanged`; a skipped/invalid row → `skipped`; a matched-but-protected-field-disagrees
  row → `conflict`, recorded in `conflictFields` as `[{ field, current, source }]`). The worker records the
  per-row `reconciliation` + rolls the counts into `summary`. The match key is the **`externalRef`-first,
  then deterministic natural key** anchor the handlers already cache (`buildCaches`) — making a re-run
  `unchanged`, never a duplicate `created`.
- **The panel (reuse-first):** one **"Import & sync health"** component over the existing batch-detail KPI
  cards + rows table, **re-bucketed by reconciliation class**, with a **per-row drill-down** (which entity,
  which field, why — source-vs-current for conflicts, rendered from `conflictFields`, no second query). The
  existing **24h rollback** block stays one click away. **Non-stigmatising:** success emerald/blue
  (created/updated), neutral slate (unchanged), amber warning (conflict/skipped) — **destructive red reserved
  for genuine `failed` only**; status carries **text + icon** (not colour alone); `role=status` live region.
- **Reuse + shared-UI:** reuse `@pilotage/ui` (`KpiCard`/`StatusBadge`/`Timeline`/rows table/`Drawer`); a
  genuinely-shared fix lands in `packages/ui` (the E3-S3 hardened `Drawer` precedent).

**Acceptance:** AC-6, AC-10, AC-11 (spec.md — reconciliation panel, tenant+audit, reuse).

**Targeted tests (Murat P0):**
- A batch with new + pre-existing rows classifies them `created` vs `updated`/`unchanged` correctly; counts
  roll up into `summary`.
- A protected-field disagreement is classified `conflict` (with `conflictFields`), **not** silently
  overwritten.
- The panel reads **one aggregate batch** (no client N+1); the per-row drill-down renders from the row
  payload (no extra round-trip).

---

## [ ] S3 — OneRoster source: connect + pull + map-to-`ImportBatch` · `[schema][api][integration]` · P2 · ~M

**Goal:** let an admin **connect a OneRoster source** and **pull + map** its roster into a normal validated
`ImportBatch` — so a sync inherits S1's async apply + S2's reconciliation panel **for free**. v1 = a
**OneRoster CSV bundle** upload (CSV-bundle first; a REST base-url + bearer key is the optional stretch).
Demoable by connecting a source, clicking "Synchroniser", and landing on a normal `origin=oneroster`
`ImportBatch` in `validated` with the preview/reconciliation surface populated.

**Scope (`apps/api` + small `apps/web` + additive schema):**
- **Schema (additive `db push`):** `RosterSourceKind` (`oneroster_csv`/`oneroster_rest`) + `RosterSyncStatus`
  (`idle/pulling/mapped/failed`) + `ImportOrigin` (`csv_upload`/`oneroster`) enums + the `RosterSource` model
  (tenant+school scoped, `label`, `baseUrl?`, opaque `credentialRef?` — **never raw plaintext, never returned
  to the client**, `lastSyncAt`/`lastBatchId`) + additive `ImportBatch.origin ImportOrigin? @default(csv_upload)`
  + `ImportBatch.rosterSourceId String?` (data-model §3/§4). Nullable+defaulted ⇒ existing batches read
  `csv_upload`, zero behaviour change.
- **Connect (admin, `integrations.write`):** `POST /integrations/oneroster` (create a `RosterSource`),
  `GET /integrations/oneroster` (list), tenant+school scoped, append-only audit. Credential handling:
  store/resolve an **opaque ref** server-side at pull time only (Sentinel gate).
- **Pull + map (the OneRoster adapter):** `POST /integrations/oneroster/:id/sync` pulls the source (CSV
  bundle parse first; REST paged pull optional), **maps each OneRoster entity** (`orgs`/`academicSessions`/
  `courses`/`classes`/`users`/`enrollments`) onto the **existing `ImportRow` payload shape** for the matching
  `ImportType`, reusing the type handlers' `validateRow`, and creates an `ImportBatch` of `origin=oneroster`
  in `validated`. **Roster identity + enrollment only** (RGPD minimal-data — no grades/attendance/medical/
  guardian-private). Respect the existing `MAX_ROWS` (5 000) guard; a partial/failed pull is a `failed`
  pull, **never** a corrupt apply. Idempotency anchor = the OneRoster **`sourcedId`** carried in
  `externalRef`.
- **FE (small):** an `/admin/integrations` (or `/admin/imports` interop tab) surface to create a source +
  "Synchroniser" → lands on the produced batch's detail/health surface (reuse). Graceful "indisponible"
  degrade when the additive schema isn't applied yet.

**Acceptance:** AC-7 (ingest through the same pipeline), AC-9 (interop authority on `integrations.write`),
AC-10 (tenant+audit+RGPD), AC-11 (reuse) (spec.md).

**Targeted tests (Murat P0):**
- A mapped OneRoster bundle produces a `validated` `ImportBatch` whose rows pass the **same** type
  `validateRow` an equivalent CSV upload would.
- The credential is **never** returned to the client / stored in plaintext.
- A non-admin (no `integrations.write`) gets **403** on connect/sync.
- Mapping reads **only** roster identity + enrollment fields (no grades/medical leak).

---

## [ ] S4 — Idempotent sync apply + conflict resolution + 24h rollback + re-run convergence · `[api][worker][web]` · P2 · ~M

**Goal:** close the interop loop — apply a OneRoster-origin batch through the S1 spine, classify via S2,
let the admin **resolve conflicts** (keep current / take source, audited — never a silent overwrite of a
child's data), offer the **24h rollback**, and prove **re-running the sync converges** (0 created on the
second run, no duplicates). **No schema (reuses S1–S3).** Demoable by applying a sync, re-running it and
watching it converge to `unchanged`, resolving a conflict, and rolling a sync back within 24h.

**Scope (`apps/api` + `apps/worker` + `apps/web`, no schema):**
- **Sync apply (reuse the spine):** the `origin=oneroster` batch applies through the **S1 async worker
  apply** + the **S2 reconciliation classification** with **zero new execution/reconciliation code** — it is
  the same validated batch. The append-only audit gains `import.sync.apply`.
- **Idempotent convergence (the ADR-024 invariant):** re-syncing the **same** source **converges** — every
  roster entity matched by `sourcedId`/`externalRef` is **updated or left `unchanged`, never inserted again**
  (`0 created` on the second run). A SIS-side **delete** surfaces as a **conflict / "à vérifier"** (a soft
  divergence the admin reviews) — **never** an automatic destructive delete.
- **Conflict resolution (admin choice, audited):** a `conflict` row **blocks auto-apply** of that row; the
  admin chooses **keep current** or **take source** in the panel's conflict drawer (focus-trapped, the E3-S3
  `Drawer`); the choice is recorded `import.conflict.resolve` (append-only). No silent overwrite.
- **24h rollback (reuse S1):** a OneRoster-origin applied batch is roll-back-able within 24h via the **same**
  reverse-order `rollbackRow` compensation + `rolled_back` status + `import.rollback` audit as a CSV import.
- **FE:** the sync-health panel (the S2 component, reused) renders the OneRoster batch with its `origin`
  header; the conflict drawer + "Synchroniser à nouveau" / "Annuler la synchronisation" actions.

**Acceptance:** AC-7, AC-8 (idempotent convergence), AC-10, AC-11 (spec.md). **On land → `E11` is `shipped`.**

**Targeted tests (Murat P0):**
- **Convergence:** running the same sync twice yields **0 created** on the second run; **no** duplicate
  child/teacher/class.
- A SIS-side delete → **conflict / "à vérifier"**, never an auto-delete.
- A conflict-resolution choice is audited; "keep current" leaves the entity untouched, "take source" updates
  it (and is reversible via rollback).
- A synced batch rolls back within 24h (reverse-order compensation, `rolled_back`).

---

## Cross-artifact reconciliation ledger (PM rulings — read before implementing)

| # | Divergence | PM ruling (authoritative) | Fix where |
|---|---|---|---|
| R1 | New `interop.sync` permission vs reuse existing `integrations.write` | **Reuse the existing admin-held `integrations.write`** (verified `permissions.constants.ts:112`/`:215`) — no new permission; CSV import keeps `imports.execute`; no parent/teacher/student holds either (AC-9) | done (`spec.md`/`data-model.md`/`plan.md`) |
| R2 | LTI in v1 vs banner-only | **OneRoster roster-sync only**; a working **LTI 1.3 launch/runtime/grade-passback** is a hard **Non-goal** (recorded future epic seed) — naming it prevents scope creep | done (`spec.md` Non-goals) |
| R3 | OneRoster REST client vs CSV bundle | **CSV bundle first** (maps cleanly onto the existing CSV substrate); a **live REST client / OAuth** is an **optional stretch in S3 / recorded follow-on**, the `RosterSource` model admits it without a rewrite | done (`plan.md` §4 / `data-model.md` §3) |
| R4 | Forked worker apply vs reuse the handler contract | **Reuse the existing `applyRow`/`rollbackRow` contract** — relocate the apply logic so API (validate) + worker (apply) share **one** implementation; a **byte-parity test** guards no drift (AC-1/AC-11) | S1 |
| R5 | SSE/WebSocket progress vs poll | **Poll** (the batch-detail page already polls; the house pattern, E4) — **no** SSE/WebSocket; ADR-024 records it rejected | done (`spec.md` Non-goals / `plan.md` §2) |
| R6 | Auto-delete on SIS removal vs soft conflict | **Soft conflict / "à vérifier"** — E11 **never** auto-destructively-deletes a child/entity on a sync diff; destructive reconciliation is a deliberate later decision behind explicit admin confirmation (AC-8) | S4 |
| R7 | Reconciliation classes (`status` overload) | **Orthogonal** — `ImportRowStatus` answers *did the pipeline process it*; the new `ReconciliationClass` answers *what did the upsert do* (`created/updated/unchanged/conflict/skipped`). Don't overload the existing status enum the wizard/rollback depend on | done (`data-model.md` §2.1) |
| R8 | ADR-024 committed vs conditional | **ADR-024 IS authored on S1 (committed)** — the third queue + async mutating-worker execution + idempotent reconciliation is the one new architectural decision (project-context §3). Re-verify next-free after ADR-023 | S1 |
| R9 | Slice count: 4 | **4 slices** (S1 async spine+ADR · S2 reconciliation panel · S3 OneRoster connect+pull+map · S4 sync apply+conflict+rollback+convergence); `spec.md`/`plan.md`/`PROGRESS.md` agree | done |

## Out of scope (recorded — see `spec.md` Non-goals)

- No LTI launch/runtime/grade-passback (banner-only; future epic seed).
- No live OneRoster REST client/OAuth in v1 (CSV bundle first; REST an optional stretch / recorded follow-on).
- No new apply engine / no forked business logic (reuse the handler contract; one apply implementation).
- No second datastore, no Redis-lock/Saga framework, no SSE/WebSocket (3rd BullMQ queue + DB status machine).
- No auto-delete of children/entities on sync (soft conflict / "à vérifier").
- No new permission (reuse `integrations.write` + `imports.execute`), no new Keycloak role/realm/client.
- No parent/teacher/student import or sync surface; no cross-tenant import; admin-only.
- No new grades/attendance ingest semantics (OneRoster v1 = roster identity + enrollment only; no AGS).
- No payments / no SIS write-back (Pilotage reads from the source, never writes back; finance stays parked).
- No build/rebuild in any slice (project-context §4); each schema slice's `db push` is an operator pre-req.
