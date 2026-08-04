# V3-E02 — Versioned database lifecycle and release integrity

**Layer** L0 · **Closes** PF-03, PF-55, PF-56, VAL-01, VAL-03, VAL-10 (+ PF-58, PF-59, PF-60, PF-61 discovered in flight)
**Spec** the story contracts in `docs/daily-improvement-v3/stories/sprint-01.md` are the spec-kit for this epic.
**Status (2026-08-04, after `S-E02-15`)** `code-complete` — **not `shipped`**, deliberately. Every story that can be
built from this checkout is done: `S-E02-15` was the last enumerated slice, and the three rows that are not ✅ cannot be
closed by code at all — `S-E02-1`'s residual and `S-E02-5` need hosted credentials and an operator, `S-E02-3` is blocked
on decision **D-01**. Recording this as `shipped` would claim the operator half was delivered, which is the exact
overstatement this epic exists to end. **Next selectable work is in another epic** → `V3-E06`, story `S-E06-1`
(see [Next slice](#next-slice)).

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
| **S-E02-14** | The trace pipeline stops being a dead address: spans are emitted, and the gate runs the thing | ✅ done | 2026-08-04 | 17/17 tracing + 21/21 gate guard (112/112 across `src/shared/quality`); **api 2 spans, worker 2 spans** from a real request against the **built** `dist/`, where the number was 0 in all three applications before; the collector declaration measured at **five** services, not the three the finding named; 3 negative paths driven through the real script |
| **S-E02-15** | `apps/web` becomes the third observed artefact: metrics on its own socket, spans through the one redacting exporter | ✅ done | 2026-08-04 | **41/41** new web-observability guard + 40/40 tracing guard + 42/42 observability guard (**218/218** across 8 suites in `src/shared/quality`, was 124 — the sprint predicted 213; 218 is what the routine actually executed, and the difference is the runtime-guard-form test added when the build failed). Whole gate: **`GATE: PASS`, 12/12, exit 0**, after a first run of **`GATE: FAIL (3 stages)`** — build, web artefact, and `test:api (ratchet)`; see "What running it found" below. The gap measured first — `grep -rniE 'prom-client\|opentelemetry\|/metrics' apps/web/src` returned **0 hits** while `observability-check.js` exited **0** on that exact state; the probe yields **1 span** and a histogram **sample** labelled `route="/parent/students/[id]/grades"`, with the cuid and `tenantId` absent from both the exported payload and the exposition; 11 negative directions driven through the two pure evaluators; the anti-drift guard exercised in the negative (**4 failures** with both stages replaced by `true`, clean on restore) |

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

## S-E02-14 — the traces third: emitted, redacted, and proven by running it

`S-E02-13` deliberately left tracing out rather than half-build it, and recorded it as `PF-78`. Step 2 confirmed the
finding reproduced exactly — a case-insensitive grep for `opentelemetry|otel` across all three applications' source
returned **0 files** — and then found it **wider than recorded**.

**The declaration reached five services, not three.** `OTEL_EXPORTER_OTLP_ENDPOINT` sat on the compose file's shared
`x-app-env` anchor, which is consumed by `migrator`, `api`, `worker`, `web` **and** `seed`. Two of those are one-shot
jobs and one is a Next.js application whose instrumentation is a different mechanism entirely. So the repository was
handing a collector address to three things that could never use it — PF-78 in miniature, three times over, inside the
defect itself.

### The load order is the whole risk, and it is invisible

OpenTelemetry's auto-instrumentation works by **monkey-patching modules as they are loaded**. An SDK started after
`require('./app.module')` finds `http`, `express` and `@nestjs/core` already resolved in the module cache: it patches
nothing, throws nothing, logs nothing, and the application boots looking fully instrumented while emitting no request
spans at all. Every gate in this epic would stay green.

That is not a hypothetical. **The gate's own emission probe reproduced it by accident:** its first version required
`node:http` at the top of the file, one line before `startTracing()`, and reported **0 spans** — while the identical
probe run under `tsx`, where the require came after, reported **2**. The first full gate run of this slice therefore
came back `TRACING CHECK: FAIL`, naming both applications, and it was right to.

So `scripts/tracing-check.js` reads the order off the **emitted `main.js`**, not the source — R-26 rule (a), the same
discipline as `tsc --showConfig` in `boot-gate.spec.ts` — and then does the thing no previous instance of R-26 could:
it **runs the application code**, spawning a child Node process per app that serves a real request over a real socket
and fails if no span comes out. An order assertion can be satisfied while emission is broken for some other reason;
asserting the outcome as well as the condition is what makes the difference.

**Why not a jest test — measured, not assumed.** It was written as one first, on a real socket, mirroring
`metrics-server.spec.ts`. It produced **0 spans**. Jest does not use Node's module registry, so
`require-in-the-middle` never fires and every instrumentation silently patches nothing. Same class as `jose` under
ts-jest (`PF-67`), same answer as `S-E02-9`: run it outside jest, against `dist/`, which is also what ships.

### G-TENANT: redaction at the exporter, in one copy

Jaeger is unauthenticated by construction — its access control **is** the docker network — so the payload has to be
safe on its own terms, exactly as `/metrics` does. Three placements were possible and two are traps: configuring each
instrumentation is precise and unreliable (a version bump adds an attribute and the omission is silent), and a
`SpanProcessor.onEnd` sees read-only attributes. The **exporter** is the one point every span passes regardless of
which instrumentation produced it, including one added next year by someone who never reads this file.

The policy lives once, in `packages/contracts/src/observability/`, imported by both applications — because two copies
means one of them can forget `db.statement`, and ioredis writes Redis commands **with their arguments** into it, keys
that carry tenant and user ids. Measured on the built artefacts: `url.path` arrives as `/api/v1/students/:id` and
`?tenantId=demo` is gone.

### Not claimed

It does **not** start Jaeger and watch a span arrive — that needs `docker compose --profile obs up`, which the routine
forbids. The pipeline is proven to **emit and redact**, not to be **ingested**. Prisma is deliberately uninstrumented:
its instrumentation needs `previewFeatures = ["tracing"]` in `schema.prisma`, dragging G-MIGRATION into a slice that
does not need it. There is no official BullMQ instrumentation, so job processing is untraced. And `apps/web` emits
nothing at all — `OTEL_EXPORTER_OTLP_ENDPOINT` was **removed** from it rather than left as a false claim, and that
removal is recorded as **`PF-79`** so it is not misread as coverage.

## S-E02-15 — the third artefact stops being the unobserved one

`S-E02-13` gave metrics to the API and the worker. `S-E02-14` gave them traces, and — correctly — **removed**
`OTEL_EXPORTER_OTLP_ENDPOINT` from the `web` service rather than leave a collector declared to an application that
could never reach it. That left one honest hole, recorded as `PF-79`: **the artefact users actually touch was the
only one no observability surface covered.** A slow or failing page was invisible to Prometheus and to Jaeger while
both Nest applications were visible to both.

### The gap, measured before anything was written

| Probe (pre-slice) | Result |
|---|---|
| `grep -rniE 'prom-client\|opentelemetry\|/metrics' apps/web/src` | **0 hits** (exit 1) |
| `node scripts/observability-check.js` | **exit 0** — the gate was green on the state `PF-79` describes |
| `node -e "…require('./packages/contracts/dist').TRACED_SERVICES"` | `["api","worker"]` |

The second line is the one that matters. Two artefacts were observed, one was not, and *nothing said so*. This epic
keeps finding the same shape — a declared capability nothing reads — and this run found it in the gate's own blind
spot rather than in a config file.

### Four decisions, and why each is the way it is

**1. A separate `node:http` socket, never a Next route.** `infra/nginx/conf.d/pilotage.conf` `location /` proxies
**everything** unmatched to the web upstream. An `app/metrics/route.ts` would therefore be published on the public
internet the day it was added — and the observability gate's exposure rule, which inspects nginx `location` blocks,
would **not** notice, because nothing in nginx would have changed. So the exposition lives on its own internal
listener (the precedent is `apps/worker/src/shared/release/version-server.ts`, whose access control *is* the docker
network), and a new gate assertion fails if the metrics path ever appears in `scripts/web-route-baseline.json`.

The socket gets **no `ports:` entry at all** — unlike the worker's, which the release gate must reach from the host.
Nothing published is strictly better than the loopback-binding *convention* `S-E02-13` recorded as unenforceable, and
unlike a convention it is checkable. Prometheus reaches it by compose service name on the `pilotage` network. Host
port 3001 is in any case already taken by `grafana` under the same `obs` profile.

**2. Plain CommonJS, deliberately.** `apps/web/src/observability/web-observability.js` is not TypeScript, and that is
load-bearing rather than a style lapse. `apps/web` has **no jest project** and **no `dist/`**: its only compiler is a
`next build` that takes over nine minutes and that the routine may run **once** per run. A TypeScript module here
would have been executable by nothing else — and an observability implementation nobody can execute while writing it
is the exact defect this epic exists to end. A plain module is `require`-able by the three consumers that matter:
Next's webpack build (through `instrumentation.ts`), the guard specs hosted in `apps/api`, and the gate's child-process
probe. A hand-written `web-observability.d.ts` keeps `instrumentation.ts` type-checking. This is the same reasoning
that makes `scripts/*.js` plain CJS.

**3. The metrics are derived from the span pipeline — and the provider therefore starts unconditionally.** Next
exposes no server middleware to hang a stopwatch on; its built-in OpenTelemetry instrumentation is the only
measurement point available. So a `SpanProcessor.onEnd` feeds the histogram and the counter: one measurement source,
two sinks. The consequence had to be implemented deliberately and is a **divergence from the api/worker posture**,
stated out loud in the module header: there, declaring `OTEL_EXPORTER_OTLP_ENDPOINT` *is* the switch for the whole
SDK; here the SDK is also the instrument, so the provider and the metrics processor start **always**, and only the
redacting OTLP batch exporter is added when a collector is declared. Without that, the default compose stack
(`OTEL_EXPORTER_OTLP_ENDPOINT: ${…:-}`, i.e. empty) would publish a histogram nothing ever fed — `PF-79` in a new hat.

A second consequence, recorded rather than discovered later: **`OTEL_TRACES_SAMPLER_ARG` is not honoured on web.**
Head sampling at the root would discard spans *before* the metrics processor and silently bias the p95 latency by an
unknown factor. Between cheaper traces and a wrong measurement that says nothing about being wrong, this epic has
already chosen.

**4. Identical metric names, and the dashboard had to change with them.** `pilotage_http_request_duration_seconds`
and `pilotage_http_requests_total` are registered with the same names and the same buckets as the API, distinguished
only by `registry.setDefaultLabels({ app: 'web' })`. A `pilotage_web_*` prefix would have forked every panel and made
the only question worth asking in an incident — *is it the page or the API that is slow?* — unanswerable.

But panels 1–3 of `pilotage-slo.json` aggregated `sum by (route)` / `sum by (le, route)` with **no `app` dimension**.
The moment a third registry published those names, the API's series and Next's SSR series would have blended into one
line and the 5xx ratio would have averaged two artefacts — green, silent, wrong, which is this epic's signature
failure at one more address. Every HTTP grouping now carries `app`, and a guard-spec case parses the shipped JSON and
fails if any `by (...)` clause loses it.

### G-TENANT holds on **two** unauthenticated surfaces, not one

The trace half reuses `withRedaction` from `@pilotage/contracts` verbatim — a guard spec greps the module for it and
fails if the file defines its own `sanitize*`/`redact*`, because a second copy that forgets `db.statement` is the leak
`S-E02-14` centralised the policy to prevent. `packages/contracts` stays pure: no `@opentelemetry/*`, no `prom-client`,
no `node:*`, because that package is imported by **client** bundles of `apps/web`.

The metrics half needed its own control, and this is the sharp part. **A span processor sees attributes *before* the
exporter redaction runs.** Whatever becomes a Prometheus label goes out verbatim, on an endpoint that carries no
token. So `routeLabelFromSpan` reads **only** template-shaped attributes (`next.route`, then `http.route`) and never
`http.target`, `http.url` or `url.path`, falling back to a single `<unmatched>` series. Driven with input known to be
wrong: a span carrying *only* a resolved URL with a cuid and `?tenantId=demo` yields `<unmatched>`; 500 distinct
unmatched URLs yield exactly **one** series, so a scanner cannot exhaust the container's memory through the registry;
and the exposition after those 500 spans contains neither the cuid nor `tenantId`.

### What was executed

- **`node scripts/web-observability-probe.js` → exit 0**, `PROBE_RESULT` with `spans: 1`. It requires the plain module
  directly, so it runs with **no build** — which is what made it usable while writing the code. It starts the real
  provider with an injected in-memory exporter, binds the metrics socket on port 0, issues a real `GET /metrics` over
  a real socket, ends a Next-shaped SERVER span carrying an identifier in **both** places one can leak from, and
  re-scrapes. Result: the exported span name reduced to `GET /parent/students/:id/grades`, `http.target`/`http.url`/
  `url.path` all templated, the query string gone; and the exposition carrying
  `pilotage_http_requests_total{method="GET",route="/parent/students/[id]/grades",status_code="200",app="web"} 1`.
- **A real socket in jest**: 200 with `content-type` equal to `PROMETHEUS_CONTENT_TYPE` and `cache-control: no-store`;
  `process_resident_memory_bytes`, `nodejs_eventloop_lag_p99_seconds` and both HTTP metrics present; 404 on an unknown
  path and on a non-GET method; **500 — with the process alive** — when the registry's `metrics()` rejects.
- **`register()` really transpiled and really invoked**, not read. On `NEXT_RUNTIME='edge'` and with the variable
  unset it loads **nothing** (asserted by a `require` that throws if called — `apps/web/src/middleware.ts` makes the
  edge runtime real); on `'nodejs'` it starts both; with the implementation module throwing on import, with the SDK
  throwing, and with the socket bind rejecting, it **resolves** every time. A throw out of `register()` is fatal to
  Next's bootstrap, which would make an optional side-car a boot dependency of the only user-facing artefact.
- **11 negative directions through the two pure evaluators**: web traced but handed no endpoint; the endpoint put back
  on the shared `x-app-env` anchor → fails naming `migrator` **and** `seed`; the emitted bundle absent from both
  candidate paths; present but empty; present without the metric names; the histogram registered but never observed;
  a sample labelled with a resolved URL; `tenantId` in the exposition; the probe unrun, at zero spans, and hung;
  `TRACED_SERVICES` naming an artefact the gate does not know. Plus, on the observability side: a `web` target on a
  port the service declares nowhere (naming `3000, 3001`); a scraped path that is not the served one; the path present
  in the Next route inventory (failing with the `location /` reasoning); the inventory unreadable; a scrape job for a
  host the gate knows no artefact for.
- **The anti-drift guard exercised in the negative**: both stages replaced by `true` in `scripts/ci-gate.sh` **and**
  `.github/workflows/ci.yml` → **4 failures** across the three guard specs; restored, and `git diff` shows only the
  intended comment and stage-label changes.
- **Gate stages run here**: `pnpm --filter @pilotage/web lint` → 0 errors, **34 warnings = the ceiling exactly**;
  `node scripts/lint-ratchet.js` → **no drift**, all eight ceilings unchanged (two self-inflicted warnings in the new
  spec were removed rather than absorbed by raising a ceiling — that is the move the ratchet exists to refuse);
  `tsc --noEmit` clean for `apps/api`, `apps/web` and `packages/contracts`; `node scripts/web-artifact-check.js` →
  **108 routes unchanged** (admin 50 · teacher 22 · parent 24 · student 6 · shared 6), baseline **not edited**;
  `node scripts/observability-check.js` → **exit 0** with the third scrape job and the third registry;
  `pnpm install` run and `pnpm-lock.yaml` committed — the versions are read from the installed tree and are byte-equal
  to the API's, because two OpenTelemetry majors in one workspace is a silent breakage (E11-S1's RED gate was exactly
  a dependency set declared and never installed).

### The two escape-by-omission traps that had to be closed first

Neither is cosmetic; both would have made the new scrape job pass **vacuously**.

1. **`serviceListenPort()` read `['PORT', 'WORKER_HTTP_PORT']` and returned one answer.** `web` sets `PORT: "3000"`,
   so a correct `web:3001` target was rejected with *"service web listens on 3000"* — and the path of least resistance
   from there is to retarget `web:3000/metrics`, i.e. to turn the socket into a published Next route. A gate must not
   push anyone towards the leak it exists to prevent. There is now a plural `serviceListenPorts()`; the singular is
   kept, exported and used for the datasource check, and a spec asserts the api/worker resolutions are **unchanged**.
2. **`scrapePathProblem()` returned `null` — i.e. *pass* — for every host that was not `api` or `worker`.** Adding a
   `pilotage-web` job would have satisfied check 4 without checking anything. It now has a `web` branch **and** the
   default is a problem. This is the same rule `S-E02-9`, `-11` and `-12` each had to add at their own address.

### Not claimed

Written before it is asked for, because a slice in this epic that overstates is worse than one that ships less.

- **Nothing was ingested.** Prometheus, Jaeger and Grafana were not started — the routine forbids
  `docker compose --profile obs up`. The web artefact is proven to **serve** metrics and to **redact** spans; the hop
  from the socket to a scrape, and from the exporter to a collector, is configuration these scripts read, not traffic
  they observe.
- **Next itself was not booted.** A booted Next needs a database and a Keycloak session. That Next **emits** the
  server spans this design measures is inferred from its built-in OpenTelemetry support, not executed. What *is*
  executed is that the module measures, serves and redacts, and what is *asserted about the artefact* is that the hook
  was emitted and carries the registered metric names — the closest honest substitute available under one build slot.
- **The metric names are read from source, not from a build output.** `apps/web` has no `dist/`, which is precisely
  why the module is plain CommonJS and ships verbatim; the emitted half is covered by `tracing-check.js` reading
  `.next/server/instrumentation.js` (or `.next/server/src/…` — this app has a `src` directory, which is why its
  emitted middleware landed under `src/`) and asserting those same names appear in it **or in the async chunks emitted
  beside it**. That widening is not laxity, it is the shape webpack produces: the hook must reach its implementation
  through `await import()` (a static import would be *resolved* for the edge runtime, where `node:http` and
  `prom-client` do not exist), and webpack emits every dynamic import as a separate async chunk under
  `.next/server/chunks/`. Asserting the markers in the entry alone would have required Next to do the opposite of what
  it does — the gate would have gone red on a correct artefact, and a gate that cries false ends up disabled. What is
  **not** widened is the entry's own share of the proof: it must still have been emitted and must still be non-empty,
  because a hollow `register()` is a failure whatever sits beside it (three spec cases pin all three rules).
- **This slice's `tracing-check.js` is red until the contracts package is rebuilt.** `TRACED_SERVICES` is read from
  `packages/contracts/**dist**` (R-26 rule (a)), so the source change lands ahead of the build. Run against the tree
  as the agent left it, the script fails with *"service web is handed OTEL_EXPORTER_OTLP_ENDPOINT but is not in
  TRACED_SERVICES"* — a **true** failure with a misleading cause, which is why that message now names the stale-build
  possibility explicitly and says the fix is to rebuild, not to un-declare (a spec pins that wording). The orchestrator's
  single `pnpm build` resolves it; driven through the real machinery with the traced list forced to its post-build
  value, every check passes except the emitted bundle, which `next build` produces. Measured on the tree as it stands:
  `.next/server/instrumentation.js` does not exist yet (the `.next` present predates this slice) while
  `.next/server/chunks/` already holds 33 emitted fragments — which is exactly the split shape the chunk-aware read
  above exists for.
- **Span *events* are still not redacted.** `redactSpan` rewrites `name` and `attributes` only; `exception.message`
  and `exception.stacktrace` ride on events and reach an unauthenticated Jaeger untouched. On web this matters more
  than on the API, because SSR errors routinely embed the request URL. Recorded as a limitation, not fixed here —
  it belongs in `packages/contracts` and would change what api and worker export too.
- **`PF-56`'s remaining third is untouched**: queue depth, failure rate and DLQ are still unexposed. No alert rule and
  no SLO threshold was invented, because what counts as "good" is a product decision (R-13).
- **The loopback-binding convention for published ports still lives in `.env.prod`**, outside this repository, where
  nothing reads it. This slice sidesteps it for the web socket by publishing nothing at all, which is checkable; it
  does not fix it for the ports that are published.
- **No ADR.** The `node:http` sidecar reuses the worker's documented convention; the redaction placement was decided
  and documented by `S-E02-14`. The plain-CommonJS module is a scoped, justified exception recorded in the file header
  and here — the only candidate in this slice if the architect rules otherwise.
- **Blast radius**: no Prisma schema change, no migration, no new permission, no new endpoint on any portal, no
  `packages/ui` change, no user-visible UI, no second BullMQ queue. `apps/api` and `apps/worker` **runtime** code is
  untouched; the only api-side files are guard specs under `apps/api/src/shared/quality/`.

### What running it found — the first gate run was `FAIL (3 stages)`

The sprint returned `landed: true`. The routine's Step 4 ran the whole of `scripts/ci-gate.sh` anyway, and it came back
**`GATE: FAIL (3 stage(s))`**: `build`, `web artefact` (a consequence of `build`), and `test:api (ratchet)`. Recording
this is the point of R-23 — a run that cited only the stages it had already seen pass would have reported a green slice.

**1. `next build` failed with 16 `Module not found`, and the cause was the *shape* of a correct guard.**
Every error traced `./src/instrumentation.ts → ./src/observability/web-observability.js → prom-client`, unable to
resolve `fs`, `v8` or `cluster`. `apps/web/src/middleware.ts` exists, so Next compiles the instrumentation hook for the
**edge** runtime as well, and the hook's guard was an early `return`:

```ts
if (process.env.NEXT_RUNTIME !== 'nodejs') return;
await import('./observability/web-observability.js');   // still statically reachable
```

Semantically this is flawless, and both behavioural guard tests pass with it — on edge it loads nothing. But webpack
judges **reachability, not execution**. An early return is not a boundary it can see, so the `import()` remained
reachable from the entry and the edge compiler resolved `prom-client` against a runtime that has no node builtins.
`process.env.NEXT_RUNTIME` is substituted literally by Next's `DefinePlugin`, so only the block form turns the edge
branch into `if ('edge' === 'nodejs')` — which dead-code elimination removes along with its import. That is why Next
documents the block form, and this is the reason it documents it.

The correction is four lines. The lesson is not: **the form was load-bearing, correct-looking and read by nothing** —
`R-26`'s eighth instance, in a sub-shape none of the previous seven had, since here the *meaning* was right and only the
*shape* was wrong. It is now a test (`web-observability-gate.spec.ts`), proven in the negative against the real file:
the early-return form yields **1 failed / 40 passed**, naming the forbidden pattern.

**2. `test:api (ratchet)` reported 1 NEW test failure — a spec the sprint never ran.**
Widening `TRACED_SERVICES` from two entries to three broke `apps/api/src/shared/tracing/tracing.spec.ts`, which pinned
the old list. The sprint verified the specs it authored (`src/shared/quality`, green) and reported `landed: true`; a
shared-contract edit has a blast radius the editing agent cannot see from the directory it works in. Recorded as
**`PF-80`**, not absorbed. The assertion was updated to three **because the capability was added and is proven by
execution** — `tracing-check.js` requires a `web` probe emitting at least one span and fails in both directions on
compose/`TRACED_SERVICES` divergence — not to turn a red test green. `migrator` and `seed` stay out, which is the half
of that assertion that still bites.

**Second gate run: `GATE: PASS`, 12/12 stages, exit 0.** One build was spent on the failure and one on the fix, which is
the rebuild-once the routine allows.

## Next slice

> **Pointer, stated once and plainly.** The next slice is **not in this epic**. `S-E02-15` closed the last enumerated
> story; what remains here (`S-E02-1` residual, `S-E02-3`, `S-E02-5`) needs an operator or **D-01**, not a run. Under the
> roadmap's layer/dependency rule the next selectable story is **`S-E06-1`** in **`V3-E06` — production hygiene**
> (`PF-17`/`PF-54`: Maildev and seed leakage on the hosted deployment, plus hard-coded credentials). It is independent of
> everything per `dependency-map.md` §3, which is why it is selectable while `V3-E01`/`E03`/`E04`/`E05` are not.
> `V3-E03` is **not** selectable yet despite the tempting `PF-63`/`PF-65` triage below — it depends on `E01`, `E04` and
> `E05`, all open.

Eight blind spots this epic knew about are now closed or advanced: the lint gate executes, something boots the
applications, the release gate covers the whole deployment, the web build is inspected, the declared runtime is
checked, the observability profile can start and is held to being coherent, the trace pipeline emits, and — since
`S-E02-15` — **all three artefacts are observed, not two**. What is left, in order:

1. **`PF-63`/`PF-65`** — 12 of the 18 baselined failures sit on the analytics/snapshot path (`V3-E03`), which is the
   epic that owns `PF-04`'s cross-portal count contradiction. Those red tests are very likely *already describing*
   that bug. **Note the sequencing constraint:** `V3-E03` depends on `E01`, `E04` and `E05`, all open, so this is not
   selectable under the roadmap's layer rule until they close — it is listed here because the triage is cheap and
   would inform E03, not because it can be picked next.
2. ~~**`PF-79`** — `apps/web` is observed by nothing.~~ **Closed by `S-E02-15`** (2026-08-04). What it left behind,
   listed here rather than in a footnote because both are real: **span events are still unredacted** —
   `exception.message` / `exception.stacktrace` ride on events, which `redactSpan` does not rewrite, and SSR errors
   routinely embed the request URL; and **nothing was ingested** — no Prometheus, no Jaeger, no booted Next, so the
   three artefacts are proven to serve and to redact, not to be scraped. The event-redaction fix belongs in
   `packages/contracts` and would change what api and worker export too, so it is a slice of its own.
3. **`PF-56`'s remaining thirds** — queue depth / failure / DLQ, which is now a *tracing and* metrics gap: there is no
   official BullMQ instrumentation, so processors must be instrumented one by one and would need a manual span as
   well as a counter. Alert rules and SLO thresholds stay **a product decision, not a build** — what counts as "good"
   cannot be invented by the routine any more than legal text can (R-13). The restore drill stays blocked on **D-01**.
4. **Prisma tracing** — deliberately excluded from `S-E02-14` because `@prisma/instrumentation` requires
   `previewFeatures = ["tracing"]` in `schema.prisma` and a version matched to the client, i.e. a schema change and a
   `prisma generate`. That makes it a G-MIGRATION slice, and folding it into a slice that needed neither would have
   been the scope-widening this routine records rather than performs. Database latency is currently visible only as
   the inside of a request span.

**A routine-level item that outranks all of the above, and is not this repository's to fix.** `PF-77` / `R-27`: the
single-writer lock expires during Step 3 and a concurrent tick reaps it. It was observed causing a working-tree reset
on run 15. Until the routine heartbeats during implementation, every long run is exposed, and the failure is silent
until `heartbeat` prints `no lock held` — by which point another run may already have written. The fix lives in
`~/.claude/scheduled-tasks/`, outside this checkout, so it is an operator action.

With `PF-79` closed, `V3-E02` has **no unblocked code work left**: `S-E02-1`'s residual, `S-E02-5` and `S-E02-3` all need an
operator or **D-01**, and the two residuals `S-E02-15` recorded (span-event redaction, BullMQ queue metrics) are
follow-ups rather than open findings. The alternative under the selection rule is to let it move to **`V3-E06`** (production hygiene —
independent of everything, per `dependency-map.md` §3), whose first unblocked story is `S-E06-1` (`PF-17`/`PF-54`,
Maildev and seed leakage plus hard-coded credentials). `S-E06-4`'s content half stays blocked on **D-08**.
