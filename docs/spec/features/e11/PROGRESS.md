# E11 — Progress

> Run status for **E11 — Standards interop (OneRoster/LTI) + async imports**. The spec-kit landed on the
> **epic-spec run** (docs-only). Slices ship one PR each on later runs; tick them here + in
> [`bmad/roadmap.md`](../../../../bmad/roadmap.md) on land. **Status legend:** `[ ]` not started ·
> `[~]` in progress · `[x]` shipped.

## Epic status: `in-progress` (spec-kit landed; slices unstarted)

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

- [ ] **S1** — Async import execution: 3rd BullMQ queue (`imports`) + worker `ImportsProcessor` +
  enqueue-on-apply (reuse the existing `applyRow`/`rollbackRow` contract — no forked engine) + crash-safe
  idempotent (from-status-guarded claim + per-row resume) + **ADR-024**. `[schema][worker][async]` · P1.
  *Additive `db push`: `ImportStatus += queued`.*
- [ ] **S2** — Reconciliation classification (`created/updated/unchanged/conflict/skipped`) + the
  "Import & sync health" panel (counts + per-row drill-down + 24h rollback), non-stigmatising.
  `[schema][api][web][a11y]` · P2. *Additive `db push`: `ReconciliationClass` + `ImportRow.reconciliation`/`conflictFields`.*
- [ ] **S3** — OneRoster source connect + pull + map-to-`ImportBatch` (CSV bundle first; REST stretch) on
  `integrations.write`. `[schema][api][integration]` · P2. *Additive `db push`: `RosterSource` + `ImportOrigin`.*
- [ ] **S4** — Idempotent sync apply + conflict resolution + 24h rollback + re-run convergence. No schema.
  `[api][worker][web]` · P2. **On land → `E11` is `shipped`.**

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

## Open questions for the S1 implement run

- Where the relocated apply logic lives so API + worker share **one** implementation (a shared apply module
  vs the worker importing the moved service path) — Winston/Amelia(BE) to settle without forking the logic.
- The exact lease window + reclaim cadence for a stale `applying` batch (mirror the analytics-snapshots /
  E7-S5 `processedAt`-keyed reclaim).
- Whether the sync `syncing` state reuses `applying` semantics or earns its own additive status value
  (data-model leans on reuse; confirm on S3/S4).

## Operator note

The additive `db push` per S1/S2/S3 must be applied to dev/prod before each slice is demoable, and the
worker must run with the **third queue** registered (S1). The routine cannot run infra — surfaces degrade
kindly ("indisponible") until an operator applies the migration (the E7/E8/E9 precedent).
