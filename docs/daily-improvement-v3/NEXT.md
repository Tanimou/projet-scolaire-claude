# NEXT — written by run 32 (`S-E04-4`), 2026-08-09

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-5`

| | |
|---|---|
| **Story** | `S-E04-5` — The KPIs share the table's scope, and the `to` filter includes its own day |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | M · `[schema][api][web][truth]` |
| **Gates** | **`G-MIGRATION`** *(first slice in this epic where it triggers)*, `G-TRUTH`, `G-TENANT`, `G-DNC` *(DNC-09)* |
| **blockedBy** | **nothing** — `S-E04-4` shipped the declared vocabulary (run 32), which was its only blocker |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-5` (from line 264) — read it verbatim, it is the contract |

### `G-MIGRATION` triggers, and it is not obvious why

A day-inclusive `to` is meaningless without a declared timezone, and **`Tenant` has no `timezone` column** — measured:
only `School.timezone` exists (default `Europe/Paris`), and `Tenant` carries `settings Json`. Computing the boundary in
the *server's* zone is the defect at a new address. This wants a reviewed migration, an expand/contract plan and a
stated rollback — never `db push`. Budget for it: the `schema drift` gate stage alone took **107 s** on run 32.

### Carry these three with it — they are in the file you will already have open

1. **`PF-138` is already closed** (run 32 restored the `portal: 'admin'` scope and flipped the provenance gate back to
   length 1). Do not re-fix it; do not re-invert the gate.
2. **`PF-137`** — reconcile `contracts/openapi.yaml` `AuditKpis` and `data-model.md` D-23 with whatever shape you ship.
   They currently specify `adminLogins` *removed* and `distinctActors` in four `{value, scope}` envelopes; the code
   ships `adminLogins: number | null`. Pick one and make the other agree. Same file, same problem for
   `sensitiveExports`: the contract defines it structurally (`resourceType = 'export_job'`), the code by action.
3. **`PF-139`** — the KPI card work is yours anyway: « Non instrumenté » is **clipped, not ellipsised**, in
   `KpiCard`'s `font-mono text-3xl` slot, and `page.tsx`'s `safe()` collapses an analytics **outage** onto the same
   `adminLogins: null` sentinel that means "not instrumented". An outage must not render as a claim.

### The read-side half of `portal` that a label map could not fix

`analytics.service.ts` builds the portal facet `where: { portal: { not: null } }` while the row filter matches `portal`
exactly — so a `null`-portal row is reachable by **no offered filter value at all** (there is no « sans portail »
option). That is `PF-123`'s read half and it belongs with the filter work, not with `S-E04-7`.

---

## ✅ What run 32 shipped, so the next run does not re-derive it

`S-E04-4` closed the **vocabulary half of `PF-32`**. One declaration now exists — `packages/contracts/src/audit/`
(`vocabulary.ts` + `labels.ts` + a re-export-only `index.ts`), exported as `@pilotage/contracts/audit`, CJS-built.
It carries `AUDIT_RESOURCE_TYPES`, `AUDIT_ACTIONS` (each code with its French label and `critical`/`export` flags),
`AUDIT_PORTALS` (**four**), and a **frozen** `LEGACY_AUDIT_*_ALIASES` table. `ADR-037` records five decisions.

**Three consumers read it and hold no local copy:** the web label map (`RESOURCE_TYPE_LABELS` / `PORTAL_LABELS`
deleted), the API KPI predicates, and the worker `audit-csv` generator that every prior reading had missed.

**The written set was extracted by a TypeScript AST walker, not transcribed** — and it falsified the brief's own
hand-count, which was short by roughly a third across five literal shapes. The `asc`/`desc` trap (Prisma `orderBy`,
in both object and array form) is excluded by construction and asserted absent. Completeness is set equality in
**both** directions.

**Measured on the live local database, not asserted:**

| | before | after |
|---|---|---|
| `criticalChanges` | **9** (matched only the French `Suppression` out of four listed strings) | **18** (declared critical set + declared legacy aliases) |
| `adminLogins` | **0**, structurally forever | **`null`** — «Non instrumenté», and **no query is issued** |
| legacy values outside the frozen alias table | never measured | **0** on both axes (`PF-143` discharged) |

`PORTALS` was deliberately **not** widened: it backs `dto/auth.ts` `portal: z.enum(PORTALS)` for **login**, so adding
`student` there would have made it a legal login portal. `AUDIT_PORTALS` is a separate 4-valued declaration and
`ADR-037` D2 says why. **No writer emits `portal: 'student'` yet** — `deriveAuditProvenance` maps three — and none was
fabricated to satisfy AC-3.

---

## ⚠️ Container-state facts that will otherwise waste your Step 2

