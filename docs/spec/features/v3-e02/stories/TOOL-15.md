# TOOL-15 / TOOL-18 — no spec plants a probe file in the shared checkout

> **Epic** `V3-E02` — Versioned database lifecycle and release integrity (gate-hardening track)
> **Layer** L0 · **Risk tier** P1 · **Mode** `epic-slice` · **blockedBy** (empty — see §0, the parked decision is
> settled by measurement in this document and ratified in `ADR-039`)
> **Closes** `TOOL-15` (P1, primary) and `TOOL-18` (P1) — they are one defect at two addresses.
> **Advances** `TOOL-16(b)` (the end-to-end non-determinism; this removes one of its two named causes).
> **Does NOT close** `TOOL-17(b)`'s three residuals. `scripts/lib/walk-read.js` is **not** modified and **not**
> deleted — see §6.
> **Touches** UI: **no** · backend runtime: **no** (no controller, guard, DTO, service, module or Prisma query is
> opened) · worker: **no** · gate scripts: **one existing script modified** —
> `scripts/link-integrity-check.js` (§4) · specs: **two rewritten** + **one new**.
> **Gates triggered** `G-DNC` only. §8 gives every other gate its reason rather than a blank cell.

---

## 0. The parked decision, and why it is settled rather than deferred

`TOOL-15` has been recorded three times as *"an open design call for `open-decisions.md`, not a side effect of a
slice"* — choose between **(a)** a scratch-tree copy, **(b)** serialising the two writer specs, and **(c)** weakening
`AC-7` to a rule-scoped assertion. Run 46 raised `TOOL-18` as *"the second independent piece of evidence that this
design call has to be taken."*

**It is taken here, and it is (a), because (a) is already this repository's technique and it was measured, not
preferred.** Three facts decide it:

1. **6 of the 8 spec files in `apps/**` that write to the filesystem already write into an os-tmpdir scratch tree**
   (`mkdtempSync(join(tmpdir(), …))`). Counted this run across all 108 spec files, not sampled:
   `link-integrity-gate.spec.ts`, `observability-gate.spec.ts`, `production-artefact-gate.spec.ts`,
   `schema-drift-gate.spec.ts`, `walk-read-gate.spec.ts`, and the `DNC-08` block of each of the two offenders.
   The two exceptions are **precisely** the two probes named in `TOOL-15`, `TOOL-17` and `TOOL-18`. Option (a) is not
   a new architecture; it is the removal of two deviations from the standing one.
2. **The "no root parameter" objection does not apply, and that was the objection blocking (a).**
   `audit-findings-index.md` records it as *"`csv-escape-check.js` deliberately exposes no root parameter — a flag
   that lets a caller choose what is compared is a bypass flag wearing a different hat."* True, and it stays true:
   **no flag is added.** `scripts/csv-escape-check.js:128` is `const REPO_ROOT = resolve(__dirname, '..')` — the root
   follows the **script's own location**. Copying the script to `<scratch>/scripts/csv-escape-check.js` and spawning
   it with `cwd: scratch` makes the scratch tree its root with no interface change at all. This is not a workaround:
   **the `DNC-08` block of each offending spec already does exactly this**, eight cases deep, and has since it was
   written.
3. **(b) and (c) are both worse and both were checked.** (b) serialising leaves the probe in the real tree, so
   `git status` is still dirty mid-run and any *other* future walker is still a victim — it narrows the window
   instead of closing it. (c) rule-scoping `AC-7` deletes the only executed evidence that the real script can go red
   on a real fourth escaper, which is the one thing `AC-7` exists for.

`ADR-039` records this. `open-decisions.md`'s `TOOL-15` entry moves to `resolved` **citing the measurement**, not the
argument.

> **Correction to fact 1, made at land (run 47) — keep the correction, not the tidier number.** The "6 of 8" above
> came from *this document's* author scanning with a regex. The implementer re-measured with the TypeScript parser
> and got **7 files performing real writes, 5 of them exclusively into a scratch tree**, the same 2 exceptions.
> The regex had counted `test-ratchet.spec.ts`, whose only `rmSync(scratch, …)` sits **inside a string literal**.
> Both readings agree on the conclusion and on which files the exceptions are, so the decision is unaffected — but
> the AST reading is the correct one, and it is the reason `AC-4`'s ratchet **parses instead of grepping**
> (`R-30`: a matcher that flags a write inside a string literal creates pressure to weaken the ratchet).
> `open-decisions.md` `D-13` records both readings. This paragraph exists because a spec that quietly swaps in the
> better number teaches the next author nothing — cf. `feedback-verify-the-brief-you-wrote`.

