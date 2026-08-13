# ADR-039 — A spec may write only into a tree it created under `tmpdir()`

- **Status**: Accepted
- **Date**: 2026-08-13
- **Slice**: `TOOL-15` (epic V3-E02 — gate-hardening track)
- **Findings**: `TOOL-15` (P1, primary) · `TOOL-18` (P1) — one defect at two addresses. **Advances** `TOOL-16(b)`.
- **Gates**: G-DNC · **DNC**: DNC-08
- **Supersedes nothing.** Extends nothing. It records a decision that had been raised — and parked — three
  times in `docs/daily-improvement-v3/audit-findings-index.md`, and settles it by measurement.
- **Relationship to `scripts/lib/walk-read.js` (`TOOL-17`)**: complementary, not competing. That module makes
  the READERS survive the race; this decision removes the WRITERS. Neither replaces the other, and
  `walk-read.js` is **not** modified or deleted by the slice that lands this ADR — see D5.

---

## Context — what was parked, and what unparked it

Two quality specs planted a file inside the real working checkout and deleted it again:

| Writer | Probe path |
|---|---|
| `apps/api/src/shared/quality/audit-write-gate.spec.ts` | `apps/api/src/shared/quality/__audit_write_probe.ts` |
| `apps/api/src/shared/quality/csv-escape-gate.spec.ts` | `apps/web/src/lib/__csv_escape_probe.tsx` |

Under parallel jest, any process that LISTS one of those directories and then READS what it listed can be
handed a path that no longer exists. Two consequences were measured, on unchanged trees, by two different runs:

- **`TOOL-17`** — five spec suites died at LOAD with `ENOENT`, a *different* suite on each of two runs of
  `node scripts/test-ratchet.js api` over one unchanged tree.
- **`TOOL-18`** — `scripts/link-integrity-check.js` walks `apps/web/src`, the exact directory the CSV probe is
  planted in, and its read had no `try` anywhere on the path. The CLI died on an uncaught `ENOENT` and printed
  a **stack trace where its verdict line belongs**. Two consecutive no-flag `scripts/ci-gate.sh` runs on branch
  `ci/2026-08-13-v3-e02-tool17`, denominator **2532 in both**: run 1 `GATE: FAIL (1 stage)` with exactly two new
  failures, run 2 `GATE: PASS (fast)` with no drift. Both victim specs pass **228/228 standalone**.

The operational consequence is the one that matters: **`AUTO-LAND`'s `green` could not be discharged from a
single gate run for any gate-machinery diff**, because a red on this class of diff was not evidence about that
diff.

The repair was parked because it looked like it needed a bypass flag. `audit-findings-index.md` records the
objection verbatim — *"`csv-escape-check.js` deliberately exposes no root parameter — a flag that lets a caller
choose what is compared is a bypass flag wearing a different hat."* That objection is correct, and D2 explains
why it does not apply.

---

## D1 — The decision: a spec writes only into a tree it created under `tmpdir()`

Three options were on the table and all three were checked.

**(a) Scratch-tree copy — TAKEN.** The spec creates `mkdtempSync(join(tmpdir(), …))`, copies the check script
into `<scratch>/scripts/`, populates the tree, and spawns the script with `cwd: scratch`.

**(b) Serialise the two writer specs — rejected.** It leaves the probe in the real tree, so `git status` is
still dirty mid-run and any *other* future walker is still a victim. It narrows the window instead of closing
it, and the window is not the defect.

**(c) Rule-scope the two assertions — rejected.** Weakening `csv-escape-gate.spec.ts`'s `AC-7` to a rule-scoped
assertion deletes the only executed evidence that the real script can go red on a real fourth escaper, which is
the one thing that case exists for. *"An assertion about a gate that cannot fail is not an assertion"* (`R-30`).

**(a) is chosen because it is already this repository's technique, and that was measured rather than assumed.**
Two readings of the same corpus, both recorded because they differ and the difference is instructive:

| Reading | Method | Result |
|---|---|---|
| The one this ADR was raised on | text scan for `fs` write calls over `apps/**` spec files | **8** files write; **6** already write only into an os-tmpdir scratch tree; the 2 exceptions are exactly the two probes |
| The one measured when implementing | TypeScript AST over all **108** spec files under `apps/**` | **7** files perform real write calls (**61** call sites); **5** were already exclusively hermetic; the 2 exceptions are exactly the two probes. The 8th file in the text reading, `test-ratchet.spec.ts`, matches only **inside a string literal** — it asserts over the text of another file |

