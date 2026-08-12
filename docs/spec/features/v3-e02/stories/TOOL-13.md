# TOOL-13 — a suite that stops existing must not read as green

> **Epic** `V3-E02` — Versioned database lifecycle and release integrity (gate-hardening track)
> **Layer** L0 · **Risk tier** P1 · **Mode** `epic-slice` · **Track** a
> **Branch** `ci/2026-08-12-v3-a-e02-tool13-skip-ratchet`
> **Closes** `TOOL-13` (P1, primary), `TOOL-16(a)` (P1, batched), `TOOL-11` (P2, batched), `TOOL-12` (P2, batched)
> **Does NOT close** `TOOL-16(b)` — the underlying suite non-determinism. Out of scope; do not attempt it.
> **Touches** UI: **no** · backend: **no** (production `apps/api/src` is not opened; only `src/shared/quality/**`
> spec files) · worker: **no** · gate scripts: **yes**
> **Gates triggered** `G-DNC` only. See §8.

---

## 0. Read this first — the one direction a gate may never fail in

A merge gate is allowed to be wrong in one direction only: it may cry wolf. It may **never** report green about a
check it did not perform. `scripts/test-ratchet.js` currently does exactly that, and this slice removes it.

The ratchet decides on a **set of failures**. It builds `failing` from `t.status === 'failed'`
(`scripts/test-ratchet.js:195`) plus one `<suite failed to load>` sentinel (`:199-201`), compares that set against a
baseline **of failures**, and **never looks at a count of anything**.

A test that stops executing is not a failure. So it is not in the set. So the ratchet reports **`✓ no drift.`**

**This is not hypothetical, and the proof is in this repository right now.**
`apps/api/src/shared/quality/schema-drift-gate.spec.ts:1215` reads:

```js
const describeWithDb = reachable ? describe : describe.skip;
```

On a machine with no reachable PostgreSQL — this one — the whole end-to-end block becomes `describe.skip`. Measured
by the author of this story on this worktree on **2026-08-12**, running the two spec files this slice touches:

```
$ node ./node_modules/jest/bin/jest.js --ci --silent --runInBand --json \
    src/shared/quality/test-ratchet.spec.ts src/shared/quality/schema-drift-gate.spec.ts
wall = 30 s
{"total":124,"passed":119,"failed":0,"pending":5,"todo":0,"suites":2,"failedSuites":0}

schema-drift-gate.spec.ts  status=focused  {"passed":105,"pending":5}
    pending | the CLI, executed against a real PostgreSQL the unmodified repository PASSES — the gate is not red on correct code (AC-2)
    pending | the CLI, executed against a real PostgreSQL leaves no scratch database behind (AC-11)
    pending | the diff and the deploy, driven through the exported seams the ledger really builds the schema the datamodel describes (AC-2)
    pending | the diff and the deploy, driven through the exported seams a datamodel the ledger does not build FAILS, naming the drifted object (AC-1)
    pending | the diff and the deploy, driven through the exported seams a migration that does not execute on PostgreSQL FAILS (AC-3)
test-ratchet.spec.ts       status=passed   {"passed":14}
```

`numFailedTests` is **0**. The ratchet's verdict on that report is `✓ no drift.` — including about
**`the unmodified repository PASSES — the gate is not red on correct code`**, the single case whose whole job is to
prove the drift gate is not red on correct code. That case has not executed on this machine in any run, and nothing
said so.

**Your deliverable is: the ratchet notices.**

---

## 1. Measured facts about jest's JSON report — do not re-derive these, and do not assume them

Every line below was produced on this worktree on 2026-08-12 with **jest 29.7.0** (`apps/api/package.json:84`,
resolved 29.7.0), by running fixture spec files through `node ./node_modules/jest/bin/jest.js --ci --silent --json
--outputFile=…` and reading the file back. They are the semantics your reduction must implement.

### 1.1 `describe.skip` and `it.skip` surface as `'pending'`, `it.todo` as `'todo'`

Fixture: one passing `it`, a `describe.skip` holding two `it`s, one `it.skip`, one `it.todo`.

```
numTotalTests 5   numPassedTests 1   numPendingTests 3   numTodoTests 1
SUITE status=focused  assertions=5
    passed  | outer runs
    pending | outer skipped block a      <- describe.skip
    pending | outer skipped block b      <- describe.skip
    pending | outer single skipped       <- it.skip
    todo    | outer a todo               <- it.todo
```

**If you count only `'skipped'` you will count zero.** `'skipped'` is a real jest status but it is not the one
`describe.skip` produces in this version. Derive the not-executed set explicitly and name it in a constant.

### 1.2 `numTotalTests` **includes** pending — so the denominator does not move

This is the sharpest fact in the story, and it is *worse* than the finding assumed. A `describe.skip` moves tests
from `passed` into `pending` while leaving `numTotalTests` unchanged. The ratchet's own summary line
(`:238-242`, `${passed}/${total} passed`) would print `119/124` instead of `124/124` — a number nobody reads and
nothing compares.

So there are **two** distinct disappearances, and they have different signatures:

| Shape | `numTotalTests` | Detected by |
|---|---|---|
| a suite (or block) skips **itself** — `describe.skip`, `it.skip`, `it.todo` | **unchanged** | the per-suite skipped count of AC-1 |
| a suite **vanishes from the report** — its file no longer matched, or it failed to load | **falls** | the absent-baseline-key rule of §3.5 |

The `2433 → 2219` denominator movement the finding recorded across three consecutive gate runs on one unchanged
branch is the **second** shape. The `describe.skip` case is the **first**. Both are in scope; §3.5 says exactly how
far the second is handled and where the honest limit is.

### 1.3 A suite that fails to load: `status: 'failed'`, `assertionResults: []`, cause in **`message`**

```
SUITE broken.spec.js  status=failed  assertions=0
KEYS: assertionResults, coverage, endTime, message, name, startTime, status, summary
message: "  ● Test suite failed to run\n\n    Cannot find module './no-such-module-anywhere' from 'broken.spec.js'\n\n    [0m[31m…"
```

