# ADR-024 — Async import/sync execution on a third BullMQ queue + crash-safe, idempotent apply (status-guarded claim + per-row resume)

- **Status:** Accepted
- **Date:** 2026-06-11
- **Epic / Slice:** E11 — Standards interop (OneRoster/LTI) + async imports · S1 (third `imports` queue +
  worker `ImportsProcessor` + enqueue-on-apply + crash-safe idempotent status machine + this ADR)
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
