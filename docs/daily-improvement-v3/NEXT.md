# NEXT — written by run 37 (`S-E04-9`), 2026-08-10

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-11` — the regulator-facing export stops changing bytes silently, and stops dying on a value nothing validates

| | |
|---|---|
| **Story** | `S-E04-11` — batch **`PF-140` (P1)** + **`PF-149` (P1)** *(no story file yet; the contract is the two rows in `OPEN.md`, which state the fixes verbatim)* |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | **M** — two findings, one seam, two tests |
| **Gates** | `G-TRUTH`, `G-DNC` · **`G-MIGRATION` does not trigger** · `G-TENANT` only if you touch the query |
| **blockedBy** | **nothing** |

**Why these two together.** Run 36 named them the natural batch after `S-E04-9`, and run 37 confirms the seam is
genuinely shared: both live in the DPO audit-export path and both touch `apps/worker/.../audit-csv.generator.ts`
(`PF-140` on its header and escaping, `PF-149` at `:68`, where an unhandled `UnknownTimezoneError` kills every
`audit_csv` job). `PF-149`'s second half lands in `analytics.service.ts` (`GET /api/v1/analytics/audit`, the same
unhandled throw as a 500). **Batch them, but do not expect one test to cover both** — the routine's batching rule is
*one seam and one test*; this is one seam and two. That is still a batch worth taking, because the alternative is two
runs paying the same read-in cost on the same file. Say so in the PR rather than claiming a shared test.

**Both are `latent`, and both stay P1 for the same measured reason.** Neither can fire today — no exported column is
reachable free text yet, and nothing writes `Tenant.timezone`. Both become live the moment one small thing changes
(`S-E04-3` has already started populating `user_agent`, one column from the export; any settings screen, import or
seed can write the timezone). **Do not re-scope them down to P2 on the strength of "it cannot fire today"** — that
measurement is already in their rows and is the reason they are worded as they are.

**Two traps stated in the rows, repeated because both invite the wrong fix:**
- `PF-140` — **append** `action_vocabulary` / `resource_type_vocabulary` at the end. Do not insert mid-header again;
  that is the defect. Neutralise leading `=`/`+`/`-`/`@`/tab and bare `\r` in `csvEscape` **before** any slice widens
  the export, not after.
- `PF-149` — fix by **validating on write** (`isKnownTimezone` already exists and is exported) and by mapping the
  error to a deliberate HTTP response. **Do not reintroduce a fallback to the server zone** — that silent fallback is
  precisely the defect `S-E04-5` removed.

---

## What `S-E04-9` shipped, so you do not re-derive it

**`PF-163` (P1) is closed by resolution (a), COMPENSATE — the routine declined the mechanical (b), and that decision
is the load-bearing one.** (b) would have dropped `invite` back out of the audit sweep and baselined it under
`best-effort-post-commit` (9 + 18 = 27). It was declined because it only narrows the trigger from *profile or role or
audit fails* to *profile or role fails*: the `ADR-002` escalation stays fully reachable through any profile-create
failure, which is pre-existing rather than introduced by `S-E04-7`. **`invite` therefore stays in the sweep and the
arithmetic stays `10 + 17 = 27`.** `scripts/audit-write-baseline.json` and `audit-write-gate.spec.ts` are untouched.

- **On rollback, the orphan is deleted.** `KeycloakAdminService` gains exactly one method, `deleteUser`, in which
  **404 is a success** — already-gone is the desired state, and a compensation that manufactures a phantom orphan is
  worse than one that is idempotent. The compensation is **non-masking**: the original error is re-thrown unchanged.
- **When the delete itself fails, nothing is swallowed.** The admin gets a French sentence naming the orphaned
  `kcUserId` (`actions.ts` renders `body.message` raw, so the id has to be *in the string*), the original failure
  travels as `cause`, and both reach `Logger.error`.
- **`.catch()` plus a private `persistInvitedProfile` method, and that shape is forced, not taste.**
  `scripts/audit-write-check.js:265-274` (`insideTryBlock`) walks **every** AST ancestor of a `writeAudit` call, so a
  `try` anywhere above it turns rule B red. The routine verified this by reading the walker, not by trusting the
  comment. `writeAudit` itself is byte-for-byte unchanged: one unconditional statement, inline object literal,
  transaction client first.
- **`ADR-035` gains D15–D17, and it also rules on a numbering collision:** `D15` had been claimed three times by
  different slices and no claimant had landed. `S-E04-9` takes **D15–D17**, the carried documentation correction takes
  **D18**, and **`S-E04-8` reserves D19 onward**. Use that allocation.

### ⚠️ AC-4 was WITHDRAWN mid-slice, and the withdrawal is the most important thing in this run

The story's AC-4 asked step 1's `ConflictException` dead end to become a **repair path**: adopt a Keycloak account
that has no local `UserProfile`. The implementation panel refused it and falsified its premise. **The routine
independently verified all three facts before accepting the refusal** — do not re-open this without reading them:

1. `UserSyncService.ensureUser` creates the profile **lazily, on first login**. Every realm identity that has never
   logged in is profile-less **by design**, not by failure. So "no local profile" is *not* evidence of an orphan.
2. `infra/keycloak/realm-export.json` ships three such identities — `admin@`, `teacher@`, `parent@pilotage.local`,
   enabled — and `apps/api/prisma/seed-demo.ts` contains **0** matching rows (`grep -c`, measured).
3. `ADR-004` puts every tenant in **one** realm, so those identities are reachable from **any** tenant.

Adoption would therefore have matched *any never-onboarded account*, handing any `users.write` holder in an arbitrary
tenant a password overwrite, a realm-role grant, and — since `authProviderId` is globally `@unique`
(`schema.prisma:838`) — a **permanent** binding of that identity to their own tenant. That is the `ADR-002` breach
this slice exists to close, reached through a new door. **`PF-163` closes anyway, by the stronger half:** its row
offers the two halves as *and/or*, and the compensation removes the orphan rather than adopting it.

The sound version of adoption needs a **positive** marker stamped at `createUser` time. It cannot be written today:
Keycloak 26 (`infra/docker-compose.yml:184`) disables unmanaged user attributes by default and the realm export
declares no `components`, so the attribute would be dropped on write; the local alternative is an invite-intent table,
and `G-MIGRATION` does not trigger in a compensation slice. **Re-pointed, not silently dropped.**

## Findings discovered this run — all P2, recorded and NOT storified (routine triage)

| Id | What |
|---|---|
| **`PF-165`** | `ensureUser` self-provisions any profile-less identity into the hard-coded **`demo`** tenant with realm-derived permissions. **The amplifier that gave `PF-163` its severity, reachable without it.** Until this run it existed only inside `PF-163`'s prose — closing `PF-163` would have silently retired it. Latent while `demo` is the only tenant; a live `ADR-002` breach the day a second exists → moved to **`V3-E05`**. |
| **`PF-166`** | `POST /auth/register-parent` — the one **public** account-creation path — writes **no audit row at all**, and creates the account in four non-atomic steps with no compensation. `PF-46` covers throttling and self-verified email at this endpoint, **not** atomicity and not the missing row. |
| **`PF-167`** | The invite path's **SMTP-failure branch** still orphans an identity, **deliberately** — deleting the account there would falsify the message it returns. Same orphan class as `PF-163`, different trigger, different remedy (an `ActivationHint.tsx` copy change, `PF-17`'s seam). Recorded so `PF-163`'s closure cannot be read as *"invite can no longer orphan an identity"*. |
| **`TOOL-03`** | The audit-write sweep counts **existing** audit writes, so a privileged mutation writing **none** is invisible to it. It proves *every audit write goes through the seam*, never *every privileged mutation writes one*. `PF-166` is the live instance — found by reading a controller, not by any gate. |

All four are **declared in `audit-findings-index.md` in the same commit that raised them** — the `TOOL-01` lesson
applied prospectively. An id the ledger cites but the index does not declare cannot own a baseline row, which is what
blocked run 36.

---

## ⚠️ Container and tooling facts that will otherwise waste your Step 2

1. **No Docker rebuild this run.** Evidence is unit tests plus the full 19-stage gate. `pilotage_api` still serves an
   image built **2026-08-09 02:58**, so it contains neither `S-E04-7`, `S-E04-10` nor `S-E04-9`. Nothing above is
   claimed against the running API.
2. **`pilotage_web` still serves an image from 2026-08-07**, and **`PF-126` still blocks every `web` image rebuild** —
   `next build` inside BuildKit cannot fetch `Inter` from Google Fonts; both obvious explanations are already
   falsified (host: 200; bare `docker run alpine`: 200). **Do not re-test connectivity.** Fix direction is
   `next/font/local`; owner `V3-E02`. A sweep therefore remains unschedulable, for the reason runs 30–36 gave.
3. **`TOOL-02` did not fire this run** — `git log HEAD..origin/main` was empty at land, so no PR merged mid-sprint.
   Keep making that check; it costs one command and run 36 needed it.
4. **`ci-gate.sh` builds at stage 6**, so Step 4's standalone `pnpm build` must be **skipped** — one build per run
   means one. Run 37 took that path.

## Still open in `V3-E04` after this run

`PF-140` **P1** and `PF-149` **P1** *(next story)* · `PF-164` *(durable half — gate narrowing, blocked on
`remediation.controller.ts`'s baselined forwarders)* · `PF-136`, `PF-141`, `PF-148`, `PF-150` (id collision still
unresolved — renumber in both files at once or not at all) · `PF-154` (enrollment transfer capacity race) · `PF-160` ·
`PF-121` and `PF-123`'s write half · `PF-166`, `PF-167`, `TOOL-03` *(new, P2)* · `PF-153`, `PF-156`, `PF-165` →
`V3-E05`.

`PF-129`/`PF-133` remain the **same missing artefact**: no web-side quality gate and no web unit runner (`apps/web` has
Playwright only — also `PF-100`'s blocker and part of `VAL-08`). Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\ecstatic-mcclintock-1d0445

> Step 0.5 D: run 37 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 36's handoff (`jolly-engelbart-789ce0`) is discharged at the git level** — run 37 confirmed it is no longer a
> registered worktree; `rm -rf` still reports *"Device or resource busy"*, exactly as runs 31–36 saw. It is inert
> leftover bytes, not a worktree; no git command is needed, just delete it when the holding process is gone. Also on
> disk and inert, unchanged from run 36: `vigorous-cannon-d1d65a`, `clever-haibt-fff645`, `awesome-spence-9e6f69`,
> `pensive-raman-4baf7c`, `brave-almeida-541d05`, `distracted-cartwright-5287d0`, `keen-mendeleev-53ae1d`,
> `quizzical-hermann-8d4460`, `agitated-cerf-ad2bdf`, `dazzling-agnesi-18e92e`, `inspiring-mclaren-a76c8e`,
> `sharp-albattani-ec7c4d`, `stoic-allen-b8284b`, `sweet-euler-fdad66`, `sweet-lichterman-b7c1b7`. **22 directories
> sit under `.claude/worktrees/` and only 1 is a registered worktree** — the rest are this residue.
>
> Unchanged and still requiring a human, said now by runs 29–37: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB: `PLAN.md`, `packages/`, `upcomingicsexport.patch`) — unreachable *and* unattributable, so it is
> not deleted. `youthful-chaum-6aad5c` is **dirty** (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion works.** Run 37 deleted **14** merged remote `ci/*` branches. Note the mechanism:
> they were **squash**-merged, so `git branch -r --merged origin/main` reports **none** of them as merged. Resolve
> each branch's PR state with `gh pr list --head <branch> --state all` instead — run 37 did, and all 14 were `MERGED`.