> ### ⚠️ Correction to the finding as written — `failureMessage` does not exist in the JSON report
>
> `TOOL-16(a)` is recorded as *"throws away the jest report's `failureMessage`"*. **In jest 29.7.0's `--json`
> output the key is `message`, and `failureMessage` is not present at all** (the key list above is complete —
> measured, not read from documentation; `failureMessage` is the field name on jest's *internal* `TestResult`,
> which `formatTestResults` renames to `message` on the way out).
>
> Implement against `message`. Reading `suite.failureMessage` would yield `undefined` on every suite and the
> TOOL-16(a) half would ship as a no-op that prints nothing — a fix that is green and does nothing, which is the
> exact family of defect this whole track exists to remove. If you want a belt: read
> `suite.message || suite.failureMessage || ''`, and say in a comment which one this jest actually populates.
>
> **The `message` value carries ANSI escape codes** (`[0m[31m…` above). Strip them before printing, or
> the gate log gains control characters.

### 1.4 A suite skipped **in its entirety** is `status: 'skipped'`, and still lists its assertions

```
SUITE allskipped.spec.js  status=skipped  assertions=1   (that one assertion: status=pending)
```

So a fully-skipped suite is **not** confusable with a load failure: the load-failure sentinel at `:199` fires on
`assertionResults.length === 0 && status === 'failed'`, and a fully-skipped suite has one assertion and status
`'skipped'`. **The sentinel must stay a failure and must not be double-counted as a skip.** Verified: the two
shapes cannot collide.

---

## 2. Where the code is (line numbers measured on this worktree, 2026-08-12)

