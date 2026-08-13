# TOOL-25 — the drift gate's spec resolves its address at runtime, and the spec and the scripts are ASSERTED to agree

| | |
|---|---|
| **Epic** | V3-E02 · Versioned database lifecycle and release integrity · **Track** gate-hardening |
| **Gates** | **G-MIGRATION** (the diff *is* the migration/drift gate's own spec) · **G-DNC** (DNC-08, DNC-10) |
| **Not triggered, and no evidence is claimed for them** | G-TENANT, G-AUTHZ, G-AUDIT, G-TRUTH, G-PORTAL — the diff touches ONE quality spec and ONE document. No Prisma query, no controller, no guard, no DTO, no read projection, no portal-visible data |
| **blockedBy** | — · **requiresDecision** — *(no new ADR: this is the `ADR-027` seam already amended by TOOL-23/24, applied to the spec TOOL-22 left behind)* |
| **Size** | S–M · **Risk** P1 · **Layer** L0 — trust and production foundation |
| **touchesUi** | false · **touchesBackend** **true** — the edit lives under `apps/api/src`, so it belongs to the backend dev's file set; it is nevertheless **test-only**, and **no runtime backend code changes** · **touchesWorker** false |

---

## 1. Why — the drift gate's own spec reports GREEN by not executing

*(Heading corrected at implementation. It read *"two individually-correct gates jointly produce a FALSE GREEN"*; there
was only ever **one** gate involved, and the second was a comment. See the correction box below.)*

`apps/api/src/shared/quality/schema-drift-gate.spec.ts:96` pins the local stack's address as a literal:

```ts
const LOCAL_URL = 'postgresql://pilotage:pilotage@127.0.0.1:5433/pilotage?schema=public';
```

and `:1556-1558` decides, from that literal, whether the entire end-to-end block runs:

```ts
const PROBE_URL = process.env.DATABASE_URL || LOCAL_URL;
const reachable = gate.probeServer(PROBE_URL);
const describeWithDb = reachable ? describe : describe.skip;
```

The comment at `:91-95` claims the literal is wrong **on purpose** — that `scripts/production-artefact-check.js`
rule **A6** (`production-artefact-check.js:187-190`) matches

```js
/(?:localhost|127\.0\.0\.1):(?:8025|9000|9001|5432|6379)\b/gi
```

on string literals inside `apps/api/src`, so writing the address the project actually uses would turn **stage 0b** red.

> ### ⚠️ CORRECTED AT IMPLEMENTATION — that claim is **false**, and it was measured false on 2026-08-13
>
> A6 has **never been able to read this file**. `production-artefact-check.js:105` defines
> `EXCLUDED_FILE = /\.(spec|test)\.(ts|tsx|js|jsx|mjs|cjs)$/` and `:319` applies it inside `walk()`, so every
> `*.spec.ts` is skipped **before any rule runs**. Conclusive, not inferential: the scanner's own banner reports **597**
> files across the three scan roots; walking those roots with the same extensions and excluded directories but
> **without** the spec exclusion yields **701**. 597 *is* the spec-excluded count. (Two A6-matching literals ship
> today — `apps/api/src/shared/queue/queue.module.ts:20` and `production-artefact-gate.spec.ts:208` — and pass via
> Tier B and the spec exclusion respectively, not by absence.)
>
> **So the divergence was silent, not forced.** No gate pushed this file onto a dead port; a second copy of an address
> simply drifted, and a comment asserting a non-existent constraint is what carried it through `TOOL-22`, `TOOL-23`
> **and** `TOOL-24` — three agents read it and believed it. The corrected premise is written into both edited source
> files (`schema-drift-gate.spec.ts:104-140`, `default-database-url-gate.spec.ts:101-118`); it is corrected **here** too,
> because a story doc that contradicts the code it produced re-arms the failure for the next slice, which reads
> `docs/spec/features/<epic>/`.

Either way the observable defect is identical and is the reason for the slice: **the drift gate's spec reports green by
not executing.** That is a live **DNC-08** instance committed at the address of the DNC-08 enforcer.

### Measured by the routine this run, on this host — facts, not assumptions

* `127.0.0.1` port **5432** accepts TCP in **10 ms** (native Windows service `postgresql-x64-15`). Port 5433 has had
  nothing listening on it for weeks.
* `require('./scripts/lib/default-database-url.js').defaultDatabaseUrl()` resolves to `127.0.0.1` port **5432**
  (it reads `apps/api/.env`, then the root `.env`, then falls back to the historical literal).
* **BASELINE** — `npx jest src/shared/quality/schema-drift-gate.spec.ts` from `apps/api`:

  ```
  Test Suites: 1 passed, 1 total
  Tests:       5 skipped, 119 passed, 124 total
  ```

  exit 0. The five that skipped, **by name**:

  1. `the unmodified repository PASSES — the gate is not red on correct code (AC-2)`
  2. `leaves no scratch database behind (AC-11)`
  3. `the ledger really builds the schema the datamodel describes (AC-2)`
  4. `a datamodel the ledger does not build FAILS, naming the drifted object (AC-1)`
  5. `a migration that does not execute on PostgreSQL FAILS (AC-3)`

* Meanwhile `scripts/schema-drift-check.js`, three directories away, executed the identical journey against 5432 and
  returned **PASS**.
* `scripts/schema-drift-check.js:204` and `scripts/restore-drill.js:145` **already** do
  `require('./lib/default-database-url')`. **Only the SPEC was left behind by TOOL-22.**

This is precisely the class TOOL-13's skipped-count ratchet was built to catch — and that ratchet ships **disarmed**,
so five vanished cases read as green.

---

## 2. Decision

**D1 — resolve at runtime, do not encode.** Delete `LOCAL_URL`. Introduce a single runtime-resolved base:

```ts
const DEFAULT_DB_URL_PATH = join(REPO_ROOT, 'scripts', 'lib', 'default-database-url.js');
/* eslint-disable @typescript-eslint/no-require-imports */
const { defaultDatabaseUrl } = require(DEFAULT_DB_URL_PATH) as { defaultDatabaseUrl: () => string };
/* eslint-enable @typescript-eslint/no-require-imports */
const BASE_URL = defaultDatabaseUrl();
```

`REPO_ROOT` already exists at `:82`. The **standing precedent** for a spec requiring a `scripts/lib` module by computed
path is `scripts/lib/ratchet-core.js`, landed in #231 — see `apps/api/src/shared/quality/test-ratchet.spec.ts:307`
(`const CORE_PATH = join(REPO_ROOT, 'scripts', 'lib', 'ratchet-core.js')`) and `:356`
(`const core: RatchetCoreModule = require(CORE_PATH);`), with the same unguarded-on-purpose comment this file already
uses at `:160-166` for `require(SCRIPT_PATH)`. **Follow that precedent exactly** — no new convention, no `try/catch`
around the require: if the resolver disappears, this suite must go red at LOAD.

**D2 — A6 is untouched, and it was never the constraint.** ⚠️ **Corrected at implementation.** The sentence that stood
here — *"with the literal gone, no string literal under `apps/api/src` matches A6"* — is **false in both directions**:
A6 cannot read `*.spec.ts` at all (see the correction box in §1), and two A6-matching literals ship under `apps/api/src`
today regardless. What survives unchanged is the **prohibition**: **no exclusion is added, A6 is not weakened,
`production-artefact-check.js` is not edited** (R-30). The literal is deleted because **a second copy of an address is
the defect**, not because a gate forbade it — and the ratchet that will actually stop a fourth copy is the consumer
enumeration of AC-4, because the scanner structurally cannot be that ratchet.

**D3 — the probe's shape is unchanged.** `PROBE_URL` stays `process.env.DATABASE_URL || BASE_URL`, the identical shape
the two scripts use, so an explicitly exported `DATABASE_URL` still wins exactly as before.

**D4 — DNC-10: `DATABASE_URL` is an ADDRESS, never a BYPASS.** Add **no** flag, **no** options parameter, **no** root
override to this spec or to `default-database-url.js` that would let a caller choose *what is compared*. The structural
argument is unchanged and still holds: the scratch database is created **empty** and migrated from the migrations on
disk, so a different address cannot buy a pass — it can only make the run unreachable, which is a failure with its own
verdict.

**D5 — the reachability guard is CORRECT and stays.** Only its *address* was wrong. `describeWithDb` must still become
`describe.skip`, with its warning, on a host where nothing answers. Making the block unconditional would trade a false
green for a false red and destroy the guard.

---

## 3. Acceptance criteria (verbatim — every one must be evidenced)

**AC-1.** `schema-drift-gate.spec.ts` contains **NO** hard-coded local-stack DSN literal. The base address is resolved
at **runtime** from `scripts/lib/default-database-url.js` via `defaultDatabaseUrl()`, loaded with a computed require
rooted at the existing `REPO_ROOT` (`:82`). The standing precedent for a spec requiring a `scripts/lib` module by
computed path is `scripts/lib/ratchet-core.js` (landed #231) — follow it.

**AC-2.** ⚠️ **Reframed at implementation, and the reframing is the point.** Rule **A6** is **untouched**: **DO NOT** add
an A6 exclusion, **DO NOT** weaken A6, **DO NOT** edit `production-artefact-check.js`. *Evidence* = run
`node scripts/production-artefact-check.js` and report its printed verdict line — **read that evidence for what it is:
a NON-REGRESSION check on the shipped-source scan.** It proves this diff did not disturb the scanner. It provides
**zero** protection against a future author re-planting an address in this file, because the scanner **cannot read this
file at all**. The enforcement ratchet is AC-4, not A6.

**AC-3.** The two port assertions at `:533` and `:563` (`expect(url.port).toBe('5433')`) are **REPLACED**, never merely
deleted. TOOL-21's lesson applies: assert the property those lines actually defended — that `buildScratchUrl()` and
`deriveMaintenanceUrl()` change **ONLY** the database segment and **PRESERVE** the base URL's host **and** port —
asserted against the resolved base, not against any literal.

**AC-4.** A **NEW** case asserts the spec and the two scripts agree about the address **by source**, so they cannot
silently diverge a third time: both `scripts/schema-drift-check.js` and `scripts/restore-drill.js` require
`./lib/default-database-url`, and the spec's own resolved base equals `defaultDatabaseUrl()`. (TOOL-22 fixed the
scripts and left the spec; this AC is what makes a fourth instance impossible.)

**AC-5. THE CLOSING MEASUREMENT.** Re-run `npx jest src/shared/quality/schema-drift-gate.spec.ts` from `apps/api` and
paste the tail. The five named cases in §1 must **RUN** instead of printing `○ skipped`. Compare explicitly against the
baseline `5 skipped, 119 passed, 124 total`. If any of the five now **FAILS**, that is a **REAL finding** about the
drift gate on a live database — report it with its output; do **NOT** re-skip it and do **NOT** weaken it to green.

**AC-6. THE CONTROL — do not skip this, it is half the value.** The reachability guard is correct; only its address was
wrong. `describeWithDb` must **STILL** become `describe.skip`, with its warning, on a host where nothing answers. Prove
the negative direction **without a database** using the existing `DEAD_URL` at `:99`
(`127.0.0.1:59999` — A6 does not match it, **keep it**) and the existing AC-8 case at `:1101`
(`expect(gate.probeServer(DEAD_URL)).toBe(false)`); report that it is still green. **DO NOT** make the block run
unconditionally.

**AC-7.** `apps/api/src/shared/quality/restore-drill-gate.spec.ts:659/663` **KEEPS** its 5433 literal and is **OUT OF
SCOPE**. Verified by the routine this run: that file has no `describeWithDb` / `probeServer` — **the literal is a pure
redaction fixture**, i.e. an input whose meaning *is* its value, exactly like `REDACTION_SAMPLE_URL` in the edited file.
⚠️ **Corrected at implementation:** the original justification added *"and `127.0.0.1:5433` does not match A6"*, which
is true but irrelevant — A6 cannot read that file either. The reason it is out of scope is that it carries a fixture,
not an address. This note is the deliverable for AC-7; the file is not touched.

---

## 4. Implementation notes — every call site, and what replaces it

`LOCAL_URL` has **nine** call sites. All become `BASE_URL`; three of them need more than a rename.

| Line | Case | What to do |
|---|---|---|
| `96` | the declaration | delete it; replace the `:91-95` comment with one that explains the runtime resolution and the A6 reason. **Write no `127.0.0.1:<port>` literal in the new prose either** — A6 blanks comments (`where: 'code'`), but keep the prose unambiguous without the colon-form (e.g. "127.0.0.1, port 5432") so a future `where: 'raw'` rule cannot be tripped by documentation |
| `530-536` | `buildScratchUrl replaces ONLY the database segment` | **AC-3.** Replace `expect(url.port).toBe('5433')` with an assertion against the resolved base: `const base = new URL(BASE_URL); expect([url.hostname, url.port]).toEqual([base.hostname, base.port]);` and likewise for `username`/`password`/`search`, so the case still pins "only the path segment changed" |
| `540-542` | scratch-target refusals | rename only |
| `551-554` | `the migration tools are never handed the resolved base URL (FR-7)` | rename only |
| `561-563` | `the maintenance URL is DERIVED, never supplied` | **AC-3.** Keep `expect(url.pathname).toBe('/postgres')`; replace `expect(url.port).toBe('5433')` with the host **and** port preserved from `new URL(BASE_URL)` |
| `582-583` | redaction (G-TENANT) | the assertion currently relies on the literal's credentials. Derive them from `new URL(BASE_URL)`: assert the redaction does **not** contain the base's `username` + `':'` + `password`, and **does** contain `'***'`. Keep the independent sample `postgres://u:s3cr3t@h:5433/db` at `:584` — a synthetic fixture, not a local-stack address |
| `1144` | TOOL-11 cross-server refusal (`routes.exec(LOCAL_URL, …)` against `DEAD_URL`'s routes) | rename **and add a non-vacuity guard**: the case only means something while the resolved base is a *different* server from `DEAD_URL`. Assert that premise explicitly — `expect(new URL(BASE_URL).host).not.toBe(new URL(DEAD_URL).host)` — before the refusal expectation, so the case cannot silently become vacuous on a host whose `.env` points at 59999 |
| `1292-1294` | `the guard rests on host/port invariance, and that invariance is pinned` | rename only — it already asserts against `new URL(base)`, which is the AC-3 shape |
| `1598`, `1605` | `process.env.DATABASE_URL || LOCAL_URL` | `process.env.DATABASE_URL || BASE_URL` (D3) |

**The new AC-4 case** — place it with the deterministic wiring cases, **above** `describeWithDb` (the placement rule
already written at `:1218-1222`: evidence below that line can only run where the bug cannot):

```ts
it('the spec and both scripts resolve the SAME address, from the SAME module (TOOL-25)', () => {
  expect(EXECUTABLE_SCRIPT).toContain("require('./lib/default-database-url')");
  const drillSource = readFileSync(join(REPO_ROOT, 'scripts', 'restore-drill.js'), 'utf8');
  expect(drillSource).toContain("require('./lib/default-database-url')");
  expect(BASE_URL).toBe(defaultDatabaseUrl());
  // …and this spec no longer carries an address of its own.
  expect(readFileSync(__filename, 'utf8')).not.toMatch(/postgresql:\/\/[^'"\n]*127\.0\.0\.1:543\d/);
});
```

`EXECUTABLE_SCRIPT` is already this file's read of `scripts/schema-drift-check.js`. Both requires are byte-identical
today (`schema-drift-check.js:204`, `restore-drill.js:145`).

### Fixtures that are NOT touched (they are deliberately unreachable or synthetic, never the local stack)

`DEAD_URL` (`:99`, `127.0.0.1:59999`) · `OTHER_SERVER_URL` (`:1225`, `10.255.255.1`) ·
`SAME_SERVER_OTHER_DB_URL` (`:1226`) · the `UNRESOLVABLE_HOST` DSN (`:1032`) · `LIVE_PREFLIGHT_URL`
(`:1398`, `schema-drift-gate.invalid`) · the redaction sample at `:584`. None of them matches A6, and each exists to
prove a *failure* direction.

---

## 5. Files

**EDIT (both test-only; no runtime backend code changes)**
`apps/api/src/shared/quality/schema-drift-gate.spec.ts`
`apps/api/src/shared/quality/default-database-url-gate.spec.ts` — ⚠️ **added at implementation, and the addition is
deliberate.** AC-4 asked for the consumer assertion inside the drift spec; it belongs **beside the seam**, enumerated
**exactly once**, because two enumerations of *"who shares the address"* would be the same class of defect as two
literals of the address. This is the ratchet A6 structurally cannot be.

**WRITE**
`docs/spec/features/v3-e02/stories/TOOL-25.md` (this file — the implementing run fills §6)

**DO NOT EDIT**
`scripts/lib/default-database-url.js` (already correct, already used by both scripts) ·
`scripts/production-artefact-check.js` · `scripts/ci-gate.sh` · `scripts/schema-drift-check.js` ·
`scripts/restore-drill.js` · `apps/api/src/shared/quality/restore-drill-gate.spec.ts`

---

## 6. Evidence — baseline vs after *(the implementing run fills the "After" column and pastes the tails)*

| Measurement | Baseline (routine, this run) | After |
|---|---|---|
| `pnpm typecheck` | 13/13 exit 0 | **13/13 exit 0**, `Cached: 12`, `@pilotage/api` a real cache **miss executed fresh** — so both edited specs really compiled |
| `git diff --check` | exit 0 | **exit 0** |
| `npx jest src/shared/quality/schema-drift-gate.spec.ts` from `apps/api` | `5 skipped, 119 passed, 124 total`, exit 0 | ⚠️ **NOT TAKEN — see the box below** |
| the five §1 cases | `○ skipped` | ⚠️ **NOT OBSERVED** — expected to run on this host, unverified |
| `node scripts/production-artefact-check.js` | *(green today)* | ⚠️ **NOT RE-RUN** — and see AC-2: it would be a non-regression reading, not enforcement |
| `expect(gate.probeServer(DEAD_URL)).toBe(false)` at `:1101` | green | **unchanged by this diff** (untouched line); the §5f cases add the second axis, driven with injected probes |

> ### ⚠️ AC-5 — THE CLOSING MEASUREMENT WAS NOT TAKEN. Read this before grading the slice.
>
> **No agent in this run may invoke jest** (GUARDRAILS §4: exactly one agent runs `pnpm typecheck`, once; no agent runs
> tests). So this PR **asserts a behaviour change it has not witnessed**. Everything below is *expectation*, not
> evidence: `defaultDatabaseUrl()` resolves to `127.0.0.1`, port 5432 on this host, which is loopback and answering, so
> `classifyEndToEndTarget` should return `runnable: true` and the five named cases should RUN for the first time in this
> file's history.
>
> **What that first run does, which is why an operator should watch it:** `CREATE DATABASE … TEMPLATE template0`,
> `prisma migrate deploy`, `DROP DATABASE … WITH (FORCE)` and a credentialed `pg_database` scan, on the operator's real
> seeded PostgreSQL. Destruction is name-bounded to `^schema_drift_\d+$` at four independent points, so **child data
> cannot be reached** — but this is real DDL on a real server.
>
> **The three readings that close AC-5/AC-6, none substitutable:**
>
> 1. `npx jest src/shared/quality/schema-drift-gate.spec.ts` from `apps/api`, tail pasted, compared to
>    `5 skipped, 119 passed, 124 total`. **A failure among the five is a REAL FINDING about the drift gate against a
>    live database — report it with its output; do NOT re-skip it and do NOT weaken it** (R-30).
> 2. The negative direction, now **two-dimensional** because §5f added an axis. The old control (unreachable → skip) is
>    no longer sufficient: run `DATABASE_URL=postgresql://u:p@10.255.255.1:5432/x npx jest …` and confirm it **skips**
>    with the new warning line printed — that proves the *wiring*, where the injected §5f cases only prove the function.
> 3. Post-run cleanliness, since this is the first execution of the destructive path:
>    `SELECT datname FROM pg_database WHERE datname LIKE 'schema\_drift\_%'` **empty**, and `git status --porcelain`
>    clean (the AC-1 case copies `schema.prisma` to a temp tree — verify the tracked file is untouched).
>
> **Precondition, and it is not a footnote:** run this from the **main checkout**. `.env` and `apps/api/.env` are
> gitignored and absent from a linked worktree, so there `defaultDatabaseUrl()` falls back to the dead 5433 literal and
> the five cases still skip — see §7 residual 5.

**Read the printed verdict line, never `$?` of a pipeline** (R-23: `bash scripts/ci-gate.sh | tail` reports *tail's*
exit code). A verdict read out of a log file this run did not produce is not evidence — check the mtime.

---

## 7. Risks and the failure modes this story pre-empts

* **The five cases run for the first time against a live PostgreSQL and one of them FAILS.** That is the *point* of the
  slice, not an accident: it would be a real finding about the drift gate. Report it with its output. Re-skipping it,
  or weakening the assertion to reach green, is **R-30** and is refused.
* **The end-to-end block now creates and drops a real scratch database on the operator's server.** That is the
  designed behaviour (`schema_drift_<n>`, pattern-guarded, dropped on every exit path, orphans swept), and
  `leaves no scratch database behind (AC-11)` is one of the five cases that will now execute — it is the evidence.
* **Host-dependence of the pure-function cases.** Nine fixtures move from a constant to a host-resolved value. Every
  one of them is rewritten to assert a *relationship to the base* rather than an absolute, so the cases stay meaningful
  on any host — plus the `:1144` non-vacuity guard above.
* **A fourth divergence.** Prevented structurally by AC-4, which is a source assertion over both scripts *and* this
  spec, not a comment. ⚠️ **Claim narrowed at implementation:** AC-4 makes a fourth *divergence among the three
  enumerated consumers* impossible. The list is hand-maintained, so a **fifth** consumer added next month is silently
  uncovered — the same *"invariant held by a comment"* shape this slice exists to abolish, one level up. Closing that
  needs a completeness walk over `scripts/*.js` and `apps/api/src/**/*.spec.ts`; it is `TOOL-26`'s single most valuable
  test, not a claim this slice may make.

---

## 8. Residuals raised by this slice — all open, all carried as `TOOL-26`

Full text and the measured evidence for each live in
[`docs/spec/features/v3-e02/PROGRESS.md` § `TOOL-25`](../PROGRESS.md). Summarised here so the story doc is not the one
place that says the slice was clean.

1. **§5f is un-specced, and `loopback` ≠ `non-production`.** The end-to-end block gained an address bound that is not in
   any AC and that **narrows** `D5`. It is the right safety property, but `.env.prod.example:50` binds this project's own
   production PostgreSQL to the **loopback** interface, so the guard's containment claim has a counterexample inside the
   repo. **Either record it as an `ADR-027` addendum with the limitation written down honestly, or split it into its own
   slice.** A second discriminator (`NODE_ENV` / `.env.prod` presence) is the non-knob option; a bypass flag is DNC-10
   and is refused.
2. **The port half of the cross-server guard lost its only coverage** — no assertion in the file now pairs an equal
   hostname with an unequal port, so `schema-drift-check.js:1312`'s port clause is unasserted. Restore a fixed
   `SAME_HOST_OTHER_PORT_URL` case beside the different-host one.
3. **`leaves no scratch database behind (AC-11)` asserts a server-wide property** and now really executes — one killed
   worker or one overlapping run reds it with no defect present. Scope it to this run's own scratch.
4. **Two assertions print the raw resolved DSN, password included, on failure** — into a tail AC-5 instructs pasting
   into a report this routine publishes. Compare redacted forms, or reduce the credential half to a boolean.
5. **The fix is inert in a linked worktree** (and on any host that reaches Postgres by service name): `.env` is absent,
   the fallback is the dead port, the five cases skip and the suite reports green. AC-5 is meaningful **only** from the
   main checkout.
