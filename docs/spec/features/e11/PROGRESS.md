# E11 — Progress

> Run status for **E11 — Standards interop (OneRoster/LTI) + async imports**. The spec-kit landed on the
> **epic-spec run** (docs-only). Slices ship one PR each on later runs; tick them here + in
> [`bmad/roadmap.md`](../../../../bmad/roadmap.md) on land. **Status legend:** `[ ]` not started ·
> `[~]` in progress · `[x]` shipped.

## Epic status: `shipped` (spec-kit landed; **S1 + S2 + S3 + S4 all shipped** — E11 complete)

> **Post-ship hardening #2 (2026-06-11, `polish` run — GREEN, invariant now HOLDS).** A
> `[worker][concurrency][imports][async][schema]` follow-up to the S1 async-import claim (processor + new
> `decideClaim` helper + 2 specs + **one additive nullable column** `ImportBatch.claimedAt`; no contract /
> permission / second-queue change). The S1 stale-`applying` reclaim was an **unconditional** re-admit
> (`updateMany WHERE status IN ('queued','applying')`), NOT the `claimedAt < now − IMPORTS_APPLY_STALE_MIN` lease
> ADR-024 §4 / FR6 specify — so a re-delivered / duplicate BullMQ job could double-admit a batch a
> **still-alive** worker was mid-`$transaction` on. **The fix makes the invariant genuinely hold (not merely
> narrow it):** the lease instant was promoted out of `summary` Json to a **typed `ImportBatch.claimedAt`
> scalar column**, so the apply + rollback claims (one shared `claim()` helper) issue a **single atomic
> claim+stamp** `updateMany` — `fresh` (`WHERE status='queued' SET status='applying', claimedAt=now`, the status
> flip elects one winner) or `reclaim` (`WHERE status='applying' AND claimedAt=<observed> SET claimedAt=now`, a
> compare-and-swap on the lease instant that elects one winner even though status stays `applying`). This
> **closes BOTH** prior residuals: (1) the claim-to-stamp TOCTOU (stamp is now atomic with the claim, no window)
> and (2) the non-single-winner `applying→applying` no-op (the CAS makes the loser's stale `claimedAt` miss →
> `count===0` skip). The progress flush heartbeats the `claimedAt` column so a long apply keeps its lease. Pinned
> by the pure `import-claim.spec.ts` **and** the processor-level `imports.processor.spec.ts` Murat requested
> (two concurrent stale re-deliveries ⇒ `applyBatchRows`/`rollbackBatchRows` invoked **exactly once**, loser
> `skipped`). ADR-024 carries the updated `## Stale-lease reclaim — implemented (polish — amendment)` section.
> **Gate:** `pnpm typecheck` 13/13 + `pnpm --filter @pilotage/worker --filter @pilotage/api build` exit 0 +
> `import*` specs 32/32 green. **Operator pre-req (gates demoability, not merge):** `prisma db push` for the
> additive `claimed_at` column (existing rows read `null` → reclaimed defensively, zero behaviour change).
>
> **Post-ship hardening #1 (2026-06-11, `polish` run — needs human review, NOT auto-merged).** A small
> `[security][auth][multi-tenant][abac]` follow-up on the S3 `IntegrationsService` (one file + its spec;
> **no schema / no contract / no permission change**). (1) **Tenant wall moved into the query** —
> `requireSource` now does `findFirst({ where: { id, tenantId } })` → 404, replacing the old
> `findUnique({ id })` + post-fetch `if (tenantId !== …) → 403` (ADR-002 "scope is the query, not a branch";
> closes the 403-vs-404 cross-tenant existence oracle; a foreign id now takes ZERO lifecycle side-effect —
> the `pulling` `updateMany` never fires). (2) **FR10 multi-school** — `sync` files the batch + validation
> caches + active-year resolution + SIS-delete divergence read under `source.schoolId` (re-validated by
> `forTenant`'s explicit-school arg, which can't widen access), NOT the actor's active/default school, so a
> multi-school admin who switched their active school can no longer mis-file a school-A roster (and its
> `externalRef` divergence read) under school-B. Plus a combined-total `ONEROSTER_MAX_ROWS` pre-commit guard
> (per-type caps could previously sum past the cap). `ForbiddenException` fully removed from both files.
> Tests updated to match (mock honours the `tenantId` predicate as Postgres would; cross-tenant `sync`/`getOne`
> now assert `NotFoundException` + the query-level wall + no `pulling` side-effect; combined over-cap; batch-
> follows-source). **This diff is uncommitted and has NOT been through the routine's typecheck/build gate or
> the Sentinel/Quinn/Murat lenses** — a human should commit it on a fresh `ci/*` branch, run `pnpm typecheck`
> once (the `ForbiddenException` import removal goes RED if any reference lingers), and confirm the still-
> pending S1–S4 operator pre-req (`prisma db push` + `prisma generate` + `pnpm build` of
> `@pilotage/imports-core/dist` + a worker draining the `imports` queue) is applied — until then this fix is
> correct-but-dormant.

