# NEXT — written by run 38 (`S-E04-11`), 2026-08-10

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## 🛑 READ FIRST — the machine ran out of disk during run 38

**`C:` hit 100% (0 bytes free on 476 GB) while run 38's CI gate was running.** The gate was stopped rather than
allowed to report a verdict it could not honestly produce. Run 38 reclaimed **1.04 GB** by deleting only
unambiguously regenerable caches — every `.turbo` directory and `apps/web/.next/cache` — leaving **~1.15 GB** free.

**What run 38 deliberately did NOT delete, and why you should not either without a human:**
- **No Docker images or volumes.** `PF-126` makes the `web` image **unrebuildable** (`next build` inside BuildKit
  cannot fetch `Inter` from Google Fonts). Deleting it would take the stack down with no way back.
- **Not `node_modules/.cache/prisma`.** Those are the Prisma engines; removing them forces a network re-download at
  gate stage 1.
- **Not the ~22 residue directories under `.claude/worktrees/`.** They are OS-locked, almost certainly by the two
  idle `claude` processes from 02:44 and 03:07 that took `GATE=BUSY` and stopped. Killing another session's process
  is not the routine's call.

**Consequence for your run:** ~1.15 GB is *marginal* for a full gate, and the Turbo cache is now **cold**, so the
first gate after this will be a full rebuild — slower and hungrier than usual. **Check free space before Step 6**
(`df -h /c`). If the gate dies on `ENOSPC`, that is the environment, not the diff — do not go hunting in the code.
This is a **human-owned** problem: 476 GB is full and the routine can only reclaim caches.

---

## ▶ Next story → `S-E05-x` — the CSV escaper that actually has a payload path