| What | Where |
|---|---|
| The ratchet | `scripts/test-ratchet.js` (274 lines) |
| argv parsing | `:43-44` (`app`, `update`), `:60-61` (`--skip`) |
| usage guard → `process.exit(2)` | `:63-66` |
| `--update` + `--skip` refusal (AC-2 extends this) | `:71-75` |
| app-directory guard | `:77-81` |
| `runJest()` — spawns a real jest at module scope | `:99-178` |
| the no-report branch (TOOL-10's, do not disturb) | `:129-173` |
| `testKey(specPath, fullName)` | `:185-188` |
| `const report = runJest();` | `:190` — **this exact line is pinned by a spec; keep it byte-identical** |
| the reduction this slice extracts | `:192-202` (failures `:195`, load sentinel `:199-201`) |
| baseline load | `:204-207` |
| `--update` write path | `:209-219` |
| `--skip` hold-out (`allKnown` / `knownSkipped` / `known`) | `:221-233` |
| `regressions` / `fixed` | `:235-236` |
| summary + reports + exit | `:238-273` |
| The baseline | `scripts/known-test-failures.json` (95 lines; `$doc` at `:3-12`, `apps.api.failures` `:15`, `apps.worker.failures` `:63`) |
| The ratchet's guard spec (extend it) | `apps/api/src/shared/quality/test-ratchet.spec.ts` (274 lines, **14/14 green today**) |
| Its helpers you will reuse | `executableJs()` `:65`, `blockAt()` `:82`, `EXECUTABLE_SCRIPT` `:71`, `runScript()` `:239` |
| The drift check | `scripts/schema-drift-check.js` (~1660 lines) |
| `run()` — the one `spawnSync` wrapper; already supports `options.timeoutMs` | `:691-714` (`timeout: options.timeoutMs` at `:700`) |
| `prismaRun()` → `run(cli.command, …)` — **route A, unbounded** | `:936-941` (the `run` call at `:940`) |
| `psqlHost()` → `run('psql', …)` — **route B, unbounded** | `:1076-1080` |
| `psqlContainer()` → `run('docker', ['exec'…])` — bounded at `DOCKER_EXEC_TIMEOUT_MS` | `:1083-1086` |
| `containerAddressesTheUrl()` → `docker port`, bounded at `DOCKER_TIMEOUT_MS` | `:1050-1053` |
| `exec()` docstring: *"Returns `{ ok, detail }` rather than throwing"* | `:1110-1111` |
| `exec()`'s cross-server guard — **throws**, contradicting the docstring two lines above | `:1120-1126` |
| the constants and their rationale — **read `DOCKER_EXEC_TIMEOUT_MS`'s comment before writing §6** | `:224`, `:229`, `:242`, `:262`, `:269` |
| `cleanup()` → `dropScratch()` → `routes.exec()` | `:1386-1392`, `:1544-1560` |
| the signal / `uncaughtException` handlers that also call `cleanup()` | `:1394-1404` |
| `finally { cleanup(); }` — the throw path that escapes past `report(state)` | `:1528-1530` |
| The drift guard spec | `apps/api/src/shared/quality/schema-drift-gate.spec.ts` (1354 lines) |
| its `SchemaDriftModule` interface (extend it or it will not typecheck) | `:122-159` |
| its helpers: `callSites()` paren-balancer `:221`, `executableJs()` `:204`, `EXECUTABLE_SCRIPT` `:210`, `runInChild()` `:242`, `DEAD_URL` `:99` |
| the existing bound-pinning case to copy the register of | `:1175-1192` |
| **non-DB describes end here** | the `});` at `:1204` |
| ⛔ `const describeWithDb = reachable ? describe : describe.skip;` | `:1215` — **`describe.skip` on this machine** |
| ⛔ the DB-gated blocks | `:1246`, `:1261` |

> **Where your new drift-gate cases go: after `:1204`, before the section banner at `:1206`.** Anything you put at
> `:1215+` is inside `describeWithDb` and **will not run on this machine** — which would make it evidence that can
> only run where the bug cannot, the precise thing AC-4 forbids.

---

## 3. What to change — the primary: `scripts/test-ratchet.js` + a new pure core

### 3.1 Why a new module, and why not an env var

AC-4 requires the evidence to be **fixture-driven**: a hand-written jest report, fed to the real decision logic,
producing a red verdict. That is impossible against the script as it stands — `:43` reads `process.argv[2]`, `:63`
can `process.exit(2)`, and `:190` calls `runJest()` at module scope, which spawns a real jest. A spec that
`require()`d it would either kill the jest worker or start a second full jest run inside the first. The existing
spec says so at its own `:22-38` and pins it at `:140-141`.

**Extract the pure decision layer into `scripts/lib/ratchet-core.js`** (new directory; CommonJS, no I/O, no
`process`, no clock, no environment — the same discipline `schema-drift-check.js` applies to its verdict layer).
`scripts/test-ratchet.js` `require()`s it and keeps **all** of its I/O: argv, the guards, `runJest()`, the baseline
read/write, every `console` call and every `process.exit`.

> ### ⛔ The forbidden alternative, named so nobody reaches for it
>
> **Do not add an env var or hidden flag** (`RATCHET_REPORT_FILE`, `RATCHET_INPUT`, anything of that shape) that
> makes the script read a report from disk instead of running jest. A gate whose input can be chosen from the
> environment is a gate that can be bypassed — it is a bypass flag wearing a lab coat. `DNC-10`, and the same
> lesson `link-integrity-gate` and `csv-escape-check` already carry. The module boundary gives the spec the same
> access with none of the attack surface, and it has the property the env var does not: **the spec exercises the
> exact code the gate runs**, so the two cannot drift.

### 3.2 `scripts/lib/ratchet-core.js` — the surface

Export at least:

```js
NOT_EXECUTED_STATUSES      // Set<string>
LOAD_FAILURE_SENTINEL      // '<suite failed to load>'  — byte-identical, see §3.4
suiteKey(specPath, appDir)
testKey(specPath, fullName, appDir)   // moved verbatim from :185-188
reduceReport({ report, appDir })
compareToBaseline({ reduced, baselineApp, skip })
```

**`NOT_EXECUTED_STATUSES` is a named constant with a comment**, not an inline literal, and the comment carries §1.1's
measurement. Derive it explicitly rather than assuming:

```js
/**
 * The jest assertion statuses that mean THE TEST DID NOT RUN.
 *
 * Measured against jest 29.7.0 on 2026-08-12 (fixture report, this repository):
 * `describe.skip` and `it.skip` both surface as 'pending'; `it.todo` as 'todo'.
 * 'skipped' and 'disabled' are jest statuses this fixture did not produce but
 * that the type union declares, and they mean the same thing, so they are here.
 *
 * Counting only 'skipped' would count ZERO — which is how this defect would ship
 * again. A future jest that renames a status makes this a VISIBLE edit rather
 * than a silent drift back to green.
 */
const NOT_EXECUTED_STATUSES = new Set(['pending', 'todo', 'skipped', 'disabled']);
```

`reduceReport` returns, for one jest JSON report:

| Field | Meaning |
|---|---|
| `failing` | `string[]` — exactly today's set: every `status === 'failed'` assertion, **plus** the load-failure sentinel key. Behaviour unchanged. |
| `skipped` | `Record<suiteKey, number>` — per suite, the count of assertions whose status is in `NOT_EXECUTED_STATUSES`. **Record only non-zero entries** (see §3.5). |
| `loadFailures` | `Array<{ key, cause }>` — one per load-failed suite, `cause` from `suite.message` (§1.3), ANSI-stripped and truncated per §3.4. |
| `suites` | `string[]` — every suite key present in the report, so the comparison can tell "count fell" from "suite absent". |

**A load-failed suite contributes to `failing` and must NOT contribute to `skipped`.** It has zero assertions
(§1.3), so a straightforward `assertionResults.filter(…)` already yields 0 — but assert it, do not assume it: a
future jest that emits a synthetic pending assertion for an unloadable file would double-count silently.

`compareToBaseline` returns the verdict material — `regressions`, `fixed` (both exactly as today),
`skipRises`, `skipFalls`, `missingSuites`, the two held-out lists, and `baselineHasSkipBlock`.

### 3.3 What `test-ratchet.js` keeps, byte-for-byte

The existing 14 cases in `test-ratchet.spec.ts` must stay green **without being edited to accommodate you**. They
pin, among other things:

- `expect(EXECUTABLE_SCRIPT).toMatch(/^const report = runJest\(\);$/m)` (`:140`)
- `expect(EXECUTABLE_SCRIPT).toMatch(/^const app = process\.argv\[2\];$/m)` (`:141`)
- the whole `if (!existsSync(outFile))` block and its contents (`:144-218`)
- the four output strings at `:223-226`: `NEW test failure(s) — not in the baseline`,
  `baseline entr(ies) now PASS — the ratchet only turns one way`, `no drift.`,
  `--update and --skip are mutually exclusive.`
- the argument contract at `:248-272` (four executed cases, exit 2 each)

Nothing in this slice may move those. If one of them goes red, the refactor went too far — pull it back.

### 3.4 TOOL-16(a) — print the cause of a load failure

`:199-201` synthesises the sentinel and discards the report's explanation, so an operator reads a symptom with no
cause. This is the same defect TOOL-10 just repaired for the killed-jest path, in the adjacent branch of the same
file.

- **The sentinel key stays byte-identical**: `'<suite failed to load>'`. It is a baseline key; changing it
  invalidates every existing baseline entry that uses it.
- When a load failure is present, print the suite path and its cause from `suite.message` (§1.3 — **not**
  `failureMessage`), ANSI-stripped, trimmed to the first `N` lines behind a named constant
  (`LOAD_FAILURE_CAUSE_LINES`; 12 is ample — jest's own block is a heading, a blank line, the reason, then a code
  frame). If it was truncated, **say so** on the last line (e.g. `… (truncated; N of M lines)`) — a message that
  silently cuts is a message an operator cannot trust.
- Print it for **every** load-failed suite, baselined or not: a tolerated load failure whose cause changed is still
  something the operator must be able to see.

### 3.5 The skipped-count ratchet — the six decisions, and the reason for each

**(a) Fail on a rise. Report on a fall. Never the other way.**

A rise means fewer tests executed than the baseline records — that is the defect, and it fails the gate exactly the
way a new failure does. A fall means *more* tests executed, which is the good news, and failing on it would red the
gate on the very change that improved it. This is deliberately **asymmetric with the failure list**, where a
baseline entry that now passes IS a failure — and the asymmetry needs its comment, because it looks like an
inconsistency until you see why:

> A failure key is an **identity**: it names one test, and if that test passes the entry is simply stale and must be
> removed. A skipped count is a **measurement** over a suite whose membership changes for unrelated legitimate
> reasons — a suite gains three passing tests, someone deletes an `it.todo`, a `describe.skip` is un-skipped. Failing
> on a fall would make every one of those red on the author who did the right thing, and the gate would be routed
> around within a week. Failing on a rise is the whole finding; a fall is reported so the operator knows to run
> `--update`.

The fall report must be **loud and specific**, not a shrug. It must say that a fall is *also* what a disappearing
test looks like from inside a suite:

```
▲ 2 suite(s) record FEWER skipped tests than the baseline — good news if you un-skipped them,
  and a DISAPPEARANCE if you did not. Check before you run --update:
    src/shared/quality/schema-drift-gate.spec.ts   5 → 2   (-3)
```

**This is the slice's honest limit, and it must be stated in the code.** A suite that loses skipped tests by having
them **deleted** is reported, not failed. Say so in a comment rather than letting a reader discover it.

**(b) A suite in the report with a skip count and no baseline entry is a rise from 0 — it FAILS.** Otherwise a new
suite could arrive fully skipped and be green forever. Escape by omission is the exact defect `boot-check.js`'s
baseline and `lint-ratchet.js`'s ceiling list already refuse.

**(c) A suite key present in the baseline's `skipped` block but ABSENT from the report FAILS.** That is the third
case, and it is the one that catches §1.2's second shape: the suite stopped existing. It is at least as suspicious
as a count that rose, and it gets the same verdict, with its own message naming the file and telling the operator
that a legitimate rename or deletion is resolved by `--update` — the same escape hatch `fixed` already uses.

Held out under `--skip`, obviously — see (e).

**(d) Record only non-zero counts, and state the residual.** The baseline stays small and every line in it means
something. The cost is real and must be written down in a comment: **a suite with zero recorded skips that vanishes
entirely is NOT caught by this slice.** Catching that needs a full suite inventory (the shape of
`scripts/web-route-baseline.json`), which is a bigger diff than this finding, and inventing it here would widen the
change past its finding. Record it as a follow-on rather than leaving it unconsidered.

**(e) AC-3 — the `--skip` collision. Skipped counts get exactly the treatment `knownSkipped` already gets.**

`:222-225` already holds baseline failure keys matching the `--skip` pattern out of the comparison, because a test
that did not run is evidence in neither direction. **The same rule, for the same reason, applies to counts** —
and here it matters more, because under `--skip` those suites contribute *no* entry to the report at all, so
without the hold-out every skipped-under-the-pattern suite would look like case (c), a vanished suite, and a
`--skip` run would fail the gate every single time.

Two distinct events that must never be conflated, and the code should say which is which:

| Event | What it means | Treatment |
|---|---|---|
| the **gate's own tiering** skipped a path (`--skip src/shared/quality/`) | ci-gate.sh chose not to run it; nothing is known about it | held out of the comparison, and **reported** in the existing `SKIPPED specs matching …` line, which now also states how many skip-count entries were held out |
| a **suite skipped itself** (`describe.skip` because a database is absent) | the suite ran, decided not to execute, and reported that | counted, compared, and failed on a rise |

Extend the existing `:227-233` message rather than adding a second one — one line, both numbers.

**(f) `--update` (AC-2) — reinforce the existing rule, do not weaken it.**

`:71-75` already refuses `--update` with `--skip`, because rebuilding a baseline from a partial run drops what it
did not see. **That rule now protects the counts too, and more sharply**: a partial run has no entry for the
skipped suites, so an `--update` under `--skip` would write a `skipped` block with those suites **deleted** — the
gate would then be permanently blind to exactly the suites the tiering skips, which are the gate's own meta-tests.
Do not weaken the guard, do not add a `--force`, and extend its error message to say the counts are the second
reason.

### 3.6 Baseline schema — extend additively, and never degrade to silent green

`scripts/known-test-failures.json` is `{ $schema, $doc, apps: { <app>: { failures: {…} } } }`. Add a sibling:

```jsonc
"apps": {
  "api": {
    "failures": { /* unchanged */ },
    "skipped": {
      "src/shared/quality/schema-drift-gate.spec.ts": 5
    }
  }
}
```

Keys are suite paths **relative to the app directory, forward slashes** — the same normalisation `testKey()`
already applies at `:186`, so a Windows run and a Linux CI run produce the same key. Reuse the helper; do not write
a second normaliser.

**An old baseline with no `skipped` key must degrade LOUDLY, never silently.** If `apps.<app>.skipped` is absent:

- do **not** crash;
- do **not** fail the gate (it would leave the gate red with no way back except a complete run, which is not always
  available);
- **do** print an unmissable line on stdout — e.g.
  `⚠ test-ratchet[api]: this baseline records no skipped counts. The skip ratchet is INACTIVE for this app; run --update from a COMPLETE run.`
- **and qualify the final verdict line** so the green is never unqualified:
  `✓ test-ratchet[api]: no drift (skipped-count ratchet INACTIVE — baseline has no "skipped" block).`

A run that could not perform half its check says so. That is `DNC-08` applied to this file.

**Update the `$doc` block** to explain the new half in the existing voice — that the list of failures may only
shrink, and that the skipped counts may only fall; that a rise is a test that stopped running; and that a fall is
reported so the operator re-runs `--update` after checking it was deliberate.

**Populating the counts.** `--update` must write them, and only from a complete run (§3.5(f)). **If you cannot
produce a complete run in your environment — and you probably cannot: the full `apps/api` suite takes ~350 s and is
currently non-deterministic (`TOOL-16(b)`), and this story forbids you from running it — then DO NOT invent
numbers.** Leave the key absent, let the loud "INACTIVE" path above handle it, and **say plainly in your report
that the baseline was not populated and that populating it is an operator step.** A fabricated baseline number is
worse than an absent one: it makes the gate look armed.

---

## 4. Batched work — read the scope order before starting §5 or §6

> **Scope order.** TOOL-13 is the deliverable. TOOL-16(a) ships with it — it is a dozen lines in the same file. If
> TOOL-13 grows past a clean change, **drop §5 and §6 and say so in the PR body.** A tight correct PR beats a
> padded one, and both are P2.

Both §5 and §6 change `scripts/schema-drift-check.js` and add cases to `schema-drift-gate.spec.ts` — **in the
non-DB describes only** (see the ⛔ note in §2).

## 5. TOOL-11 (P2) — a cleanup path that throws ends the run with no verdict

`exec()`'s docstring at `:1110-1111` says, verbatim:

```
/** Execute-only. Returns `{ ok, detail }` rather than throwing, because every
 * caller has a verdict for a failure. */
```

Nine lines later, `:1120-1126` **throws**.

That matters because of *where* `exec()` is reached from. `check()` ends with `finally { cleanup(); }` (`:1528-1530`);
`cleanup()` (`:1386-1392`) calls `dropScratch()` (`:1544`), which calls `routes.exec(maintenanceUrl, 'DROP DATABASE …')`.
A throw inside a `finally` **replaces** the normal completion of the block — so it escapes past the
`console.log('▶ elapsed …')` and past `return report(state)`, and the run ends **with no verdict at all**. That is
`DNC-08` — *a run that ends without describing itself* — committed by the machinery built to prevent `DNC-08`.

It is worse on the signal path. `:1394-1404` registers `SIGINT`/`SIGTERM` handlers that call `cleanup()`, and an
`uncaughtException` handler that also calls `cleanup()`. A throw from the signal handler lands in the
`uncaughtException` handler, which calls `cleanup()` again, which throws again — this time with no handler left.

**The repair is the shape, not the rule.** Return instead of throwing:

```js
if (target.host !== source.host || String(target.port) !== String(source.port)) {
  return { ok: false, detail: `refusing to run SQL against … ` };   // same words, returned
}
```

**Do not weaken the guard.** It must still refuse the cross-server URL, with the same refusal text — it must just
refuse it *by returning*, which is what its own docstring promises and what `dropScratch()` at `:1551-1558` is
already written to handle (`if (!dropped.ok) { … return dropped; }`).

**It is unreachable today, and that is fine — this is defence in depth.** `deriveMaintenanceUrl()` and
`buildScratchUrl()` vary only the database path segment of the URL, and `buildScratchUrl` is already pinned to do
exactly that by the case at `:480`. Say so in the comment so the next reader can tell the fast path is sound rather
than lucky. If `deriveMaintenanceUrl`'s host/port invariance is not already pinned near `:551-560`, add that pin —
it is the fact this whole guard rests on.

**Evidence — drive the path, do not read the source.** `openSqlRoutes` is exported and the spec already calls it
with `DEAD_URL` at `:1136`, so this is a real execution, not a text assertion:

1. `const routes = gate.openSqlRoutes(DEAD_URL);` then
   `const outcome = routes.exec('postgresql://u:p@10.255.255.1:5432/other?schema=public', 'SELECT 1;');`
   → `expect(outcome).toEqual({ ok: false, detail: expect.stringContaining('refusing to run SQL against') })`,
   and **`expect(() => …).not.toThrow()`**. Red before (it throws), green after.
2. **Reproduce the cleanup shape**, because that is where the consequence lives: call `routes.exec(...)` from
   inside a `try { … } finally { … }` that mirrors `check()`'s, with a sentinel `reported = true` after the
   `finally`, and assert the sentinel is set. Before the fix the throw escapes and the sentinel stays false; after,
   it is true. That is `DNC-08` measured rather than described.
3. Negative control: the same `routes.exec` with a **same-server** URL must NOT return the refusal detail — or case
   1 would pass against an `exec` that refuses everything.

## 6. TOOL-12 (P2) — routes A and B still descend an unbounded ladder

`TOOL-10` bounded the two `docker` spawns and the Prisma-CLI probe. Two spawns on the gate path are still
unbounded:

| Route | Call site | Bound today |
|---|---|---|
| **B** — host `psql` | `psqlHost()`, `run('psql', …)` at `:1076-1080` | **none** |
| **A** — the Prisma CLI | `prismaRun()`, `run(cli.command, …)` at `:940` | **none** |

They do not bite on this Windows host only because `psql` is `ENOENT` — it fails instantly for the wrong reason.
`ci.yml` runs on `ubuntu-latest`, where a PostgreSQL client ships in the image and the OS TCP timeout is ~130 s per
attempt. The `indeterminate` preflight branch — deliberately kept by `TOOL-10` so a loaded-but-alive server is not
read as absent — descends that ladder on purpose. Unbounded, in CI, on every PR.

**Read `DOCKER_EXEC_TIMEOUT_MS`'s comment at `:246-262` before choosing numbers**, and follow its reasoning rather
than restating it. Its point: a **control-plane** bound applied to the **data plane** kills a legitimate
`CREATE DATABASE` on a cold Docker Desktop and reports `scratch_create_failed` — a false red on correct code, which
is worse than the slowness it removes.

Both new bounds are **data-plane** sized, and both are named constants with their own rationale:

| Constant | Value | Why |
|---|---|---|
| `PSQL_HOST_TIMEOUT_MS` | `120000` | Route B carries the *same statements* as route C (`CREATE DATABASE … TEMPLATE template0`, `DROP DATABASE … WITH (FORCE)`), just over the wire instead of through `docker exec`. Same work ⇒ same budget as `DOCKER_EXEC_TIMEOUT_MS`. |
| `PRISMA_RUN_TIMEOUT_MS` | `300000` | Route A is `db execute`, `migrate deploy` and `migrate diff` — `migrate deploy` **replays the entire ledger** and `migrate diff` shells out to the schema engine. The measured healthy end-to-end run of this check is ~17 s (`S-E02-5`), so 300 s is ~17× headroom and still a bound. |

`PRISMA_RUN_TIMEOUT_MS` must be **greater than** the existing `PRISMA_CLI_PROBE_TIMEOUT_MS` (`:269`, 60000): that
one bounds `pnpm … prisma --version`, a version lookup, and reusing it here would kill a real `migrate deploy`.

Export both, add them to `SchemaDriftModule`, and **pin the asymmetry** the way `:1175-1192` already pins
`DOCKER_EXEC_TIMEOUT_MS > DOCKER_TIMEOUT_MS`:

- `expect(gate.PSQL_HOST_TIMEOUT_MS).toBeGreaterThan(gate.DOCKER_TIMEOUT_MS)` — data plane ≠ control plane, with
  the comment saying why collapsing them is a false red rather than a tidy-up.
- `expect(gate.PRISMA_RUN_TIMEOUT_MS).toBeGreaterThan(gate.PRISMA_CLI_PROBE_TIMEOUT_MS)`.
- `callSites(EXECUTABLE_SCRIPT, /run\(\s*'psql'/)` → exactly 1 site, containing `PSQL_HOST_TIMEOUT_MS`.
- `callSites(EXECUTABLE_SCRIPT, /run\(\s*cli\.command/)` → exactly 1 site, containing `PRISMA_RUN_TIMEOUT_MS`.
- Non-vacuity first (`sites.length` asserted before any content claim) and on the **comment-blanked** source — a
  bound mentioned in a comment must not satisfy the assertion. `TOOL-07`/`TOOL-08` were made of exactly that.

**Verify the balancer against the shipped file with `node -e` before you trust it**, exactly as `TOOL-10`'s §5.4
did: measured today, both anchors find their site and **neither** contains a `timeoutMs`, so both cases are red
before and green after. Confirm that yourself and paste the numbers.

Bound nothing else. `pnpm`, and every other spawn, stay as they are — inventing bounds nobody has measured hanging
widens the diff past its finding.

---

## 7. Tests — the evidence standard

Every assertion must be able to fail, and every claim of "X is caught" must be paired with a measurement of the
**mutant that would slip past a weaker check** — the way `TOOL-10`'s spec measured 0-vs-2 `docker` sites, and the
way this file's `:127` case proves the extractor really extracts.

### 7.1 `apps/api/src/shared/quality/test-ratchet.spec.ts` — the fixture block (AC-4)

Keep the existing 14 cases untouched. Add describes that `require()` **`scripts/lib/ratchet-core.js` directly** —
the precedent is `schema-drift-gate.spec.ts:165`, which `require()`s a `scripts/` file by absolute path and types
it with a local interface. Do the same: a `RatchetCoreModule` interface, an unguarded `require`, and a comment
saying an unguarded require is deliberate (a guard spec that degrades to "nothing to check" when its subject
disappears is the failure the subject exists to stop).

Hand-write fixture jest reports as object literals in the spec — a passing suite, a suite with `pending`
assertions, a suite with a `todo`, a load-failed suite (`assertionResults: []`, `status: 'failed'`, `message` with
ANSI), and a fully-skipped suite (`status: 'skipped'`, one `pending` assertion). §1's measurements are the shapes
to copy.

The cases that carry the story:

| # | Case | Must be red before / green after |
|---|---|---|
| 1 | non-vacuity: the core module loads and exports the named surface | — |
| 2 | `NOT_EXECUTED_STATUSES` contains `'pending'` **and** `'todo'` | the mutant: a set of only `['skipped']` counts **0** on the §1.1 fixture — measure and assert that number, so "we count skips" cannot be satisfied by counting nothing |
| 3 | `reduceReport` on the §1.1 fixture yields the right per-suite count | ✔ |
| 4 | a fixture with **more** pending than the baseline ⇒ `compareToBaseline` reports a rise **and** the script's exit path is 1 | ✔ this is the primary AC |
| 5 | the **same** fixture against a **matching** baseline ⇒ no rise, no failure | the control — without it, case 4 is satisfied by a comparator that always fails |
| 6 | a fixture with **fewer** pending ⇒ **not** a failure, but present in `skipFalls` | ✔ |
| 7 | a baseline suite key absent from the report ⇒ reported as missing and fails (§3.5(c)) | ✔ |
| 8 | a report suite with skips and no baseline entry ⇒ rise from 0, fails (§3.5(b)) | ✔ |
| 9 | under `skip: 'src/shared/quality/'`, matching suites are held out of **both** directions — not a rise, not a fall, not missing (AC-3) | run the same fixture with and without `skip` and assert the verdicts differ exactly there |
| 10 | the load-failed suite is in `failing` with the byte-identical sentinel, and contributes **0** to `skipped` (§1.4) | assert the 0 explicitly |
| 11 | TOOL-16(a): the load-failed suite's `cause` is non-empty, contains the fixture's reason text, carries **no ANSI escape** (`/\[/` must not match), and is truncated with a stated marker when over `LOAD_FAILURE_CAUSE_LINES` | the mutant: reading `suite.failureMessage` yields `undefined` — assert the cause is a non-empty string, which that mutant fails |
| 12 | a baseline with **no** `skipped` key ⇒ `baselineHasSkipBlock === false`, no crash, and the script prints the INACTIVE line and qualifies its final verdict | drive the message through the script's own formatter, not by eye |

Add source-level pins on `EXECUTABLE_SCRIPT` proving **the logic really moved** and is not duplicated:

- `expect(EXECUTABLE_SCRIPT).toContain("require('./lib/ratchet-core')")`
- `expect(EXECUTABLE_SCRIPT).not.toContain('assertionResults')` — the reduction is no longer inline, so the spec
  and the gate cannot drift apart. **Evaluate this against your own diff before trusting it**; if you leave one
  legitimate reference behind, assert the count you actually have and say why.
- `expect(EXECUTABLE_SCRIPT).toContain('--update and --skip are mutually exclusive.')` (unchanged) plus the new
  sentence about the counts.

### 7.2 `apps/api/src/shared/quality/schema-drift-gate.spec.ts` — §5 and §6 evidence

**Insert after `:1204`, before the banner at `:1206`. Never at `:1215+`.** Anything inside `describeWithDb` is
`describe.skip` on this machine — which is this story's own defect, used as a place to hide from it.

Cases: §5's three (execution-driven, including the `finally`-shaped reproduction and the same-server negative
control) and §6's four (two constant pins, two paren-balanced call-site pins with non-vacuity first).