**Mode of this run:** `epic-spec` — authored the kit, **no code / no schema / no build**. The bulk-import
pipeline exists but runs **in-request** (`imports.service.ts apply()`/`rollback()` are sync API methods,
verified); **zero** OneRoster/LTI code exists; the worker runs **2** BullMQ queues (`exports`,
`notifications-email`) and **no `imports` queue** (verified). Moving imports async is the one architectural
tripwire → **ADR-024** (ADR-023 confirmed last on disk → 024 next-free).

## Spec-kit (this run)

- [x] `spec.md` — vision · users · 8 scenarios · 12 FRs · 11 ACs · non-goals · reuse map.
- [x] `plan.md` — async spine, reconciliation contract, OneRoster surface, sequencing, pre-mortem, gates.
- [x] `data-model.md` — additive only: `ImportStatus += queued`; `ReconciliationClass` + `ImportRow.reconciliation`/`conflictFields`; `RosterSource` + `ImportOrigin` + `ImportBatch.origin`/`rosterSourceId`. No destructive migration.
- [x] `contracts/openapi.yaml` — the import (async apply/rollback/poll) + OneRoster (connect/sync) surface.
- [x] `ux.md` — the calm/auditable/reversible panel + interop surface; WCAG 2.2 AA checklist.
- [x] `tasks.md` — the S1→S4 slice backlog + the PM reconciliation ledger.
- [x] `quickstart.md` — run & demo each slice against the running stack.
- [x] `PROGRESS.md` — this file.

## Slices

- [x] **S1** — Async import execution: 3rd BullMQ queue (`imports`) + worker `ImportsProcessor` +
  enqueue-on-apply (reuse the existing `applyRow`/`rollbackRow` contract — no forked engine) + crash-safe
  idempotent (from-status-guarded claim + per-row resume) + **ADR-024**. `[schema][worker][async]` · P1.
  *Additive `db push`: `ImportStatus += queued`.* **Shipped (needs human review — RED gate: needs
  `pnpm install`+`pnpm build` for the new `@pilotage/imports-core` workspace package; not auto-merged).**
  The apply engine + 5 handlers + `applyRow`/`rollbackRow` + caches are **relocated** into a new
  `packages/imports-core` workspace package (`main → dist`, the `@pilotage/contracts` precedent), so the
  API (validate) and worker (apply) share ONE byte-for-byte implementation — the API's `handlers/index.ts`
  + `handler.types.ts` become thin re-exports. `ImportsService.apply()`/`rollback()` flip the batch
  `validated → queued` / `applied → queued` via a from-status-guarded `updateMany` then enqueue on the
  third `imports` queue (enqueue-failure compensation reverts the claim; the 24h rollback window is
  checked *at enqueue*). The worker `ImportsProcessor` claims `queued|applying → applying`, runs the
  relocated engine in one atomic `$transaction`, and the per-row RESUME skips already-`applied` rows
  (no double-apply). A new `ImportStatusPoller` (`router.refresh()` on a 2.5 s interval, stops on
  terminal status — the E6-S4 discipline) keeps the detail page live across the async transition.
  `ImportStatus += queued` (additive). **Operator pre-req (gates demoability, not merge):** `pnpm install`
  + `pnpm build` (produce `packages/imports-core/dist`), `prisma db push` for the `queued` enum value,
  and a worker running with the `imports` queue registered.
