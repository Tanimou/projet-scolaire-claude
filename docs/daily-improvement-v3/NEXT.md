# NEXT — written by run 31 (`S-E04-3`), 2026-08-08

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-4`

| | |
|---|---|
| **Story** | `S-E04-4` — One canonical audit vocabulary, declared once, in `packages/contracts` |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | M · `[contracts][api][web][worker]` |
| **Gates** | `G-TRUTH`, `G-PORTAL`, `G-DNC` *(DNC-09, DNC-08)* · **ships `ADR-037`** |
| **`G-MIGRATION`** | does **not** trigger — deliberately (no Prisma enum; `data-model.md` says why) |
| **blockedBy** | **nothing** — `S-E04-2` shipped the render verdict (run 30), which was its only blocker |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-4` (lines 207-260) — read it verbatim, it is the contract |

### Why this one and not `S-E04-6`

Selection rule 3 takes the first story in the epic whose `blockedBy` is empty. After run 31, `S-E04-3` is done, so the
live candidates are `S-E04-4` (blocked by `S-E04-2` ✅) and `S-E04-6` (blocked by `S-E04-1` ✅ **and** `S-E04-3` ✅ —
now unblocked). `S-E04-4` is ordered first **and** it is the cheaper prerequisite: `S-E04-6` spreads provenance to five
more write families, and doing that *before* the vocabulary is canonical means writing five more call sites against
codes that `S-E04-4` will then redefine.

### What `S-E04-4` must not get wrong

The contract's own trap is that completeness must be checked **in both directions** — every code a call site writes has
a label, **and** every label corresponds to a code something writes. One-directional checking is exactly how
`calendar_event` went missing, and it is the same asymmetry as `PF-127` (the link gate) and `PF-105` (`A ≡ A` proves
nothing). Drive the test off the **actual** literals reachable in `apps/api/src` *and* `packages/imports-core/src`,
never off a hand-written list.

Three consumers, not two: the web label map, the API KPI predicates, **and**
`apps/worker/.../exports/generators/audit-csv.generator.ts:16`, which exports `action` **raw**. A two-consumer fix
leaves the CSV export drifting, and the CSV export is what a DPO hands to a regulator.

### What run 31 hands it directly

1. **`PF-121`/`PF-122`/`PF-123` are still open and still unowned by this slice.** They belong to `S-E04-7`. Run 31 did
   not touch the audit read path, exactly as run 30 did not.
2. **The `portal` column now has four legal values in practice but three in `packages/contracts`.** `S-E04-4`'s AC-3
   requires four. `deriveAuditProvenance` maps only `admin`/`teacher`/`parent`, so a `student` portal row cannot yet be
   *written* — decide whether AC-3 is satisfied by the label existing or requires the writer too, and say which.

---

## ✅ What run 31 measured, so the next run does not re-measure it

`S-E04-3` is **measured, not asserted**. Baseline `54 / 0 / 0` → after `59 / 4 / 4` on
`select count(*), count(ip_address), count(user_agent) from audit_log`. Six probes on
`PUT /api/v1/subjects/coefficients/matrix`, all read back from Postgres — full table in
`docs/spec/features/v3-e04/PROGRESS.md` § "MEASURED". `TRUST_PROXY_HOPS` is now in `REQUIRED_ENV`, so **the API
refuses to boot without it**; `.env`, `.env.example`, `.env.prod.example` and both compose files declare it.

**`pilotage_api` was rebuilt and recreated by run 31 and is healthy on the new code.** `pilotage_web` was **not** —
see below. The stack was left running.

---

## ⚠️ Two container-state facts that will otherwise waste your Step 2

1. **`pilotage_web` still serves an image from 2026-08-07.** It has neither `S-E04-2`'s `/admin/audit` render fix nor
   `S-E04-3`'s provenance forwarding. `http://localhost:3000/admin/audit` may still fail — that is the **old bundle**,
   not a regression, and not something to debug. Unchanged from run 30.
2. **`PF-126` still blocks every `web` rebuild** — `next build` inside BuildKit cannot fetch `Inter` from Google
   Fonts, and the two obvious explanations are already falsified (host: 200; bare `docker run alpine`: 200). Do not
   re-test connectivity. Fix direction is `next/font/local`; owner `V3-E02`.

**A sweep is still not schedulable** for the same reason run 30 gave: a sweep's mechanism is one
`docker compose build` + `--force-recreate`, and the `web` half of that is exactly what is broken.

---

## Findings raised by run 31 and still open

| Finding | Owner | One line |
|---|---|---|
| `PF-129` | `V3-E04` `S-E04-7` | a **third** `apps/web` server-side fetch (`parent/register/actions.ts:25`) bypasses `clientProvenanceHeaders`; latent until parent registration becomes audited |
| `PF-130` | `V3-E04` `S-E04-7` | nginx passes the three `x-pilotage-*` headers through from the internet, so any authenticated actor can blank **their own** row with one header, indistinguishably from an honest absence |
| `PF-131` | `V3-E04` | `location /api/v1/notifications/stream` sets no `X-Forwarded-For`, so the `N = 2` pin is not uniform across the public surface; a **padded** chain defeats the short-chain guard |
| `PF-132` | `V3-E04` `S-E04-7` | **PARTIAL** — both example files now ship `AUDIT_FORWARD_TOKEN=` empty (run 31), but nothing *refuses* a weak or published token at the read site. `PF-54`'s shape exactly |
| `PF-133` | `V3-E02` | a `'use client'` file imported a **value** from a server module; no artefact asserts that boundary, `tsc` cannot see it, and `next build` only sees it once a hard server-only import exists. Instance fixed, **class open** |

`PF-124`, `PF-125`, `PF-126`, `PF-127` from run 30 are all still open and untouched — run 31 was not their owner.

### The two most useful of those, if a gate slice is ever picked up

`PF-129` and `PF-133` are the **same missing artefact**: there is no web-side quality gate at all. One spec could
assert both invariants — every server-side `fetch` to `API_URL` goes through `clientProvenanceHeaders`, and nothing
reachable from a `'use client'` entry imports `@/lib/api-client` / `next/headers` / `@/auth`. Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\pensive-raman-4baf7c

> Step 0.5 D: run 31 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Leftover directories — run 31 deregistered one more, and the handling still differs:**
>
> 1. `stoic-allen-b8284b` (run 30's handoff) was **discharged at the git level** by run 31: `git worktree list` no
>    longer shows it and its branch was merged. `git worktree remove --force` then failed with **Permission denied**,
>    and a plain `rmdir` on the now-empty directory failed with **Device or resource busy** — a process outside this
>    session holds a handle. It is **inert leftover bytes**, not a worktree; no git command is needed, just delete the
>    directory when the holding process is gone. The same is true of `agitated-cerf-ad2bdf`, `elated-ellis-40bb4a`,
>    `inspiring-mclaren-a76c8e` and `sharp-albattani-ec7c4d` — all empty, all deregistered, all held.
> 2. `laughing-wing-54e738` is **not registered** as a worktree but is **not empty** (~1.4 MB: `PLAN.md`, `packages/`,
>    `upcomingicsexport.patch`). Nothing in git points at it, so its contents are unreachable *and* unattributable —
>    run 31 left it alone rather than delete work it could not identify. A human decides.
> 3. `youthful-chaum-6aad5c` is **dirty** (a large set of staged deletions under `docs/`). The hard rule forbids
>    removing a dirty worktree. Leave it. Runs 29, 30 and 31 have all said this and it is still true.