---

## 8. Gates

**`G-DNC` — triggered (always).** Two clauses bind here specifically:

- **`DNC-08` — a run that ends with no verdict.** §5 *is* a `DNC-08` repair. Do not reintroduce a throw on any
  cleanup path. And the ratchet's own new blindness case (§3.6, no `skipped` block) must **say** it could not
  check, never imply it did.
- **`DNC-10` — no new bypass surface.** No flag, env var or parameter that lets a caller choose what the gate
  compares or whether it runs. §3.1's forbidden alternative is the specific instance. `--update` and `--skip` stay
  mutually exclusive.

**Untriggered — and this is stated plainly rather than papered over with manufactured evidence.** This diff touches
no Prisma query, no model, no endpoint, no guard, no DTO, no permission, no migration, no privileged mutation, no
read projection or KPI, and nothing a parent, teacher, admin or student can see. **`G-TENANT`, `G-AUTHZ`,
`G-MIGRATION`, `G-AUDIT`, `G-TRUTH` and `G-PORTAL` are NOT triggered.** Do not write evidence for them.

---

## 9. Scope — the complete list of files this slice may touch

```
scripts/test-ratchet.js
scripts/lib/ratchet-core.js                              (new)
scripts/known-test-failures.json
scripts/schema-drift-check.js                            (§5, §6 only — droppable)
apps/api/src/shared/quality/test-ratchet.spec.ts
apps/api/src/shared/quality/schema-drift-gate.spec.ts    (§5, §6 only — droppable)
```