- [x] **S2** — Reconciliation classification (`created/updated/unchanged/conflict/skipped`) + the
  "Import & sync health" panel (counts + per-row drill-down + 24h rollback), non-stigmatising.
  `[schema][api][web][a11y]` · P2 (gated **P1**). *Additive `db push`: `ReconciliationClass` +
  `ImportRow.reconciliation`/`conflictFields` + `@@index([batchId, reconciliation])`.* **Shipped — GREEN,
  auto-merged. The two blocker/safety items the verify panel flagged were resolved in the orchestrator's land
  pass (ADR-024 reconciliation amendment landed WITH this slice; the load-bearing matched-row rollback-exclusion
  test was added) → no open blocker remained at merge.**
  The externalRef match is **no longer a hard `invalid` reject** — `studentsHandler.applyRow` (in the relocated
  `@pilotage/imports-core`) takes the idempotent match path: identical identity → `unchanged` (no write); a
  **protected-field** (firstName/lastName/birthDate) disagreement → `conflict` recorded in
  `ImportRow.conflictFields` with **NO write** (FR4 RGPD no-silent-overwrite wall); an email/notes-only diff →
  `updated`. The engine rolls a `byClass` tally into the existing `summary` Json + `import.apply` audit `after`
  (no new column/audit action; `applied`/`skipped` byte-identical), re-tallying an already-`applied` row from its
  stored class on RESUME (FM-2/FM-10). **The load-bearing safety fix:** matched (`updated`/`unchanged`) rows now
  carry `createdEntityId = a PRE-EXISTING student`, so `rollbackBatchRows` was rewritten to compensate **ONLY
  rows this import actually created** (`reconciliation == null` legacy/byte-parity OR `=== created`) — matched
  rows are flipped to `rolled_back` for bookkeeping but the entity is **never `deleteMany`'d**, closing an
  irreversible cascade-delete of a real child's enrollments/grades/guardianships that the advertised 24h
  rollback would otherwise trigger after an idempotent re-import. The worker carries `reconciliation` into BOTH
  the apply (re-tally) and rollback (exclusion data) `engineRows` maps. FE = the non-stigmatising "Bilan
  d'import & synchronisation" panel (5 KPI cards, `conflict`/`skipped` = amber "À examiner", red reserved) +
  a `?reconciliation=` row facet deep-linking the conflict filter + a per-row source-vs-current `ConflictDiff`,
  degrading to **no panel** pre-migration. **RED gate (fixed in-flight):** 8 typecheck errors — the stale-
  Prisma-client pattern (schema added the enum/columns but `prisma generate` was never run) + one
  `ReconciliationTally` JSON-assignability fix (index signature) → `pnpm typecheck` 13/13 GREEN.
  **Operator pre-req (gates demoability, not merge):** `prisma generate` + the additive `prisma db push`
  (enum + 2 columns + index), then `pnpm build` (`packages/imports-core/dist`).
  **Resolved in the land pass:** (1) **ADR drift — FIXED** — ADR-024 now carries a
  `## Reconciliation classification (E11-S2 — amendment)` section (the 5-class taxonomy, the externalRef-first
  idempotency anchor, the protected-field `{firstName,lastName,birthDate}` allow-list + no-silent-overwrite
  wall, the `byClass` roll-up, the rollback delete-only-what-we-created invariant, the `all_or_nothing`
  shift), so the cited "§reconciliation" reference now resolves. (2) **Rollback safety test — ADDED** — the
  matched-row rollback exclusion is now pinned by `imports-engine.spec.ts` ("SAFETY … rollback compensates
  ONLY rows this import CREATED"): an `updated`/`unchanged` row is flipped to `rolled_back` WITHOUT
  `rollbackRow` being invoked, only `created`/legacy-null rows are compensated.
  **Carried to S-hardening (non-blocking):** (3) `all_or_nothing` no longer guarantees true
  all-or-nothing — a worker-discovered `conflict` leaves a row unapplied yet the batch finalizes `applied`
  (intended: deferred to S4 arbitration; confirm acceptable). (4) Minor copy/a11y polish carried to
  S-hardening: panel missing `role=status` (the S1 `LiveProgressStrip` live region has unmounted by the time
  the panel renders, so no announcement); rows-table `th` missing `scope=col`; `updated` rows carry no
  `conflictFields` so the FE diff branch is dead for them; guardians still default to `created`.
- [x] **S3** — OneRoster source connect + pull + map-to-`ImportBatch` (CSV bundle first; REST stretch) on
  `integrations.write`. `[schema][api][integration]` · P2. *Additive `db push`: `ImportOrigin`/`RosterSourceKind`/
  `RosterSyncStatus` enums + `RosterSource` model + `ImportBatch.origin`/`rosterSourceId`.* **Shipped.**
  A new `IntegrationsModule` (`/api/v1/integrations/oneroster`) on the EXISTING admin-held `integrations.write`
  (no new permission): `POST` connect (create a tenant+school-scoped `RosterSource`), `GET`/`GET :id` list, and
  `POST :id/sync` which pulls a OneRoster v1.1 **CSV bundle** (uploaded in the request body), maps it via the
  pure `oneroster.adapter.ts` onto the EXISTING `ImportRow` raw-row shape per `ImportType`
  (`users`→students, `classes`→classes, `enrollments`→enrollments — **roster identity + enrollment only**, RGPD-
  minimal, no birthDate/grades/medical), and produces one **`validated` `ImportBatch(origin=oneroster)`** per
  mapped type — reusing each handler's `parseRow`/`validateRow` byte-for-byte (no forked validation), so the
  sync inherits the **S1 async apply + S2 reconciliation panel for free** (the worker reads neither `origin`
  nor `rosterSourceId`). The OneRoster `sourcedId` is carried into `externalRef` as the **idempotency anchor**
  (S4 convergence). `MAX_ROWS` (5000) enforced per type; a too-large/empty pull is a `failed` pull, never a
  corrupt apply. **Credential handling (Sentinel):** `RosterSource.credentialRef` stores an **opaque
  server-side ref only** — never plaintext, **never returned** (the DTO exposes `hasCredential: boolean`).
  Append-only `import.sync.connect`/`import.sync.pull` audit, tenant-scoped on every read/write. FE = a new
  `/admin/integrations` surface (server page + `IntegrationsManager` client island: connect FormDrawer, source
  cards with status badges, a sync FormDrawer that file-loads the bundle and **navigates to the produced
  batch's health/detail surface** on success), a "OneRoster" origin badge on the batch detail header, and a new
  "Intégrations" admin sidebar item — degrading kindly to "indisponible" pre-migration. ADR-024 carries an
  `## OneRoster source connect + pull + map (E11-S3 — amendment)` section. *Targeted test:
  `oneroster.adapter.spec.ts` (Murat P0 — mapped rows pass the SAME `validateRow`; sourcedId→externalRef anchor;
  RGPD-min fields; non-student/soft-deleted rows skipped).* **Operator pre-req (gates demoability, not merge):**
  the additive `prisma db push` (3 enums + `RosterSource` + 2 `ImportBatch` columns) + `prisma generate`, then
  `pnpm build` (`@pilotage/imports-core` already built from S1).
- [x] **S4** — Idempotent sync apply + conflict resolution + 24h rollback + re-run convergence. No schema.
  `[api][worker][web]` · P2. **Shipped — `E11` is now `shipped` (all 4 slices landed).**
  Closes the interop loop with **zero new execution/reconciliation code**: an `origin=oneroster` batch applies
  through the **S1 async worker** (`applyBatchRows`) and is classified by the **S2 reconciliation taxonomy**
  exactly like a CSV import. Net-new is **admin conflict arbitration** + the proven **re-run convergence** + the
  **non-destructive SIS-delete** posture.
  - **Conflict resolution (admin choice, audited, in-request — not the queue):** a `conflict` row (protected-
    field disagreement on a matched student, recorded by S2 with `conflictFields` and **no write**) blocks
    auto-apply. The admin arbitrates in the panel's focus-trapped `Drawer` (E3-S3 hardened):
    **`POST /api/v1/imports/:id/conflicts/:rowId/resolve`** `{decision: keep_current | take_source}` on the
    existing **`imports.execute`** (no new permission). One in-request `$transaction`: the handler's new optional
    **`resolveConflict`** (only `studentsHandler` in v1; shared **`resolveRowConflict`** engine wrapper, no fork)
    re-resolves the matched student by `externalRef` (tenant-scoped) and applies the choice — `keep_current`
    writes **nothing** → `unchanged`; `take_source` is the **only** path that overwrites a protected field →
    `updated`. The row flips `conflict → applied` with `createdEntityId = the PRE-EXISTING entity` (so the S2
    rollback-safety invariant keeps it OUT of the delete set). A **from-status-guarded `updateMany`**
    (`WHERE reconciliation='conflict'`) makes a concurrent double-resolve a clean 400 (never a second overwrite);
    append-only **`import.conflict.resolve`** audit `{decision, entityId, reconciliation, fields}`; `summary.byClass`
    adjusted (`conflict−1`, chosen `+1`).
  - **Re-run convergence (AC-4):** re-syncing the same source yields **0 created** on the 2nd run, no duplicate
    child/teacher/class — the externalRef-first anchor + S1 per-row RESUME. Pinned by the students-handler
    convergence test.
  - **SIS-side delete (R6):** a student absent from a new pull is left **intact** (never auto-deleted); a
    `status=tobedeleted` source row is skipped by the adapter. Destructive reconciliation stays a deliberate
    future decision.
  - **24h rollback (reuse S1):** an `oneroster` applied batch rolls back within 24h via the **same** reverse-order
    `rollbackRow` + `rolled_back` + `import.rollback` audit; the FE copy reads "Annuler cette synchronisation"
    (provenance-aware). The §E rollback-safety invariant holds for syncs.
  - **FE:** the conflict-resolution island `ConflictResolver.tsx` replaces the S2 static "Voir les arbitrages"
    link — an amber "à arbitrer" strip listing each conflict row + a focus-trapped `FormDrawer` per row with a
    side-by-side source-vs-current table, a keyboard `radiogroup` (Garder l'actuel default / Prendre la source,
    arrow keys, ≥44px, `motion-reduce`), `role=status` toast, and the `resolveImportConflict` server action.
    Rollback block/button are origin-aware. **No schema, no new permission, no contract change.**
  - **Tests:** S4 cases in `apps/worker/.../imports-engine.spec.ts` — `resolveRowConflict` (keep-current no-write,
    take-source writes source, unsupported-handler rejects, vanished-entity throws not 500) + students-handler
    re-run convergence (`unchanged`, 0 created) + matched protected-field divergence → `conflict` (no silent
    overwrite). ADR-024 carries an `## Idempotent sync apply + conflict resolution + 24h rollback (E11-S4 —
    amendment)` section.

## Decisions locked (this run)

- **ADR-024 IS authored on S1 (committed).** Async mutating-worker execution + idempotent reconciliation on
  a **third BullMQ queue** = the one new architectural decision (project-context §3). Re-verify next-free
  after ADR-023 on the S1 run.
- **Reuse the existing `integrations.write` permission** for OneRoster (admin-held, verified
  `permissions.constants.ts:112`/`:215`) — **no new permission**; CSV import keeps `imports.execute`.
- **Reuse the existing `applyRow`/`rollbackRow` handler contract** — relocate the apply so API (validate) +
  worker (apply) share **one** implementation (byte-parity test, no drift).
- **OneRoster CSV bundle first**; live REST client / OAuth = optional S3 stretch / recorded follow-on.
- **LTI is banner-only** — a working LTI 1.3 launch/runtime/grade-passback is a hard **Non-goal** (future
  epic seed).
- **Poll, not SSE/WebSocket**; **no second datastore / Redis-lock / Saga framework**; **no auto-delete** on
  a SIS removal (soft conflict / "à vérifier").
- **All schema changes additive** (new enum values / nullable columns / new model) — no destructive
  migration; each slice's `db push` is an operator pre-req (gates demoability, not merge).

## Open questions — S1 resolutions + carry-overs

- **[resolved S1]** The relocated apply logic lives in a **new `packages/imports-core` workspace package**
  (`main → dist`, the `@pilotage/contracts` precedent); the API `handlers/index.ts`+`handler.types.ts` are
  thin re-exports, so API (validate) + worker (apply) share ONE implementation, no fork.
- **[resolved — polish run 2026-06-11]** The stale-`applying` reclaim was an **unconditional** re-admit
  (`status IN (queued, applying)`), NOT the `claimedAt < now - IMPORTS_APPLY_STALE_MIN` lease the ADR/FR6
  cite. **FIXED (worker-only, additive, no schema/permission/contract change):** the `ImportsProcessor`
  claim now reads the batch status + stamped `summary.claimedAt` first and routes through the pure
  `decideClaim` helper (`apps/worker/.../imports/import-claim.ts`) — `queued` is always claimable; an
  `applying` batch is re-admitted **only** when its claim is older than `IMPORTS_APPLY_STALE_MIN` (default
  15 min, env-overridable, mirroring the analytics-snapshots / E7-S5 `processedAt`-keyed reclaim) or its
  `claimedAt` is absent/unparseable (legacy/pre-hardening claim → reclaimed defensively). A re-delivered
  job can no longer double-admit a batch a **still-alive** worker holds the lease on; a genuinely dead
  worker's batch self-heals after the lease. The from-status-guarded `updateMany` is now keyed on the
  **observed** status (preserving the `count===0` lost-race no-op). Applied to BOTH the apply and rollback
  paths (one shared `claim()` helper; rollback's claim stamps its own fresh `claimedAt` so its lease isn't
  keyed on a stale apply timestamp). **The invariant now HOLDS, not merely narrowed:** the lease instant is a
  typed `ImportBatch.claimedAt` scalar column, so the claim is a **single atomic claim+stamp** `updateMany`
  (`fresh` = status flip; `reclaim` = compare-and-swap on the observed `claimedAt`), which closes BOTH the
  claim-to-stamp TOCTOU (stamp atomic with the claim) AND the non-single-winner `applying→applying` no-op (the
  CAS makes the loser miss). Pinned by `import-claim.spec.ts` (fresh→held, stale→reclaim, boundary, null→defensive
  reclaim, terminal→never) **and** the processor-level `imports.processor.spec.ts` Murat requested (two concurrent
  stale re-deliveries ⇒ engine invoked **exactly once**, loser `skipped`). **One additive nullable column
  (`claimed_at`), `db push`** — existing rows read `null` (reclaimed defensively, zero behaviour change); no
  contract/permission change. **This S1 carry-over is fully closed.**
- **[carry-over → S2/S4]** Whether the sync `syncing` state reuses `applying` semantics or earns its own
  additive status value (data-model leans on reuse; confirm on S3/S4).
- **[resolved S2 land pass]** ADR-024 cited a **"§reconciliation"** section that did not exist. **FIXED** — the
  amendment section `## Reconciliation classification (E11-S2 — amendment)` was added to
  `docs/adr/ADR-024-async-import-sync-and-idempotent-reconciliation.md`, documenting the 5-class taxonomy, the
  externalRef-first idempotency anchor, the protected-field allow-list + no-silent-overwrite wall, the
  `byClass` roll-up, the rollback safety invariant, and the `all_or_nothing` shift (project-context §3 met).
- **[resolved S2 land pass]** The matched-row rollback-exclusion (engine.ts ~L256-279, the
  `created = reconciliation == null || created` guard) — the single most safety-critical line, preventing
  irreversible cascade-deletion of a pre-existing child's record — now has its dedicated test in
  `apps/worker/.../imports-engine.spec.ts` ("SAFETY … rollback compensates ONLY rows this import CREATED"):
  an `updated`/`unchanged` row is flipped to `rolled_back` WITHOUT `handler.rollbackRow` being invoked.
- **[resolved S4]** `all_or_nothing` semantics: a worker-discovered `conflict` leaves the row unapplied yet the
  batch finalizes `applied`. **Confirmed acceptable** — S4 makes this intentional and complete: the `conflict`
  rows are surfaced "à arbitrer" in the health panel and the admin resolves each via the
  `POST /imports/:id/conflicts/:rowId/resolve` arbitration (keep-current/take-source, audited). The batch is
  `applied` because the bulk write succeeded; the conflicts are a separate, human, reversible decision — not a
  pipeline failure. No revert of the `all_or_nothing` shift.

## Operator note

The additive `db push` per S1/S2/S3 must be applied to dev/prod before each slice is demoable, and the
worker must run with the **third queue** registered (S1). The routine cannot run infra — surfaces degrade
kindly ("indisponible") until an operator applies the migration (the E7/E8/E9 precedent).
