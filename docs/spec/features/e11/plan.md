# E11 — Plan (architecture & sequencing)

> How E11 is built: the async spine, the reconciliation contract, the OneRoster surface, and the slice
> order. Grounded in the verified current code (ADR-017 import pipeline, the two existing BullMQ queues,
> the exports producer/consumer pattern). No code/schema/build in this run.

## 1. Architecture overview

```
ADMIN (apps/web /admin/imports + /admin/integrations)
  │  upload→validate (UNCHANGED, sync — small, cheap)
  │  POST :id/apply           ──┐
  │  POST /integrations/oneroster/:id/sync ──┐
  ▼                              │           │
API (apps/api ImportsModule + IntegrationsModule)
  • validate stays in-request   │           │
  • apply ENQUEUES, returns 202 ▼           ▼
  • sync  ENQUEUES, returns 202  ┌───────────────────────┐
  • status/progress reads (poll) │  QUEUE_IMPORTS (NEW,   │  ← the 3rd BullMQ queue (ADR-024)
                                 │  3rd queue)            │
WORKER (apps/worker)            └───────────┬───────────┘
  • ImportsProcessor: drain batch ──────────┘
      - reuse the SAME handlers (parseRow/validateRow/applyRow/rollbackRow)
      - idempotent reconciliation per row (created|updated|unchanged|conflict|skipped)
      - write progress + summary back to ImportBatch / ImportRow
      - append-only AuditLog
  • OneRosterPull (S3/S4): fetch source → map to ImportRow payloads → reconcile
                                 │
POSTGRES (tenant-scoped, RLS) — ImportBatch / ImportRow (+ minimal additive sync fields)
```

**Key principle:** the worker reuses the **exact same per-type handlers** the API uses today
(`apps/api/src/modules/imports/handlers/*`). The handlers are pure-ish (`applyRow(payload, ctx)` taking a
`tx`); they move to a place both API (validate) and worker (apply) can import, or the worker calls them via a
shared package. No re-implementation of business rules → no byte-drift between sync and async apply (AC-1).

## 2. The async spine (S1)

1. **Third queue.** `QUEUE_IMPORTS = 'imports'` registered in `apps/api/.../queue/queue.module.ts` (the
   producer) and consumed by a new `ImportsProcessor` in `apps/worker/.../modules/imports/`. This is the
   **single ADR tripwire** (ADR-024) — the platform's third queue, mirroring the `exports` producer/consumer
   wiring 1:1 (`attempts:3`, `backoff exponential`, `removeOnComplete/removeOnFail` windows).
2. **Enqueue on apply.** `ImportsService.apply()` stops running the `$transaction` in-request. It:
   - re-validates the batch is `validated` + mode-legal (unchanged guards),
   - transitions the batch to `queued` (new status value — see data-model),
   - enqueues `{ batchId, tenantId, schoolId, mode, actorId }`,
   - returns the batch DTO immediately (HTTP **202-style**, status `queued`).
3. **Worker drains.** `ImportsProcessor.process()` loads the batch + valid rows, opens the **same**
   `$transaction` apply loop that lives in `imports.service.ts` today (relocated, not rewritten), writing
   per-row `applied|skipped` + `createdEntityId`, the append-only `import.apply` audit row, and on
   completion the batch `applied|failed` + summary. **Progress** is written incrementally (a
   `processedRows` counter / periodic batch-summary update) so a mid-run poll is accurate (AC-2).
4. **Poll, not push.** The batch detail page already polls (`force-dynamic`, `cache:'no-store'`). Reuse it —
   add a lightweight `queued|applying` live strip; no SSE/WebSocket (non-goal).
5. **At-least-once safety.** BullMQ may re-deliver a job. The apply loop must be **idempotent per row**: a
   row already `applied` (with a `createdEntityId`) is skipped on a redelivery; the per-row write is guarded
   by row status so a retried job converges (AC-4). This is the same discipline ADR-020 used for bookings.

## 3. The reconciliation contract (S2 — the visionary spine)

Today an import row ends `applied | skipped | invalid | rolled_back`. E11 enriches the **outcome** of an
applied row into a reconciliation **class** so the admin sees *what changed*, not just *that it ran*:

| Class | Meaning | Tone |
|---|---|---|
| `created` | a new entity was inserted | success (emerald) |
| `updated` | an existing entity matched and one+ field changed | success (blue) |
| `unchanged` | matched, nothing to change (idempotent re-run) | neutral (slate) |
| `conflict` | matched but the source disagrees on a protected field — needs a human decision | warning (amber) |
| `skipped` | invalid (skip-invalid mode) or admin-declined | warning (amber) |

This is stored per row (additive — see data-model) and **rolled up** into the batch summary. The handlers'
`applyRow` already does upsert-style logic; S2 makes that logic **report** which class it took (a small
return-shape extension on the handler result), and the worker records it. The **"Import & sync health"
panel** is then a reuse of the existing batch-detail KPI cards + rows table, re-bucketed by reconciliation
class with per-row source-vs-target drill-down.