---

## 1. The defect, at both addresses — measured by run 46, do not re-derive it

Two specs plant a file inside the real working checkout and delete it again:

| Writer | Probe path | Line |
|---|---|---|
| `apps/api/src/shared/quality/audit-write-gate.spec.ts` | `apps/api/src/shared/quality/__audit_write_probe.ts` | `:689`, written `:698` |
| `apps/api/src/shared/quality/csv-escape-gate.spec.ts` | `apps/web/src/lib/__csv_escape_probe.tsx` | `:493`, written `:502` |

Under parallel jest, any process that lists one of those directories and then reads what it listed can be handed a
path that no longer exists.

**`TOOL-17` (closed, run 46) fixed the five SPEC-side victims** by routing their walked reads through
`scripts/lib/walk-read.js`, which tolerates exactly one thing: a walked path confirmed absent on re-check.

**`TOOL-18` is the half that was deliberately left standing**, and it is a CHECK SCRIPT, not a spec:
`scripts/link-integrity-check.js:1060-1061` is

```js
for (const file of walkSources(root)) {
  const source = readFileSync(file, 'utf8');   // ← no try, anywhere on this path
```

over `apps/web/src` — the very directory `csv-escape-gate.spec.ts` plants its probe in. The CLI dies on an uncaught
`ENOENT` and prints a **stack trace instead of a verdict line**. `link-integrity-gate.spec.ts:1899-1900` then
compares that CLI's exit status against an **in-process** `classifyAll` that read the tree at a different instant, and
`:1903` asserts the verdict line matches `/LINK INTEGRITY CHECK: (PASS|FAIL)/`. Both fail.

Measured, twice, on one unchanged tree (`ci/2026-08-13-v3-e02-tool17`, denominator **2532 in both runs**):

| Gate run | Verdict | api ratchet |
|---|---|---|
| 1 | `GATE: FAIL (1 stage)` | `2514/2532 · 13 failing · 11 known` — 2 NEW, both this race |
| 2 | `GATE: PASS (fast)` | `2516/2532 · 11 failing · 11 known` — no drift |

Both victim specs pass **228/228 standalone**. Neither was in run 46's diff.

**The consequence, restated because it is the operational one:** `AUTO-LAND`'s `green` cannot be discharged from a
single gate run for any gate-machinery diff. This story is the repair that makes it dischargeable.

---

## 2. The constraint that decides whether this slice is worth landing

**Do NOT route `scripts/link-integrity-check.js` through `scripts/lib/walk-read.js`.** That module's own docblock
argues the divergence and it is right: a check script **is** the verdict, it runs once and alone, and an input it
cannot read is a verdict it cannot pronounce. Tolerating a vanished file there converts an unclassifiable state into
a PASS — `DNC-08` proper, and the routine's STOP condition 4 (*"closing the finding would require weakening a
gate"*). `PF-146` and `PF-105` are the two existing instances of that mistake in this repository; do not create a
third.

The repair is to **remove the race**, not to tolerate it. The check scripts keep failing on an unreadable input;
`link-integrity-check.js` is only taught to fail **legibly** (§4), which is strictly more information than a stack
trace, never less.

---

## 3. AC-1 … AC-4 — the two probes become hermetic

### AC-1 — `csv-escape-gate.spec.ts` `AC-7`'s fourth-copy case writes nothing into the checkout

The sub-`describe` *"a deliberately-added fourth copy, in a .tsx file"* (`:492-522`) is rebuilt on the scratch-tree
technique **already present in the same file** at `:540-556`: `mkdtempSync(join(tmpdir(), …))`, the real
`scripts/csv-escape-check.js` copied to `<scratch>/scripts/`, `spawnSync(process.execPath, [scriptCopy], { cwd:
scratch })`.

**The trap, and it is the whole difficulty of this AC.** The script has four preflights *before* rule A can speak —
the predicate module, the security barrel re-export, every declared walk root existing, and a vacuity floor
(*"found nothing" is never a pass*). `DNC-08` cases 2–7 in this same file each drive one of them. So a naive scratch
tree makes the script red **for a preflight reason**, and an `expect(red.status).toBe(1)` would pass while proving
nothing about a fourth escaper.