Plus this story file and the run's own traceability inbox file.

`scripts/**` and `apps/api/src/shared/quality/**` are **shared paths** (`docs/daily-improvement-v3/tracks.md`
§"Shared paths — claim before touching"). Keep the change minimal and **declare both in the PR body.**

**Explicitly out of scope — do not do these:**

- **`TOOL-16(b)`** — the underlying suite non-determinism. Named, not attempted.
- **Do not touch `scripts/ci-gate.sh`.** No stage bound moves, up or down.
- **Do not touch `apps/web/**`, `packages/**`, `apps/api/src/shared/auth/**`,
  `apps/api/src/modules/identity/**`, `apps/api/src/modules/audit/**`** — tracks b and c own those.
- **Do not edit `docs/daily-improvement-v3/traceability/OPEN.md`** and do not touch `.claude/`.
- **Do not run `pnpm build`**, `next build`, `docker build`, or `infra/pilotage.sh update|rebuild|reset`.
- **Do not run `pnpm typecheck`** — the test-architect runs it, once.
- **Do not run the full `apps/api` suite.** ~350 s and non-deterministic (`TOOL-16(b)`).
- **Do not invoke `docker`.** Degraded on this host: `docker ps` hangs past 150 s and leaves orphaned CLI processes.
- **Do not start a database.** `127.0.0.1:5433` refuses connections, measured. Nothing here needs one; if you find
  yourself needing one, you have left the slice — stop and report.
