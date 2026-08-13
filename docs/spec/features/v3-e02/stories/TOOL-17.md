# TOOL-17 — a spec that writes a probe file into the REAL working tree must not make an unrelated suite fail to LOAD

> **Epic** `V3-E02` — Versioned database lifecycle and release integrity (gate-hardening track)
> **Layer** L0 · **Risk tier** P1 · **Mode** `epic-slice` · **blockedBy** (empty)
> **Closes** `TOOL-17` (P1, primary). Nothing else. No batching.
> **Does NOT close** `TOOL-15` (make the probe writers hermetic). That is an OPEN DESIGN DECISION parked in
> `open-decisions.md` and it **stays open** — see §7.
> **Touches** UI: **no** · backend: **yes, by file location only** (every edited file is under `apps/api/src`; **no
> runtime backend behaviour changes** — no controller, guard, DTO, service, module or Prisma query is opened) ·
> worker: **no** · gate scripts: **one NEW file only** — `scripts/lib/walk-read.js` is added beside the existing
> `scripts/lib/ratchet-core.js`; **no existing script under `scripts/` is modified**, and no check script, `ci-gate.sh`
> or baseline is opened. (This line originally read "`scripts/**` is not opened at all"; see the correction in §4.)
> **Gates triggered** `G-DNC` only. See §8, where every other gate carries its reason rather than a blank cell.

---

## 0. Read this first — the constraint that decides whether this slice is worth landing

The obvious fix for this defect is one line:

```ts
try { source = readFileSync(file, 'utf8'); } catch { continue; }   // ← DO NOT DO THIS
```

That line closes the flake and **weakens five merge gates at once**. Four of these five suites carry an explicit
comment saying they fail at LOAD *on purpose*, because a gate that cannot read its corpus must go red rather than
report "nothing to check, therefore pass" (`open-redirect-gate.spec.ts:145-147`,
`portal-landing-gate.spec.ts:90-96`, `audit-provenance-gate.spec.ts:114-116`,
`trust-proxy-dnc10-gate.spec.ts:46-47`). A blanket catch converts every one of those deliberate loud failures into a
green one. That is **DNC-08** — *an unclassifiable state must never be reported as a PASS* — and it is the routine's
STOP condition 4, *"closing the finding would require weakening a gate."*

