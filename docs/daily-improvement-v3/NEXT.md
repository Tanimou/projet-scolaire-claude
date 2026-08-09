# NEXT — written by run 36 (`S-E04-10`), 2026-08-09

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ▶ Next story → `S-E04-9` — the invite path stops trading an account for an audit row

| | |
|---|---|
| **Story** | `S-E04-9` — resolve `PF-163` **(P1)** *(no story file yet; the contract is `PF-163`'s row in `OPEN.md`, which states both acceptable resolutions verbatim)* |
| **Epic** | `V3-E04` — Audit trail and governance surfaces |
| **Layer** | **L0** |
| **Size** | **S** if you take resolution (b), **M** if you take (a) |
| **Gates** | `G-AUDIT`, `G-TENANT`, `G-DNC` · **`G-MIGRATION` does not trigger** |
| **blockedBy** | **nothing — and the one thing that blocked it is now cleared (see below)** |

### Read this first: PR #208 merged **unresolved**, and that changes what you are walking into

Run 35 left `S-E04-7` open, titled `⚠️ PF-163 (P1) needs a human ruling`. **A human merged it at 21:36 on 2026-08-09
with that title intact** (`bfbf029`). Do not read the merge as the ruling. Nothing in `PF-163`'s row was answered; the
code simply landed. So the P1 is now **on `main`**, not held behind a PR, which raises its urgency rather than
lowering it: `S-E04-8` (the hash chain) is the last slice of the epic and `plan.md` §2's ruling — a chain computed
over provenance that is not yet true is a cryptographically verifiable record of falsehoods — still forbids chaining
over this. **Resolve `PF-163` first.** That was run 35's judgement and run 36 concurs.

### Resolution (b) is now genuinely executable — that was the point of TOOL-01, and it needed amending

Run 35 flagged that (b) was **blocked** because `audit-write-check.js` resolves baseline owner ids against
`audit-findings-index.md`, which stopped at `PF-133`. Run 36 appended the missing ids. **The list turned out to be 28,
not 26**, because `PF-163` and `PF-164` themselves reached `OPEN.md` only when #208 merged *during* this run — the
merge re-opened the very gap the append had just closed. Both are now declared, so a baseline row owned by `PF-163`
**will bind**. The index now resolves **161** unique ids.

**(b), mechanically:** drop `invite.controller.ts` back out of the sweep, baseline it under `best-effort-post-commit`
with `PF-163` as its owning finding, and move the arithmetic from **10 + 17 = 27** to **9 + 18 = 27** in
`scripts/audit-write-baseline.json`'s `$doc` and in `audit-write-gate.spec.ts:577`/`:584`/`:612-621`.
**(a) compensates instead:** delete or disable the freshly created `kcUserId` when the transaction aborts, and/or let
step 1 repair a Keycloak account that has no local profile. Better product behaviour, more work, and it changes an
identity path — take it as its own slice, do not fold it into a baseline edit.

**Either way the missing artefact lands with the fix:** there is still **no `invite.controller.spec.ts`**. It needs a
fake `$transaction` that **stages then commits**, so a callback throw is *observably* not persisted. The AC-10
evidence for that site today is a regex over the controller's source text — which is exactly how `PF-163` reached
three review panels without a single failing assertion.

---

## What `S-E04-10` shipped, so you do not re-derive it

**Four findings closed on one seam and one thesis: an audit row must correspond to exactly one real state transition,
name the transition that actually happened, and record the fields that changed.** `PF-155` (P2), `PF-157`, `PF-158`,
`PF-159` (P3) — moved to `CLOSED-L0.md` with evidence. Three production files, three existing specs extended, zero
files under `apps/web`, `packages/contracts`, `schema.prisma` or SQL.

- **`status` is gone from `UpdateSchoolDto`.** `PATCH /schools/:id { status: 'closed' }` was a **second closure door**:
  it bypassed `DELETE`'s students / academic-years refusal *and* filed the closure as `school.update`, so an auditor
  filtering « Fermeture d'un établissement » saw none of those closures. Both codes are `critical: true`, so the KPI
  **count** never moved — the **attribution** was wrong. `main.ts:140-146` sets `forbidNonWhitelisted: true`, so
  sending it is now a loud **400**, never a silent ignore. `UpdateSchoolDto` was **exported** so that refusal is
  provable at the pipe itself: controller unit tests traverse no `ValidationPipe`, so an assertion posted on
  `update()` would have been green without the guard ever firing.
- **The same removal deleted the only REOPEN path**, which never had a code, an endpoint, a UI or a test — it existed
  only as the DTO hole. No `school.reopen` was invented (vocabulary is `S-E04-4`'s seam). Registered as **`D-11`** in
  `open-decisions.md`; it blocks no story, but a school closed by mistake now has no in-product recovery.
- **The no-op rule is applied consistently across the four families**, always as an early return **after** the tenant
  guard and **before** `$transaction` opens. Both halves are load-bearing: after, or `PATCH {}` on a foreign-tenant id
  returns 200 with the foreign school's body — a cross-tenant read oracle created by a correctness fix; before, so
  every `writeAudit` stays **one unconditional statement with an inline literal**, which is what keeps the diff
  passing `audit-write-check.js`.
- **Two things the sprint found that the brief did not ask for, and both are real:**
  1. `enrollment.cancel` was overwriting `endedAt` unconditionally, so cancelling an already-`transferred_out` or
     `completed` enrollment **erased the date the schooling actually ended**. That is data loss, not an audit defect.
     Now conditional, with `endedAt` recorded on both sides so the preservation is legible in the trail.
  2. A naive `body.status === enrollment.status` no-op check would itself have lost data: `:284` only sets
     `endedAt`/`endReason` when `isEnding && !enrollment.endedAt`, so an enrollment created directly in a terminal
     status is genuinely timestamped for the first time by a same-status PATCH. The guard is *status identical* **and**
     *end already timestamped*.
- **`PF-157`'s correctness now comes from the database, not from a read.** `tx.userRole.updateMany({ where: { id,
  revokedAt: null, userProfile: { tenantId } } })` inside the transaction, branching on `count === 0`. At READ
  COMMITTED the loser re-evaluates its predicate against the new row version, gets `count = 0`, writes no row and
  returns the winner's state. The pre-transaction guard is kept as a **fast path only** and says so. The relation
  filter in `updateMany` was **executed against the live Postgres through the real Prisma query engine**, not assumed
  from types — mocked unit tests cannot tell a supported query from an unsupported one.
- **No database backstop was added, deliberately.** `@@unique([userProfileId, roleId, schoolId])` cannot deduplicate
  because `schoolId` is written `null` and PostgreSQL treats NULLs as distinct. The partial unique index
  `(user_profile_id, role_id) WHERE revoked_at IS NULL` is the right long-term fix, is a **schema change**, and
  protects a *different* race — two concurrent `assignRole` calls creating two active rows, which `create` cannot make
  conditional. **That residual is still open and nothing above narrows it.**
- **Severity re-scoped honestly by measurement, not inherited.** `PF-158`'s KPI inflation is real in code but
  **latent in data**: the live database holds **61** audit rows and **0** in any of the four families, and **0** rows
  anywhere have identical `before`/`after`. The families shipped in run 34 and have seen no traffic through them.
- **`PF-156` (P1, self-grant escalation) and `PF-153` stay open by design.** `revokeRole` was rewritten and **who may
  revoke did not move** (`ADR-015`). The `userProfile: { tenantId }` clause added to the `updateMany` `where` grants
  nothing — the `ForbiddenException` above already refused every case where it could differ; it makes the scoping
  structural so a future refactor fails closed.

---

## ⚠️ Container and tooling facts that will otherwise waste your Step 2

1. **No Docker rebuild this run.** Evidence is unit tests plus the full gate plus two executed probes against the
   live stack. `pilotage_api` still serves an image built 2026-08-09 02:58, so it does **not** contain `S-E04-7` or
   `S-E04-10`. Nothing above is claimed against the running API.
2. **`pilotage_web` still serves an image from 2026-08-07**, and **`PF-126` still blocks every `web` image rebuild** —
   `next build` inside BuildKit cannot fetch `Inter` from Google Fonts; both obvious explanations are already
   falsified (host: 200; bare `docker run alpine`: 200). **Do not re-test connectivity.** Fix direction is
   `next/font/local`; owner `V3-E02`. A sweep therefore remains unschedulable, for the reason runs 30–35 gave.
3. **The whole `obs` profile is up and healthy** (Prometheus, Grafana, Loki, Jaeger), as are all app containers.
4. **`TOOL-02` (P2, new — routine, not product): a PR can merge into `$REPO` mid-run and fast-forward the feature
   branch under the sprint's feet.** That is what #208 did at 21:36. It was benign **only** because the two diffs did
   not overlap on any production file, which the routine verified file-by-file rather than assumed; the four
   overlapping docs files were then re-checked line-by-line to confirm the agents had edited post-merge content
   rather than reverting it. **Check this explicitly before committing** — `git -C "$REPO" log --oneline
   origin/main..HEAD` plus a `--stat` overlap check against any commit that arrived during the sprint. Recorded under
   `TOOL-`, not as a product finding.

## Still open in `V3-E04` after this run

`PF-163` **P1** *(next story)* · `PF-164` *(durable half)* · `PF-140` **P1** and `PF-149` **P1** — **these two share
the audit-export seam** (`audit-csv.generator.ts`, `analytics.service.ts`) and are the natural batch **after**
`S-E04-9` · `PF-136`, `PF-141`, `PF-148`, `PF-150` (id collision still unresolved — renumber in both files at once or
not at all) · `PF-154` (enrollment transfer capacity race — *not* taken this run) · `PF-160` · `PF-121` and
`PF-123`'s write half · `PF-153`, `PF-156` → `V3-E05`.

`PF-129`/`PF-133` remain the **same missing artefact**: no web-side quality gate and no web unit runner (`apps/web` has
Playwright only — also `PF-100`'s blocker and part of `VAL-08`). Build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\jolly-engelbart-789ce0

> Step 0.5 D: run 36 executed inside that worktree and could not delete the ground it stood on. Apply the three
> Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 35's handoff (`vigorous-cannon-d1d65a`) is discharged at the git level** — it was already unregistered; run 36
> confirmed the directory survives on disk and `rm -rf` still reports *"Device or resource busy"*, exactly as runs
> 31–35 saw. Same for `clever-haibt-fff645`, which run 36 deregistered this run (clean, merged, backing no open PR)
> and whose directory is likewise locked. These are inert leftover bytes, not worktrees; no git command is needed,
> just delete them when the holding process is gone. Also on disk and inert: `awesome-spence-9e6f69`,
> `pensive-raman-4baf7c`, `brave-almeida-541d05`, `distracted-cartwright-5287d0`, `keen-mendeleev-53ae1d`,
> `quizzical-hermann-8d4460`, `agitated-cerf-ad2bdf`, `dazzling-agnesi-18e92e`, `inspiring-mclaren-a76c8e`,
> `sharp-albattani-ec7c4d`, `stoic-allen-b8284b`, `sweet-euler-fdad66`, `sweet-lichterman-b7c1b7`.
>
> **Two worktrees registered themselves during this run** — `awesome-wilbur-c0301c` and `relaxed-liskov-1caf4a`, both
> clean and both parked on this run's branch. They are not this session's. Apply the Step 0.5 C tests to them.
>
> Unchanged and still requiring a human, said now by runs 29–36: `laughing-wing-54e738` is unregistered but **not
> empty** (~1.4 MB: `PLAN.md`, `packages/`, `upcomingicsexport.patch`) — unreachable *and* unattributable, so it is
> not deleted. `youthful-chaum-6aad5c` is **dirty** (staged deletions under `docs/`); the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion is NO LONGER denied.** Runs 32–35 recorded the permission classifier refusing
> `git push origin --delete` three runs running. It **succeeded this run**: all **26** merged remote `ci/*` branches
> were deleted. The backlog is clear; keep pruning normally.
