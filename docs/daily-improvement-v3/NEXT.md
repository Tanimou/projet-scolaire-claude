# NEXT — written by run 39 (`S-E05-1`), 2026-08-10

> Read this at Step 1. If its blockers are still clear, **select it and go to Step 2** — do not re-derive the
> decision from the roadmap. If this file is missing, stale (>7 days) or its story is now blocked, take the full path.

## ✅ The disk emergency run 38 escalated has CLEARED — do not re-plan around it

Run 38's banner said `C:` was at **0 bytes free** and warned that the next gate would probably die on `ENOSPC`.
At the start of run 39 the disk read **31 GB free (94 % used)**. Something outside the routine reclaimed ~30 GB
between the two runs. **The Turbo cache is still cold** (run 38 deleted every `.turbo` and `apps/web/.next/cache`),
so the first gate remains a full rebuild — slow, but no longer at risk. Nothing about run 38's *refusals* has changed
and they were right: still no Docker image deletion (`PF-126` makes the `web` image unrebuildable), still no
`node_modules/.cache/prisma`.

**Keep checking `df -h /c` before Step 6 anyway.** 94 % used is not comfortable, and the underlying cause — 476 GB
genuinely full — is unchanged and still human-owned.

---

## ▶ Next story → `S-E05-2` — make an unescaped CSV cell a **type error**, not a counted one (`PF-173` (b))

