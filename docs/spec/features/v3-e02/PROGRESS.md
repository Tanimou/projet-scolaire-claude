# V3-E02 — Versioned database lifecycle and release integrity

**Layer** L0 · **Closes** PF-03, PF-55, PF-56, VAL-01, VAL-03, VAL-10 (+ PF-58, PF-59, PF-60, PF-61 discovered in flight)
**Spec** the story contracts in `docs/daily-improvement-v3/stories/sprint-01.md` are the spec-kit for this epic.

> **Why there is no `spec.md` here.** The V3 stories are authored pre-sliced with acceptance criteria, a stated test
> and an explicit out-of-scope list — they already carry what a `spec.md` + `tasks.md` pair would. Spending a run on
> `epic-spec` while a P0 (`PF-03`) was open would have been ceremony. This file is the epic's status ledger.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E02-0** | Land the V3 substrate on `main` | ✅ done | 2026-08-02 | PR #170 → `81c6e15` |
| **S-E02-1** | Baseline migration; stop `db push`; preflight; schema manifest | 🟡 partial | 2026-08-02 | baseline applied to scratch DB, `migrate diff --exit-code` = 0, `migrate status` clean, entrypoint refusal exercised, 10/10 jest |
| **S-E02-2** | Make CI actually run | 🟢 done *(local gate)* | 2026-08-02 | suites executed for the first time — **568/588 passing**; 18 failures all baselined with owning finding ids; ratchet proven to block in **both** directions; **surfaced and fixed a live production P0 (`PF-62`)** |
| **S-E02-3** | Timed backup → restore rehearsal | ⛔ blocked | — | blocked by decision **D-01** |
| **S-E02-4** | Seed cannot run in production | ✅ done | 2026-08-03 | 34/34 jest; the guard was **executed** — all **7** seed scripts exit 1 `[refused-production]` under a production target *with the correct token*, and the allowed demo path crosses the guard and fails on the DB connection instead; `nest build` exit 0 |
| **S-E02-5** | Reconcile source ↔ hosted schema drift | ⬜ todo | — | *(implied by S-E02-1; needs hosted access)* |
| **S-E02-6** | Release manifest made real; deploy gate compares it | ✅ done | 2026-08-03 | 19/19 jest; the gate was **executed** — exit 1 against the live drifted API, exit 0 on a conforming manifest, exit 1 on all four bad verdicts *and* on a manifest lying `match`; `nest build` exit 0 |
| **S-E02-7** | The `lint` stage stops being fictional; `prisma/` enters both gates | ✅ done | 2026-08-03 | 26/26 jest; `pnpm lint --force` **13/13, 0 cached** (was 7 of 8 packages exiting 2); a deliberate error probe makes the stage exit 1 at package level *and* through turbo; `pnpm typecheck --force` 13/13 including `prisma/`; `pnpm build` exit 0 |
| **S-E02-8** | Warning count becomes a ratchet; first cut taken only where it is safe | ✅ done | 2026-08-03 | 20/20 jest (46/46 with `lint-gate.spec.ts`); **996 → 44** warnings; ratchet exercised in four directions (increase → 1, back under → 0, ceiling left high → 1, package absent → 1); the DI-breaking autofix measured on emitted JS and refused; `pnpm build` exit 0 |
| **S-E02-9** | Something starts the applications: module graph + booted route table | ✅ done | 2026-08-03 | 15/15 jest (61/61 across `src/shared/quality`); both apps construct (api 42 modules / 40 controllers / 228 routes, worker 23 modules); gate exits 1 on the R-24 DI break **and** on the PF-62 unmounted controller, naming all 13 lost routes; found and fixed `PF-72` (worker building to an empty `dist/` behind a green `pnpm build`) |
| **S-E02-10** | The release gate stops judging one third of the deployment | ✅ done | 2026-08-03 | 27/27 jest (19 surface + 8 worker socket; 38/38 with the comparator); the **previous** gate measured at **exit 0** on both halves of the finding, the new one at **exit 1**; 7 scenarios executed end to end; run against the live local stack: **4/4 failed**, honestly — those containers predate their manifests |
| **S-E02-11** | The web build enters a gate; the release manifest is held to being dynamic | ✅ done | 2026-08-03 | 12/12 jest (73/73 across `src/shared/quality`); the gap measured first — with `apps/web/.next` **deleted entirely**, `boot-check.js` returned **exit 0**; the new check exercised in **9 directions**, 1 pass and 8 distinct failures |
| **S-E02-12** | The declared runtime stops blessing a Node the API cannot boot on | ✅ done | 2026-08-03 | 18/18 jest (91/91 across `src/shared/quality`); run against the **unfixed** repo: `FAIL`, exit 1, naming **35** contradicting dependencies where the finding named one; the finding's own one-line fix measured **wrong in both directions**; 12 negative paths driven through the pure evaluator |
| **S-E02-13** | The observability profile stops being a claim | ✅ done | 2026-08-03 | 33/33 jest (124/124 across `src/shared/quality`) + 13/13 metrics + 6/6 on a **real worker socket**; the profile measured **unable to start** — all 3 of its bind-mount sources absent; the check run against that exact state **fails** naming all three |

## S-E02-6 — the manifest was inert; now the comparison is real

`S-E02-1` shipped `GET /version`. Step 2 of the 2026-08-03 run found it could not gate anything, for two **independent**
reasons — neither visible without looking outside the API source:

1. **Nothing set the SHA.** `buildSha()` read `GIT_SHA`/`BUILD_SHA`, and no Dockerfile, compose file or deploy script
   in the repository ever set either. The manifest returned `"unknown"` in every environment, always.
2. **`/version` was unroutable.** It is deliberately excluded from Nest's global `api/v1` prefix, and nginx proxies only
   `/api/` — so it fell through to `location /` and was answered by **Next.js**. Probing the hosted host returned the
   *web app's* 404, not the API's manifest.

Recorded as `PF-68`. Both are fixed; the design point is that the gate compares **two independent sources**:

| Value | Origin | Means |
|---|---|---|
| `GIT_SHA` | `ARG`→`ENV`, baked into the image **at build time** | what the artefact **is** |
| `EXPECTED_GIT_SHA` | injected into the container **at deploy time** | what the operator **believes** they run |

Producing both from the same step would have proved nothing. Their independence is the control.

