# ADR-024 — Async import/sync execution on a third BullMQ queue + crash-safe, idempotent apply (status-guarded claim + per-row resume)

- **Status:** Accepted
- **Date:** 2026-06-11 · **Amended:** 2026-06-11 (E11-S2 — the reconciliation half, see
  [§ Reconciliation classification](#reconciliation-classification-e11-s2--amendment) below)
- **Epic / Slice:** E11 — Standards interop (OneRoster/LTI) + async imports · S1 (third `imports` queue +
  worker `ImportsProcessor` + enqueue-on-apply + crash-safe idempotent status machine + this ADR) · **S2**
  (the reconciliation classification taxonomy + the protected-field no-silent-overwrite wall + the
  rollback "delete-only-what-we-created" safety invariant — the amendment section below)
- **Deciders:** Winston (Architect), Amelia (BE), Murat (Test-Architect), Sentinel (Security)
- **Supersedes / relates:** ADR-017 (bulk import pipeline — this relocates its **apply/rollback** execution
  off the HTTP request onto the worker while reusing its per-row `applyRow`/`rollbackRow` handler contract
  byte-for-byte; the validate/preview half is unchanged), ADR-002 (multi-tenancy — every queue job carries
  `tenantId` and every worker query re-scopes; a job never crosses tenants), ADR-019 (analytics snapshots —
  the durable, from-status-guarded, lease-reclaimable dirty-queue idiom this ADR reuses for the apply claim),
  ADR-020 (booking concurrency — the same `updateMany` from-status guard for a deterministic single-winner
  claim under concurrency).

## Context

Bulk import (ADR-017) works but applies **synchronously inside the HTTP request**:
`ImportsService.apply()` is a single `await prisma.$transaction(…, { timeout: 60_000 })` on the API thread
(`apps/api/src/modules/imports/imports.service.ts`). A 2 000–5 000-row apply holds a request open for tens of
seconds, blocks the event loop, and dies on a gateway timeout — exactly when an admin is onboarding a whole
school. `rollback()` has the same shape. The platform already runs **two** BullMQ queues (`exports`,
`notifications-email`), but **both are non-mutating** in the domain sense: exports are read-only generators,
emails are fire-and-forget. **No worker queue today mutates domain entities transactionally**, and none is
**rollback-able** or required to be **idempotent under at-least-once redelivery**.

E11-S1 moves `apply`/`rollback` onto the worker. That introduces a genuinely new cross-cutting pattern —
async execution of a **mutating, transactional, rollback-able** bulk operation, which must converge (never
double-apply) when BullMQ redelivers a job or a worker dies mid-apply. Project-context §3 requires such a
decision to land **with** an ADR. ADR-023 is the last ADR on disk, so this is **ADR-024** (next-free).

## Decision

### 1. A third BullMQ queue `imports`, registered in both producer and consumer
`QUEUE_IMPORTS = 'imports'` is added to **both** `apps/api/.../shared/queue/queue.module.ts` (producer) and
`apps/worker/.../shared/queue/queue.module.ts` (consumer), mirroring the `exports` wiring 1:1
(`attempts: 3`, `backoff: exponential`, `removeOnComplete`/`removeOnFail`). A new worker `ImportsModule` +
`ImportsProcessor` (`@Processor(QUEUE_IMPORTS)`) is the structural sibling of `ExportsProcessor`. The job
payload is `{ batchId, kind: 'apply' | 'rollback', mode, tenantId, schoolId, actorId }`.

### 2. `apply`/`rollback` enqueue instead of executing in-request
- `ImportsService.apply()` re-checks the existing `validated` + mode guards (unchanged), then flips the batch
  `validated → queued` via a **from-status-guarded `updateMany`** (`WHERE id=… AND status='validated'`).
  `count === 0` ⇒ already claimed by a concurrent request ⇒ idempotent no-op (returns the current DTO; never
  a second enqueue). It enqueues the job and returns the batch DTO in `queued` immediately (202-style). The
  in-request `$transaction` is **removed**, not shadowed.
- `ImportsService.rollback()` checks the **24h window at enqueue** (reject past-window *before* queuing, so a
  stale rollback never becomes a queued no-op job), flips `applied → queued` (or a dedicated guard), and
  enqueues `kind: 'rollback'`.

### 3. The worker reuses the EXISTING per-row handler contract — one apply implementation, no fork
The apply/rollback loop is **relocated** so API (validate path) and worker (apply path) share **one**
implementation of `handler.applyRow` / `handler.rollbackRow` invocation, the same `$transaction`, the same
`import.apply` / `import.rollback` audit row, the same batch `applied|failed` + `summary` write. There is **no
second apply engine**. Because the worker runs in its own Nest application context with `rootDir: ./src`
(it cannot import `apps/api/src/**`), the relocation target is a **shared workspace package**
(`packages/imports-core`, the `@pilotage/contracts` precedent): the handler registry + `applyRow`/`rollbackRow`
+ the apply/rollback engine move there and both apps consume it. (The cheaper alternative — duplicate the
handlers under the worker tree with a "keep in sync" note, the `alerts-rules` precedent — is **rejected here**
because the import handlers are mutating and rollback-bearing; a silent drift between two copies could corrupt
or fail to compensate a child's record. A **byte-parity test** guards the single implementation regardless.)

### 4. Crash-safe + idempotent status machine (the core of this ADR)
- **Claim:** the worker flips `queued → applying` via a from-status-guarded `updateMany`
  (`WHERE id=… AND status IN ('queued','applying')`); a lost race claims 0 rows and the job exits — never two
  workers applying the same batch.
- **Per-row resume:** on redelivery / re-claim, the worker **resumes from `ImportRow.status`**. A row already
  `applied` **with a non-null `createdEntityId`** is **skipped, never re-applied**; only `valid` (not-yet-
  applied) rows are processed. This makes BullMQ at-least-once delivery safe: a re-delivered apply job
  converges the batch to `applied | failed` **exactly once**, with no duplicated entity.
- **Stale-lease reclaim:** an `applying` batch whose claim timestamp is older than a lease window
  (`IMPORTS_APPLY_STALE_MIN`, default mirrors the analytics-snapshots / E7-S5 `processedAt`-keyed reclaim) is
  reclaimable so a worker that died mid-apply never wedges the batch forever. The reclaim keys on the
  **claim instant**, not the enqueue instant (a long-queued-but-just-claimed batch is legitimately running).
- **Incremental progress:** `{ processedRows, totalToApply, applied, skipped }` is written to the existing
  `summary` Json as rows are applied, so a mid-run poll renders accurate intermediate state.

### 5. Poll, not push
The batch-detail page already polls (`force-dynamic`, `cache: 'no-store'`). S1 adds a `queued | applying`
live strip (`role=status`); the page re-fetches the batch DTO. **No SSE / WebSocket** (the house pattern, E4).

### 6. Schema: one additive enum value
`ImportStatus += queued` (between `validated` and `applying`). Additive — existing rows keep their value; the
FE status map adds one key. The live counter rides the existing `summary` Json (no new column). The `db push`
is an operator pre-req (gates demoability, not merge — the E7/E8/E9 precedent).

## Consequences

**Positive.** Apply/rollback never holds a request; the admin watches a calm, accurate, reloadable progress
view. A worker crash or a BullMQ redelivery converges instead of duplicating or corrupting. The apply outcome
(created/skipped counts, per-row `createdEntityId`, audit, batch status) is byte-equivalent to today's
in-request result (guarded by a parity test). One apply implementation, consumed by two apps. The third queue
is the only new infra primitive, and it mirrors the existing `exports` wiring exactly.

**Negative / trade-offs.** A real worker must run with the `imports` queue registered for apply to complete
(if the worker is down, batches sit in `queued` — the UI must surface this kindly, never claim "applied").
The relocation to a shared package is a one-time refactor of the handler tree (mitigated: pure handler
modules depending only on `@prisma/client` + `handler.types`). At-least-once delivery means the per-row resume
guard is load-bearing — its byte-parity + no-double-apply tests are P0.

## Alternatives considered (rejected)

- **Keep apply in-request, just raise the timeout / stream a chunked response.** Rejected — still blocks the
  event loop, still dies on a gateway/proxy timeout, no crash recovery.
- **SSE / WebSocket progress.** Rejected — the page already polls; a second realtime transport is off-pattern
  (project deliberately runs no websocket) for no user-visible gain at this scale.
- **A distributed lock (Redis SETNX) / a Saga framework.** Rejected — the DB from-status-guarded `updateMany`
  (ADR-019/ADR-020 idiom) already gives a deterministic single-winner claim with no extra dependency.
- **A second datastore / an outbox table for progress.** Rejected — the existing `summary` Json + the
  durable batch/row status carry all the state; no new table needed.
- **A forked worker apply engine (re-implement the apply loop in the worker).** Rejected (PM ruling R4) — the
  handlers are mutating and rollback-bearing; two copies risk corrupting or failing to compensate a child's
  data. One implementation in a shared package, guarded by a byte-parity test.
- **Duplicate the handlers under the worker tree (the `alerts-rules` precedent).** Rejected for *this* case
  (see Decision §3): the alerts rules are read-only detectors; import handlers mutate. A shared package is the
  safer home.

## Reconciliation classification (E11-S2 — amendment)

S1 made apply async + crash-safe. **S2 makes it _reconciled_** — every applied row reports *what the upsert
actually did*, so a re-import is a calm, auditable, reversible event rather than an opaque mutation. This
section is the authority the S2 schema/engine/handlers cite as "ADR-024 §reconciliation". It is an
**amendment, not a new ADR** (ADR-025): the title literally promises "idempotent reconciliation"; S2 spells
out the half S1 deferred. No new queue, permission, endpoint, or audit action is introduced.

### A. The `ReconciliationClass` taxonomy — orthogonal to `ImportRowStatus`
A new additive enum `ReconciliationClass { created · updated · unchanged · conflict · skipped }`, stored on
`ImportRow.reconciliation ReconciliationClass?` (nullable ⇒ legacy rows read `null`) + `ImportRow.conflictFields
Json?` + `@@index([batchId, reconciliation])`. The batch roll-up rides the existing `summary` Json
(`summary.byClass`) — **no batch column**.

The two axes are deliberately **orthogonal** (PM ruling R7): `ImportRowStatus` answers *did the pipeline
process this row* (`valid|invalid|applied|skipped|rolled_back`); `ReconciliationClass` answers *what did the
upsert do*. We do **not** overload the existing status enum the wizard/rollback depend on.

### B. externalRef-first idempotency (the AC-4 anchor)
The match key is **`externalRef` first, then the handler's deterministic natural key** (the cache the handlers
already build in `buildImportCaches`). Pre-S2, the students handler treated a matching `externalRef` as a hard
`invalid` **validation reject**; S2 reclassifies a match into:
- **`unchanged`** — every comparable field equals the stored value ⇒ **no write** (a re-run converges here, so
  re-importing the same CSV never produces a duplicate `created`);
- **`updated`** — only a **non-protected** field (`email`/`notes`) differs ⇒ update exactly those fields;
- **`conflict`** — a **protected** identity field disagrees (see C) ⇒ **no write**.
A no-match / no-`externalRef` row stays **`created`** (byte-parity insert).

### C. The protected-field allow-list — `conflict` blocks the write (no silent overwrite of a child's identity)
The protected allow-list is **`{ firstName, lastName, birthDate }`**. If a matched row disagrees on any of
these, the row is classified **`conflict`**, its `ImportRowStatus` stays **`valid`** (NOT `applied`), **no
entity is written or overwritten**, and the side-by-side diff is recorded in `conflictFields` as
`[{ field, current, source }]`. `conflictFields` is an **identity-field allow-list only** — it never serialises
`notes`/free-text/medical/guardian-private data, and it carries only the row's own payload-vs-current values
(it inherits the batch's tenant check; there is no row-level endpoint that bypasses it). **S2 surfaces the
conflict (amber "À examiner"); resolution (keep-current / take-source) is deferred to S4.** No silent overwrite
of children's data, ever.

### D. The additive `applyRow` contract (backward-compatible, byte-parity)
`AppliedEntity` gains **optional** `reconciliation?` + `conflictFields?`. A handler that returns the legacy
`{ id, type }` shape defaults to **`created`** — so the four always-create handlers (classes/subjects/
enrollments) and guardians compile and behave byte-identically (FR10/FM-3). Only the students handler emits the
rich classes in S2. The engine writes `reconciliation` **in the same `importRow.update` inside the apply
`$transaction`** as `status` (atomic — a crash never leaves an `applied` row with a `null` class, FM-2), and on
a RESUME re-tallies the stored class so `byClass` survives redelivery (FM-10). `applyBatchRows` returns an
additive `byClass` tally rolled into `summary.byClass` (one authoritative terminal write, FM-9) and the
existing `import.apply` audit row's `after` JSON — **no new audit action**.

### E. The rollback safety invariant (the load-bearing S2 fix — RGPD-significant)
S1's rollback deleted **every** `applied` row with a `createdEntityId`. That was safe *only because* a match
was a hard reject, so every applied+created row was one **this import created**. S2 breaks that premise: an
`updated`/`unchanged` row is now `applied` with `createdEntityId = existing.id`, a **pre-existing** matched
student. Deleting it on the advertised "safe" 24h rollback would cascade-wipe a real child's
enrollments/grades/guardianships/attendance/alerts (all `onDelete: Cascade` on `Student`).

**Invariant (enforced in `rollbackBatchRows`): rollback compensates ONLY rows this import actually CREATED** —
`reconciliation === created` **or** legacy `null` (pre-S2 rows + the always-create handlers). `updated`/
`unchanged` rows are flipped to `rolled_back` for status bookkeeping **without touching the pre-existing
entity** (S2 does not capture the prior `email`/`notes` to revert — leaving the matched entity intact is the
safe behaviour, a recorded non-goal). `conflict` rows never enter the set (no `createdEntityId`). This
invariant is the single most safety-critical line in the slice and is pinned by a dedicated engine test
(`imports-engine.spec.ts` — "rollback compensates ONLY rows this import CREATED").

### F. `all_or_nothing` semantics shift (recorded)
A `conflict` is discovered only **inside the worker** (after the enqueue-time `invalid`-row gate), leaves its
row unapplied, yet the batch still finalises **`applied`**. So once matching exists, `all_or_nothing` no longer
guarantees true all-or-nothing — a conflicting row is surfaced as "à arbitrer" rather than failing the whole
batch. This is deliberate (conflict resolution is an S4 admin decision, not an apply-time abort) and is the one
behavioural contract change S2 makes; it is recorded here for the reviewer rather than hidden.

### Rejected (reconciliation alternatives)
- **Overload `ImportRowStatus` with reconciliation values.** Rejected (R7) — the wizard/rollback depend on the
  existing status semantics; a second orthogonal axis is clearer and non-breaking.
- **Auto-resolve a `conflict` by taking the source ("source wins").** Rejected — silently overwriting a
  child's protected identity is exactly the failure this slice exists to prevent; resolution is an explicit,
  audited admin choice (S4).
- **Convert the four create-only handlers to upsert in S2.** Rejected (architect Option A) — that is a
  behaviour change to the ADR-017 validate contract across five mutating handlers; S2 ships the rich classes
  for `students` only and defers the rest to a later slice, keeping the blast radius honest.

## OneRoster source connect + pull + map (E11-S3 — amendment)

S1 made apply async; S2 made it reconciled. **S3 adds the first non-CSV-upload _origin_** — a connected
OneRoster source whose pull is **mapped onto the existing import substrate**, so a sync inherits the async
apply (S1) and the reconciliation panel (S2) **for free**. This is an **amendment, not a new ADR** (the title
promises "import/**sync**"): no new queue, no new permission, no new apply/reconciliation engine.

### A. A sync is just an `ImportBatch` — no parallel pipeline
The one architectural rule of S3: **a OneRoster pull PRODUCES a normal `validated` `ImportBatch`** (one per
applicable `ImportType`), never a second mutation path. The `RosterSource` model is **config + provenance
only**; the adapter maps the bundle onto the *existing* `ImportRow` raw-row shape and runs the *existing* type
handlers' `parseRow`/`validateRow` (no forked validation — the Murat P0 "same `validateRow`" test pins this).
The produced batch is indistinguishable from a CSV upload to the worker apply engine, which reads neither
`origin` nor `rosterSourceId`. So S4's "sync apply + 24h rollback + re-run convergence" is **zero new
execution/reconciliation code** — it is the same `applyBatchRows`/`rollbackBatchRows` + S2 classification.

### B. Additive schema (no rename/removal)
`enum ImportOrigin { csv_upload · oneroster }` + `ImportBatch.origin ImportOrigin? @default(csv_upload)` +
`ImportBatch.rosterSourceId String?` (nullable+defaulted ⇒ every existing batch reads `csv_upload`, zero
behaviour change); `enum RosterSourceKind { oneroster_csv · oneroster_rest }`, `enum RosterSyncStatus { idle ·
pulling · mapped · failed }`, and the tenant+school-scoped `RosterSource` model. Additive `db push` only.

### C. RGPD minimal-data + the idempotency anchor
The adapter maps **roster identity + enrollment ONLY** — `users.csv` (role=student → `students`),
`classes.csv` (→ `classes`), `enrollments.csv` (role=student → `enrollments`). It intentionally does **not**
read grades/attendance/medical, nor `birthDate` (which lives in the RGPD-sensitive OneRoster
`demographics.csv`). The OneRoster **`sourcedId` is carried verbatim into `externalRef`** — so it becomes the
S2 externalRef-first idempotency anchor, and a re-sync converges (`unchanged`/`updated`) instead of creating
duplicates (the AC-4 contract, proven in S4). `MAX_ROWS` (5 000) is enforced per produced type; a too-large or
empty pull is a **`failed` pull**, never a corrupt apply.

### D. Credentials — opaque ref, never returned (Sentinel gate)
`RosterSource.credentialRef` holds an **opaque server-side ref only** — the raw secret is never persisted in
plaintext and **never returned to the client** (the DTO exposes `hasCredential: boolean`, not the value). For
the CSV-bundle v1 the credential is unused (the bundle rides the sync request body); the field exists so the
recorded REST stretch (R3) needs no schema rewrite.

### E. Permission — reuse `integrations.write` (no new permission)
The connect/list/sync endpoints ride the **existing admin-held `integrations.write`** permission (R1) — no
parent/teacher/student ever holds it; CSV import keeps `imports.execute`. Every read/write is tenant-scoped
server-side; connect/pull write append-only `integration.roster_source.created`/`import.sync.pull` audit rows.

### Rejected (S3 alternatives)
- **A live OneRoster REST/OAuth client in v1.** Deferred (R3) — CSV bundle maps cleanly onto the existing
  substrate; the `RosterSource` model admits REST without a rewrite (the stretch is recorded, not built).
- **One multi-type `ImportBatch` for the whole bundle.** Rejected — `ImportBatch` is single-`type` by design
  (the handler/wizard/rollback all key on it); a sync produces one batch per applicable type, linked to the
  source, the admin landing on the students batch.
- **Auto-delete a student absent from the new pull.** Rejected (R6) — a SIS-side removal surfaces as a soft
  conflict / "à vérifier" in S4, never an automatic destructive delete of a child's record.

## Idempotent sync apply + conflict resolution + 24h rollback (E11-S4 — amendment)

S4 **closes the interop loop** and flips E11 to shipped. It adds **no schema** and **no new
execution/reconciliation engine** — an `origin=oneroster` batch applies through the S1 async worker
(`applyBatchRows`) and is classified by the S2 reconciliation taxonomy exactly like a CSV import (§A above).
S4's net-new is **admin conflict arbitration**, the proof of **re-run convergence**, and the **non-destructive
SIS-delete** posture.

### A. Conflict resolution — keep-current / take-source, audited, in-request (not the queue)
A `conflict` row (a protected-field disagreement on a matched student, recorded by S2 with `conflictFields` and
**no write**) blocks auto-apply of that row. The admin arbitrates it in the panel's focus-trapped `Drawer`
(the E3-S3 hardened primitive): **`POST /api/v1/imports/:id/conflicts/:rowId/resolve`** with
`decision: keep_current | take_source`, on the existing **`imports.execute`** permission (admin-held; no new
permission). This is a **single targeted write run in-request** (one `$transaction`), deliberately NOT the
`imports` queue — it is O(1), needs an immediate result, and has no crash-resume surface. The handler gains an
optional **`resolveConflict(payload, decision, ctx)`** (only `studentsHandler` implements it in v1; the service
rejects a resolve on a type that omits it); the shared engine wrapper **`resolveRowConflict`** keeps the call
framework-agnostic (one implementation, no fork — the R4 rule extended to arbitration).
- **`keep_current`** writes **nothing** (the child's identity is preserved verbatim) → the row flips to
  `applied` / `reconciliation=unchanged`.
- **`take_source`** is the **only** path that overwrites a protected field (firstName/lastName/birthDate) — and
  only on an explicit, audited admin decision → the row flips to `applied` / `reconciliation=updated`.

The row's `createdEntityId` is set to the **pre-existing matched entity** id, so the S2 rollback-safety
invariant (§E) deliberately keeps it OUT of the delete set (we never created it). The flip uses a
**from-status-guarded `updateMany`** (`WHERE reconciliation='conflict'`) so a concurrent double-resolve writes
exactly once (the loser is a clear 400, never a second overwrite). An append-only **`import.conflict.resolve`**
`AuditLog` row records `{ decision, entityId, reconciliation, fields }` (AC-6/AC-7 — no silent overwrite). The
batch `summary.byClass` roll-up is adjusted (`conflict−1`, chosen class `+1`) so the health panel stays
truthful without re-deriving from rows.

### B. Re-run convergence (the AC-4 invariant, proven)
Re-syncing the **same** source converges: every roster entity matched by `sourcedId`→`externalRef` is
`unchanged` (or `updated` only where the source genuinely changed), **never re-inserted** — **0 created on the
second run**, no duplicate child/teacher/class. The anchor is the S2 externalRef-first match (§B above), made
within-batch idempotent by the handler caching a created student back into `studentsByExternalRef`. An
interrupted/retried worker job converges via the S1 per-row RESUME (an already-`applied` row is skipped). Pinned
by the S4 students-handler convergence test (a 2nd apply of an unchanged matched row → `unchanged`, `create`
never called).

### C. SIS-side delete → soft conflict / "à vérifier", never an auto-destructive delete (R6)
A student present before but **absent from a new pull** is left **intact** — E11 **never** auto-deletes a
child/entity on a sync diff. A soft-deleted source row (`status=tobedeleted`) is **skipped** by the adapter (no
apply row), so it is neither re-created nor deleted. Destructive reconciliation stays a deliberate future
decision behind explicit admin confirmation, out of scope here.

Because an absent source row simply produces **no ImportRow**, the deletion would otherwise be **invisible**. So
`IntegrationsService.sync` adds a **best-effort, read-only divergence** pass after producing the batches
(`computeAbsentFromSource`): it diffs the school's `externalRef`-carrying students (the roster-managed pupils)
against the pulled `sourcedId` set and records the ones absent from the pull as an additive
`summary.absentFromSource: [{ externalRef, name }]` on the produced **students** batch (and on the `SyncResult`),
plus an `absentFromSourceCount` on the `import.sync.pull` audit. The panel renders this kindly as "N élève(s)
absent(s) de la dernière synchronisation — à vérifier" (amber/neutral, **never red, never a one-click delete**).
The pass is **strictly non-destructive** (only reads students + writes the advisory JSON) and **best-effort**
(any failure is swallowed → empty advisory, the sync still succeeds). No auto-delete code path exists anywhere.

### D. 24h rollback (reuse S1, unchanged)
An `origin=oneroster` applied batch is roll-back-able within 24h via the **same** reverse-order `rollbackRow`
compensation + `rolled_back` status + `import.rollback` audit as a CSV import (the 24h window is checked at
enqueue). The §E rollback-safety invariant holds for syncs: only rows the sync **created** are physically
compensated; matched (`updated`/`unchanged`) and arbitrated rows leave the pre-existing child's record intact.
The FE rollback copy reads "Annuler cette synchronisation" for an `oneroster` batch (provenance-aware), but the
mechanism is identical.

### Rejected (S4 alternatives)
- **Resolve conflicts on the `imports` queue.** Rejected — arbitration is a single O(1) write needing an
  immediate result; queuing it adds latency, a poll surface and a crash-resume case for no benefit. The async
  queue stays for the bulk apply/rollback only.
- **A new `conflicts.resolve` permission.** Rejected — the resolve rides the existing `imports.execute` (the
  whole import-detail surface is already gated by it; admin holds it). No new permission (the R1 house style).
- **`take_source` auto-applied by the worker.** Rejected — a protected-field overwrite of a child's identity
  MUST be a human, audited decision; the apply leaves the row in `conflict` until the admin chooses (the
  children's-data guardrail).

## Stale-lease reclaim — implemented (polish — amendment)

§4 specified that an `applying` batch is reclaimable **only** once its claim instant is older than a lease
window (`IMPORTS_APPLY_STALE_MIN`), keyed on the **claim instant** not the enqueue instant. The S1 worker
shipped this as an **unconditional** re-admit instead (`updateMany WHERE status IN ('queued','applying')`),
which under BullMQ at-least-once delivery let a re-delivered / duplicate job re-claim a batch a
**still-alive** worker was actively mid-apply on — two workers racing the same `$transaction` and per-row
RESUME. This amendment brings the implementation to the §4 contract (worker-only, **additive, no schema /
permission / contract change**):

- The `ImportsProcessor` claim now reads the batch `status` + the lease instant first, then routes through a
  pure, unit-tested `decideClaim` helper (`apps/worker/src/modules/imports/import-claim.ts`): `queued` →
  always claimable (`fresh`); `applying` → reclaimable **only** when `claimedAt < now − IMPORTS_APPLY_STALE_MIN`
  (default 15 min, env-overridable) **or** `claimedAt` is `null` (a legacy / pre-S5 / never-stamped claim →
  reclaimed defensively, the analytics-snapshots `processedAt: null` precedent) ⇒ `reclaim` carrying the
  observed instant; every other status → terminal, never claimed.
- **The lease instant is a typed `ImportBatch.claimedAt` scalar column** (additive, nullable — promoted out of
  the `summary` Json). This is load-bearing: it makes the stale-reclaim a **single-winner compare-and-swap that
  is expressible in Prisma's typed `updateMany`** (a Json key cannot be predicated). The claim issues ONE atomic
  statement (claim **and** stamp together — no read-to-stamp TOCTOU a re-delivery could slip through):
  - `fresh`   → `updateMany WHERE status='queued'                       SET status='applying', claimedAt=now`
    — the status flip elects exactly one winner (the loser matches 0 rows).
  - `reclaim` → `updateMany WHERE status='applying' AND claimedAt=<observed> SET claimedAt=now`
    — a CAS on the observed lease instant elects exactly one winner **even though the status stays `applying`**:
    once the winner re-leases, the loser's stale `claimedAt` no longer matches (`count === 0` → skip). This
    closes the prior gap where two simultaneously-stale re-deliveries both passed an `applying → applying`
    no-op guard.
- Applied to **both** the apply and rollback paths via ONE shared `claim()` helper so their admission semantics
  cannot drift. During a long apply the periodic progress flush **heartbeats** the `claimedAt` column, so a
  re-delivery mid-run reads `lease-held` and skips.

The lease default (`IMPORTS_APPLY_STALE_MIN = 15`) mirrors `SNAPSHOT_RECOMPUTE_STALE_MIN`. A dead worker's
batch still self-heals after the lease (BullMQ re-delivers the stalled job; the now-stale claim is reclaimed by
CAS and the per-row RESUME converges it). The invariant now **holds, not merely narrowed**: a re-delivery
against a **live** claim no-ops (`lease-held`), and two concurrent **stale** re-deliveries admit **exactly one**
worker — pinned by `import-claim.spec.ts` (the pure decision) **and** `imports.processor.spec.ts` (the wiring:
two concurrent stale re-deliveries ⇒ `applyBatchRows`/`rollbackBatchRows` invoked **exactly once**, the loser
`skipped`). **Schema:** one additive nullable column (`claimed_at`), `db push` — existing rows read `null`
(reclaimed defensively, zero behaviour change). No permission / contract change.