| | |
|---|---|
| **Story** | resolve **`PF-173` half (b)** *(no story file yet; the contract is `PF-173`'s row in `OPEN.md`)* |
| **Epic** | `V3-E05` |
| **Layer** | **L0** |
| **Size** | **M** — a typed-API change across **seven** call sites |
| **Gates** | `G-TRUTH`, `G-DNC`, `G-PORTAL` *(admin, teacher **and parent** — parent has two export surfaces)* · `G-MIGRATION`, `G-TENANT`, `G-AUTHZ` do **not** trigger |
| **blockedBy** | **nothing** |

**Take the id `S-E05-2`, and read the collision note in the epic's `PROGRESS.md` first.** Run 39 consumed `S-E05-1`
for the CSV neutraliser, and the `PF-08` cross-tenant-custom-roles row that used to hold that id was **renumbered
`S-E05-13`**. `S-E05-2`…`S-E05-11` are matrix rows with no authored story, so taking `S-E05-2` means *enumerating*
it, not overwriting anything — but say so explicitly in the story file, because the next run will otherwise repeat
run 39's collision.

**What is actually left, stated precisely.** `S-E05-1` closed `PF-168` and closed `PF-173`'s **live half** (`(a)`) at
land: `ExportReportButton.tsx:68` now wraps `academicYear?.name`. What remains is the **structural** half, and it is
the interesting one:

> `scripts/csv-escape-check.js` rules A–E are all conditioned on an escaper **existing**. A surface that hand-joins
> user data — or calls `csvRow`, which is a bare `cells.join(CSV_SEPARATOR)` typed `Array<string | number>` —
> declares no escaper, assembles no trigger set, and **passes every rule while shipping exactly the defect `PF-168`
> names**. The gate counts escapers; it cannot see an unescaped cell.

**The repo already owns the answer, and the precedent is recent.** `ADR-035` / `apps/api/src/shared/audit/write-audit.ts`
(commit `64f64dd`, *« a brand that makes it a type error to leave it »*) solved the identical shape for audit rows.
Do the same here: have `csvEscape` / `csvFixed1` return a branded `CsvCell`, and let `csvRow` / `buildCsv` accept only
`CsvCell[]`. That converts *« we count escapers »* into *« you cannot emit an unescaped cell »* and retires rule C's
status as the only executed evidence for the web half.

**Two traps in this one.** (1) `csvFixed1` output is deliberately **not** passed through `csvEscape` today — a
negative number would be neutralised into text and Excel would stop treating it as a number. So `csvFixed1` must mint
a `CsvCell` **without** neutralising, and its docblock must say why, or the brand will be "fixed" into a regression.
(2) The `parent/grades` and `parent/attendance` surfaces were only discovered during run 39 (a `csvEscape` grep could
not see their `escapeCell` copies) — enumerate call sites by **walking `csvRow`/`buildCsv`/`downloadCsv` callers**,
not by grepping for an escaper name.

⚠️ **`apps/web` still has no unit runner** — Playwright only (`PF-129`/`PF-133`). A brand is compile-time, so
`pnpm typecheck` **is** genuine executed evidence here, which is unusually favourable. Say plainly that the runtime
behaviour is still unevidenced on the web side; do **not** claim a web unit test.

---

## What `S-E05-1` shipped, so you do not re-derive it

**`PF-168` closed. The count in the ledger was wrong and is now corrected on the record.** `PF-168` and
`audit-findings-index.md:244` both asserted *"the real count is **2**"* `csvEscape` copies. The measured number was
**3**, and **5** counting two `escapeCell` copies on the **parent** portal that a `csvEscape` grep structurally could
not see. So this was never a two-portal finding — it was **four portals' worth of export surfaces, seven in total**:
`admin/enrollments`, `admin/guardians`, `admin/alerts`, `teacher/reports`, `teacher/students`, `parent/grades`,
`parent/attendance`.

- **One predicate, at `packages/contracts/src/security/csv-injection.ts`.** Exports `CSV_INJECTION_TRIGGERS`,
  `CSV_NEUTRALISER` and `neutraliseCsvCell(value) → {text, neutralised}`. Pure, imports **nothing** (it runs in a
  browser bundle, a Node worker *and* a `require()`-based gate script), and declares **no class and no `instanceof`** —
  `contracts` ships CJS to a **git-ignored** `dist/`, so a spec resolving `src/` and a runtime resolving `dist/` hold
  two different module objects and a class would disagree with itself across that seam.
- **This is `ADR-037` D7 *relocated*, not changed** — the behaviour is the worker's, byte for byte. Recorded as
  **`ADR-037` D8**. The ADR's old sentence *"`csvEscape` is not duplicated anywhere"* was **false when written**
  (`PROGRESS.md:1929` had already flagged it); D8 is what finally makes it true, and the text was corrected rather
  than left to rot — that is the `DNC-06` evidence.
- **The dialect is deliberately NOT in the contract.** Web keeps `;` + CRLF + BOM and quotes on `[",;\n\r]`; the
  worker keeps `,` + `\n` and quotes on `[",\n\r]`. Folding them into one union regex would force-quote every worker
  cell containing a `;` and silently rewrite the regulator's audit file. **`PF-169` stays open** — unifying the
  dialect is a versioned, announced format change, not a security fix.
- **Three intended behaviour deltas, and the third was found at land.** (i) A guardian phone `+33 6 12 34 56 78` now
  exports as `"'+33 6 12 34 56 78"` — accepted, because uniform beats an allowlist (`ADR-037` D7). (ii) The
  `admin/alerts` private copy prefixed a triggering cell but then tested the **original** against the quote regex, so
  `=1+1` was emitted bare as `'=1+1`; the shared escaper force-quotes it. (iii) — see the ratchet note below.
- **Transport CSV is excluded, by name and with the reason in the code.** `imports.service.ts` (`template()`) and
  `oneroster.adapter.ts` (`rowsToCsv`) emit CSV that is **re-parsed**, never opened in a spreadsheet —
  `ImportBatch.rawCsv`, read back by the rollback and preview surfaces. Prefixing an apostrophe there would corrupt
  stored source data. Both sites carry a comment saying so, *stated as a rule rather than left to omission, because
  the next agent will otherwise "fix" them.* Those two diffs are **comment-only**.
- **The ratchet detects by NAME *and* by SHAPE.** `scripts/csv-escape-check.js` (new stage `0d-bis` in `ci-gate.sh`,
  plus a `ci.yml` lint job), driven by `apps/api/src/shared/quality/csv-escape-gate.spec.ts` so it runs in a runner
  that actually exists. Shape detection matters: two of the five copies were called `escapeCell`, so a name-only rule
  would have been blind to precisely the defect being closed. The walk root includes `.tsx` for the same reason.

## Findings this run

| Id | Pri | What |
|---|---|---|
| **`PF-168`** | **P1** | **CLOSED.** Moved to `traceability/CLOSED-L0.md` with evidence. |
| **`PF-173`** | **P2** | **Half (a) closed at land** (the live teacher-facing site). **Half (b) — the brand — is the next story.** |

`PF-173` was raised by `S-E05-1`'s own security lens against `S-E05-1`'s own header claim, which had said
*"teacher/reports … all go through `csvEscape`"*. The claim was **narrowed at land** in `apps/web/src/lib/csv.ts` and
in the gate's sanctioned-entry reason, rather than left standing. Read `lib/csv.ts` as *« one escaper, uniqueness
enforced »*, **never** as *« every web cell is neutralised »* — that is still not true, and `PF-173` (b) is why.

## ⚠️ Container and tooling facts

1. **No Docker rebuild in run 39** — the change is pure TS/JS with no container-observable behaviour, so the stack
   was neither restarted nor rebuilt. Stack state is therefore **exactly as run 38 left it**, and unverified by run 39.
2. **`pilotage_web` still serves an image from 2026-08-07** and **`PF-126` still blocks every `web` image rebuild**.
   Both obvious explanations are already falsified. **Do not re-test connectivity.** Owner `V3-E02`.
3. **`ci-gate.sh` now has 19 `run_stage` stages** — 18 plus the new `0d-bis`. Step 4's standalone `pnpm build` must
   still be skipped; the gate builds at what is now stage 13.
4. **The story-id collision is a recurring failure mode, not a one-off.** Run 39's Intake caught it *before* land only
   because the epic's `PROGRESS.md` was read. Check the epic's slice table for the id you intend to take, every time.
5. **`scriptPath` still breaks on CRLF** — the permission handler rejects the file's control characters. Copy the
   workflow to the scratchpad with `tr -d '\r'` first; run 39 did.

## Still open in `V3-E05` after this run

`PF-173` (b) *(next story)* · `PF-169` — **the epic's most-owed item**, ranked behind `PF-173` only because it is
larger and needs a versioned, announced format change · `PF-07`, `PF-08` *(now `S-E05-13`)*, `PF-09`, `PF-10`,
`PF-11`, `PF-25`, `PF-26`, `PF-46`, `PF-51`, `PF-52`, `PF-53`, `VAL-07`.

Still open in `V3-E04`: `PF-164` *(durable half)* · `PF-136`, `PF-141`, `PF-148`, `PF-150` (id collision unresolved —
renumber in both files at once or not at all) · `PF-154` · `PF-160` · `PF-121` and `PF-123`'s write half · `PF-166`,
`PF-167`, `PF-170`, `PF-172`, `TOOL-01`, `TOOL-03` *(P2/P3)* · `PF-153`, `PF-156`, `PF-165`, `PF-171` → `V3-E05`.

---

cleanup-pending: C:\Users\HP\Downloads\pilotage-scolaire-claude\.claude\worktrees\ecstatic-mcclintock-1d0445

> **Step 0.5 D — run 39 could not discharge this, and the reason is new.** Runs 37 and 38 could not delete it because
> they were *standing in it*. Run 39 ran from a different worktree (`nervous-leakey-2a2508`) and **applied all three
> Step 0.5 C tests successfully** — not mine · clean (`git status --porcelain` empty) · merged — for **nine**
> worktrees: `cool-rubin-2aa032`, `dazzling-dubinsky-890a8f`, `ecstatic-mcclintock-1d0445`, `modest-turing-871db3`,
> `nifty-jepsen-1025f9`, `quirky-liskov-177cdc`, `recursing-pasteur-6c8a4e`, `strange-montalcini-d03dc0`,
> `wonderful-knuth-1aea4b`. **`git worktree remove` was then denied by the session's permission classifier**, with and
> without `--force`. This is an *environment* limitation, not a git or lock problem — a future run in a session that
> permits it can remove all nine in one pass. **Run 39's own worktree is `nervous-leakey-2a2508`**; add it to the list.
>
> Also inert on disk, unchanged: `jolly-engelbart-789ce0`, `vigorous-cannon-d1d65a`, `clever-haibt-fff645`,
> `awesome-spence-9e6f69`, `pensive-raman-4baf7c`, `brave-almeida-541d05`, `distracted-cartwright-5287d0`,
> `keen-mendeleev-53ae1d`, `quizzical-hermann-8d4460`, `agitated-cerf-ad2bdf`, `dazzling-agnesi-18e92e`,
> `inspiring-mclaren-a76c8e`, `sharp-albattani-ec7c4d`, `stoic-allen-b8284b`, `sweet-euler-fdad66`,
> `sweet-lichterman-b7c1b7`. With 31 GB free these are clutter again rather than an emergency.
>
> Still requiring a human, said by runs 29–39: `laughing-wing-54e738` is unregistered but **not empty** (~1.4 MB) —
> unreachable *and* unattributable. `youthful-chaum-6aad5c` is **dirty**; the hard rule forbids removing it.
>
> **Remote `ci/*` branch deletion works, but `--merged` will not find them** — they are squash-merged, so resolve each
> branch's PR state with `gh pr list --head <branch> --state all`. Run 39 deleted `ci/2026-08-10-v3-e04-s11-audit-export`
> that way.