**Executed evidence, both directions.** Run against the API actually running on this machine (up 43 h), the gate
**failed with exit 1** — that container predates `/version`, i.e. it is a genuinely drifted artefact, which is R-05
still live locally. Against a synthetic manifest: `match`→0; `drift`, `dirty`, `unverified`, `unstamped` and a
missing `verdict` field→1. The sharpest case: a manifest **claiming `match`** against a foreign SHA is still rejected,
because `release-gate.sh` re-derives the expectation from the checkout instead of trusting the artefact it is judging.

**`unverified` fails the gate but does not block boot.** Not comparing is reported honestly rather than as success
(`DNC-08`), while every pre-existing deployment keeps starting. There is **no bypass flag** (`DNC-10`) — not declaring
an expectation *is* the switch, and it is visible in the manifest. A test asserts three plausible flag names have no
effect in production.

**What it does not cover.** Worker and web carry `GIT_SHA` but expose no HTTP manifest, so their drift is undetected;
`schemaVersion` is published but not compared against the checkout's latest shipped migration. Both are the open half
of `PF-68`. And the gate has **never run against the hosted deployment** — it cannot, until a deploy carrying
`/version` reaches it.

## S-E02-2 — what "done" means here, and what it does not

**The previous run recorded this story as ⛔ blocked by `PF-59`. That was the wrong read**, and correcting it is the
main lesson of the 2026-08-02 run: `PF-59` locks the *hosted runner*, not the *gate*. The suites were always
executable on the machine the routine already runs on. Treating "CI is down" as "the gate cannot exist" is what let a
production P0 sit undetected for seven weeks.

**Delivered and executed:**

- `scripts/test-ratchet.js` — runs a suite, compares against `scripts/known-test-failures.json`, and fails on a new
  failure *or* on a baseline entry that starts passing (the list may only shrink). Both directions were exercised
  live, not asserted.
- `scripts/ci-gate.sh` — the six CI stages in CI's own order, runnable locally; every stage runs even after one fails,
  so a single run reports every problem.
- `scripts/known-test-failures.json` — 18 entries, each with a cause and an owning finding (`PF-63`…`PF-66`).
- `.github/workflows/ci.yml` — `prisma generate` added before `lint` (it `dependsOn: ^build`, which needs the client);
  `pnpm test --if-present` (a pnpm flag that turbo does not accept, and an invitation to treat a missing script as a
  pass) replaced by the two ratchet invocations.

**Not delivered — stated plainly:**

- The **hosted** gate. `ci.yml` is repaired but has not executed and cannot until `PF-59` is resolved by the account
  owner. Its correctness is reviewed, not proven.
- **Playwright and axe stages** (`VAL-08`). Wiring a job that cannot be run would be asserting a gate rather than
  executing one, which is the failure mode V3 exists to end — so they are left explicitly open instead.
- **Merge gating.** Nothing mechanically blocks a merge yet; the ratchet is only as binding as the routine that runs it.

## What remains on S-E02-1

The **code path** is done and evidenced. What is not done is the **hosted** side, which needs production credentials
and an operator:

1. Run the drift check in `docs/runbooks/baseline-hosted-database.md` §1.
2. If it is **not** empty → that is the S-E02-5 drift; do **not** baseline.
3. If it is empty → `prisma migrate resolve --applied 0_baseline`, then `migrate status`.

Until step 3 runs, the hosted migrator will **refuse to deploy** — deliberately. That refusal is the fix working, not
a regression: it is what stops an unreviewed schema mutation.

## S-E02-4 — done 2026-08-03 (run 8)

The seed can no longer run against a production target, and the demo survives as a deliberate act rather than a side
effect.

**What was actually wrong**, wider than the story said: **one of seven** seed scripts carried a guard;
`docker-compose.prod.yml` disabled that one by forcing `NODE_ENV: development` on the only service in the file not
given `production`, with a comment explaining the bypass; and `deploy-prod.sh` ran all seven **by default**
(`--no-seed` was the opt-out). `ALLOW_SEED` existed nowhere in the repository. This chain is the mechanism behind
`PF-17`'s seed residue on the hosted deployment.

**What landed:** `apps/api/prisma/seed-guard.ts` — a pure `evaluateSeedPermission()` deciding on two independent
signals (`NODE_ENV`, set per service; `DEPLOY_ENV`, set once per stack), wired into all seven scripts ahead of any
`PrismaClient` or network call; the compose override deleted; `deploy-prod.sh --seed` made opt-in;
`docs/runbooks/provision-demo-tenant.md` written so R-12's demo stays reproducible.

**Executed in both directions.** 7/7 scripts exit 1 under a production target *even with the correct token* — so the
token is an opt-in, not a bypass (DNC-10). The allowed demo path crosses the guard and fails on the DB connection
instead, which is what proves the guard is not a blanket refusal. `docker compose config` shows the hosted stack
resolving to `DEPLOY_ENV: production`, `ALLOW_SEED: ""` — closed by default.

