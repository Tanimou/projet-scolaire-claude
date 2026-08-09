# NEXT — written by run 33 (`S-E04-5`), 2026-08-09

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-6`

| | |
|---|---|
| **Story** | `S-E04-6` — Five privileged families write their audit row in the same transaction |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | M · `[api][audit]` |
| **Gates** | **`G-AUDIT` (primary)**, `G-TENANT`, `G-AUTHZ`, `G-DNC` *(DNC-10)* · **`G-MIGRATION` does not trigger** |
| **blockedBy** | **nothing** — `S-E04-1` (run 29) and `S-E04-3` (run 31) both shipped; provenance is true before it is recorded at five more families, which was the whole point of the ordering |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-6` — read it verbatim, it is the contract |

### The measurement the story rests on is from 2026-08-08 — re-verify it cheaply, it is one grep

**6 of 28** audit call sites use `tx.auditLog.create` inside a `$transaction`; the other **22** call
`this.prisma.auditLog.create` outside one. Three of the five `AC-2` families write **no row at all**: role
grant/revoke (`identity/users.service.ts:57`, `:74`), school mutations (`apps/api/src/modules/schools/` — **zero**
`auditLog` references) and enrollment decisions (`apps/api/src/modules/enrollments/` — **zero**). The finance family
is **vacuous**: there is no finance module in `apps/api/src/modules`. State that plainly; do not tick `AC-2`.

The seam's shape is the point: `writeAudit(tx: Prisma.TransactionClient, input)` — the transaction client as the
**first parameter** makes `writeAudit(this.prisma, …)` a *type* error, so the invariant is compile-time rather than a
review convention.

### Carry these two — they are in the files you will already have open

1. **`PF-149` (P1, latent)** — `UnknownTimezoneError` is thrown by `packages/contracts/src/audit/window.ts` and
   **caught nowhere**; the only reference in `apps/api/src` is a comment at `analytics.service.ts:3426`. It cannot
   fire today (measured: `tenant.timezone` is `NOT NULL DEFAULT 'Europe/Paris'`, both tenants hold that value, no
   writer for the column exists anywhere, and `process.versions.icu` is **76.1** inside `pilotage_api`). It goes live
   the moment anything writes the column, because nothing validates it on write. Two small halves: validate with the
   already-exported `isKnownTimezone` on write, and map the error to a deliberate HTTP response.
   **Do not "fix" it by reintroducing a fallback** — fail-closed is the design.
2. **`PF-150` (P2)** — encode « `S-E04-8` stays last » as a real `blockedBy` in `dependency-map.md`. It currently
   survives only because each run remembers the reasoning (a chain over provenance that is not yet true is a
   cryptographically verifiable record of falsehoods).

### What run 33 shipped, so the next run does not re-derive it

`S-E04-5` closed the **last two halves of `PF-32`** plus `PF-134`, `PF-137`, `PF-139`, and the **read half** of
`PF-123`. Full gate `GATE: PASS`.

- **`Tenant.timezone`** exists — additive, `TEXT NOT NULL DEFAULT 'Europe/Paris'`, one hand-reviewed expand-only
  migration at `apps/api/prisma/migrations/20260809120000_tenant_timezone/`. **Applied to the local stack** with
  `prisma migrate deploy`; the ledger holds both migrations, finished and not rolled back. No `db push`.
- **`packages/contracts/src/audit/window.ts`** is now the single resolver of audit date bounds — `gte` = local
  midnight, `lt` = **next** local midnight (exclusive, so no precision to choose against Postgres microseconds).
  It fixed **both** bounds: `from` had the same UTC-midnight defect, i.e. it dropped 00:00–02:00 Paris on the first
  selected day. DST by civil-date increment plus a second `Intl` offset read, asserted on the 23 h and 25 h Paris days.
- **The four KPIs share the table's `where`**, each plus exactly one predicate, combined with `AND: [...]` so a user's
  own `action` filter is never overwritten. `eventsInRange` is **`total` itself**, not a fifth count — the anti-drift
  invariant holds by construction, including under concurrent appends.
- **`adminLogins` and `today` are gone.** « Acteurs distincts » replaces them, via `groupBy`, excluding the actor-less
  system row rather than inventing a phantom actor. `V3-E05` (`PF-26`) owns real login auditing; no
  "first authenticated request" heuristic was invented.