| | |
|---|---|
| **Story** | resolve **`PF-168` (P1)** *(no story file yet; the contract is `PF-168`'s row in `OPEN.md`)* |
| **Epic** | `V3-E04` → **`V3-E05`** |
| **Layer** | **L0** |
| **Size** | **S–M** |
| **Gates** | `G-TRUTH`, `G-DNC`, `G-PORTAL` *(admin **and** teacher)* · **`G-MIGRATION` does not trigger** |
| **blockedBy** | **nothing** — but see the disk note above |

**Why this and not a P2.** Triage says a discovered **P1** becomes a story in the current layer **now**. `PF-168` is
the same defect class `S-E04-11` just closed — a BOM-prefixed CSV whose escaper quotes but does not neutralise — with
one difference that inverts the severity: **the audit CSV has no reachable free-text column today; this one does.**
`apps/web/src/lib/csv.ts:17` (`/[",;\n\r]/`, plus `CSV_BOM` at `:11`) backs four live export buttons, and
`GuardiansExportButton.tsx:75-83` exports `profession` — arbitrary operator-entered text — alongside names, emails
and phones. Two portals, admin and teacher.

**Take the fix `S-E04-11` already proved, then delete the duplication.** The additive, reversible form is settled:
force-quote **and** prefix a single apostrophe when the first character is `=`, `+`, `-`, `@`, tab or CR; nothing is
ever dropped; non-triggering values stay byte-identical. Apostrophe rather than a leading tab, because a tab is
*itself* a trigger and would make the escaper recurse. Once both copies agree, **lift one predicate into
`@pilotage/contracts`** — both apps already consume it — so a third copy cannot appear. `PF-169` (the `;` vs `,`
dialect contradiction) lives in the same two files and is the natural companion, but it needs a **versioned,
announced** format change, so decide deliberately whether to take it in the same slice or leave it.

⚠️ **`apps/web` has no unit runner** — Playwright only (`PF-129`/`PF-133`, also `PF-100`'s blocker and part of
`VAL-08`). That absence is part of why this survived. Either build the runner as part of this story or state plainly
how the fix is evidenced without one; **do not claim a test you cannot run.**

---

## What `S-E04-11` shipped, so you do not re-derive it

**Two P1s closed on one seam with two tests — `PF-140` and `PF-149`.** Batched because they share the DPO
audit-export path; the PR says explicitly that this is *one seam and two tests*, not the routine's one-seam-one-test
shape.

- **The column contract is now append-only and enforced.** Indices **0..9 are frozen**; `action_vocabulary` and
  `resource_type_vocabulary` are **appended** at 10..11. The spec pins the **full header as an exact string** *and*
  the frozen prefix **separately**, so *"you moved a column"* and *"you added a column"* are two different failures.
- **The collapsed `vocabulary` column was KEPT, deliberately.** It is `weakerVocabulary(action, resource_type)` and
  therefore fully **derivable** from the two appended columns, so it is redundant rather than a third axis. Removing
  it would have moved `resource_id`/`ip_address` a **second** time — committing `PF-140` (i) inside the fix for
  `PF-140` (i). Retirement is a follow-up needing a versioned, announced format change.
- **`csvEscape` neutralises additively.** Force-quote + apostrophe prefix, uniform across every column rather than a
  per-column allowlist — an allowlist is exactly what drifts the day `audit_log.user_agent` joins the export. **The
  BOM is untouched**: it is deliberate, documented, and it is *why* the injection matters.
- **The false comment is gone.** `:94-95` claimed the `*_label` columns were *"appended beside them, never
  interleaved"*; the header contradicted it. The replacement keeps the one thing it got right — label adjacency,
  asserted at `audit-vocabulary-gate.spec.ts:1215`.
- **`PF-149` is handled on both call sites, and the guard is wider than the finding asked.** Guarding only
  `assertKnownTimezone` would have protected the case that *cannot fire today* and missed the one that *can*: the
  `DEFAULT_AUDIT_TIMEZONE` branch never reaches that assert, while `zonedYmd` (`window.ts:222`) and
  `resolveAuditWindow` (`:323`) assert **again** downstream — so under small-ICU it is the **default** zone that
  fails, for **every tenant at once**. API: **503** + `TENANT_TIMEZONE_UNUSABLE` (a deliberate divergence from the
  story's 500 — unavailable *until configuration is fixed*). Worker: `bullmq` `UnrecoverableError`, **verified end to
  end** by the routine — `bullmq@5.28.1` exports it, it is an `Error` subclass, `.name === 'UnrecoverableError'`, and
  `queue-metrics.ts`'s `isUnrecoverable` matches on **name**, so it grades `failed_terminal` on attempt 1 and a
  configuration fault is not retried into three identical failures.
- **`isUnknownTimezoneError` checks `instanceof` OR `name`** because `packages/contracts` ships CJS with a
  **git-ignored** `dist/` that each app resolves separately — two class objects would make a bare `instanceof` dead
  code while a self-constructing test still passed. **Correction to run 38's own brief:** the routine told the agents
  `contracts/dist` was checked in; it is **git-ignored** (`.gitignore:6`). They checked and corrected it.
- **`G-DNC`/DNC-06 was checked, not assumed.** `quickstart.md:212` is a `grep` command and `openapi.yaml:596` says
  only that `action` is exported **raw** — still true at index 3. Neither doc enumerates columns, so appending two
  falsifies neither. No doc update was needed.

## Findings discovered this run

| Id | Pri | What |
|---|---|---|
| **`PF-168`** | **P1** | The injection defect, **live** in `apps/web` over free text, two portals. **Next story.** |
| `PF-169` | P2 | The two CSV writers disagree about what French Excel needs, both citing French Excel. |
| `PF-170` | P2 | The export truncates at 50 000 rows silently — and drops the **oldest** end of the window. |
| `PF-171` | P2 | `School.timezone` is a second unvalidated column; *validate on write* is only partly discharged. |
| `PF-172` | P3 | `TENANT_TIMEZONE_UNUSABLE` is exported where `apps/web` cannot import it. |

All five are **declared in `audit-findings-index.md` in the same commit that raised them** — `TOOL-01` applied
prospectively. **One claim was NOT recorded because it did not verify:** a review lens reported an a11y defect at
`/admin/exports:540-547` (a `truncate`d error line whose full text lives only in `title=`). The routine could not
find it at those lines and **did not record it**. If you meet it, measure it first.

---

## ⚠️ Container and tooling facts

1. **No Docker rebuild in run 38**, and Docker was **unresponsive** while the disk was full — `docker system df`
   timed out twice. Re-check the stack is healthy before trusting any container-based evidence.
2. **`pilotage_web` still serves an image from 2026-08-07** and **`PF-126` still blocks every `web` image rebuild**.
   Both obvious explanations are already falsified. **Do not re-test connectivity.** Owner `V3-E02`. A sweep remains
   unschedulable, for the reason runs 30–37 gave.
3. **`TOOL-02` did not fire** in run 38 — `git log HEAD..origin/main` was empty at land.
4. **`ci-gate.sh` builds at stage 6** (18 `run_stage` stages), so Step 4's standalone `pnpm build` must be skipped.
   *Correction to run 37's note, which said 19 and whose PR said 41: the real count is **18**; 41 counted sub-banners.*

## Still open in `V3-E04` after this run

`PF-168` **P1** *(next story)* · `PF-164` *(durable half)* · `PF-136`, `PF-141`, `PF-148`, `PF-150` (id collision
unresolved — renumber in both files at once or not at all) · `PF-154` · `PF-160` · `PF-121` and `PF-123`'s write half ·
`PF-166`, `PF-167`, `PF-169`, `PF-170`, `PF-172`, `TOOL-03` *(P2/P3)* · `PF-153`, `PF-156`, `PF-165`, `PF-171` → `V3-E05`.

`PF-129`/`PF-133` remain the **same missing artefact**: no web-side quality gate and no web unit runner. `PF-168` now
needs it too — build them together.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\ecstatic-mcclintock-1d0445

> Step 0.5 D: runs 37 **and** 38 both executed inside that worktree and could not delete the ground they stood on.
> Apply the three Step 0.5 C tests (not mine · clean · merged or no open PR) and remove it, then clear this line.
>
> **Run 38 deregistered two more** — `exciting-benz-afbe4a` and `objective-hellman-0efc9f`, both clean, both merged,
> both backing no open PR. Their directories are OS-locked, like the rest. Also inert on disk, unchanged:
> `jolly-engelbart-789ce0`, `vigorous-cannon-d1d65a`, `clever-haibt-fff645`, `awesome-spence-9e6f69`,
> `pensive-raman-4baf7c`, `brave-almeida-541d05`, `distracted-cartwright-5287d0`, `keen-mendeleev-53ae1d`,
> `quizzical-hermann-8d4460`, `agitated-cerf-ad2bdf`, `dazzling-agnesi-18e92e`, `inspiring-mclaren-a76c8e`,
> `sharp-albattani-ec7c4d`, `stoic-allen-b8284b`, `sweet-euler-fdad66`, `sweet-lichterman-b7c1b7`. **These are now a
> disk-space problem, not just clutter** — see the banner at the top.
>
> Still requiring a human, said by runs 29–38: `laughing-wing-54e738` is unregistered but **not empty** (~1.4 MB) —
> unreachable *and* unattributable. `youthful-chaum-6aad5c` is **dirty**; the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion works, but `--merged` will not find them** — they are squash-merged, so resolve each
> branch's PR state with `gh pr list --head <branch> --state all`. Run 37 deleted 14 that way.