The construction must therefore be, in order:

1. build a scratch tree that the real script rates **GREEN** — every walk root present and non-empty, the predicate
   and barrel present, and the sanctioned escapers present so the vacuity floor is satisfied;
2. assert that green **first** (`status === 0`, `CSV ESCAPE CHECK: PASS`) — this is the control, and without it the
   RED below is not attributable;
3. add the fourth copy as `<scratch>/apps/web/src/lib/__csv_escape_probe.tsx`;
4. assert RED **naming `RULE A (a fourth CSV escaper)` and naming the probe file** — the same three assertions the
   current test makes;
5. remove it, assert green again.

Prefer copying the real sanctioned escaper sources into the scratch tree over hand-writing look-alikes: a
hand-written stand-in that stops matching the script's own detector turns this case green for the wrong reason. If
copying is not workable, say so in the PR body and state what was synthesised instead.

### AC-2 — `audit-write-gate.spec.ts` `AC-3` likewise

Same rebuild for the probe at `:689-717`, against `scripts/audit-write-check.js`, using the scratch-tree block
already in that file at `:735-750`. Same ordering discipline: prove the scratch tree green first, then plant the
non-transactional write, then assert it names the rule **and** the file.

### AC-3 — the real-tree half of both `AC-7`/`AC-3` is UNCHANGED

`csv-escape-gate.spec.ts:474-490` and the equivalent in `audit-write-gate.spec.ts` run the real script over the real
`REPO_ROOT` and assert it is green. **Those stay exactly as they are.** They plant nothing, they are the only
evidence the real repository satisfies the rule, and deleting them would be option (c) by the back door.

### AC-4 — a ratchet, shown able to fail, so this cannot regress

A new spec asserts: **no spec file under `apps/**` performs a filesystem write to a destination that is not derived
from `mkdtempSync` / `tmpdir()`.** Requirements:

- it must **walk** the spec corpus and go through `scripts/lib/walk-read.js` (that seam exists precisely for this);
- it must carry the accounting identity `map.size + skipped.length === list.length` and the `MAX_VANISHED_FILES`
  cap, like the nine sites `TOOL-17` converted — a floor on the walk list does not transport to the read map;
- it must have a **floor** on the corpus size, so an empty walk is not a pass;
- it must be **shown able to fail**: drive the classifier over a fixture containing a `writeFileSync(join(REPO_ROOT,
  …))` and assert it is flagged. A ratchet that has never been observed red is an assertion, not a gate.
- the six specs that legitimately write into scratch trees must be **green** under it. If the analysis cannot
  distinguish them without a hand-maintained allowlist, prefer a small **declared** allowlist with a comment per
  entry over a heuristic that will misfire — and say which you chose and why.

**Where it lives:** `apps/api/src/shared/quality/` beside its siblings. Note `TOOL-04`: a diff matching
`^(scripts/|\.github/|infra/|apps/api/src/shared/quality/)` escalates the gate. This diff already matches on both
counts, so the escalation is priced in and is not a reason to place the file elsewhere.

---

## 4. AC-5 — `link-integrity-check.js` pronounces a verdict instead of crashing

`scripts/audit-write-check.js` and `scripts/csv-escape-check.js` already convert an unreadable walked file into
`fail(['DNC-08 — <path> is unreadable: …'])`. `scripts/link-integrity-check.js` does not — it crashes. Close that
asymmetry, **matching the existing two scripts' vocabulary and exit behaviour exactly**.

Non-negotiable, and the reason this is not `walk-read.js` in disguise:

- the script still **FAILS**. Exit status is unchanged from what a crash implied: non-zero, never 0.
- the failure is **named**: the message contains `DNC-08`, the offending path, and the underlying errno.
- the verdict line `LINK INTEGRITY CHECK: FAIL` is **printed**, which is the whole point — `link-integrity-gate.spec
  .ts:1903` asserts a verdict line exists, and today there is none to assert on.
- **no file is skipped and no tolerance is introduced.** An unreadable input is a verdict it cannot pronounce; it
  says so and goes red.

Shown able to fail via the scratch-tree technique (copy the script, supply an unreadable input), not by mutating the
real tree.

---

## 5. AC-6 — the decision is recorded