- Do not change the failure-list semantics, the exit codes (2 = could not run, 1 = drift, 0 = clean), or the
  sentinel key.

---

## 10. Acceptance criteria

| # | Criterion | How it is proven |
|---|---|---|
| **AC-1** | `test-ratchet.js` records a per-suite **skipped/pending** count in the baseline alongside failures, and **fails** when it rises — a disappearing case is a red like any other | §7.1 cases 3, 4, 8, with case 5 as the control |
| **AC-2** | `--update` rewrites those counts only from a **complete** run; `--update` + `--skip` is still refused, exit 2, and its message now names the counts as the second reason | the existing executed case at `test-ratchet.spec.ts:254` stays green; the message extension asserted |
| **AC-3** | Baseline entries *and* skip counts under a `--skip` path are held out of the comparison in **both** directions; a path skipped by the gate's tiering is distinguished, in code and in output, from a suite that skipped itself | §7.1 case 9; the extended `:227-233` line |
| **AC-4** | The proof is **fixture-driven**: hand-written jest reports fed to `scripts/lib/ratchet-core.js`, the exact module the gate runs. No test depends on a database | §7.1, all cases; `ratchet-core.js` is pure |
| **AC-5** | `NOT_EXECUTED_STATUSES` is a named constant with its measurement in a comment, and covers `'pending'` and `'todo'` | §7.1 case 2, including the counts-zero mutant |
| **AC-6** | A load-failed suite stays a **failure** under the byte-identical `<suite failed to load>` key and is **not** counted as skipped | §7.1 case 10 |
| **AC-7** | A baseline suite key absent from the report is handled deliberately and documented; the residual (a zero-skip suite that vanishes) is stated in a comment, not left unconsidered | §7.1 case 7 + the comment at §3.5(d) |
| **AC-8** | A skipped count that **falls** does not fail the gate but **is** reported, with the reason for the asymmetry in a comment | §7.1 case 6 |
| **AC-9** | An old baseline with no `skipped` block does not crash and does not silently pass: it prints an INACTIVE warning and **qualifies the final verdict line** | §7.1 case 12 |
| **AC-10** | **TOOL-16(a)**: a load failure's cause reaches the output — from `suite.message`, ANSI-stripped, truncated with a stated marker | §7.1 case 11, with the `failureMessage`-returns-`undefined` mutant measured |
| **AC-11** | The 14 existing cases in `test-ratchet.spec.ts` stay green **unedited**; `const report = runJest();` and `const app = process.argv[2];` stay byte-identical | run the file; report 14/14 + your new count |
| **AC-12** | No new flag, env var or parameter chooses the gate's input or whether it runs (`DNC-10`) | source pins; the argument-contract cases stay green |
| **AC-13** | **TOOL-11**: `exec()`'s cross-server guard **returns** `{ ok:false, detail }` with the same refusal text; a cleanup-shaped `finally` completes and still reports | §5 evidence 1–3, execution-driven |
| **AC-14** | **TOOL-12**: routes A and B each pass a named data-plane `timeoutMs`; the data-plane and control-plane bounds are pinned as **different** | §6's four cases, non-vacuity first, on comment-blanked source |
| **AC-15** | `scripts/ci-gate.sh` is **byte-identical** to `HEAD` | `git diff --stat` in the PR body |