1. **`pilotage_web` still serves an image from 2026-08-07.** Unchanged from runs 30, 31 and 32. It has none of
   `S-E04-2`'s render fix, `S-E04-3`'s provenance forwarding or `S-E04-4`'s vocabulary.
   `http://localhost:3000/admin/audit` failing is the **old bundle**, not a regression, and not something to debug.
2. **`PF-126` still blocks every `web` rebuild** — `next build` inside BuildKit cannot fetch `Inter` from Google
   Fonts, and the two obvious explanations are already falsified (host: 200; bare `docker run alpine`: 200). **Do not
   re-test connectivity.** Fix direction is `next/font/local`; owner `V3-E02`. Run 32 did not rebuild anything.
3. **A sweep is still not schedulable**, for the reason runs 30–32 all gave: a sweep's mechanism is one
   `docker compose build` + `--force-recreate`, and the `web` half of that is exactly what is broken.

`pilotage_api` is healthy on run 31's image. Run 32 changed API source but did **not** rebuild it — the gate's
`pnpm build` and `boot-check` are the evidence that the new code compiles and boots, not the running container.

---

## Findings raised by run 32 and still open

| Finding | Priority | Owner | One line |
|---|---|---|---|
| `PF-134` | **P1** | `S-E04-5` | a **fourth** audit vocabulary survives in `AuditTable.tsx`'s inline `pickActionTone`, and it is **already wrong**: `coefficient.upsert` and `grade.unflag` are declared critical, counted by the card, and painted `neutral` |
| `PF-135` | **P1** | `S-E04-5` | **nothing executes `/admin/audit`** — all web evidence is textual, on the one route that has already 500'd for every admin. ~25 lines of Playwright on the existing `adminPage` fixture |
| `PF-140` | **P1** | `S-E04-7` | the DPO CSV changed bytes with no AC asking (three columns **mid-header**, new BOM), collapses two vocabulary axes into one column, and `csvEscape` neutralises no leading `=`/`+`/`-`/`@` one column from a raw client header |
| `PF-136` | P2 | `S-E04-7` | drawer, table and worker use **three different** merge rules for a mixed-vocabulary row; the marker is `aria-hidden`, so the regulatory signal is absent from the accessibility tree |
| `PF-137` | P2 | `S-E04-5` | `openapi.yaml` + `data-model.md` D-23 disagree with shipped code |
| `PF-139` | P2 | `S-E04-5` | « Non instrumenté » is clipped in `KpiCard`; an analytics outage renders as an affirmative claim |
| `PF-141` | P2 | `S-E04-7` | the table shows the label and **drops the raw code**, while its own filter still matches the raw column |
| `PF-142` | P2 | `V3-E02` | both jest configs now read contracts **source**, so nothing verifies the built CJS artefact Node actually loads |

`PF-138` and `PF-143` were raised **and closed** by run 32 — they are in `traceability/CLOSED-L0.md`, not here.
`PF-121`, `PF-122`, `PF-123` (`S-E04-7`) and `PF-124`…`PF-127` from run 30 are all still open and untouched.

### The three worth doing together, if a gate slice is ever picked up

`PF-129`, `PF-133` and now `PF-135` are the **same missing artefact**: there is no web-side quality gate at all, and no
web unit runner (`apps/web` has Playwright only — that is also `PF-100`'s blocker and part of `VAL-08`). One spec could
assert all of it: every server-side `fetch` to `API_URL` goes through `clientProvenanceHeaders`; nothing reachable from
a `'use client'` entry imports `@/lib/api-client` / `next/headers` / `@/auth`; and `/admin/audit` returns 200 for an
admin. Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\awesome-spence-9e6f69

> Step 0.5 D: run 32 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 31's handoff (`pensive-raman-4baf7c`) is discharged at the git level** — run 32 deregistered it along with
> `musing-archimedes-77d454` and `youthful-jones-758d15`; `git worktree list` shows none of the three. All three
> **directories** survive on disk: `Remove-Item -Recurse -Force` failed with *"being used by another process"* for
> each. They are inert leftover bytes, not worktrees; no git command is needed, just delete them when the holding
> process is gone. Same for `agitated-cerf-ad2bdf`, `elated-ellis-40bb4a`, `inspiring-mclaren-a76c8e`,
> `sharp-albattani-ec7c4d` and `stoic-allen-b8284b`.
>
> Unchanged and still requiring a human, said now by runs 29–32: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB: `PLAN.md`, `packages/`, `upcomingicsexport.patch`) — unreachable *and* unattributable, so it is not
> deleted. `youthful-chaum-6aad5c` is **dirty** (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion was denied to run 32 by the permission classifier** (`git push origin --delete`).
> All 38 remote `ci/*` branches are merged and back no open PR; they are safe to delete whenever the permission
> allows. No local `ci/*` branches remain.
