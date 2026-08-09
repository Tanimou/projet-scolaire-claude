# NEXT — written by run 34 (`S-E04-6`), 2026-08-09

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-7`

| | |
|---|---|
| **Story** | `S-E04-7` — The remaining call sites move onto the seam, and a blocking gate keeps them there |
| **Epic** | `V3-E04` — Audit trail and governance surfaces (**7 of 8**) |
| **Layer** | **L0** |
| **Size** | M · `[api][worker][audit][gate]` |
| **Gates** | `G-AUDIT`, `G-DNC` *(**DNC-08** — a check that cannot run must FAIL — and **DNC-10**)* · **`G-MIGRATION` does not trigger** |
| **blockedBy** | **nothing** — `S-E04-6` shipped the seam (run 34), which was its only blocker |
| **Contract** | `docs/spec/features/v3-e04/tasks.md` § `S-E04-7` (from line 384) — read it verbatim, it is the contract |

### The number you will be measured against is 27, and it is a *post*-change count

`S-E04-6`'s ADR restates it deliberately: **27 direct `auditLog.create` sites across 15 files** still bypass the seam,
measured on branch `ci/2026-08-09-v3-e04-s6` **after** the five families moved. The contract's own AC-1 says **30**
across the full walk root. Both are right and they count different things — 27 is `apps/api/src` only; the walk root
is `apps/api/src` **+** `apps/worker/src` **+** `packages/imports-core/src`, and the two extra live at
`packages/imports-core/src/engine.ts:197` and `:288` (both already transactional). **Re-measure before you plan** —
one grep — and state which root your number uses. A gate rooted at the API alone is the `S-E06-5` blindness recurring.

`identity/roles.controller.ts` is the sharp one: it is the exact shape `ADR-035`'s Context cites as motivation
(`prisma.role.create` then, separately, `prisma.auditLog.create`) and it is **still** unconverted.

### Nine findings are already pointed at this story — read them before scoping, several are one-liners

`PF-136` · `PF-140` **P1** · `PF-141` · `PF-149` **P1** · `PF-150` · `PF-154` · `PF-155` · `PF-157` · `PF-158` ·
`PF-159` · `PF-160` · `PF-162`. That is more than one slice's worth; **batch the ones that share the seam and the
test** (the routine explicitly allows 3–5 per PR) and leave the rest pointed here. The cheapest real wins:

1. **`PF-162` (P2)** — type `AuditWriteInput.action` / `.resourceType` as `AuditActionCode` / `AuditResourceTypeCode`
   from `@pilotage/contracts/audit` instead of `string`. `apps/api` already depends on the package. It converts
   `ADR-035` D6 from convention to invariant and costs nothing. **Do this one first** — it is the half of the thesis
   `S-E04-6` left unfinished, and the gate you are about to write is much easier to trust once codes cannot be typos.
2. **`PF-150` (P2)** — encode « `S-E04-8` stays last » as a real `blockedBy` in `dependency-map.md`. Still not done;
   `S-E04-6` did not carry it and said so rather than quietly dropping it. **⚠️ Id collision, unresolved:**
   `docs/spec/features/v3-e04/PROGRESS.md` uses `PF-150` for a *different* finding (the `portal = ''` gap at
   `analytics.service.ts:3654`). Two registers, one number — renumber in both files at once or not at all.
3. **`PF-149` (P1, latent)** — `UnknownTimezoneError` is still caught nowhere. `S-E04-6` did **not** carry it: that
   slice touched no timezone path, and re-pointing it here was the honest move rather than ticking it. Fail-closed is
   the design; **do not reintroduce a fallback**.

### What `S-E04-6` shipped, so you do not re-derive it

`PF-31`'s **missing-row and non-transactional halves** are closed for five families. One seam:
`apps/api/src/shared/audit/write-audit.ts`, re-exported from `shared/audit/index.ts`, **11 call sites across 10
handlers in 4 files**. Vocabulary went 22 → **25** resource types and 48 → **57** actions, all in
`packages/contracts`, **zero** copies in `apps/web`. Full gate `GATE: PASS`.

- **The contract's own central claim was falsified, and the correction is the design.** `plan.md` §5, `tasks.md`
  note 1 and the story all asserted that typing the first parameter `Prisma.TransactionClient` makes
  `writeAudit(this.prisma, …)` a type error. **It does not** — `Prisma.TransactionClient` is
  `Omit<PrismaClient, ITXClientDenyList>`, `Omit` *removes* members rather than forbidding them, and TypeScript is
  structural, so a full client is assignable. The invariant would have been **green because it could not fire**.
  `AuditTransactionClient` re-adds the two deny-listed members as optional `never`; a declared method is not
  assignable to `never`, so `PrismaService` is rejected. Pinned by `// @ts-expect-error` at
  `write-audit.spec.ts:223`, and `apps/api/tsconfig.json` includes `src/**/*` with no spec exclusion, so the brand is
  RED in **both** directions. **Do not "simplify" it back.**
- **Fail-closed is now real** (`ADR-035` D2): an audit-insert failure re-throws and rolls the mutation back. No
  `try` sits around any call site, and a static assertion keeps it that way — a call site that downgraded a failed
  write to a warning would be a DNC-10 bypass wearing a different hat.