- **`docs/adr/ADR-039-hermetic-spec-writers.md`** — the §0 measurement, the three options, why (a), and the
  standing rule: *a spec may write only into a tree it created under `tmpdir()`.* Record explicitly that no root
  flag was added to any check script and why the `REPO_ROOT = resolve(__dirname, '..')` shape makes one unnecessary,
  so the "bypass flag wearing a different hat" objection is answered in the place someone will look for it.
- **`open-decisions.md`** — the `TOOL-15` entry moves to `resolved`, citing `ADR-039` and the 6/8 count.

---

## 6. What this slice must NOT do

- **Do not modify or delete `scripts/lib/walk-read.js`.** Removing the two probes shrinks how often its tolerance
  fires; it does not make the tolerance wrong. Any *future* writer, and the five converted sites, still need it.
  `TOOL-17(b)`'s three residuals (the sixth victim at `write-audit.spec.ts:416`, the FR-4 named-path leak, the
  shared cap of 5 over `portal-landing-gate`'s 10-file corpus) stay open and are **out of scope here**.
- **Do not touch `scripts/ci-gate.sh`, `scripts/test-ratchet.js`, `scripts/known-test-failures.json` or any
  baseline.** The skipped-count baselines are an operator `--update` from a complete run and must never be
  hand-written.
- **Do not add a dependency.** A bump is how the NestJS v10 pin breaks by accident.
- **Do not weaken, rule-scope or delete any existing assertion in either spec** beyond the mechanical relocation of
  the two probe cases. If an assertion cannot be carried into the scratch tree, keep it on the real-tree half and
  say so.

---

## 7. Evidence this slice must produce

1. `git status` is clean at every point of the api suite's execution — no `__csv_escape_probe.tsx`, no
   `__audit_write_probe.ts`, ever, in the real tree.
2. Both rewritten cases still go **RED on the real script** for the **real rule**, with the rule name and the file
   name in the message.
3. AC-4's ratchet observed **red** on its fixture and **green** on the real corpus.
4. AC-5's failure path observed producing a verdict line and a non-zero status.
5. `scripts/ci-gate.sh` (**no flags**) run **twice**. Report the printed `GATE:` line from each, never `$?`, and
   never through a pipe. Two agreeing PASS runs is the first time this repository will have had a reproducible gate
   on a gate-machinery diff — that is this story's real acceptance test, and if the two runs still disagree, **say
   so and leave the PR open**: the finding is then narrowed, not closed.

## 8. Gates

| Gate | Triggered | Reason |
|---|---|---|
| `G-TENANT` | **no** | No Prisma query, model, endpoint, job, export or object key is opened. |
| `G-AUTHZ` | **no** | No controller, guard, DTO, permission or role code is opened. |
| `G-MIGRATION` | **no** | No `schema.prisma`, no SQL. |
| `G-AUDIT` | **no** | No privileged mutation. `audit-write-gate.spec.ts` is edited, but it is a *scanner over* audit code, not audit code. |
| `G-TRUTH` | **no** | No read projection, KPI, count, aggregate or dashboard. |
| `G-PORTAL` | **no** | No shared data and no portal surface. `apps/web/src` is *walked* by a check script; nothing under it is edited. |
| `G-DNC` | **yes, always** | `DNC-08` is the live one and §2 is its argument. Verify the diff reproduces none of `DNC-01…DNC-12`. |

---

## 9. Implementation contract — measured this run (John), so the dev needs nothing else open

Everything below was read out of the scripts and specs on this branch, not recalled. Line numbers are `HEAD` of
`ci/2026-08-13-v3-e02-tool15-hermetic`.

### 9.1 The GREEN control for AC-1 — the exact scratch tree, and the trap in it

`scripts/csv-escape-check.js` checks its inputs in this order (`:676-724`, then `:610`), and **the first one that is
missing is the one that speaks**:

1. `require('typescript')` resolves;
2. `packages/contracts/src/security/csv-injection.ts` exists · is readable · exports **all three** of
   `CSV_INJECTION_TRIGGERS`, `CSV_NEUTRALISER`, `neutraliseCsvCell`;
3. `packages/contracts/src/security/index.ts` exists · re-exports `'./csv-injection'`;
4. **each of the six** `WALK_ROOTS` (`:135-142`) exists **and** matches ≥ 1 production source file
   (`.ts`/`.tsx`, not `.d.ts`, not `.spec.*`/`.test.*`);
5. every walked file is readable and parseable;
6. the vacuity floor `MIN_SANCTIONED_ESCAPERS = 2` (`:219`).

