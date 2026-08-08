# NEXT — written by run 29 (`S-E04-1`), 2026-08-08

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-2`

| | |
|---|---|
| **Story** | `S-E04-2` — `/admin/audit` is measured under authentication; `/admin/reports` stops being a dead link |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | S · `[web][nav]` |
| **Gates** | `G-PORTAL` *(admin only, stated)*, `G-DNC` *(DNC-09)* |
| **`G-MIGRATION`** | does **not** trigger |
| **blockedBy** | **nothing** |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-2` — read it verbatim, it is the contract |

### Why this one and not `S-E04-3`

Both are unblocked now that `S-E04-1` has shipped the seam and `ADR-036`. Selection rule 3 takes the **first** story
in the epic whose `blockedBy` is empty, and `S-E04-2` is ordered first. It is also the cheaper of the two and it
**gates two later slices**: `S-E04-4` and `S-E04-5` both edit `/admin/audit`, and the kit forbids editing that page
before its render verdict exists.

### Blockers — none. But two things must be true before code is written

1. **The headline is a measurement, not a fix.** `PF-14` is open **in both directions**. The authenticated render of
   `/admin/audit` has **still never been performed** — run 29 did not perform it either (it needs a browser login,
   which that run declined to do) and re-confirmed only the unauthenticated `307 → /admin/login` on
   `localhost:3000`. Record the verdict **either way**, with the browser console, in the PR and in `PROGRESS.md`.
   Do not close `PF-14` in either direction without it.
2. **Read `PF-119` before deciding what to build.** `/admin/analytics` **exists**, renders « Analytique des
   performances », and has **no sidebar entry at all**, while `sidebar-items.ts:175` publishes `Rapports →
   /admin/reports`, which does not exist — under the same `BarChart3` icon. So *"implement `/admin/reports`"* is
   probably the wrong half of `AC-5`. **Building a reports page is refused** by the contract.

### Things run 29 leaves on the table for it

- `analytics.service.ts:3358-3364` builds the `/admin/audit` portal facet as `where: { portal: { not: null } }` while
  `:3246` filters `portal` by exact match — so a `null`-portal row is offered by **no filter value** (no
  « sans portail » option). `S-E04-1` now derives `portal` at 9 write sites but changed **nothing** read-side.
  Inventory owed by `S-E04-2` / `S-E04-5`; it is why `PF-123`'s rows are unreachable by any filtered review.
- `S-E04-3` (real client IP/UA) is **also unblocked** — `ADR-036` exists and pins `N = 2` prod / `N = 0` local.
  Take it after `S-E04-2` unless `S-E04-2` turns out to be blocked.

---

## Findings raised by run 29 and still open

| Finding | Owner | One line |
|---|---|---|
| `PF-121` | `S-E04-7` | `packages/imports-core/src/engine.ts:201-202`, `:292-293` hard-code both fields on a path with **no JWT** (worker drains a BullMQ job) |
| `PF-122` | `S-E04-7` | `child-claims.service.ts:722-729` parametrises both fields and writes `actorRole: 'admin'` — **not a realm role**; invisible to all four matchers of the new gate |
| `PF-123` | `S-E04-7` | `assessments.controller.ts:290` — grade publication writes **no** `actorRole` and **no** `portal` at all |

`AC-1`'s *"exactly one file decides an actor role"* was **narrowed, not ticked**: three provenance decision sites
survive inside or adjacent to the walk root. That is the honest state, and `S-E04-7` owns closing it.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\inspiring-mclaren-a76c8e

> Step 0.5 D: run 29 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Also still pending, and deliberately not touched by run 29:**
> `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\youthful-chaum-6aad5c` is **dirty** (a large set
> of staged deletions under `docs/`). The hard rule forbids removing a dirty worktree — a human decides what that
> work was. Leave it until someone does.
