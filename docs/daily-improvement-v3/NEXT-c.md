# NEXT — track **c** (web surface) · written by run 40 (`S-E06-8`), 2026-08-12

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track c's seam (`tracks.md`): `apps/web/**` · `packages/ui/**` · `packages/design-tokens/**`.
>
> **This file did not exist before run 40.** Runs 38–39 wrote the un-suffixed `NEXT.md`, which is track-agnostic and
> now describes a story (`PF-173` (b), the CSV brand) that is **still track c's and still open** — see below. Do not
> delete `NEXT.md`; read it *after* this one.

## 🛑 READ FIRST — `OPEN.md` is NOT the complete open set (`TOOL-07`, raised by this run)

**Do not select a story from `OPEN.md` alone until `TOOL-07` is fixed.** The reconciler folds the inbox into the
**main checkout's working tree** and never commits it, then deletes the inbox file there — so the fold happens once,
into a checkout no track reads, and can never be redone. Nine rows filed on 2026-08-11 are absent from `origin/main`'s
`OPEN.md`, including **`PF-174` (P1)**, which is the story *this* run implemented. Run 40 found it in `NEXT-b.md`
prose, not in the ledger.

**Until it is fixed, add one step to Step 1:** `ls docs/daily-improvement-v3/traceability/inbox/` and read every file
there. That is where the newest findings actually live. Full mechanism and recovery instructions in this run's inbox
file and in `audit-findings-index.md`.

---

## ▶ Next story → `S-E06-9` — route the three `admin/roles` actions through the shared converter (`PF-179` + F2)

| | |
|---|---|
| **Story** | close **`PF-179` (P2)**, and with it `S-E06-8`'s follow-up **F2** *(no story file yet; the contract is `PF-179`'s row in this run's inbox file)* |
| **Epic** | `V3-E06` |
| **Layer** | **L0** |
| **Size** | **S** — one file, three catch blocks |
| **Gates** | `G-DNC` · `G-PORTAL` **1/1, admin-only — verify, do not assert** · `G-TENANT`, `G-AUTHZ`, `G-MIGRATION`, `G-AUDIT`, `G-TRUTH` do **not** trigger |
| **blockedBy** | **nothing** |

**What it is.** `apps/web/src/app/admin/roles/actions.ts` — none of `createRoleAction` (`:24-31`),
`updateRoleAction` (`:44-50`) or `deleteRoleAction` (`:58-64`) re-throws the Next navigation signal. `api()` calls
`redirect()` on a 401; `redirect()` throws an error whose `digest` starts `NEXT_REDIRECT;`. Their blanket `catch`
returns that digest **as data**, and `RoleBuilderForm.tsx:236` renders it — so an admin whose session expired mid-edit
is shown `NEXT_REDIRECT;replace;/admin/login…` and is **never navigated to login**.

**Why it is small and safe now.** `S-E06-8` built exactly the seam this needs: `apiResultFromError`
(`apps/web/src/lib/api-client.ts`) checks `isNextNavigationSignal` **first**, then delegates to the total
`apiErrorMessage`. All three actions already return the compatible `{ ok, error }` shape, so the change is
`catch (err) { return apiResultFromError(err); }` three times. It closes **F2** in the same pass — those three catches
are the divergent copies (`createRoleAction` handles the nested `{ message: { message } }` form, the other two do
not), and `PF-180` (`admin/settings/preferences-actions.ts`, three more actions that render `HTTP 403` and discard the
message) is the natural batch partner: **same seam, same fix, one test — batch them.**

**The trap.** `createRoleAndRedirect` (`:67-71`) calls `redirect()` *itself* on success. It must keep working: the
re-throw is what makes that possible, but check that the success path is not accidentally routed through the catch.

**Second candidate if `PF-179` is closed by other work:** `PF-173` (b) — make an unescaped CSV cell a **type error**
via a branded `CsvCell` in `apps/web/src/lib/csv.ts`. Still track c's, still open, fully described in `NEXT.md`
(run 39). It is larger (a typed API across seven call sites) and, unlike `PF-179`, has no already-built seam waiting.

---

## What `S-E06-8` shipped, so you do not re-derive it

**`PF-174`'s silence half is closed. Its menu half is refused on purpose, and the difference is the whole story.**

- **The defect was singular, and that was measured rather than assumed.** `admin/users/actions.ts` was the **only**
  `'use server'` file in the entire web surface with **zero** `catch` clauses (counted across every `'use server'`
  file in `apps/web/src`). `admin/alerts/actions.ts` funnels its six actions through one catching `callApi`;
  `admin/settings/preferences-actions.ts` uses `Promise.allSettled`. **Do not go sweeping the other action files for
  this shape — it is not there.** What *is* there is a different defect: divergent hand-rolled extraction (`PF-179`,
  `PF-180`, F2).