**Idempotency anchor.** The match key is `externalRef` when present, else a deterministic natural key per
type (e.g. student: `lastName+firstName+birthDate`; class: `academicYear+gradeLevel+name`). The handlers
already build these caches (`buildCaches` in `imports.service.ts` — `studentExternalRefs`,
`classSectionsByName`, …). S2 formalises "match → compare → classify" on top of those caches so a re-run is
`unchanged`, never a duplicate `created` (AC-4).

## 4. OneRoster surface (S3 + S4)

OneRoster v1.1 ships rosters as a **CSV bundle** (`students.csv`, `classes.csv`, `enrollments.csv`, …) or a
**REST API**. E11 targets **CSV bundle first** (it maps cleanly onto the existing CSV import substrate),
with a **REST base-url + bearer key** path as an optional stretch in S3.

- **S3 (connect + pull + map).** A `RosterSource` config (additive model — see data-model) on
  `integrations.write`. "Synchroniser" pulls the source, maps each OneRoster entity to the **existing**
  `ImportRow` payload shape for the matching type (reusing the type handlers' `validateRow`), and creates an
  `ImportBatch` of `origin = oneroster`. From there it is **the same** validated batch the import path
  produces — so S1's async apply + S2's reconciliation work **for free**.
- **S4 (reconcile + apply + rollback + conflicts).** The worker applies the OneRoster-origin batch through
  the S1 spine, classifies via S2, surfaces conflicts (source-vs-current) for admin resolution, and offers
  the 24h rollback. **Idempotent**: re-syncing converges (AC-4). Conflict resolution is an admin choice
  (*keep current* / *take source*) recorded as an audit row — never a silent overwrite of children's data.

**Why map-to-`ImportBatch` instead of a parallel pipeline:** it collapses OneRoster onto the proven,
audited, reversible, validated import substrate. One reconciliation engine, one rollback, one health panel —
not two. This is the central design bet of the epic and the reason S1/S2 land *before* OneRoster.

## 5. Sequencing rationale

1. **S1 first** — the async spine is the architectural risk (3rd queue, ADR-024, at-least-once idempotency).
   Proving it on the **existing** import path (no OneRoster yet) de-risks the whole epic and delivers
   immediate value (no more frozen applies). It is the only slice that *must* author the ADR.
2. **S2 second** — reconciliation classification + the health panel turn the relocated apply into the
   visionary, explainable, reviewable event. Still no OneRoster — it lands on the existing import path,
   making every import (not just syncs) auditable.
3. **S3 third** — OneRoster connect + pull + map. Because it produces a normal `ImportBatch`, it inherits
   S1+S2 with no new execution/reconciliation code.
4. **S4 last** — the idempotent sync apply + conflict resolution + rollback + re-run convergence — the full
   interop loop closed.

## 6. Risk & mitigation (pre-mortem seeds for Critic)

| Risk | Mitigation |
|---|---|
| Handler drift: worker apply diverges from API apply | Share the **identical** handler modules; no re-implementation. A targeted byte-parity test (Murat). |
| BullMQ redelivery double-applies a row | Per-row status guard (`valid→applied` only once); row already `applied` ⇒ no-op on retry (AC-4). |
| Long apply exceeds worker job timeout | Chunked/streamed apply with periodic progress write; keep the per-row work small; reuse the 60s tx envelope per chunk if needed. |
| OneRoster source is huge / partial | Respect the existing `MAX_ROWS` (5 000) guard; page the REST source; a partial pull is a `failed` pull, not a corrupt apply. |
| Conflict silently overwrites a child's data | `conflict` class **blocks** auto-apply of that row; admin must choose; choice is audited (AC-3/AC-7). |
| Third queue forgotten in worker bootstrap | S1 acceptance includes the worker module registration + a smoke that a queued job drains. |
| Scope creep into LTI | Hard non-goal in `spec.md`; ADR-024 scopes to import/sync only. |

## 7. Quality gates

- **Murat (once):** `pnpm typecheck` + `git diff --check`. Targeted tests: handler byte-parity (API vs
  worker apply), per-row idempotency on redelivery, reconciliation classification, OneRoster map→validate.
- **Sentinel:** tenant-scoping on every batch/row/source query; `integrations.write` wall on OneRoster;
  append-only audit on apply/sync/rollback; no cross-tenant roster leak.
- **A11y:** progress + health panel = `role=status` live region; status text+icon; ≥44px; focus-trapped
  conflict-resolution drawer (reuse the E3-S3 hardened `Drawer`).
- **Drift:** the 3rd queue is the **only** new architectural pattern and it ships with ADR-024; no other
  off-convention path, no client N+1 (the health panel reads one aggregate batch).