Both readings agree on the conclusion and on the exceptions. The AST reading additionally shows why the ratchet
that enforces this decision must PARSE rather than grep: a text scan flags `test-ratchet.spec.ts:110` and
`:214`, and the only way to make a text scan green again is to weaken it — `R-30` exactly.

Option (a) is therefore not a new architecture. It is the removal of two deviations from the standing one. The
two offending specs *already contained* a scratch-tree block each (their `DNC-08` cases), eight cases deep, and
had since they were written.

---

## D2 — No root flag was added to any check script, and none is needed

This is the decision's load-bearing half, recorded here because it is where the next reader will look.

`scripts/csv-escape-check.js:128`, `scripts/audit-write-check.js` and `scripts/link-integrity-check.js:165` all
compute their root the same way:

```js
const REPO_ROOT = resolve(__dirname, '..');
```

The root follows **the script's own location**. Copying the script to `<scratch>/scripts/<name>.js` and spawning
it with `cwd: scratch` makes the scratch tree its root **with no interface change at all**. There is no flag, no
environment variable, and no exported setter — so the DNC-10 property those scripts assert in the negative
(*"there is no way to turn this gate off"*) is untouched, and their `argv.includes(…)` whitelists are unchanged.

The "bypass flag wearing a different hat" objection was the thing blocking option (a). It is answered by not
needing a flag, not by arguing the flag would be safe.

---

## D3 — The green control comes FIRST, and it is asserted

A scratch tree that is red **for a preflight reason** makes `expect(status).toBe(1)` pass while proving nothing
about the rule under test. This is not hypothetical: `csv-escape-check.js` has six preflights before rule A can
speak, its rule D is one-way (a `SANCTIONED` or `EXCLUDED` row matching nothing is itself red), and
`audit-write-check.js` carries a vacuity floor of **12** `writeAudit` call sites.

So every relocated case is built in this order, and each step is an executed assertion:

1. build a scratch tree the **real** script rates GREEN;
2. **assert** that green — status 0 and the `… CHECK: PASS` line;
3. introduce the single mutation the case is about;
4. assert RED **naming the rule and naming the file**;
5. remove it, assert green again.

The same ordering discipline is required of any future case added under this ADR. A red-proof without a green
control is a red-proof of the wrong thing.

---

## D4 — A check script that cannot read an input FAILS, legibly — it never tolerates

`TOOL-18` is repaired by making `scripts/link-integrity-check.js` **pronounce** its failure instead of crashing.
It is **not** repaired by routing it through `scripts/lib/walk-read.js`.

The distinction is the one that module's own docblock draws, and it is upheld here:

- A **spec** measures a tree a sibling worker may legitimately be mutating, and its verdict is carried by floors
  it asserts afterwards. Tolerating one confirmed-vanished walked path there is safe and narrow.
- A **check script IS the verdict**. It runs once, alone. An input it cannot read is a verdict it cannot
  pronounce. Tolerating a vanished file there converts an unclassifiable state into a **PASS** — `DNC-08` proper.
  `PF-146` and `PF-105` are the two existing instances of that mistake in this repository; there is not a third.

So the script keeps failing. What changed is only the legibility, which is strictly more information than a
stack trace and never less:

- the unreadable file becomes a **structural failure**, handled exactly like a missing build artefact — the
  application is not classified from a truncated corpus at all;
- the message carries **`DNC-08`**, the **repo-relative path** and the **errno**, in the vocabulary
  `audit-write-check.js` and `csv-escape-check.js` already use;
- `LINK INTEGRITY CHECK: FAIL` is **printed** and the exit status is **non-zero, never 0**;
- a partial scan is **never memoised** into `SCAN_CACHE`, or the next caller in the same process would silently
  believe a truncated corpus;
- the in-process exports `extractLiteralLinks` / `extractTemplateLinks` **still throw**, unwrapped. The collector
  is a parameter only `main()` passes; it is unreachable from the command line and cannot make any check pass,
  so it is a testability seam and not a flag (DNC-10).

---

## D5 — `scripts/lib/walk-read.js` stays exactly as it is