---

## 11. How to verify what you wrote — run these, paste the real numbers

```bash
# The two spec files, targeted. This is the ONLY jest you may run.
cd apps/api
npx jest src/shared/quality/test-ratchet.spec.ts
npx jest src/shared/quality/schema-drift-gate.spec.ts

# Baseline measured by the author on 2026-08-12, both files together, --runInBand:
#   wall 30 s · 124 total · 119 passed · 0 failed · 5 pending
#   test-ratchet.spec.ts 14 passed · schema-drift-gate.spec.ts 105 passed / 5 pending
# Your run must beat 0 failed and must ADD cases, not move those numbers down.

# Evaluate every source anchor against the file as shipped BEFORE trusting it:
node -e "…paren-balance run('psql' and run(cli.command; print site count and whether each has timeoutMs"
```

**Rules for the evidence you record:**

- Paste **real numbers from your own run.** Never record evidence you did not produce.
- The `5 pending` above is not a defect in the drift-gate spec and is **not yours to fix** — it is the *subject* of
  this story. Do not delete `describeWithDb`, do not force those five to run, do not stand up a database.
- **Node mismatch:** this host runs **v25.7.0** against an `.nvmrc` pin of **22.13.1**, and `GUARDRAILS` §3 warns
  Node ≥ 23 breaks the local run. If something fails in a way that smells like that mismatch, **say so and stop** —
  do not code around it.

