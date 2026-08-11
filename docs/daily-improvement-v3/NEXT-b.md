# NEXT — track **b** (authz & audit) · written by run 39 (`S-E05-2`), 2026-08-11

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the decision
> from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.
>
> Track b's seam (`tracks.md`): `apps/api/src/shared/auth/**` · `apps/api/src/modules/identity/**` ·
> `apps/api/src/modules/audit/**` · guards, DTOs and permission code in other `apps/api` modules.

## ▶ Next story → `S-E05-11` — the invite path's atomicity and its missing audit row (`PF-166`)

| | |
|---|---|
| **Story** | resolve **`PF-166` (P2)** and, if the seam allows, **`PF-167`**'s half that is a code change *(no story file yet; the contract is `PF-166`'s row in `OPEN.md`)* |
| **Epic** | `V3-E04` |
| **Layer** | **L0** |
| **Size** | **S–M** |
| **Gates** | `G-AUDIT`, `G-TENANT`, `G-DNC` · **`G-MIGRATION` does not trigger** · `G-PORTAL` does not trigger (admin surface only — *verify before asserting*) |
| **blockedBy** | **nothing** |

**Why this and not the obvious one.** The obvious next story is `S-E05-2b` — close `PF-09`'s residual with the
delegation ladder. **It is blocked on `D-12`** (raised by this run, `open-decisions.md`), and Step 1 forbids selecting a
story with an unresolved `requiresDecision`. Do not take it until a human answers `D-12`. `PF-178` and `PF-174` are
likewise decision- or seam-blocked (`PF-174` is `apps/web` — **track c's**, not yours).

**What `PF-166` is.** `apps/api/src/modules/identity/register.controller.ts:65-126` — `POST /auth/register-parent` is
the one **unauthenticated** account-creation path. It creates a Keycloak identity, sets a **permanent** password,
upserts the `demo` tenant and creates a `UserProfile` as **four separate statements with no `$transaction` and no
compensating action**, and it writes **no `auditLog` row on any path**. Both halves are squarely in your seam, and both
have a proven local pattern to copy: `S-E04-9` already built the `deleteUser` compensation on `invite.controller.ts`,
and `S-E04-7` already moved that file's writes into one transaction. This is that fix at its last address.

**Verify the premise first (Step 2).** Re-read the handler — `S-E05-2` edited `invite.controller.ts` in the same module
this week, so confirm `register.controller.ts` was not swept along. `grep -c auditLog register.controller.ts` settles
the audit half in one command.

**Watch for the seam rule that bit this run.** `writeAudit` must stay **one unconditional statement with an inline
object literal** (`ADR-035` D1) — `scripts/audit-write-check.js` and the vocabulary gate resolve `action` and
`resourceType` from the call-site AST. Do not wrap it in an `if`; use an early return above it, as
`users.service.ts revokeRole` does.

**Second candidate if `PF-166` turns out to be closed by other work:** `PF-153` — but only if `ADR-013` has landed.
Until then the unfiltered role lookup at `users.service.ts:85` **must stay unfiltered**, and the docblock at `:67-72`
saying so must stay.

---

## What `S-E05-2` shipped, so you do not re-derive it

**`PF-156` closed. `PF-09` narrowed, not closed — and the difference is the whole story.**

- **One pure predicate, four call sites.** `shared/auth/privilege-ceiling.ts` exports `exceedsGrantor(grantorSet,
  requested)` and `assertWithinCeiling(...)`. Plain functions — no class, no injectable, no decorator — for the same
  reason `shared/audit/provenance.ts` is: an explicit call is auditable by grep, where a guard is a place a future
  author forgets. Wired into `roles.controller.create()`, `roles.controller.update()` (only when `permissionCodes` is
  present — a rename stays exempt, commented as deliberate), `users.service.assignRole()` and `invite.controller`'s
  custom-role grant. **Every refusal is thrown before its `$transaction` opens**, so it writes no `Role`, no `UserRole`
  and **no audit row**.
- **The grantor's set is derived at the controller** from the existing `UserSyncService.effectivePermissions` seam and
  passed in. `UsersService` gained a parameter, not a dependency.
- **Fail-closed is structural, and was proven by mutation rather than asserted.** Replacing the predicate body with
  `return []` turns **20 of 79 tests red across all four suites** (measured by the routine on the landed tree, then
  reverted). An absent or empty grantor set denies everything — live, not theoretical: `user-sync.service.ts:67`
  resolves an unrecognised realm role to `[]`.
- **`super_admin` is unaffected structurally, not by exemption.** Its realm role already carries the whole catalogue, so
  the predicate returns `[]`; the string `super_admin` appears nowhere in the module. An `if (roles.includes(…))` would
  be a bypass wearing a role name.
- **The routine's own briefing was falsified, and the correction was kept.** The brief asserted a `school_admin` could
  POST the *seeded* `super_admin` role id. `grep -rn super_admin apps/api/prisma/` returns **zero** matches — `seed.ts`
  seeds only `school_admin`, `teacher`, `parent`, `student`. The real chain is worse and does reproduce: mint a custom
  role carrying all 89 codes, self-assign it, re-authenticate. **Both halves are now refused.** Do not restate the
  seeded-`super_admin` version; it is not true.
- **The blanket `isSystem` ban that `PF-156`'s text proposed was deliberately NOT implemented**, and `ADR-015` records
  the *corrected* reason. The routine's brief argued it was "redundant where right and breaking where wrong"; that is
  measurably wrong — the ceiling already refuses **every** seeded `isSystem` role for a non-`super_admin` grantor, so
  the ban is pure redundancy.

## Findings discovered this run

| Id | Pri | What |
|---|---|---|
| **`PF-178`** | **P1** | The ceiling refuses `school_admin` the `teacher`/`parent`/`student` roles too. Needs **`D-12`**. |
| **`PF-174`** | **P1** | `/admin/users` swallows the new 403 in silence. **Track c's seam** — not yours. |
| `PF-175` | P2 | Pre-ceiling escalated grants pass it unconditionally; the detection query is recorded, not run. |
| `PF-176` | P3 | The escalation-attempt `warn` is anonymous — the predicate has no actor context by design. |
| `PF-177` | P3 | A duplicated permission code answers 400 while naming no code at all (pre-existing). |
| **`TOOL-04`** | **P1** | **The fast gate's escalated api stage cannot finish.** Read this before your gate run — see below. |
| **`TOOL-06`** | **P1** | **The new CSV escaper gate has never run.** Its only `run_stage` call omits the timeout and exits 125. Six sibling calls are broken too, but have working duplicates lower down. |
| **`TOOL-05`** | **P2** | **Finding-id allocation is a race.** Track c and track b both allocated `PF-173` on 2026-08-11; mine renumbered to **`PF-178`**. **Re-check the register for your id AFTER your final fetch, not when you first raise it.** |

All five are **declared in `audit-findings-index.md` in the same commit that raised them** — `TOOL-01` applied
prospectively, as run 38 established.

## 🛑 READ BEFORE YOUR GATE RUN — `TOOL-04`

**`S-E05-2` could not be auto-merged, and the reason was the gate, not the diff.** `ci-gate.sh` runs the **whole** api
suite (2400 s bound) when the diff matches
`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)`, and `--skip src/shared/quality/` (1200 s) otherwise.
**The whole suite does not complete on this machine — it blocks.** Measured four ways: timed out contended, timed out
uncontended, **still blocked at ~80 min unbounded** with its 7 jest workers holding only 7–40 s of CPU each, and
`--skip src/shared/quality/` returning **`1008/1019 · no drift`, exit 0** in minutes.

**What this means for you, concretely:**

- **If your diff touches `apps/api/src/shared/quality/**`, your gate will fail on `test:api` no matter how clean your
  code is.** Budget for it, and do not go hunting in your own diff — `S-E05-2` lost an hour to that.
- Produce the evidence out of band with `node scripts/test-ratchet.js api --skip src/shared/quality/` and **say in the
  PR that it is the non-escalated command**, not the stage's own.
- **Still leave the PR open and flagged.** AUTO-LAND keys on the printed `GATE: PASS` line (`R-23`), not on your
  judgement about why it failed. `S-E05-2` did this and it is the right precedent.
- **`PF-90` is live.** Three `test-ratchet.js api` trees were alive at once, two orphaned for 7–8 h; the routine killed
  **24** orphaned processes. **Enumerate `Win32_Process` before you trust any gate timing**, and kill only trees whose
  track shows `free` in `routine-lock.sh status`.

## ⚠️ Facts for your next run

1. **`origin/main` moved mid-run** (to `#217`, a gate repair) and this branch was rebased onto it before the gate ran.
   With three tracks landing, expect this; rebase and re-run rather than treating it as an error.
2. **The sprint workflow now honours its `worktree` argument.** Run 39's agents edited the track worktree, not the main
   checkout — the old relocate-by-stash dance was not needed. Still worth a `git -C $REPO status` at land.
3. **`bmad/workflows/sprint.workflow.js` is CRLF**, and the Workflow tool refuses it (`control characters … hidden in
   the approval dialog`). Copy it to the scratchpad with `tr -d '\r'` and pass that `scriptPath`.
4. **Disk recovered**: 30 GB free on `C:` at run 39, against the ~1.15 GB emergency run 38 reported. That banner is
   resolved; the worktree-residue cleanup below is still outstanding but is no longer urgent.

---

cleanup-pending: `C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\` residue — see run 38's `NEXT.md`
for the full list and the three tests to apply. Unchanged and untouched by run 39.