`PF-146` ("the reachability guard turns *cannot tell* into a green skip") and `PF-105` ("a check whose green means
nothing") are the two existing instances of that mistake in this repository. **Do not create a third.**

So the whole engineering content of this slice is the *narrowness of the tolerance*: exactly one errno, only after
the disappearance has been **confirmed**, only for paths that came out of a `walk()`, and never silently.
`AC-2`, `AC-3` and `AC-4` are that narrowness written down. If you find you cannot satisfy them without a broader
catch, **stop and say so** — a slice that reports "this cannot be fixed without weakening a gate" is a correct
outcome here, not a failure.

---

## 1. The defect — measured, not inferred. Do not re-derive it.

Two consecutive runs of `node scripts/test-ratchet.js api` **on one unchanged tree** produced **two different
failure sets**. Every failure in both sets was a suite that failed to **LOAD** with `ENOENT` on a probe file that a
*different* spec had written into the shared checkout and then deleted.

### 1.1 The two writers — read them, do not modify them

| # | Writer | Probe it plants | Cleanup |
|---|---|---|---|
| W1 | `apps/api/src/shared/quality/audit-write-gate.spec.ts:689` | `apps/api/src/shared/quality/__audit_write_probe.ts` | `afterEach` → `rmSync` (`:691-695`) |
| W2 | `apps/api/src/shared/quality/csv-escape-gate.spec.ts:493` | `apps/web/src/lib/__csv_escape_probe.tsx` | `afterEach` → `rmSync` (`:495-499`) |

Both writers are **correct**: each proves its gate script can go red by making it go red on a real file, and each
guarantees the tree is clean afterwards. Their assertions, their probe filenames and their cleanup are **out of
scope** (§7).

### 1.2 The victims — walk-then-read over a tree another worker is mutating

Every victim does the same correct thing: `walk()` a root, then `readFileSync` every path the walk returned. Under
parallel jest the probe is *created after the walk* and *deleted before the read* (or vice-versa), the read throws,
and because the read happens at **module scope** jest reports `<suite failed to load>` — the whole suite, not one
test.

**The brief named five victim FILES. Measured this run by reading the code, those five files contain EIGHT walked-read
sites.** This is the same defect in the same five files, not a widening — but a fix that converts only the five sites
the brief listed leaves three live.

| # | Site | Population | Roots walked | Scope | Status |
|---|---|---|---|---|---|
| V1 | `audit-vocabulary-gate.spec.ts:189-194` | `SOURCES` | `apps/api/src`, `packages/imports-core/src` | module | **OBSERVED**, run 45 pass 2 |
| V2 | `audit-vocabulary-gate.spec.ts:782-786` | `declarers` (re-reads `WRITER_FILES` inside a test) | same | in-test | latent (fails ONE test, not the load) |
| V3 | `audit-vocabulary-gate.spec.ts:1039-1043` | `CONSUMER_SOURCES` | `apps/api/src`, `apps/web/src`, `apps/worker/src`, every `packages/*/src` | module | latent — **exposed to BOTH probes** (`.ts` and `.tsx`) |
| V4 | `portal-landing-gate.spec.ts:141-143` | `EXECUTABLE_SRC` | `apps/web/src` | module | **OBSERVED**, run 45 pass 2 |
| V5 | `portal-landing-gate.spec.ts:250-251` | `WEB_TEST_FILES` loop | `apps/web/tests` | in-test | latent |
| V6 | `open-redirect-gate.spec.ts:188-190` | `EXECUTABLE_SRC` | `apps/web/src` | module | **OBSERVED red**, run 45 pass 1 |
| V7 | `audit-provenance-gate.spec.ts:144-146` | `EXECUTABLE` | `apps/api/src` | module | latent, identical construction |
| V8 | `trust-proxy-dnc10-gate.spec.ts:73-75` | `EXECUTABLE` | `apps/api/src` | module | latent, identical construction |

The api-probe / web-probe split matches the walk roots exactly: W1 lands in `apps/api/src` (V1, V3, V7, V8), W2 lands
in `apps/web/src` (V3, V4, V6).

**The victims are innocent.** Walk-then-read is the right thing to do. The *race* is the defect, and the repair
belongs at the read.

### 1.3 The reads that must stay STRICT — this is where DNC-08 lives

A walked path may vanish; a **named constant path is a contract**. If `seed-demo.ts` or the route baseline is gone,
that is a broken repository and the suite must still explode. The tolerance therefore applies **only to paths
produced by `walk()`**, never to a fixed path. Concretely, all of these keep reading with a bare `readFileSync`:

* `audit-vocabulary-gate.spec.ts:180` `SEED_PATH` — note it is **appended into `WRITER_FILES` at `:182-187`**, so
  splitting the walked part from the named part is a required piece of work, not an optional tidy-up;
* `portal-landing-gate.spec.ts:147` the web route baseline JSON; `rootPagePath()` / `publicPagePath()` reads;
* `open-redirect-gate.spec.ts` `SAFE_CALLBACK_PATH`, `PORTALS_MODULE_PATH`, `LOGIN_FORM_PATH`, `MIDDLEWARE_PATH`,
  `AUTH_PATH`;
* `audit-provenance-gate.spec.ts` `CALENDAR_SEED_PATH` and the `__fixtures__/pre-fix/*.ts.txt` evidence copies;
* **every unguarded `require(...)`** at the top of all five specs. A **missing module** is a different seam from a
  **vanishing walked file** and it must keep failing at load. Do not touch those lines (§7).

---

## 2. Acceptance criteria

Verbatim from the finding. Every one must be **evidenced**, not asserted.

**AC-1.** A file that is listed by `walk()` and then DISAPPEARS before its `readFileSync` must NOT crash the suite
that walked it. All five victims above are fixed. *(Read as: all eight sites in §1.2 — the five files are fixed only
when every walked-read site in them is.)*

**AC-2.** ONLY `ENOENT` is tolerated. Every other errno (`EACCES`, `EISDIR`, `EPERM`, `EBUSY`, …) must still THROW,
unchanged and unwrapped — same error object, same `code`, same `message`, no re-wrapping in a new `Error`.

**AC-3.** The disappearance must be CONFIRMED, not assumed: on catching `ENOENT`, re-check that the path is genuinely
absent **now**; if it is present again, RETHROW. A read that fails `ENOENT` while the file exists is not this race and
must never be swallowed.

**AC-4.** A skip must be VISIBLE, never silent. Count skips and expose the count; a suite whose corpus silently shrank
must remain detectable. Keep every existing floor / "this suite is reading a real application" assertion intact — if
one does not exist in a victim, do NOT invent a large new one, just do not remove what is there.

**AC-5.** Prove it with a test that FAILS BEFORE the change and PASSES AFTER. The honest fixture is a walk-then-read
over a **scratch directory** where a file is deleted between the two phases — do NOT try to reproduce the real
parallel-jest race, and do NOT write a probe file into the real tree to test this (that would reproduce the very
defect).

**AC-6.** Assert the negative direction too: a file that vanishes is skipped, AND a read that fails with a non-`ENOENT`
errno still propagates. AC-2 without a test is an assertion, not evidence.

**AC-7** *(added by this spec — the PF-80 blast-radius rule).* State, in the PR body and in the new spec's header
comment, **which walkers now see the new helper file and what they do with it**, and assert it. See §4.

---

## 3. The shape of the fix

### 3.1 One helper, not five copies

Five hand-rolled walkers is how these drifted apart in the first place, and a single seam is what makes AC-2 and AC-3
checkable **once** instead of eight times. Add one module and route all eight sites through it.

**Location — CORRECTED after implementation; see §4 for the measurement that overturned the original choice:**

```
scripts/lib/walk-read.js          ← what landed (CJS, beside scripts/lib/ratchet-core.js)
```

> The location this spec originally decided was
> `apps/api/src/shared/quality/__fixtures__/walked-source-map.ts`. It was wrong, for the reason recorded at the end of
> §4. The API below is stated in TypeScript for readability; the module that landed is CommonJS, consumed through the
> same computed `require(join(REPO_ROOT, …))` the five victims already use for `link-integrity-check.js`.

**Proposed API** (adjust the names if the code says otherwise; the *semantics* below are the acceptance surface):

```ts
export interface WalkedReadIo {
  /** Injection seam used ONLY by the tolerance spec, to produce errnos that are not portably producible. */
  readFile?: (path: string) => string;
  exists?: (path: string) => boolean;
}

export interface WalkedReadResult<V> {
  map: Map<string, V>;
  /** Absolute paths that were walked, then confirmed absent at read time. */
  skipped: string[];
}

/** Reads one WALKED path. Returns `undefined` iff the file is confirmed to have vanished. */
export function readWalkedFile(path: string, io?: WalkedReadIo): string | undefined;

/** Reads every WALKED path and builds a `[key, value]` map, skipping only confirmed disappearances. */
export function mapWalkedFiles<V>(
  walked: readonly string[],
  build: (absolutePath: string, source: string) => [key: string, value: V],
  io?: WalkedReadIo,
): WalkedReadResult<V>;

/** One-line, human-readable notice. Never throws, never called when `skipped` is empty. */
export function warnSkipped(label: string, skipped: readonly string[]): void;
```

The whole tolerance lives in **one** private function, and it is exactly this:

1. `try { return readFile(path); }`
2. `catch (err)` → if `(err as NodeJS.ErrnoException).code !== 'ENOENT'` → **`throw err`** (the original object, not a
   copy — AC-2);
3. else if `exists(path)` → **`throw err`** (ENOENT on a file that is there is not this race — AC-3);
4. else → record the path in `skipped` and return `undefined` (AC-1).

Nothing else is caught. No `catch {}` without a rethrow branch appears anywhere in the diff.

> **Known, accepted residual — state it in the header comment rather than hiding it.** Between step 2 and step 3 the
> file could be re-created by the other worker, and then step 3 rethrows and the suite goes red. That is the
> **fail-closed** direction and it is deliberate: we only ever swallow a disappearance we have *seen*. A retry-on-
> re-appearance would read the probe's bytes into the corpus, which is worse than a red run.

### 3.2 What each site becomes

* **Module-level map sites (V1, V3, V4, V6, V7, V8)** — replace `new Map(files.map(f => [k(f), v(readFileSync(f))]))`
  with `mapWalkedFiles(files, (f, source) => [k(f), v(source)])`, keep the resulting `map` in the existing constant,
  and keep the `skipped` array in a new module-level constant.
* **In-test loop sites (V2, V5)** — `const source = readWalkedFile(file); if (source === undefined) { skipped.push(file); continue; }`.
* **V1 specifically** — split `WRITER_FILES` (`:182-187`) into the walked part and `SEED_PATH`. The walked part goes
  through `mapWalkedFiles`; `SEED_PATH` is read strictly and merged in afterwards. `WRITER_FILES` must keep meaning a
  real, non-empty population so that `:630` (`>= 120`), `:782` and `:1152` keep meaning what they mean today.

### 3.3 AC-4, concretely — and why a `console.warn` alone is not enough

`trust-proxy-dnc10-gate.spec.ts:312` already records this repository's opinion of warn-only signalling: *"rather than
a `console.warn` nobody reads."* So visibility here is **three** mechanisms, and the asserted ones carry the weight:

1. **The accounting identity (asserted).** Four victims already assert the identity in its strict form and **it would
   go red on every skip**, turning a load failure into an assertion failure — still a flake. Each must become the
   accounting form, so that nothing is ever *silently* lost:

   | File:line | today | must become |
   |---|---|---|
   | `portal-landing-gate.spec.ts:171` | `expect(EXECUTABLE_SRC.size).toBe(WEB_SRC_FILES.length)` | `expect(EXECUTABLE_SRC.size + SKIPPED_WEB_SRC.length).toBe(WEB_SRC_FILES.length)` |
   | `open-redirect-gate.spec.ts:371` | `expect(EXECUTABLE_SRC.size).toBe(WEB_SRC_FILES.length)` | same transformation |
   | `audit-provenance-gate.spec.ts:261` | `expect(EXECUTABLE.size).toBe(API_FILES.length)` | same transformation |

   `trust-proxy-dnc10-gate.spec.ts` has **no** identity today (only the floors at `:125-126`). Adding the identity
   there in the same one-line form is **recommended and permitted** — it is the same non-vacuity family, not the
   "large new floor" AC-4 forbids. `audit-vocabulary-gate.spec.ts` likewise has none; add the identity for `SOURCES`
   and `CONSUMER_SOURCES` in the same one-line form, and nothing bigger.
2. **The existing floors (unchanged) are the detector for a corpus that really shrank.** `API_FILES.length >= 200`
   (`audit-provenance:259`, `trust-proxy:125`), `PRODUCTION.length >= 150` (`:260`, `:126`),
   `WEB_SRC_FILES.length >= 300` (`portal-landing:169`, `open-redirect:370`), `WRITER_FILES.length >= 120`
   (`audit-vocabulary:630`) and every other `toBeGreaterThan*` in these five files: **do not touch a single one.** One
   skipped probe leaves them satisfied; a tree that lost half its files does not. That is exactly the discrimination
   AC-4 asks for.
3. **The notice (unasserted, human-facing).** When `skipped.length > 0`, call `warnSkipped('<suite name>', skipped)`
   once, naming every skipped path. Precedent for `console.warn` in this directory:
   `link-integrity-gate.spec.ts:1871`, `schema-drift-gate.spec.ts:1387`.

### 3.4 Do not let the sixth copy drift back in

The new spec (§5) must assert, by reading the five victim sources with plain `readFileSync` (they are fixed named
paths), that **each of the five imports the helper**. Five paths, named individually — an "all files import it"
assertion is also satisfied by a list that has silently become empty.

---

## 4. AC-7 — blast radius of the new file, measured before choosing the location (PF-80)

Three of the victims walk `apps/api/src` and read **every** `.ts` under it. A new non-spec `.ts` in the wrong place
becomes an input to the very gates being edited. Measured this run:

| Walker | Sees `…/quality/__fixtures__/walked-source-map.ts`? | What it does with it |
|---|---|---|
| `audit-vocabulary-gate.spec.ts` (`WRITER_FILES`, `:182-187`) | **No** — `.filter(f => !repoRel(f).includes('__fixtures__'))` | nothing. `:1152` (`no __fixtures__ in WRITER_FILES`) stays green **because** of this location |
| `audit-vocabulary-gate.spec.ts` (`CONSUMER_SOURCES`, `:1039-1043`) | **Yes** — no fixture filter on this walk | comment-stripped into a string map; scanned only for audit-label associations, of which the helper has none |
| `audit-provenance-gate.spec.ts` (`EXECUTABLE`/`PRODUCTION`, `:142-147`) | **Yes**, and it lands in `PRODUCTION` (filter is `.spec.ts` only) | subject to `HARDCODED_ACTOR_ROLE`, `declaresRolePrecedenceOrdering`, `'trust proxy'` setters, `req.ip` — the helper matches **none**. Floors are `>=`, so one more file can only help. `:431-438` is scoped to `__fixtures__/pre-fix` and is **unaffected** |
| `trust-proxy-dnc10-gate.spec.ts` (`EXECUTABLE`/`PRODUCTION`, `:72-83`) | **Yes**, lands in `PRODUCTION` | subject to `declaresBlanketProxyTrust`, `declaresHopCountLiteral`, `declaresCoercedHopCount`, `.set('trust proxy')` — matches **none** |
| `scripts/audit-write-check.js`, `scripts/csv-escape-check.js`, `scripts/production-artefact-check.js` | **No** — all three list `__fixtures__` in their skipped directories (`:180`, `:221`, `:104`) | nothing |
| `production-artefact-gate.spec.ts` | **No** — it reads explicit named paths, it does not walk | nothing |

That is why the location is `__fixtures__/`: it is the **only** directory name in this repository that is skipped by
`audit-vocabulary`'s writer walk *and* by all three check scripts. The two walks that still see it are measured above
and are inert.

**Two consequences to state honestly rather than discover in review:**

* `apps/api/tsconfig.build.json` excludes only `**/*.spec.ts` / `**/*.test.ts`, so this helper **will be compiled into
  `apps/api/dist/`**. It is a pure, side-effect-free module with no NestJS import; it is never imported by production
  code. The new spec must assert that: **no non-spec file under `apps/api/src` imports `walked-source-map`** (this is
  what keeps the previous sentence true a year from now).
* The existing `__fixtures__/pre-fix/*` files are deliberately `.ts.txt` so they are neither walked nor compiled
  (`audit-provenance-gate.spec.ts:431-438` explains it). That posture is about **pre-fix evidence copies**, which must
  not compile because they *contain* the defect. It does not apply to a real helper, and this file is not under
  `pre-fix/`. Say so in the header comment so the next reader does not think the rule was missed.

### 4.1 CORRECTION — the location this spec mandated was wrong, and so was its reason

This spec originally said: *"Do not put the helper outside `apps/api/src`. `apps/api/tsconfig.json` sets
`rootDir: ./src` and `include: ["src/**/*"]`; a helper under `apps/api/test/` **imported** from a spec inside `src/`
makes `tsc --noEmit` fail with 'file is not under rootDir'. That was checked, not guessed."*

**The premise does not hold for the construction this slice actually uses, and the table above is what makes the
original choice unattractive anyway.**

1. **The rootDir hazard never fires.** It applies to a TypeScript `import`. Every consumer here reaches the module
   through a **computed** `require(join(REPO_ROOT, 'scripts', 'lib', 'walk-read.js'))` — a non-literal specifier that
   TypeScript never resolves, so the file never enters the program and there is no rootDir edge to violate. The five
   victims already do exactly this for `scripts/link-integrity-check.js`
   (`audit-provenance-gate.spec.ts:82`, `audit-vocabulary-gate.spec.ts:111`, `portal-landing-gate.spec.ts:63`,
   `open-redirect-gate.spec.ts:134`, `trust-proxy-dnc10-gate.spec.ts:42`) and typecheck is green today.
2. **The original location contradicts §4's own table.** `__fixtures__/walked-source-map.ts` is still walked and read
   by `audit-provenance-gate` and `trust-proxy-dnc10-gate` (rows 3 and 4 above: they filter `.spec.ts`, not
   `__fixtures__`), and — as §4 itself concedes — `tsconfig.build.json` excludes only `*.spec.ts`/`*.test.ts`, so it
   would have been **compiled into `apps/api/dist/`**: test infrastructure inside the shipped API artefact.
3. **`scripts/lib/` is the documented convention for this exact artefact class.** `scripts/lib/ratchet-core.js`
   (PR #231) is a pure CJS helper required by absolute path from a spec under `apps/api/src/shared/quality/`
   (`test-ratchet.spec.ts:307`). Same shape, same require pattern, same invisibility: **no walk root in this
   repository is `scripts/`** — every reference to `scripts/` in the specs is a named-constant read
   (`audit-write-check.js:145`, `csv-escape-check.js:135-142`, `production-artefact-check.js:100`,
   `link-integrity-check.js:186-198` are the complete set of walk roots, and all are `apps/<app>/src`,
   `apps/web/tests` or `packages/<pkg>/src`).

**What this means for GUARDRAILS §2.** Landing at `apps/api/test/` — a brand-new top-level directory with no
precedent — would have been a *new architectural decision* requiring an ADR. `scripts/lib/` is an **existing**
convention, so the slice reuses it and no ADR is owed. `walk-read-gate.spec.ts` asserts both halves: the helper's
exact repo-relative path, and that `test-ratchet.spec.ts` still names `scripts/lib/ratchet-core.js` — if the
precedent moves, the claim "this is the documented convention" goes red rather than quietly rotting.

---

## 5. AC-5 / AC-6 — the proof, and how it fails BEFORE

New spec: `apps/api/src/shared/quality/walk-read-gate.spec.ts` (named for the module it proves — §4.1).

**It never writes into the real tree.** Every fixture lives in `mkdtempSync(join(tmpdir(), 'tool17-'))` and is removed
in `afterAll` with `rmSync(dir, { recursive: true, force: true })`. Writing a probe into the checkout to test this
would reproduce the very defect (`AC-5`).

Required cases:

1. **Fails-before, driven inside the run.** Re-implement the *pre-slice* construction as a fixture in the spec —
   `const naive = (files: string[]) => new Map(files.map((f) => [f, readFileSync(f, 'utf8')]));` — and drive it over
   the same scratch fixture: walk the directory, delete one file, then build. Assert it **throws**, and assert
   `code === 'ENOENT'`. This is the house idiom (`open-redirect-gate.spec.ts` re-implements the pre-slice expression;
   `audit-provenance-gate.spec.ts:442+` drives the recorded pre-fix bytes through the same matchers). It proves
   fails-before *without* a git checkout, and it cannot rot.
2. **Passes-after, same fixture.** `mapWalkedFiles` over the identical walked list returns a map missing exactly the
   deleted entry, `skipped` contains exactly that one path, and `map.size + skipped.length === walked.length`.
3. **AC-6 positive/negative pair, on the real filesystem.** A directory in the scratch tree is fed to the helper:
   `readFileSync` on a directory throws `EISDIR` — **measured on this machine, win32, Node v25.7.0:
   `EISDIR: illegal operation on a directory, read`** — and the helper must let it out **unchanged** (`toThrow`, and
   assert the thrown object's `code` is `EISDIR` and that it is the *same* error instance the reader threw).
4. **AC-6, the errnos that are not portably producible.** Using the `io.readFile` injection, throw a synthetic
   `ErrnoException` with `code` of `EACCES`, `EPERM`, `EBUSY` and `undefined` in turn; assert each propagates
   unwrapped. `chmod` is a no-op on Windows, which is why the injection seam exists — say so in the comment.
5. **AC-3, both directions.** With `io.readFile` throwing `ENOENT` and `io.exists` returning `true` → **rethrows**
   (the file is there; this is not the race). With `io.exists` returning `false` → skipped. This is the single most
   important case in the file: it is what stops the fix from becoming `PF-146`.
6. **AC-3 on the real filesystem too** — a genuinely deleted file is skipped; a file that exists but is fed through a
   reader that lies with `ENOENT` is rethrown.
7. **`readWalkedFile` gets the same 3-case treatment** (vanished → `undefined`; `EISDIR` → throws; ENOENT-but-present
   → throws), so V2/V5 are covered by evidence and not by "it uses the same core".
8. **The five victims import the helper** (§3.4), named individually.
9. **No non-spec file under `apps/api/src` imports the helper** (§4).

---

## 6. Definition of done

- [ ] `scripts/lib/walk-read.js` exists (location corrected — §4.1), contains the only `catch` in the diff,
      and that `catch` rethrows on both non-`ENOENT` and confirmed-present.
- [ ] All **eight** sites in §1.2 route through it; every named-constant read in §1.3 still uses a bare `readFileSync`;
      every unguarded `require()` is untouched.
- [ ] The three strict identities in §3.3 became accounting identities; the two/three missing ones were added in the
      same one-line form; **no floor was changed, lowered or deleted** — evidence: `git diff` shows zero changed lines
      containing `toBeGreaterThan`.
- [ ] `warnSkipped` is called once per site with a non-empty `skipped`.
- [ ] `walk-read-gate.spec.ts` exists with all nine case groups, uses only `tmpdir()`, and cleans up.
- [ ] The PR body states the AC-7 blast radius table (§4) and the `dist/` consequence.
- [ ] `docs/spec/features/v3-e02/PROGRESS.md` gains a `TOOL-17` row; `OPEN.md` keeps `TOOL-15` **open**.
- [ ] Residual recorded, not fixed: **`readdirSync` inside `walk()` can also throw `ENOENT`** if a *directory* vanishes
      mid-walk. Neither probe writes a directory, so it is not this defect's trigger; it is the same family and it
      belongs to a later finding. Write it down; do not widen into it.

---

## 7. FORBIDDEN / out of scope — the slice stays tight

* **Do NOT make the probe writers hermetic** (scratch-tree copies, a `root` parameter on the check scripts). That is
  `TOOL-15`'s repair, it is an **open design decision** in `open-decisions.md`, and `scripts/csv-escape-check.js`
  deliberately exposes no root parameter (*"a flag that lets a caller choose what is compared is a bypass flag wearing
  a different hat"*). `TOOL-15` **stays OPEN**.
* **Do NOT change** the two writer specs' assertions, their probe filenames, or their `afterEach` cleanup.
* **Do NOT remove or guard** the deliberate unguarded `require()` calls at the top of these specs. A missing module is
  a different seam from a vanishing walked file.
* **Do NOT touch** `scripts/ci-gate.sh`, `scripts/test-ratchet.js` or `scripts/lib/ratchet-core.js`. `TOOL-13`/`16(a)`/
  `11`/`12` landed in PR #231 (`982fe8e`) and are **closed**.
* **No dependency added or bumped.** NestJS is pinned at v10 deliberately; a bump is how that breaks by accident.
* **No `pnpm build`, no `next build`, no docker.** This slice needs none of them, and the routine owns the build slot.
* Only the **test-architect** runs `pnpm typecheck`. Note for that agent: this diff adds a new `.ts` under
  `apps/api/src` and adds generic type parameters — the two typecheck-relevant risks are (a) `rootDir` violations if
  the helper is misplaced (§4) and (b) the `[key, value]` tuple return of `build` needing `as const` or an explicit
  tuple annotation.

---

## 8. Gates — every row answered, none left blank

| Gate | Triggered | Reason |
|---|---|---|
| **G-DNC** | **YES — the only one** | DNC-08 is the whole design constraint (§0). The tolerance is one errno, confirmed, counted and never silent; the deliberate load-time failures are preserved; `AC-6` proves the negative direction. No `SKIP_*`/`ALLOW_*`/`FORCE` env read is introduced anywhere (DNC-10). |
| G-TENANT | NO | The diff contains no Prisma query, no `where` clause, no `tenantId`. Nothing reaches the database. |
| G-AUTHZ | NO | No controller, guard, decorator, DTO or `StudentAccessService` path is opened. |
| G-MIGRATION | NO | `schema.prisma` untouched; no migration, no SQL. |
| G-AUDIT | NO | No privileged mutation, no `AuditLog` write, no endpoint. `audit-*-gate.spec.ts` are *gates about* audit, not audit code — editing their file reads changes no audit behaviour. |
| G-TRUTH | NO | No KPI, no count, no read projection, no dashboard figure. |
| G-PORTAL | NO | No route, no page, no navigation, no portal-visible data. Nothing in this diff is reachable by any user of any portal. |

A gate marked "not triggered" with a blank cell is a blocker wearing a blank cell, which is why each NO carries its
reason — and why none of them claims a check that was not run.

---

## 9. Ledger disagreement, recorded

`docs/spec/features/v3-e02/PROGRESS.md` does not mention `TOOL-17`; its narrative stops at `TOOL-13` (run 45) and its
"gate-hardening track" paragraph is therefore **stale**, not wrong. There is no `spec.md` / `tasks.md` in
`docs/spec/features/v3-e02/` — the file explains why (the V3 stories are authored pre-sliced). Nothing in the ledger
contradicts this slice; it simply predates it. The operator override in the brief governs, and `PROGRESS.md` gains a
`TOOL-17` row as part of the Definition of Done.