---

## 12. Pre-mortem — assume this shipped and something broke

| Failure mode | Why it would happen | What catches it |
|---|---|---|
| The skip ratchet counts **zero** forever and the gate is green again | counting only `'skipped'`, which `describe.skip` does not produce (§1.1) | AC-5's mutant: the `['skipped']`-only set measured at 0 on the §1.1 fixture |
| TOOL-16(a) prints nothing | reading `suite.failureMessage`, which does not exist in jest 29.7.0's JSON (§1.3) | AC-10 asserts a non-empty cause containing the fixture's reason |
| Every `--skip` run of `ci-gate.sh` goes red | skip counts not held out, so skipped suites look like case (c), vanished | AC-3 / §7.1 case 9, which runs the same fixture with and without `skip` |
| The gate reds on the developer who un-skipped a test | failing on a fall as well as a rise | AC-8 |
| An un-migrated baseline reads as fully green | the missing `skipped` key defaulting to "nothing to compare" and staying quiet | AC-9 — the INACTIVE line **and** the qualified verdict line |
| The refactor breaks the gate the whole repo depends on | too much moved out of `test-ratchet.js` | AC-11 — the 14 existing cases, unedited, including the two byte-identical line pins |
| The fixture evidence drifts from the gate's real logic | logic duplicated instead of required | the `not.toContain('assertionResults')` pin, plus the spec requiring `ratchet-core.js` itself |
| A bypass arrives disguised as testability | `RATCHET_REPORT_FILE` or similar | §3.1's forbidden alternative; AC-12 |
| The drift check reports `scratch_create_failed` on correct code in CI | a control-plane bound applied to the data plane | AC-14 pins the two as different, with `DOCKER_EXEC_TIMEOUT_MS`'s own comment as the precedent |
| The `DNC-08` fix reintroduces `DNC-08` | a throw added back on a cleanup path | AC-13's `finally`-shaped reproduction |

---

## 13. Ledger note — the epic ledger disagrees, and here is exactly how

`docs/spec/features/v3-e02/PROGRESS.md` carries **no row for `TOOL-13`, `TOOL-16`, `TOOL-11` or `TOOL-12`**; its
slice table stops at `TOOL-10` (run 44). The `TOOL-*` ids live in the traceability inbox. That is a gap, not a
contradiction: the epic ledger does not index the gate-hardening findings. **The operator-supplied slice governs.**

One ledger statement is measurably **stale** and is corrected here rather than inherited: the `TOOL-10` row records
*"116 passed / 2 failed / 5 skipped, the two failures pre-existing (`AC-5`, `AC-15` at `schema-drift-gate.spec.ts:721`)"*.
Re-measured on this worktree on 2026-08-12: **124 total, 119 passed, 0 failed, 5 pending.** The two failures are
gone. The **5 pending** are still there, and they are this story's subject.

`docs/spec/features/v3-e02/tasks.md` **does not exist** — the epic directory holds only `PROGRESS.md` and
`stories/`. And `PROGRESS.md`'s last **Next slice** pointer (`:2112`) names `S-E01-2b` in `V3-E01`, a different
epic entirely. Neither is an instruction: **the operator-supplied slice governs**, and this file is the contract.

---

## 14. Dispatch re-verification — every anchor above was re-measured before this story was handed over

Re-run on this branch on **2026-08-12**, immediately before implementation started. Nothing in §1–§12 moved; a
developer may treat every line number above as current.

| Claim | Re-measured result |
|---|---|
| `scripts/lib/` does not exist | `Test-Path scripts\lib` → **False** — the new directory really is new |
| `test-ratchet.js` builds `failing` from `status === 'failed'` | **`:195`**, verbatim |
| the load sentinel is synthesised and its cause discarded | **`:199-201`**, `'<suite failed to load>'` |
| the file contains **no** `pending` / `skipped` / count logic at all | confirmed by reading `:180-274` end-to-end — the reduction, the baseline write (`:209-219`), the `--skip` hold-out (`:221-233`) and the summary (`:238-242`) mention neither |
| `known-test-failures.json` carries only `failures` keys | **`:15`** (`apps.api`, **11** entries — the table said 12 when it was handed over; corrected on landing, measured two ways: `Object.keys(b.apps.api.failures).length === 11`, and 11 `"finding"` occurrences in the `apps.api` block, which rules out a duplicate-key collapse at parse time) and **`:63`** (`apps.worker`, 7 entries); **no `skipped` key anywhere** — so the `INACTIVE` path of §3.6 is the path this repository will actually take |
| `const describeWithDb = reachable ? describe : describe.skip;` | **`schema-drift-gate.spec.ts:1215`**, verbatim; the non-DB describes still close at **`:1202`** with the banner at **`:1204-1211`** — **insert new cases between them** |
| `exec()`'s docstring promises `{ ok, detail }` … | **`:1111-1112`** |
| … and nine lines later the cross-server guard **throws** | **`:1120-1126`**, verbatim |
| **§6 anchors, `node -e` against the shipped file** — the check §11 tells you to run | `run('psql'` → **exactly 1 site, `:1077`** · `run(cli.command` → **exactly 1 site, `:940`** · all 9 `timeoutMs` occurrences are at `:674, :698, :703, :842, :843, :849, :912, :1052, :1085` — **neither anchor line is among them.** Non-vacuity holds (1 ≠ 0) and both §6 cases are genuinely **red before, green after**. |
| host Node | **v25.7.0** against the `.nvmrc` pin of **22.13.1** — §11's warning is live, not theoretical |