- **Provenance is derived before `$transaction` opens** at all ten handlers (`S-E06-6`'s rule): `AuditLog.ipAddress`
  is `@db.Inet`, so a failed cast inside the transaction would roll back the very mutation the row exists to trace.
  `assessment.publish` moved onto the seam and **gained provenance it never had** — that is `PF-123`'s write half,
  **at that one site only**.
- **`user_role`, not `user_profile`**, for grant/revoke: `AuditLog.resourceId` is `@db.Uuid`, the identifying value
  is `UserRole.id`, and a composite `userId:roleId` would be rejected by PostgreSQL — the audit row would fail the
  grant it traces. **`school.close`, not `school.delete`**: `DELETE /schools/:id` is a soft close.
- **Two authorisation defects were found, deliberately not fixed, and registered** — `PF-156` (**P1**, vertical
  privilege escalation: any `roles.assign` holder can self-grant any role) and `PF-153` (role lookup unfiltered,
  latent until `ADR-013`). Changing who may grant what, silently, inside an audit slice is what `ADR-015` exists to
  prevent. What changed is that the escalation now **writes a `critical` row naming the granted role**.

### One correction to the sprint's own ADR, made at land rather than inherited wrong

`ADR-035` originally asserted that this slice **closes** the role-tenancy hole. It does not, and the shipped code
says the opposite at `users.service.ts`. The ADR text was corrected in the land pass and the gap registered as
`PF-153` — an ADR is the register of record, and recording a check that does not exist is worse than recording the
gap, because the next slice reads it as done (`R-30`).

---

## ⚠️ Container-state facts that will otherwise waste your Step 2

1. **`pilotage_api` was NOT rebuilt this run.** It still runs run 32's image, so the container serves neither
   `S-E04-5`'s nor `S-E04-6`'s code. Every claim above is evidenced by unit test and by the full gate — **not** by
   the running API. If you need the new write paths live, that is one rationed rebuild of `api` only.
2. **The database is still ahead of the API container** (`tenant.timezone` exists in Postgres; the running client
   does not know it). Safe, additive, the expand phase behaving as designed. `S-E04-6` added **no** schema change.
3. **`pilotage_web` still serves an image from 2026-08-07.** Unchanged from runs 30–34.
4. **`PF-126` still blocks every `web` image rebuild** — `next build` inside BuildKit cannot fetch `Inter` from
   Google Fonts; both obvious explanations are already falsified (host: 200; bare `docker run alpine`: 200).
   **Do not re-test connectivity.** Fix direction is `next/font/local`; owner `V3-E02`.
5. **A sweep is still not schedulable**, for the reason runs 30–34 gave: its mechanism is one
   `docker compose build` + `--force-recreate`, and the `web` half of that is what is broken.

## One gate fact worth carrying: `boot` is timeout-sensitive under load

Run 34's **first** full gate printed `GATE: FAIL (1 stage)` — `apps/api — did not boot: boot did not finish within
180s (hung constructor?)`. It was **not** a defect: re-run alone on an idle machine it passed in seconds
(43 modules, 41 controllers, **229 routes**, route table unchanged), and the second full gate passed outright. The
machine had just finished an 18-agent sprint. If you see that line, **re-run the stage before diagnosing it** — but
do not treat a single green stage as a substitute for the full gate's verdict line.

## Still open from earlier runs, untouched by run 34

`PF-142`, `PF-146` (`V3-E02`) · `PF-145` **P1** (`V3-E05`) · `PF-121`, `PF-122` (`S-E04-7`) · `PF-124`…`PF-127`
from run 30 · `PF-148` (a11y). `PF-123` is now **fully** closed on the write side only at `assessment.publish`; the
rest of its write half stays with `S-E04-7`.

`PF-129` and `PF-133` remain the **same missing artefact**: there is no web-side quality gate and no web unit runner
(`apps/web` has Playwright only — also `PF-100`'s blocker and part of `VAL-08`). Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\vigorous-cannon-d1d65a

> Step 0.5 D: run 34 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 33's handoff (`brave-almeida-541d05`) is discharged at the git level** — run 34 deregistered it, along with
> `distracted-cartwright-5287d0`, `keen-mendeleev-53ae1d` and `quizzical-hermann-8d4460`. `git worktree list` now
> shows only the main checkout, the unrelated `.codex` one, and this run's. All four **directories** survive on disk:
> `git worktree remove` reported *"Permission denied"* on the delete for every one, exactly as runs 31–33 saw. Inert
> leftover bytes, not worktrees; no git command is needed, just delete them when the holding process is gone. Same
> for `awesome-spence-9e6f69`, `pensive-raman-4baf7c`, `musing-archimedes-77d454`, `youthful-jones-758d15`,
> `agitated-cerf-ad2bdf`, `elated-ellis-40bb4a`, `inspiring-mclaren-a76c8e`, `sharp-albattani-ec7c4d` and
> `stoic-allen-b8284b`.
>
> Unchanged and still requiring a human, said now by runs 29–34: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB: `PLAN.md`, `packages/`, `upcomingicsexport.patch`) — unreachable *and* unattributable, so it is
> not deleted. `youthful-chaum-6aad5c` is **dirty** (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion stays denied by the permission classifier** (`git push origin --delete`), for the
> third run running. All 38 merged remote `ci/*` branches back no open PR and are safe to delete whenever the
> permission allows. Run 34 deleted the one local merged branch (`ci/2026-08-09-v3-e04-s5`) — local deletion is
> permitted, only the remote push is not.