**The trap the story §3 names, made concrete.** Rule D is **one-way**: a `SANCTIONED` *or* `EXCLUDED` entry that
matches nothing is RED. So a scratch tree carrying only the two sanctioned escapers still goes red — for rule D, not
for rule A — and `expect(status).toBe(1)` would pass while proving nothing. **All four keyed files must be present.**

Minimum green tree (`<scratch>` = `mkdtempSync(join(tmpdir(), 'csv-escape-ac7-'))`):

| Path under `<scratch>` | How | Why |
|---|---|---|
| `scripts/csv-escape-check.js` | copy of `SCRIPT_PATH` | `REPO_ROOT = resolve(__dirname, '..')` → the scratch tree becomes its root. **No flag.** |
| `node_modules/typescript/{package.json,index.js}` | shim re-exporting `require.resolve('typescript')` — the technique already at `csv-escape-gate.spec.ts:565-570` | preflight 1 |
| `packages/contracts/src/security/csv-injection.ts` | **copy the real file** | preflight 2, and rule B's trigger literals |
| `packages/contracts/src/security/index.ts` | **copy the real file** | preflight 3 |
| `apps/web/src/lib/csv.ts` | **copy** | `SANCTIONED` key `…#csvEscape` + rules C/D |
| `apps/worker/src/modules/exports/generators/audit-csv.generator.ts` | **copy** | `SANCTIONED` key `…#csvEscape` + rules C/D |
| `apps/api/src/modules/imports/imports.service.ts` | **copy** | `EXCLUDED` key `…#escape` — rule D goes red without it |
| `apps/api/src/modules/integrations/oneroster.adapter.ts` | **copy** | `EXCLUDED` key `…#escape` — same |
| one placeholder `.ts` in `packages/ui/src` and `packages/imports-core/src` | write | preflight 4 (roots 5 and 6 are otherwise empty) |

Copying is AST-only work: the script never resolves an import, so a copied file with unresolvable imports is fine.
Do **not** hand-write stand-ins for the four keyed files — a stand-in that stops matching the detector turns the case
green for the wrong reason.

Then, in order and each assertion executed: **(1)** green — `status === 0` and `CSV ESCAPE CHECK: PASS`; **(2)** write
`<scratch>/apps/web/src/lib/__csv_escape_probe.tsx` (the body currently at `:503-511` is carried over verbatim);
**(3)** red — the three assertions currently at `:514-517`, i.e. `status === 1`, `stderr` contains
`CSV ESCAPE CHECK: FAIL`, `RULE A (a fourth CSV escaper)`, **and** `__csv_escape_probe.tsx`; **(4)** `rmSync` the
probe, green again. `afterAll` removes `<scratch>` recursively.

### 9.2 The GREEN control for AC-2 — `audit-write-check.js` is the more expensive tree, and here is why

Preflights (`scripts/audit-write-check.js:665-725`, floor at `:756`): parser · seam
`apps/api/src/shared/audit/write-audit.ts` exists · findings index
`docs/daily-improvement-v3/audit-findings-index.md` exists, is readable, **parses to ≥ 1 finding id** · baseline
`scripts/audit-write-baseline.json` exists, is valid JSON, **has a `sites` object** · each of the **three**
`WALK_ROOTS` (`:145` — `apps/api/src`, `apps/worker/src`, `packages/imports-core/src`) exists and matches ≥ 1
production `.ts` · every walked file readable/parseable · **`MIN_WRITE_AUDIT_CALLS = 12`** (`:162`).

That floor of **12** is the cost of this AC and it is not negotiable from the spec side. Synthesise twelve modules
under `<scratch>/apps/api/src/…`, each one call site of the shape rule B accepts — the `writeAudit` argument
**lexically bound** by a `$transaction` callback parameter (an alias is rejected, by design), and **no call inside a
`try` block** (`ADR-035` D2). Copy the real seam file and the real findings index (one file each) rather than
inventing them: the index rule exists precisely because a shape-only resolver is not a resolver. Baseline content
`{ "sites": {} }` is correct — the scratch tree contains no rule-A violation, and a baseline row matching nothing is
itself red.

Then: green first; plant `<scratch>/apps/api/src/shared/quality/__audit_write_probe.ts` with the body currently at
`:700-706`; assert `status === 1`, `AUDIT WRITE CHECK: FAIL`, `RULE A (auditLog.create outside shared/audit)` **and**
`__audit_write_probe.ts`; remove; green again.

