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

## Next slice

The lint blind spot is closed. What is left in this epic, in order:

0. **`PF-71` — ratchet the 996 warnings down.** The pattern already exists in this repo: `scripts/test-ratchet.js`
   tolerates a baselined set and blocks any increase. A `--max-warnings` ceiling per package that only ever decreases
   would do the same for lint. **952 of the 996 are `--fix`-able**, so the first cut is nearly free — but it touches a
   very large number of files, which is why it is its own slice and not a tail on `S-E02-7`.

Two follow-ons from run 5 remain, both still open:

1. **`PF-63`/`PF-65`** — 12 of the 18 baselined failures sit on the analytics/snapshot path (`V3-E03`), which is the
   epic that owns `PF-04`'s cross-portal count contradiction. Those red tests are very likely *already describing*
   that bug. Triaging them may be the cheapest entry into E03 that exists.
2. **`PF-67`** — module-wiring guards assert on source text, so they cannot catch a controller that is registered but
   fails DI at boot. `PF-62` was caught only because the deletion was textual.