**Not claimed:** demo rows already written to the hosted database stay there. Removing them is a destructive action on
hosted data (routine STOP condition #3) and belongs to the operator — runbook §6.

## S-E02-7 — done 2026-08-03 (run 9)

The `lint` stage of `ci-gate.sh` runs for the first time since it was written, and `prisma/` stops being invisible to
both gates.

**What was actually wrong**, wider than `PF-70` recorded. The finding inferred "four tasks green from turbo cache, one
red". Measured package by package, **7 of the 8 lintable packages exited 2** — ESLint 9 stopped reading `.eslintrc.*`
and no package had a flat config. The one package that exited 0, `apps/web`, passed only because `next lint` silently
forces eslintrc mode; that command is deprecated in Next 15 and removed in Next 16. So the gate was not partly
cached-green — **it was linting nothing but web**, and would have stopped doing even that on the next Next upgrade.

**The fix that was refused.** `ESLINT_USE_FLAT_CONFIG=false` would have turned the stage green in one line. That is
exactly the shape V3 exists to refuse: it makes the *report* green without making the *check* real, and it defers the
break onto a maintainer who will not have this context. Keeping both formats alive would be worse still — a package
could carry an `.eslintrc` that never loads while believing it is governed by rules that do not apply.

**What landed.** `packages/eslint-config` rewritten as flat arrays (`base` / `node` / `react`; the unused `next` preset
deleted); an `eslint.config.js` in each of the 8 lintable packages; all three `.eslintrc*` files removed; `apps/web`
moved to the ESLint CLI with `FlatCompat` over `next/core-web-vitals`; `apps/api` linting `.` rather than
`{src,test}/**/*.ts` and typechecking `prisma/tsconfig.json` alongside `src` (`PF-69`).

**Executed in both directions.** `pnpm lint --force` → **13/13 tasks, 0 cached** — the `--force` is the whole point,
since a stale cached ✓ is what hid this for three runs. A `no-useless-escape` probe in `@pilotage/i18n` makes the stage
exit **1**, at package level and through turbo alike; probe deleted, stage back to 0. `pnpm typecheck --force` →
13/13, 0 cached, now including the ~2 900 lines under `prisma/` that write the entire demo dataset.

**Six real errors fixed, none disabled.** Two `no-useless-escape` inside regex character classes, one
empty-extending interface, one `eslint-disable` directive naming a rule not loaded in that package (itself an error),
and one `require()` in a spec — that last one kept as a single documented disable, because resolving the class lazily
after the module mocks install is deliberate.

**Not claimed.** The working gate surfaces **996 warnings** (web 597, api 321, worker 49, ui 24, imports-core 5),
recorded as `PF-71` and left in place: warnings do not fail a build, and silencing them to make a number look good is
the failure mode this story just closed. `scripts/` and `bmad/` remain unlinted — neither is a workspace package.

## S-E02-8 — done 2026-08-03 (run 10)

The warning count is now bounded, and the story's own premise turned out to be wrong in a way that mattered.

**What the finding claimed.** `PF-71` recorded "952 of the 996 are `--fix`-able, so the first cut is nearly free".
The obvious reading — run `pnpm lint --fix` across the workspace — would have shipped a production outage.

**What was actually true.** 243 of those 952 are `@typescript-eslint/consistent-type-imports` in `apps/api` (218) and
`apps/worker` (25). Those are the only two packages extending `@pilotage/tsconfig/node.json`, the only shared tsconfig
that sets `emitDecoratorMetadata`. NestJS resolves constructor dependencies from the `design:paramtypes` metadata
TypeScript emits for a decorated class, and that emit requires the parameter's type to be a **value** import. The
rule's autofix rewrites it to `import type`.

Measured on `apps/api/src/modules/analytics/analytics.service.ts`, compiled before and after one `eslint --fix`:

| | `design:paramtypes` | relative `require()` calls |
|---|---|---|
| before | `[PrismaService, GradesService, RemediationService]` | 3 |
| after | `[Object, Object, Object]` | 0 |

Nest cannot resolve `AnalyticsService` from that. **And no gate in this repository sees it:** `tsc --noEmit -p
tsconfig.json` was executed on the broken file and returned **exit 0**, `nest build` succeeds, ESLint is *satisfied*
because it produced the change, and the module-wiring guards read module source and never look at a constructor
(`PF-67`, which this widens — the class is not "the guards are textual", it is "**nothing boots the app**").

**The cut that was actually taken.** 694 `import/order` autofixed, 10 dead `eslint-disable` directives removed, 5
`consistent-type-imports` fixed where it is safe (`apps/web`, `packages/imports-core` — neither emits decorator
metadata), and the remaining **243 are not "fixed": the rule is turned off** where it is incorrect, via
`packages/eslint-config/decorator-metadata.js`, which carries the measurement above in its header. The rule is `warn`,
so it never gated anything; leaving it on is the dangerous option, because it advertises 243 fixable findings whose
obvious remedy breaks boot invisibly. **996 → 44.**

**Executed in four directions,** because a ratchet that only ever passes proves nothing:

| Probe | Result |
|---|---|
| unused-var added to `@pilotage/i18n` (ceiling 0) | **exit 1**, naming the rule and the delta |
| probe removed | exit 0 |
| a ceiling left above the measured count | **exit 1** — "the ratchet only turns one way" |
| a lintable package deleted from the baseline | **exit 1** — no escape by omission |

That last rule is the one that matters most: `PF-69` and `PF-70` were both "a thing no gate looked at". A ceiling list
a new package can quietly omit itself from would reproduce them at a new address.

**The gate caught this slice's own code twice, which is the best evidence in the run.** First, the guard caught
itself: `lint-ratchet.spec.ts` reported *zero* packages emitting decorator metadata, because its JSONC comment
stripper was eating `"@/*"` inside `paths` as a block-comment opener — every assertion in that describe block would
have passed vacuously. Replaced with a string-aware scanner, and each describe now asserts discovery found something
before asserting anything about it. Second, the full gate returned **`GATE: FAIL (1 stage)`** — `typecheck`, on
`lint-ratchet.spec.ts:170`, where `expect(entry).toBeDefined()` does not narrow the type for `tsc`. Jest had passed
the same file. Fixed with optional chaining that keeps both assertions failing correctly on a missing entry, and the
gate re-run returned **`GATE: PASS`** on all seven stages.

**Two checks run because their absence would have been invisible.** After the workspace `--fix`, `apps/api` and
`apps/worker` contain **0** new `import type` conversions — every added line has an identical removed line, i.e. pure
`import/order` reordering — and the probe file still holds its value imports.

**Not claimed.** 44 warnings remain (api 9, web 34, ui 1), each named and owned in
`scripts/lint-warning-baseline.json`; a test rejects a non-zero ceiling whose note is still a `TODO`. They are debt
under a ceiling, not debt that is gone. A full ratchet pass lints all 8 packages and takes ~4–5 minutes, which is real
cost in the gate. `scripts/` and `bmad/` remain unlinted — neither is a workspace package.

**Adjacent cleanup.** `apps/worker` still linted `src/**/*.ts` where `S-E02-7` moved api and web to `eslint .`;
normalised, at a cost of 0 warnings.

## S-E02-9 — done 2026-08-03 (run 11)

Something in this repository now starts the applications. Until this slice, nothing ever did.

**The finding, in its final form.** `PF-67` was raised as "the module-wiring guards read module source", widened by
run 10 to "a type-correct change can break DI and pass every gate", and its real shape is simply: **no gate boots the
app.** Confirmed before writing anything — grepping both applications' sources for `createTestingModule` returned
**zero** call sites.

**The stated blocker is real, and was verified rather than assumed.** A throwaway probe spec importing `AppModule`
under ts-jest dies before its first assertion:

```
AppModule → AlertsModule → AuthModule → JwtStrategy → jwks-rsa → jose@6.2.3
SyntaxError: Unexpected token 'export'   (jose/dist/webapi/index.js:1)
```

**What was built, and why it is not a jest spec.** `scripts/boot-check.js` runs outside jest, under plain Node, which
loads `jose` through its own require(ESM) support — so the ESM problem is *sidestepped*, not papered over with a mock
of the very dependency we want to prove loads. It runs against `dist/` for a second and more important reason: **R-24
is a defect in emitted metadata.** The TypeScript is valid either way; only the compiler's output differs. Re-compiling
the source through ts-jest would judge a different build than the one deployed.

It does two things, and they catch different defects:

| Check | Catches | Proven by |
|---|---|---|
| `Test.createTestingModule({imports:[AppModule]}).compile()` per app | a provider that cannot be constructed (**R-24**) | patching `analytics.service.js`'s emitted `design:paramtypes` to `[Object, Object, Object]` → **exit 1**, *"Nest can't resolve dependencies of the AnalyticsService (?, Object, Object)"* |
| route table read off the **booted container** vs a reviewed baseline | a controller that stopped being reachable (**PF-62**) | emptying `grades.module.js`'s `controllers:` array → **exit 1**, naming all **13** routes that were 404 in production for seven weeks |

The second probe is the one that justifies having both halves: with the controllers removed the app still **booted
cleanly** (42 modules, 38 controllers). The compile check alone would have called that green.

**Executed in every direction that matters.**

| Probe | Result |
|---|---|
| clean run | **exit 0** — api 42 modules / 40 controllers / 228 routes; worker 23 modules |
| DI break in emitted metadata (R-24) | **exit 1**, dependency named |
| controllers unmounted (PF-62) | **exit 1**, 13 routes named |
| an app deleted from the baseline | **exit 1** — no escape by omission |
| `dist/` missing | **failure, not a skip** |
| `--update` run while an app is broken | **refused** — see below |

`.compile()` is called, never `.init()`. That distinction is the entire reason this can run in a gate with no Postgres
or Redis — and it is also the honest limit: it proves the application **can be constructed**, not that it can serve
traffic. There is no bypass flag (DNC-10), locked by a test.

**The guard caught this slice's own code, twice.** First, the initial `--update` recorded `apps/api` and silently
dropped `apps/worker`, which had failed to boot — a baseline that would then have passed the gate forever with one
application unrepresented. That is escape-by-omission reintroduced through the update path, so `--update` now refuses
to write from a partial run. Second, `boot-gate.spec.ts` went red on `apps/worker has a baseline entry` before the
worker could boot — the rule firing on a real gap rather than a hypothetical one.

### PF-72 — the worker was building to an empty `dist/`, and `pnpm build` said fine

Turning the gate on immediately found a live defect, which is the pattern `PF-62` established: the check finds the
thing it was written for on its first real run.

`apps/worker/nest-cli.json` sets `deleteOutDir: true`; the worker inherited `incremental: true` from
`@pilotage/tsconfig/base.json`. The build **deletes `dist/`**, then asks a compiler holding a `.tsbuildinfo` that says
every file is already emitted to emit — and it emits nothing, exiting 0:

| Run | Result |
|---|---|
| stale `tsconfig.build.tsbuildinfo` present | `nest build` → **exit 0, 0 files** |
| identical, build-info removed first | `nest build` → **exit 0, 53 files incl. `main.js`** |
| after the fix, twice in a row | **53 files both times** — the second run is exactly the case that used to emit nothing |

`apps/api` was never affected, because it already carried an explicit `incremental: false`. That is precisely what made
the setting invisible: it looked like a stylistic difference between two app configs rather than the load-bearing flag
it is.

**Why nothing noticed.** `pnpm build` exits 0, and turbo's `build` task declares `outputs: ["dist/**", …]` — so the
*empty* dist was cached as a successful build output and replayed on later cache hits. `.tsbuildinfo` is gitignored, so
a clean clone reproduces this as soon as anything builds twice. Recorded as **`PF-72`** and **`R-25`**, fixed by
pinning `incremental: false` in the worker, with a guard asserting that *every* app whose `nest-cli.json` deletes its
outDir resolves `incremental: false` — read through `tsc --showConfig`, because the value is **inherited** and because
regex-parsing JSONC is how run 10's guard nearly passed vacuously. Negative path executed: restoring `incremental:
true` turns the guard red, restoring `false` turns it green.

**Not claimed.** A hosted deploy was probably never hit, since Docker builds from a fresh checkout with no build-info
— but nothing in the repository *guaranteed* that, and a warm cache or a reused workspace would have shipped a worker
image with no `main.js`.

**Cost.** The boot stage adds ~35 s to the gate (api ~20 s, worker ~10 s). `apps/worker` gained a
`@nestjs/testing` devDependency at the existing v10 pin (`^10.4.13`, resolving to `10.4.22` against the installed
`@nestjs/common`/`core` — three lockfile lines, no other package moved).

**Gate verdict, reported in full per R-23 — including the run I broke myself.** The first `ci-gate.sh` run returned
**`GATE: FAIL (1 stage)`** on `build`, and the cause was **me**: I twice terminated `pnpm build` believing turbo had
hung after the web build finished, because it had no task children and near-zero CPU. That reading was wrong.
`@pilotage/web#build` genuinely runs **>9 minutes** — a `timeout 540` wrapper killed it still executing (exit 143) —
and turbo then spends further minutes writing the large `.next` cache artefact at near-zero CPU, which is what looked
like a stall. The tempting follow-on inference, "web never hits the turbo cache", is **also** unsupported: both
observed misses followed a run I had killed, and a killed run writes no cache entry, which explains them completely.
No finding is raised for it.

Re-run uninterrupted: `pnpm build` → **8 successful, 8 total, 11m52s, exit 0**. Gate re-run → **`GATE: PASS`** on all
eight stages:

```
✓ prisma generate   ✓ lint   ✓ lint:warnings (ratchet)   ✓ typecheck
✓ test:api (ratchet)   ✓ test:worker (ratchet)   ✓ build   ✓ boot (module graph + route table)
```

The self-inflicted `FAIL` is left on the record beside the `PASS`. R-23 exists because runs 5–7 reported around a red
stage; a run that quietly re-rolls its own red stage until it goes green is the same failure wearing a different hat.

## S-E02-10 — done 2026-08-03 (run 12)

The release gate was judging one artefact out of three, and printing a number it never compared.

**The finding, measured rather than argued.** `PF-68`'s residual half was recorded as a note. Step 2 turned it into a
measurement by running the **previous** gate (`git show main:scripts/release-gate.sh`) against synthetic deployments:

| Deployment | gate on `main` | gate after this slice |
|---|---|---|
| only the API answers — worker and web never interrogated | **exit 0** | **exit 1** |
| API at the right commit, database **never baselined** (`PF-03`'s live state) | **exit 0** | **exit 1** |

The second row is the sharper one. The gate *read* `schemaVersion` — to print it on line 57 — and never read
`migrations.status` at all. A deployment could be certified conforming while running against a schema of unknown
origin, which is precisely the class of defect `S-E02-1` exists to prevent.

**Why the comparator moved to `packages/contracts`.** Three artefacts are built and deployed separately, and all three
already carried a `GIT_SHA` baked at build time since `S-E02-6` — two of them had nothing that could read it. The
obvious implementation is to copy the comparator into the worker and the web. Three copies of a version comparator
drift, and a drifted copy turns green the third of the deployment it is not looking at — which is how this finding came
to exist in the first place. One copy, in the only package all three already depend on.

*(A subpath export `@pilotage/contracts/release` was written first and reverted: this workspace compiles with
`moduleResolution: Node`, which does not read the `exports` map. The pre-existing `./enums`, `./dto` and `./events`
entries are declared and imported by nothing, for exactly that reason. Adding a fourth unusable entry would have been
a trap; the root import is the idiom that actually works here.)*

**What each artefact publishes.**

| Artefact | Route | Notes |
|---|---|---|
| `api` | `GET /version` | now also carries `app: "api"` and, as before, the migration state |
| `worker` | `GET /version/worker` | a ~60-line `node:http` server — the worker has no other HTTP surface |
| `web` | `GET /version/web` | Next route handler, `force-dynamic` |

The `app` field is not decoration: without it, a reverse-proxy answering the API manifest on `/version/worker` is
indistinguishable from a conforming worker, and the gate would be green on an artefact it never reached. Executed as a
probe — it fails.

The worker also runs the **same production refusal** as the api. It writes real data from real queues; a drifted worker
is not less dangerous than a drifted API, it is less visible.

**Executed in seven directions,** because a gate that only ever passes proves nothing:

| Scenario | Result |
|---|---|
| all three conforming, schema current | **exit 0** |
| worker drifted | **exit 1**, worker named |
| web manifest absent (an artefact predating the manifest) | **exit 1** — unreachable is a failure, never a skip |
| proxy returns the api manifest on the worker path | **exit 1** — `a répondu le manifeste de 'api'` |
| database never baselined | **exit 1** |
| database `clean` about its **own**, older migration | **exit 1** — `status: clean` only means "this image's own migrations are applied" |
| artefact **claiming** `match` at a foreign SHA | **exit 1** — the gate re-derives, it does not delegate |

**Run against the stack actually running on this machine: 4/4 failed.** All three containers are two days old and
predate their manifests. That is R-05 live locally, reported as-is rather than worked around — the same result run 7
got for the API alone, now visible for the whole deployment.

**The ratchet caught this slice's own code.** `lint-ratchet.js` returned **exit 1** — `apps/api: 10 warnings exceeds
the ceiling of 9 (+1)`, an `import/order` in the file this slice had just rewritten. Fixed at the source; raising the
ceiling would have been the exact move the ratchet exists to refuse. Back to 44/44.

**Not claimed.** The gate has **never run against the hosted deployment** and cannot until a deploy carries these
manifests — it would fail there today, which *is* the drift, not a false positive. It proves **which** artefact runs,
not that it works: a container at the right SHA with a wrong connection string passes this gate and fails elsewhere.
And Keycloak, Postgres, Redis, MinIO and nginx are upstream images pinned by tag, outside this control entirely.

## S-E02-11 — done 2026-08-03 (run 13)

The third artefact enters a gate. Until this slice, `apps/web` had **no build-output assertion of any kind**.

**The gap, measured before anything was written.** `apps/web/.next` was moved aside in its entirety and
`node scripts/boot-check.js` re-run: **`BOOT CHECK: PASS`, exit 0**. `grep -rn '\.next' scripts/` returned nothing —
no stage of `ci-gate.sh` read the directory at all. The whole web build could vanish and the gate stayed green.

That is `R-25` — *"a build reports success while emitting nothing"* — at the one address its mitigation did not reach.
It was not hypothetical when it was found: `PF-72` had the worker emitting **0 files at exit 0**, and turbo's `build`
task declares `outputs: ["dist/**", ".next/**", …]`, so the same caching rule that replayed an empty `dist/` applies to
`.next/` verbatim. `boot-check.js` cannot cover web — its discovery is `apps/*` containing `src/app.module.ts`, and
Next.js has no module graph to construct.

**What the check asserts, and which defect each one is for.**

| # | Assertion | The defect it catches |
|---|---|---|
| 1 | `.next/BUILD_ID` present and non-empty | the build emitted nothing at all |
| 2 | route inventory matches `scripts/web-route-baseline.json` | a page or handler that stopped being emitted — PF-62's shape at the web address |
| 3 | every manifest route has its emitted server file on disk | the per-route form of "promises a route, wrote nothing" |
| 4 | `.next/static` non-empty | `Dockerfile.web` copies it; without it every page is unstyled and scriptless |
| 5 | `.next/standalone/apps/web/server.js` when the resolved config says `output: 'standalone'` | the image's `CMD` target — absent, it has no entrypoint |
| 6 | routes listed `mustBeDynamic` are **not** prerendered | see below |

**Assertion 6 is the one that was silently load-bearing.** `apps/web/src/app/version/web/route.ts` is the web third of
the release gate (`S-E02-10`, `R-05`), and its own header states the invariant: *« `force-dynamic` est obligatoire :
pré-rendu au build, le manifeste figerait le SHA du build de page au lieu de lire l'environnement du conteneur »*.
Nothing enforced it. Deleting one line of that file leaves the route present, the build green and `release-gate.sh`
still answering 200 — with a constant. A release gate that can be turned into a constant is worse than none, because it
reports confidence. The check reads the **emitted** `prerender-manifest.json`, not the source directive, for the same
reason `boot-check.js` reads `dist/`: the defect is in the output, and the source is not the artefact that ships. The
spec asserts the source directive too, because that fails on the diff rather than on the next build.

**`output: 'standalone'` is read from `.next/required-server-files.json`** — Next's own record of the config it ran
with. Same reasoning as reading `incremental` through `tsc --showConfig` in `boot-gate.spec.ts`: regex-parsing
`next.config.mjs` would be guessing at a value the build has already written down, and JSONC-by-regex is how run 10's
guard nearly passed vacuously.

**Executed in nine directions** — one pass, eight distinct failures:

| Probe | Result |
|---|---|
| clean artefact | **exit 0** — 108 routes, BUILD_ID, static and standalone present |
| entire `.next` deleted *(the state where `boot-check.js` returns 0)* | **exit 1** — missing build is a failure, never a skip |
| a page dropped from the emitted manifest | **exit 1**, route named |
| a manifest route whose `route.js` was never written | **exit 1**, expected path named |
| `/version/web` marked prerendered | **exit 1**, with why it matters for R-05 |
| `.next/standalone/.../server.js` absent | **exit 1**, naming `Dockerfile.web`'s CMD |
| `.next/static` absent | **exit 1** |
| `apps/web` deleted from the baseline | **exit 1** — no escape by omission |
| `--update` run against a broken artefact | **refused** — a broken build cannot be frozen into the inventory |

The guard spec was exercised in the negative too, not just written: emptying `mustBeDynamic` **and** deleting the
`force-dynamic` line makes it **2 failed / 10 passed**; replacing the stage with `true` in *both* `ci-gate.sh` and
`ci.yml` makes it **2 failed / 10 passed** again. Everything was restored and `git diff` confirmed clean.

**G-PORTAL, by enumeration rather than assertion (R-14).** The inventory is not a web-wide blob: it covers
**admin 50 · teacher 22 · parent 24 · student 6 · shared 6 = 108** routes. A page disappearing from *any* of the four
portals now fails the gate and is named in the failure — including the student portal, which has the fewest routes and
is therefore the one whose loss would be easiest to miss by eye.

**Not claimed, and the limit is real.** This does not start Next.js. Booting it needs a listening port and, behind most
of those 108 routes, a database and a Keycloak session — the same cost the `.compile()`-not-`.init()` decision avoids
in `boot-check.js`. So the web artefact is proven **produced and complete**, not **correct**: the two Nest apps are
constructed, the web app is only inspected. That asymmetry is the honest state of the gate.

**One causal step is inferred rather than executed.** Probe 5 proves the check *detects* a prerendered `/version/web`;
it does not prove that *removing* `force-dynamic` is what produces that state, because confirming it needs a second
`next build` and the run has one build slot. All four route handlers in this build carry `force-dynamic` or are
inherently dynamic, so there is no in-build control case to point at. The detection is measured; the trigger is
inferred from Next 15's static-by-default handling of route handlers.

## S-E02-12 — done 2026-08-03 (run 14)

The runtime this repository claims to support is now checked instead of asserted — and the finding's own prescription
was wrong, which is the run's most useful result.

**Why this was not a one-line fix.** `PF-73` recorded *«Fix is one line (`>=22.12.0`)»*. Applying it would have
replaced an unverified declaration with another unverified declaration, which is the exact failure mode this epic
exists to end. So the declaration became arithmetic that runs: `scripts/runtime-engines-check.js` reads every installed
package's own `engines.node` out of pnpm's virtual store — **671 of 1294 declare one** — and asserts with
`semver.subset` that the root declaration blesses no Node version any of them refuses.

**Executed against the unfixed repository before anything was changed:**

```
▶ declared runtime: node ">=20.0.0", pnpm ">=8.0.0"
▶ dependency set   : 671 packages declare engines.node
  ✗ engines.node ">=20.0.0" blesses Node versions that 35 installed dependencies refuse.
  ✗ .nvmrc pins Node "22", which is not a concrete version.
  ✗ .github/workflows/ci.yml NODE_VERSION pins Node "22", which is not a concrete version.
  ✗ engines.pnpm ">=8.0.0" allows pnpm 8.0.0, a different major from the packageManager pin (9.12.3).
RUNTIME ENGINES CHECK: FAIL (4 problem(s))
```

**35**, where the finding named one. And three problems it never mentioned at all.

**The prescription is wrong in both directions.** Measured against the installed set:

| Range | 20.19.x | 22.12.x | 22.13.x | 23.x | ≥24 |
|---|---|---|---|---|---|
| what every dependency accepts | ✅ | ❌ *(`eslint-visitor-keys`)* | ✅ | ❌ *(`eslint-visitor-keys`)* | ✅ |
| PF-73's proposed `>=22.12.0` | **excluded — wrongly** | **blessed — wrongly** | ✅ | **blessed — wrongly** | ✅ |

`require(esm)` was **backported to 20.19**, which the finding missed; `jwks-rsa@4.0.1` says so itself
(`"^20.19.0 || ^22.12.0 || >= 23.0.0"`). And `eslint-visitor-keys@5.0.1` requires `^20.19.0 || ^22.13.0 || >=24`, which
`>=22.12.0` violates twice over. Both corrections are locked as tests, so they survive the finding being re-read.

**What is declared, and why it is narrower than what works.** `^22.13.1 || >=24.0.0`. The compatible set is
20.19.x · 22.13.x · ≥24, but `engines` is a **support** statement, not a compatibility one: 22.13.1 is what the three
Dockerfiles build and ship, ≥24 is what local development runs on, and 20.19 is compatible-but-untested. Declaring only
what is exercised is the whole point of the epic.

### Two defects PF-73 never mentioned, found by the check and fixed in the same run

**`PF-75` — `engines.pnpm: ">=8.0.0"` beside `packageManager: pnpm@9.12.3`.** `pnpm-lock.yaml` is
`lockfileVersion: '9.0'`; pnpm 8 writes 6.0. The repository declared support for a package manager that cannot have
produced its own lockfile. Now `>=9.0.0`, with the rule checked rather than remembered — the floor of `engines.pnpm`
must sit inside the `packageManager` pin's major, and `ci.yml`'s `PNPM_VERSION` must equal that pin.

**`PF-76` — `.nvmrc: 22` and `ci.yml: NODE_VERSION: '22'`.** `PF-73` called itself latent because "everything runs 22".
It was latent for a weaker reason than that: a bare major *declares* 22.0.0–22.99.x, which includes 22.0–22.11 — the
window where the API cannot boot at all. It was safe only because nvm and `actions/setup-node` happen to resolve a bare
major to the newest release. A statement that is true by accident is the same defect one level down. Both now pin
**22.13.1**, equal to the three `ARG NODE_VERSION` defaults; the Dockerfiles are discovered from the filesystem rather
than from a list, so a fourth one is covered without anyone remembering.

### Executed in both directions

Positive: `RUNTIME ENGINES CHECK: PASS`, exit 0 — *"is a subset of all 671 installed engines.node ranges"*,
*"all 5 Node pins agree on 22.13.1"*, *"the running Node (25.7.0) satisfies engines.node"*.

The script judges *this* repository, so a clean run can only ever show the current state is fine — it can never show
the gate would catch a regression. The evaluation is therefore a **pure function** the spec drives with synthetic
input, which is where the real evidence is:

| Probe | Result |
|---|---|
| the exact declaration that shipped PF-73 (`>=20.0.0`) | **fails**, naming `jwks-rsa@4.0.1` |
| the finding's own proposed fix (`>=22.12.0`) | **fails**, naming `eslint-visitor-keys@5.0.1` |
| a future dependency raising its floor to `>=26` | **fails** — the forward-looking half |
| `.nvmrc` back to a floating `22` | **fails** — "not a concrete version" |
| one Dockerfile pinning a different version | **fails** — "2 different Node versions" |
| a Dockerfile that stops declaring `ARG NODE_VERSION` | **fails** — silence is not a pass |
| `engines.pnpm` back to `>=8.0.0` | **fails** — different major from the pin |
| `ci.yml` `PNPM_VERSION` drifting from `packageManager` | **fails** |
| the gate itself running on Node 20.11 | **fails** — everything downstream would be validated on an unsupported runtime |
| `node_modules/.pnpm` absent | **fails, not skips** — with nothing to compare against, check (1) would pass vacuously |
| an unparseable declaration (`lts/*`) | **fails**, rather than being ignored |

**The guard spec was exercised in the negative too, not merely written.** Reverting `engines.node` to `>=20.0.0`,
`.nvmrc` to `22`, and replacing the `ci-gate.sh` stage with `true` makes it **3 failed / 15 passed**, one failure per
broken thing. Everything was restored and `git diff` confirmed clean.

**A dependency was added deliberately.** `semver` becomes a root devDependency (3 lockfile lines, no other package
moved). It was resolvable only transitively from pnpm's virtual store, and the alternative — hand-rolling version-range
algebra inside a guard — is precisely how run 10's JSONC-by-regex nearly passed vacuously. A test asserts the direct
dependency, so a future lockfile change cannot silently remove the thing the gate's arithmetic rests on.

**Not claimed, and the limit is real.** This does **not** start Node 20 and watch the API fail. That needs a second
runtime the gate does not have. The packaging was read directly — `jose@6.2.3` is `"type": "module"` with
`main: ./dist/webapi/index.js` whose first line is `export {…}`, and `jwks-rsa/src/utils.js:1` is
`const jose = require('jose')` — but the boot failure below 20.19 stays **inferred** from the require(ESM) support
matrix, exactly as `PF-73` stated. What is executed is the arithmetic over declared ranges, which is what a declaration
*is*. The check also cannot see a Docker `build.arg` overriding `ARG NODE_VERSION` at build time; no compose file sets
one today, and that was verified, but it is a gap the check does not cover.

## S-E02-13 — done 2026-08-03 (run 15)

The `obs` profile stops being a claim. Until this slice nothing had ever tried to start it, and it could not have
started.

**The gap, measured before anything was written.** `infra/docker-compose.yml` declares Prometheus, Grafana and Loki
under `profiles: ["obs"]`, and A2 §13 recorded that as "configuration optional rather than proven active". Enumerating
every relative bind-mount source in every compose file gave **8**, of which **3 did not exist**:

| Bind-mount source | Mounted into | Present |
|---|---|---|
| `./grafana/prometheus.yml` | `prometheus:/etc/prometheus/prometheus.yml` | ❌ |
| `./grafana/provisioning` | `grafana:/etc/grafana/provisioning` | ❌ |
| `./grafana/dashboards` | `grafana:/var/lib/grafana/dashboards` | ❌ |

All three belong to this profile, and they are the only three missing in the file. Docker creates a **directory** for a
missing bind-mount source, so Prometheus would have received a directory where it expects its config file. And
`grep -rniE 'prom-client|opentelemetry|/metrics' apps/*/src` found nothing: no application registered a metric, so even
a working Prometheus would have scraped an empty set. The profile was not "optional" — it was inert, and nothing in the
repository could tell you that.

**What landed.**

| Piece | Why it is that and not something cheaper |
|---|---|
| API `GET /metrics` — default process metrics **plus** an HTTP latency histogram and request counter | PF-56 asks for **SLOs**. An SLO needs a latency distribution and an error rate; CPU and heap produce neither, so `collectDefaultMetrics` alone would have looked like progress without being any |
| Worker `/metrics` on its **existing** release-manifest socket | The worker already listens for exactly one reason. A second port for the same reason doubles the compose config, the nginx rule, and the number of things that can diverge |
| The three missing config files, written for real | A scrape config targeting both apps, a provisioned datasource, and a 4-panel SLO dashboard whose queries name only metrics that exist |
| `scripts/observability-check.js` as stage 9 | The general rule — *every relative bind-mount source in every compose file must exist* — rather than a fix for these three paths, so the class cannot reappear at a new address |

**The cardinality rule is the security rule.** `/metrics` is unauthenticated by construction: Prometheus carries no
token, and a shared secret in a read-only mounted config is the appearance of a control rather than one. Its access
control is the docker network. So the payload has to be safe on its own terms — series are labelled by the **matched
route template** (`/api/v1/students/:id`), never by `req.originalUrl`. Labelling by the resolved URL is one line away
and would turn every student id into a time series: an unbounded cardinality explosion *and* a tenant-identifier leak
onto an unauthenticated surface. A test drives the label function with a request carrying **both** and asserts the id
does not reach the exposition; another asserts unmatched URLs collapse onto a single series, so a scanner inventing
paths cannot exhaust memory. The gate holds the other half: it fails if any nginx `location` ever publishes the path.

**The check caught its own first defect, which is the best evidence that it reads something real.** Merging services
across compose files with `Object.assign` let `docker-compose.prod.yml`'s **partial** `api` override replace the base
definition wholesale, losing its `environment` and `ports` — so the very first run reported "listening port cannot be
determined" for both applications. It now merges one level into `environment`, the way compose itself layers.

**Two probes were run against the real script, not only the evaluator**, because a pure function can be driven into any
state and that is also its weakness — it never proves the *collector* reads the right things:

| Probe on the real repository | Result |
|---|---|
| `infra/grafana` moved aside in its entirety — the exact pre-slice state | **exit 1, 6 problems**: all three mount sources named, plus "Prometheus configuration missing", "no datasource provisioned", "no dashboard found" |
| an nginx `location = /metrics { proxy_pass … }` added | **exit 1**, naming the location and why the network is the control |
| restored, clean | **exit 0** — 8/8 mount sources, 3 scrape jobs, 4 dashboard queries against 29 registered metrics |

**Executed in both directions.** Beyond those, the evidence is the pure evaluator driven with input known to be wrong:

| Probe | Result |
|---|---|
| the **pre-slice state** — obs profile declared, its 3 mount sources absent | **fails**, naming all three |
| a scrape target naming a host that is not a compose service | **fails** |
| a scrape target on a port the service does not listen on | **fails**, naming the real port |
| a scrape job with no target at all | **fails** |
| an empty `scrape_configs` | **fails** — an empty config is not a pass |
| the API not serving the scraped path *(PF-62's shape)* | **fails**, and says why it is PF-62's shape |
| the worker serving metrics on a different path | **fails** |
| a dashboard panel querying a metric nothing registers | **fails** — "No data" for ever is indistinguishable from a quiet system |
| a panel pointing at an unprovisioned datasource uid | **fails** |
| a datasource step disagreeing with the scrape interval | **fails** |
| a datasource url naming a non-service host | **fails** |
| an nginx `location` publishing `/metrics` | **fails** |
| build output / route baseline / worker path unreadable | **fails, three separate paths — never a skip** |

The guard spec was exercised in the negative too, not merely written: replacing the stage with `true` in **both**
`ci-gate.sh` and `ci.yml` makes it **2 failed / 31 passed**, one per disconnected file. Restored, `git diff` clean.

**Metric names are read from the built registries** via `getMetricsAsJSON()`, not from a regex over the registry
source — R-26 rule (a), and the reason run 10's JSONC-by-regex nearly passed vacuously.

**Not claimed, and the residual is most of the finding.** This does **not** start Prometheus and watch a scrape
succeed: that needs `docker compose --profile obs up`, which the routine forbids, and a running api and worker to
scrape. The profile is therefore proven **coherent and complete**, not **ingesting** — the endpoints are proven to
serve (the worker's over a real socket), but the hop between Prometheus and them is configuration this gate reads
rather than traffic it observes. **Traces remain unimplemented**: `OTEL_EXPORTER_OTLP_ENDPOINT` and a `jaeger` service
are declared and `grep -rniE 'opentelemetry|otel' apps/*/src` returns **0 hits** — recorded as `PF-78` rather than
half-built. **Queue depth, failure rate and DLQ are not exposed.** **No alert rule or SLO threshold is defined**, which
is deliberate: what counts as "good" is a product decision, and inventing thresholds would be the same failure as
inventing policy text (R-13). `apps/web` exposes no metrics. The restore third stays blocked on **D-01**, so `PF-56` is
`in-progress`, not `closed`.

**And one half of the exposure argument is enforced while the other is convention — the distinction matters more than
the conclusion.** The gate proves nginx does not publish `/metrics`. It cannot prove the API's own published port is
loopback-bound: that lives in `.env.prod` (`API_PORT`), outside the repository. `docker-compose.prod.yml`'s header
states the convention — *"the 127.0.0.1-bound `*_PORT` values, so no infra port is exposed publicly"* — and nothing
reads it, which is `R-26`'s shape at an address this slice does **not** close. What would leak if the convention lapsed
is bounded by construction and tested: route templates, request counts, latencies and process stats; no identifier, no
connection string.

**A routine-level defect was found by living through it — `PF-77` / `R-27`.** The `write.lock` acquired at the start of
this run was reaped as stale by a **second V3 tick at 21:09**, because Step 4 asks for a heartbeat around the build and
nothing asks for one during Step 3, which has run over an hour in every run since run 9. For half an hour this run was
writing to the checkout holding no lock. Re-acquiring the gate to recover made it worse: the salvage path `git stash`ed
every tracked modification and reset the branch to `origin/main`. The slice survived only because that salvage exists.

## Next slice

Six blind spots this epic knew about are now closed or advanced: the lint gate executes, something boots the
applications, the release gate covers the whole deployment, the web build is inspected, the declared runtime is
checked, and the observability profile can now start and is held to being coherent. What is left, in order:

1. **`PF-63`/`PF-65`** — 12 of the 18 baselined failures sit on the analytics/snapshot path (`V3-E03`), which is the
   epic that owns `PF-04`'s cross-portal count contradiction. Those red tests are very likely *already describing*
   that bug. **Note the sequencing constraint:** `V3-E03` depends on `E01`, `E04` and `E05`, all open, so this is not
   selectable under the roadmap's layer rule until they close — it is listed here because the triage is cheap and
   would inform E03, not because it can be picked next.
2. **`PF-78`** — tracing. The collector (`jaeger`) and the exporter endpoint are declared in the compose file and **no
   application emits a span**. This is the trace third of `PF-56`, separated by `S-E02-13` rather than half-built,
   because instrumenting three applications is its own slice. It is unblocked, and it is the natural continuation:
   `S-E02-13` proved the profile can start, and a Jaeger with nothing in it is the same "configuration present,
   nothing proven" state the metrics half just left.
3. **`PF-56`'s remaining thirds** — queue depth / failure / DLQ metrics (needs BullMQ processors instrumented one by
   one), alert rules and SLO thresholds (**a product decision, not a build** — what counts as "good" cannot be
   invented by the routine any more than legal text can, R-13), and the restore drill, which stays blocked on
   **D-01**.

**A routine-level item that outranks all of the above, and is not this repository's to fix.** `PF-77` / `R-27`: the
single-writer lock expires during Step 3 and a concurrent tick reaps it. It was observed causing a working-tree reset
on run 15. Until the routine heartbeats during implementation, every long run is exposed, and the failure is silent
until `heartbeat` prints `no lock held` — by which point another run may already have written. The fix lives in
`~/.claude/scheduled-tasks/`, outside this checkout, so it is an operator action.

With that, `V3-E02`'s unblocked code work is `PF-78`; `S-E02-1`'s residual, `S-E02-5` and `S-E02-3` all need an
operator or **D-01**. The alternative under the selection rule is to let it move to **`V3-E06`** (production hygiene —
independent of everything, per `dependency-map.md` §3), whose first unblocked story is `S-E06-1` (`PF-17`/`PF-54`,
Maildev and seed leakage plus hard-coded credentials). `S-E06-4`'s content half stays blocked on **D-08**.