Removing the two probes shrinks how often that module's tolerance fires. It does not make the tolerance wrong.
Any *future* writer — and the five sites `TOOL-17` converted — still need it, and `TOOL-17(b)`'s three residuals
stay open. Deleting it because its last known trigger is gone is how a guard becomes a regression.

---

## D6 — The rule is held by an executed ratchet, not by review

`apps/api/src/shared/quality/hermetic-spec-writers-gate.spec.ts` walks the `apps/**` spec corpus through
`scripts/lib/walk-read.js`, parses every file, and fails on any write whose destination is not derived from a
tree created under `tmpdir()`.

**The classifier's rule, stated precisely, because a narrower one was measured to false-red the real corpus.**
The obvious phrasing — *"the destination derives from a binding INITIALISED from `mkdtempSync`/`tmpdir()`"* —
flags **four of the seven** legitimate writers. Each defeats it differently:

| Shape | Site | Why the narrow rule fails |
|---|---|---|
| (a) | `observability-gate.spec.ts` | `let dir = ''` — the initialiser is a string literal; the scratch value arrives by **assignment** in `beforeAll` |
| (b) | `production-artefact-gate.spec.ts` | `let scratch: string` with **no initialiser at all**; the write is three hops away, inside a helper, across a function boundary |
| (c) | `walk-read-gate.spec.ts` | the destination is a **call expression**, `scratchFile('alpha.ts')`, whose arrow body returns `join(scratch, name)` |
| (d) | `link-integrity-gate.spec.ts` | derived two hops inside a factory, and the cleanup iterates an array of collected scratch roots |

So the rule is: a destination is legitimate **iff it transitively derives from a binding whose initialiser OR
any assignment is `mkdtempSync(…)` / a `join()` rooted at `tmpdir()`**, following (i) `join`/`resolve`/`dirname`
argument chains, (ii) assignments as well as declarations, and (iii) the returns of locally-declared functions
and arrows. For two-argument calls (`copyFileSync`, `cpSync`, `renameSync`, …) the **destination** argument is
the one judged — the source may legitimately be the real tree, which is how `schema-drift-gate.spec.ts` copies
the real Prisma schema into its scratch tree.

Measured with that rule over all 108 spec files: **61 write calls, 0 violations**. `AC-4` permitted a declared
allowlist as the fallback if the AST could not separate the legitimate writers. **It was not needed and none is
declared** — a fact recorded here because "we used the fallback" and "we did not need it" are different
statements about how much this rule can be trusted.

The ratchet carries the same honesty checks the nine `TOOL-17` sites carry: the accounting identity
`map.size + skipped.length === list.length`, the `MAX_VANISHED_FILES` cap, a corpus floor (**≥ 90** against 108
measured), a floor on the number of write calls it actually **recognised**, and a red-proof driven with fixture
source **as a string** — never by planting a fixture spec in the corpus, which would recreate the defect.

---

## Consequences

**Positive.**

- `git status` is clean at every point of the api suite's execution. No probe file ever exists in the checkout.
- `TOOL-18`'s crash becomes a printed verdict, so `link-integrity-gate.spec.ts:1903`'s assertion has something
  to read in the failure case as well as in the passing one.
- A repeat of this class of defect is caught by an executed gate rather than by a reviewer noticing.

**Costs, stated rather than discovered later.**

- The two relocated cases are slower: each now builds a scratch tree and runs the real script **three** times
  (green, red, green) instead of twice. `audit-write-gate.spec.ts` additionally synthesises twelve `writeAudit`
  call sites to clear that script's vacuity floor of 12.
- The scratch trees are coupled to the check scripts' preflights. If a script gains a seventh preflight, its
  green control has to gain the input that satisfies it, and the failure mode is a loud red rather than a silent
  pass — which is the correct direction, but it is real maintenance.
- The `TOOL-18` red-proof drives an unreadable file through a `--require` shim that makes `fs.readFileSync`
  throw `ENOENT` for one chosen absolute path inside the scratch tree. `chmod` is a no-op on Windows and this
  repository is developed on Windows; withholding the input does not work either, because a file that does not
  exist is simply not walked. The shim is the same "inject a reader that throws a chosen errno" technique
  `walk-read.js`'s docblock records as the only portable way to drive that branch.

**What this does NOT close.** `TOOL-16(b)` (the end-to-end non-determinism) is *advanced*, not closed — one of
its two named causes is removed. `TOOL-17(b)`'s three residuals are untouched and stay open.