- **`pickActionTone` had TWO copies**, not the one `PF-134` named — `AuditDetailDrawer.tsx:40` as well as
  `AuditTable.tsx:57`. Both deleted; tone is now a declared property of `AUDIT_ACTIONS`.

**Measured on the live local database, not asserted** — two rows inserted at 23:30 and 00:30 Europe/Paris on
2026-08-09, then filtered with `from = to = 2026-08-09`:

| predicate | rows returned |
|---|---|
| old (`gte`/`lte: new Date(ymd)` — UTC midnight) | **0** |
| new (`gte` local midnight … `lt` next local midnight) | **2** |

Those two fixture rows are still in the local `audit_log` (61 rows now, was 59). They are harmless; delete them if
they bother a count, local data is expendable.

### One correction to the sprint's own review, so it is not inherited wrong

The a11y lens reported the focus-ring defect (`PF-148`) as *"a straight regression"* on the two filter controls.
**Measured false:** the two pre-existing selects keep their `focus:ring-blue-400/30` **and** their
`focus:border-blue-400`, and this diff does not touch them. What is true is that the slice adds **three new** controls
using the same low-alpha house ring. Recorded at P2 with that correction, not at the severity the panel proposed.

---

## ⚠️ Container-state facts that will otherwise waste your Step 2

1. **`pilotage_api` was NOT rebuilt this run.** It still runs run 32's image, so the container does **not** serve
   `S-E04-5`'s code. Every claim above was evidenced by unit test, by the full gate, or by direct SQL against
   `pilotage_postgres` — **not** by the running API. If you need the new endpoint shape live, that is one rationed
   rebuild of `api` only.
2. **The database is ahead of the API container** — `tenant.timezone` exists in Postgres while the running API's
   Prisma client does not know the column. That is safe (additive, and the old client never selects it) and it is the
   expand phase behaving exactly as the migration's own header describes.
3. **`pilotage_web` still serves an image from 2026-08-07.** Unchanged from runs 30–33. The container's
   `/admin/audit` is the **old bundle** — not a regression, not something to debug.
4. **`PF-126` still blocks every `web` image rebuild** — `next build` inside BuildKit cannot fetch `Inter` from Google
   Fonts, and the two obvious explanations are already falsified (host: 200; bare `docker run alpine`: 200).
   **Do not re-test connectivity.** Fix direction is `next/font/local`; owner `V3-E02`.
5. **A sweep is still not schedulable** for the reason runs 30–33 gave: its mechanism is one
   `docker compose build` + `--force-recreate`, and the `web` half of that is what is broken.

## Still open from earlier runs, untouched by run 33

`PF-136`, `PF-140`, `PF-141` (`S-E04-7`) · `PF-142`, `PF-146` (`V3-E02`) · `PF-145` (`V3-E05`) ·
`PF-121`, `PF-122` (`S-E04-7`) · `PF-124`…`PF-127` from run 30. `PF-123` is now **half** closed — read side done,
write side still `S-E04-7`.

`PF-129` and `PF-133` remain the **same missing artefact**: there is no web-side quality gate and no web unit runner
(`apps/web` has Playwright only — also `PF-100`'s blocker and part of `VAL-08`). `PF-148` and `PF-139`'s derivation
module are two more things that would be verifiable if it existed. Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\brave-almeida-541d05

> Step 0.5 D: run 33 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 32's handoff (`awesome-spence-9e6f69`) is discharged at the git level** — run 33 deregistered it;
> `git worktree list` no longer shows it. Its **directory** survives on disk: `git worktree remove` reported
> *"Permission denied"* on the delete, exactly as runs 31–32 saw for theirs. Inert leftover bytes, not a worktree; no
> git command is needed, just delete it when the holding process is gone. Same for `pensive-raman-4baf7c`,
> `musing-archimedes-77d454`, `youthful-jones-758d15`, `agitated-cerf-ad2bdf`, `elated-ellis-40bb4a`,
> `inspiring-mclaren-a76c8e`, `sharp-albattani-ec7c4d` and `stoic-allen-b8284b`.
>
> Unchanged and still requiring a human, said now by runs 29–33: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB: `PLAN.md`, `packages/`, `upcomingicsexport.patch`) — unreachable *and* unattributable, so it is
> not deleted. `youthful-chaum-6aad5c` is **dirty** (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion stays denied by the permission classifier** (`git push origin --delete`), as in
> run 32. All merged remote `ci/*` branches back no open PR and are safe to delete whenever the permission allows.
> No local `ci/*` branches remain beyond this run's.