### 9.3 AC-4 — parse it, do not grep it, and prove the red without touching `apps/**`

**Chosen technique: TypeScript AST, not text.** Measured reason, in this repository: `test-ratchet.spec.ts:110` and
`:214` contain `rmSync(scratch, { recursive: true, force: true })` **inside string literals** (it asserts over the
text of another file). A text scan flags them; the resulting pressure would be to weaken the ratchet, which is `R-30`
exactly. Both existing check scripts already state the doctrine — *"PARSED, NEVER GREPPED"* — and `require('typescript')`
is a root devDependency, so this introduces no dependency and no new decision.

Classification: a write call (`writeFileSync`, `appendFileSync`, `mkdirSync`, `cpSync`, `rmSync`, `writeFile*` …)
is **legitimate** iff its destination expression is derived from a binding initialised from `mkdtempSync(…)` /
`tmpdir()`; anything else is a violation. Prefer this over an allowlist; fall back to a **declared** allowlist with a
comment per entry only if the AST cannot separate the six legitimate scratch specs, and **say in the PR body which
was used and why**.

Required properties: walk the `apps/**` spec corpus through `scripts/lib/walk-read.js`; assert
`map.size + skipped.length === list.length` **and** `skipped.length <= MAX_VANISHED_FILES` (5); assert a corpus
**floor** — measured **108** spec files under `apps/**` today, so a floor of **≥ 90** has headroom without being
vacuous.

**The red-proof must not write into `apps/**`.** Planting a fixture spec in the corpus to prove the ratchet can fail
would recreate the exact defect this story removes. Drive an exported `classify(path, source)` with the fixture
source **as a string**, or place the fixture under `<scratch>` — never in the real tree.

Location `apps/api/src/shared/quality/` (per §3). `TOOL-04` escalation is already priced in.

### 9.4 AC-5 — the seam in `link-integrity-check.js`, named

The crash is `scanApp` (`:1051`), whose loop body is `:1060-1061`. `main()` already owns a `structuralFailures` array
(`:1575`) and already prints the verdict block and exits 1 at `:1690-1696`. **That is the seam**: convert the
unreadable walked file into a named structural failure that reaches `main()`, so the existing FAIL block prints
`LINK INTEGRITY CHECK: FAIL` and exits non-zero.

Three constraints the implementer must hold:

- `scanApp` is also reached **in process** by the exported `extractLiteralLinks` (`:1177`) and `extractTemplateLinks`
  (`:1185`), which the guard spec drives directly. Those paths keep throwing — **no tolerance is added anywhere.**
  Only the CLI converts the throw into a printed verdict.
- `SCAN_CACHE` (`:1049`) must **not** memoise a partial result produced on the failing pass.
- Message vocabulary matches the other two scripts verbatim in shape: `DNC-08 — <repo-relative path> is unreadable:
  <errno/message>`. No file is skipped; exit status is non-zero, never 0.

Shown able to fail by copying the script into a scratch tree and supplying an unreadable input — never by mutating
the real tree.

### 9.5 AC-6 — what actually exists today, so the edit lands in the right place

- `docs/adr/` stops at **`ADR-038`**; `ADR-039-hermetic-spec-writers.md` is free.
- **`open-decisions.md` has no `TOOL-15` entry** (measured: ids run `D-01`…`D-12`; the string `TOOL-15` does not
  appear in the file). AC-6's *"move it to resolved"* is therefore satisfied by **adding `D-13` already in the
  `resolved` state** — question, the three options, the decision, `ADR-039`, the 6/8 count, and the consequence —
  rather than by editing a row that is not there. Say so in the PR body; do not silently do nothing.
- The live records to flip are `docs/daily-improvement-v3/traceability/OPEN.md` **line 51** (`TOOL-15`) and **line 57**
  (`TOOL-18`), citing `ADR-039`. `TOOL-17`'s row (line 56) and its three residuals stay exactly as they are.

### 9.6 Ledger note

`docs/spec/features/v3-e02/PROGRESS.md`'s *"Next slice"* pointer is **stale** — it still routes to `V3-E06`
(`S-E06-6` and earlier) and predates the gate-hardening track. The operator slice above wins; the pointer is not an
instruction. Nothing else in `PROGRESS.md` contradicts this story.