- **One leaf module, importing nothing: `apps/web/src/lib/api-error-message.ts`.** That emptiness is the design, not
  tidiness. `api-client.ts` imports `next/headers` and `@/auth`; a **value** import of it from a `'use client'` file
  drags them into the browser graph and breaks `next build` — that is **`PF-133`**, and neither `tsc` nor `eslint`
  can see the edge. Two non-fixes are recorded in the docblock so nobody retries them: a **re-export** from
  `api-client.ts` does not help (the *import specifier* decides the graph, not the symbol), and `await import()` only
  moves the break out of the bundler's view.
- **`ApiError` now lives in the leaf and is re-exported from `api-client.ts`.** ~30 existing server callers and
  `instanceof` identity are untouched. Necessary because `apiErrorMessage` narrows by `instanceof`.
- **The extractor is total by `typeof`/`Array.isArray`/`in`, with no `as`.** That converts
  `privilege-ceiling.ts:147-152`'s *written plea* that its `message` "MUST stay a string" into a structural
  impossibility on the web side — a plea the API could not enforce, since `new ForbiddenException(obj)` accepts any
  object.
- **`AC-4` — the role menu is deliberately NOT pre-filtered**, and there is a comment at the menu saying so. Which
  roles a `school_admin` may grant is the open decision **`D-12` / `PF-178`**. **`DNC-09` is narrowed, not
  discharged.** If you are tempted to hide the failing options: that is the decision, not the fix.

## Findings this run

| Id | Pri | What |
|---|---|---|
| **`PF-174`** | **P1** | **Narrowed, not closed.** Silence half closed with evidence; menu half re-pointed at `D-12`. |
| **`TOOL-07`** | **P1** | **The reconciler never publishes its fold.** Read the banner at the top of this file. |
| **`PF-179`** | **P2** | `admin/roles` actions render `NEXT_REDIRECT;…` instead of redirecting. **Next story.** |
| **`PF-180`** | **P3** | `preferences-actions.ts` renders `HTTP 403` and discards the API's message. |

All three new ids are declared in `audit-findings-index.md` in the same commit that raised them (`TOOL-01` applied
prospectively), and were allocated **after** a fresh `git fetch` per `TOOL-05` — `origin/main` was `c8ee4f3`
throughout run 40, so no concurrent track could have taken them.

## ⚠️ Facts for your next run

1. **A normal run does not build, and this one did not.** No `pnpm build`, no build slot taken, no Docker rebuild.
   The stack was **not** touched: `docker ps` did **not return within 120 s** at the start of run 40, so the daemon
   is slow or wedged. Nothing in this slice needed it — but **do not assume the stack is healthy**; check before any
   story that does, and budget for the daemon being unresponsive.
2. **`TOOL-04` is live and it shapes what you may touch.** Any diff matching
   `^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)` escalates the gate to an api suite that **cannot
   finish on this machine**. Run 40 deliberately did **not** add a web-side server-action ratchet under `scripts/`
   for exactly this reason — the right control, unbuildable without forfeiting `GATE: PASS`. It stays a follow-up
   until the gate is repaired.
3. **`apps/web` has no unit runner — verified this run, not inherited.** `apps/web/package.json` declares only
   `test:e2e*` Playwright scripts, and neither `jest` nor `vitest` is a devDependency. `pnpm typecheck` is genuine
   evidence for a type-level claim and is **not** evidence that anything rendered.
4. **The Turbo cache is shared across track worktrees.** A gate log will print `cache hit, replaying logs` with a
   path under **another track's** worktree (run 40 saw `v3-track-a` paths while running in `v3-track-c`). That is
   correct behaviour for identical inputs, not a leak — do not debug it.
5. **Disk: 22 GB free on `C:` (96 % used)**, down from run 39's 31 GB. Not an emergency, not comfortable. The
   worktree residue in `.claude/worktrees/` is still uncleaned; see run 38's `NEXT.md` for the list and the three
   tests to apply.

---

cleanup-pending: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\` residue — unchanged by run 40.
**New and more urgent:** the uncommitted 2026-08-11 ledger fold in `C:\Users\HP\Downloads\pilotage-scolaire-claude`
(`TOOL-07`). Commit it before any `git checkout .` or salvage-stash in the main checkout discards it.
