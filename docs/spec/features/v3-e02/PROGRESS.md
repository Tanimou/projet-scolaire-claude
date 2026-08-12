# V3-E02 — Versioned database lifecycle and release integrity

**Layer** L0 · **Closes** PF-03, PF-55, PF-56, VAL-01, VAL-03, VAL-10 (+ PF-58, PF-59, PF-60, PF-61 discovered in flight)
**Spec** the story contracts in `docs/daily-improvement-v3/stories/sprint-01.md` are the spec-kit for this epic.
**Status (2026-08-12, after `TOOL-13`)** `code-complete` — still **not `shipped`**. `S-E02-3`, `S-E02-5`, `S-E02-17`,
`S-E02-18` and `S-E02-19` are all ✅ done. `S-E02-18` closed the seven findings `S-E02-17` queued (`PF-104`…`PF-110`,
plus the `PF-112` register renumber): the gate that slice made blocking **can now fail**, its wiring is **executed** by
a test rather than asserted, and the dashboard stops under-reporting a stalled worker. `S-E02-19` then closed the
residual `S-E02-18` itself queued — `PF-114` (check 10 red on the idiom its own message recommends) and `PF-115` (a)(b)(c)
(two untested readers and a vacuous G-TENANT proof), all **inside the same blocking stage**. **`S-E02-19` queued two
residuals of its own, and both are fail-**open** rather than fail-closed** — `PF-116` (the replica shield accepts
`topk`/`bottomk`, which select series rather than collapse them) and `PF-117` (an unterminated quote blanks the rest of
the expression with no signal). Both were **flagged on `HEAD` and are silently accepted after this slice**, so this is
a narrowing of gate power, not a pre-existing hole; see the section at the bottom of this file. **`PF-56` does not close**:
the alert-rules / SLO-threshold half is a product decision. `S-E02-3` and `S-E02-5` were each executed against the
**local Docker stack**; `S-E02-5` never had a hosted half: it is a *repository*
invariant — the migration ledger reproduces `schema.prisma` — and the ledger row that called it "needs hosted access"
was stale (see the re-scoping note in the slice table). **`S-E02-1`'s residual is the only open row**, and it is
genuinely hosted: it needs hosted credentials and an operator. Recording this epic as `shipped` would claim that
operator half was delivered, which is the exact overstatement this epic exists to end.
**The epic also carries a gate-hardening track** — `TOOL-06`/`TOOL-07`/`TOOL-08` (run 43), `TOOL-10` (run 44, the drift
check's TCP preflight and the ratchet's honest kill message) and now **`TOOL-13`** (run 45, the ratchet stops calling a
suite that stopped executing "green", batching `TOOL-16(a)`, `TOOL-11` and `TOOL-12`). Those slices repair the machinery
this epic built rather than extending it, so they move the epic's *reliability*, never its status: `code-complete` is
unchanged and `PF-111` / `PF-113` are still its two residuals. **One thing `TOOL-13` leaves for an operator, and it is
not a detail:** the skip ratchet ships **disarmed** — `apps.<app>.skipped` is absent from `known-test-failures.json` on
purpose, because a baseline may only be written from a complete run and this slice was forbidden to produce one
(`TOOL-16(b)`). Until someone runs `node scripts/test-ratchet.js api --update` (and `worker`) from a complete run, the
new half of the gate announces itself `INACTIVE` and qualifies its own verdict line rather than pretending to be armed.

> ### ⚠️ The paragraph this replaced was wrong on one point, and it is worth saying which
>
> It read: *"`S-E02-3` is blocked on decision **D-01**"* and *"next selectable work is in another epic → `V3-E06`"*.
> Both were stale by 2026-08-06. **D-01 asks when the HOSTED deployment may be taken down** —
> `pilotage.srv861861.hstgr.cloud` is an **audit fixture**, not a production system — and the drill's target is the
> local Docker stack, whose data is expendable. D-01 gated nothing here. `open-decisions.md` D-01 and the
> [Next slice](#next-slice) pointer were corrected earlier in run 19; this header was not, so the file contradicted
> itself for one run. `docs/daily-improvement-v3/stories/sprint-01.md` §`S-E02-3` still carries a literal
> *"STOP condition … the routine must not start this story"*: it is stale for the same reason, and it is left in place
> rather than rewritten, because the sprint file is the historical record of what was believed at the time.

> **Why there is no `spec.md` here.** The V3 stories are authored pre-sliced with acceptance criteria, a stated test
> and an explicit out-of-scope list — they already carry what a `spec.md` + `tasks.md` pair would. Spending a run on
> `epic-spec` while a P0 (`PF-03`) was open would have been ceremony. This file is the epic's status ledger.

## Slice status

| Story | Title | State | Run | Evidence |
|---|---|---|---|---|
| **S-E02-0** | Land the V3 substrate on `main` | ✅ done | 2026-08-02 | PR #170 → `81c6e15` |
| **S-E02-1** | Baseline migration; stop `db push`; preflight; schema manifest | 🟡 partial | 2026-08-02 | baseline applied to scratch DB, `migrate diff --exit-code` = 0, `migrate status` clean, entrypoint refusal exercised, 10/10 jest |
| **S-E02-2** | Make CI actually run | 🟢 done *(local gate)* | 2026-08-02 | suites executed for the first time — **568/588 passing**; 18 failures all baselined with owning finding ids; ratchet proven to block in **both** directions; **surfaced and fixed a live production P0 (`PF-62`)** |
| **S-E02-3** | Timed backup → restore rehearsal, **executed against the LOCAL Docker stack** | ✅ done | 2026-08-07 | 78/78 new guard (**328/328** across 10 suites in `src/shared/quality`, was 250/250 across 9). The drill was **run, not asserted**: `PASS`, exit 0, **55 base tables / 13 550 rows** dumped, restored into a scratch database and verified on row counts **and** per-table checksums **and** schema — dump **1242 ms**, restore **7488 ms**, verify **4001 ms**, total **22 737 ms**. Six verdicts driven against the real database: `row_count_divergence` and `checksum_divergence` by deliberate divergence, `unreachable_source`, `unbaselined_ledger`, `tooling_unavailable`, and `--update` **refusing** to write from a failed run |
| **S-E02-4** | Seed cannot run in production | ✅ done | 2026-08-03 | 34/34 jest; the guard was **executed** — all **7** seed scripts exit 1 `[refused-production]` under a production target *with the correct token*, and the allowed demo path crosses the guard and fails on the DB connection instead; `nest build` exit 0 |
| **S-E02-5** | The migration ledger must reproduce `schema.prisma` — and something says so *(row re-scoped 2026-08-07: it read "Reconcile source ↔ hosted schema drift · needs hosted access", which was **stale**. The slice is a **repository** invariant, proven against the LOCAL container; the hosted half belongs to S-E02-1's residual and stays open)* | ✅ done | 2026-08-07 | 94/94 new guard (**593/593** across 14 suites in `src/shared/quality`, was 499 across 13). The check was **run, not asserted**: `SCHEMA DRIFT CHECK: PASS`, exit 0, on the unmodified repository — a disposable scratch database created in `pilotage_postgres`, `0_baseline` applied into it, **55 base tables**, ledger row finished and not rolled back, `migrate diff` **exit 0 "No difference detected"**, scratch dropped, **≈17 s**. Four negative paths executed against the real database: a temp copy of the datamodel with one extra model → **exit 2, `[+] Added tables - DriftProbe`**; a temp migrations directory holding invalid SQL → `migrate deploy` **exit 1 (P3018)** → verdict `migrate_deploy_failed`; a dead address → **exit 1** naming all three routes (`prisma db execute`, host `psql`, `docker exec pilotage_postgres psql`); the same run with `SKIP_SCHEMA_DRIFT`/`ALLOW_SCHEMA_DRIFT`/`SCHEMA_DRIFT_CHECK=0`/`FORCE`/`CI=false`/`NODE_ENV=production` set, singly and together → **identical verdict**. Wired into `ci-gate.sh` (stage 0d) **and** `ci.yml` (`build` job); ships `ADR-027` |
| **S-E02-6** | Release manifest made real; deploy gate compares it | ✅ done | 2026-08-03 | 19/19 jest; the gate was **executed** — exit 1 against the live drifted API, exit 0 on a conforming manifest, exit 1 on all four bad verdicts *and* on a manifest lying `match`; `nest build` exit 0 |
| **S-E02-7** | The `lint` stage stops being fictional; `prisma/` enters both gates | ✅ done | 2026-08-03 | 26/26 jest; `pnpm lint --force` **13/13, 0 cached** (was 7 of 8 packages exiting 2); a deliberate error probe makes the stage exit 1 at package level *and* through turbo; `pnpm typecheck --force` 13/13 including `prisma/`; `pnpm build` exit 0 |
| **S-E02-8** | Warning count becomes a ratchet; first cut taken only where it is safe | ✅ done | 2026-08-03 | 20/20 jest (46/46 with `lint-gate.spec.ts`); **996 → 44** warnings; ratchet exercised in four directions (increase → 1, back under → 0, ceiling left high → 1, package absent → 1); the DI-breaking autofix measured on emitted JS and refused; `pnpm build` exit 0 |
| **S-E02-9** | Something starts the applications: module graph + booted route table | ✅ done | 2026-08-03 | 15/15 jest (61/61 across `src/shared/quality`); both apps construct (api 42 modules / 40 controllers / 228 routes, worker 23 modules); gate exits 1 on the R-24 DI break **and** on the PF-62 unmounted controller, naming all 13 lost routes; found and fixed `PF-72` (worker building to an empty `dist/` behind a green `pnpm build`) |
| **S-E02-10** | The release gate stops judging one third of the deployment | ✅ done | 2026-08-03 | 27/27 jest (19 surface + 8 worker socket; 38/38 with the comparator); the **previous** gate measured at **exit 0** on both halves of the finding, the new one at **exit 1**; 7 scenarios executed end to end; run against the live local stack: **4/4 failed**, honestly — those containers predate their manifests |
| **S-E02-11** | The web build enters a gate; the release manifest is held to being dynamic | ✅ done | 2026-08-03 | 12/12 jest (73/73 across `src/shared/quality`); the gap measured first — with `apps/web/.next` **deleted entirely**, `boot-check.js` returned **exit 0**; the new check exercised in **9 directions**, 1 pass and 8 distinct failures |
| **S-E02-12** | The declared runtime stops blessing a Node the API cannot boot on | ✅ done | 2026-08-03 | 18/18 jest (91/91 across `src/shared/quality`); run against the **unfixed** repo: `FAIL`, exit 1, naming **35** contradicting dependencies where the finding named one; the finding's own one-line fix measured **wrong in both directions**; 12 negative paths driven through the pure evaluator |
| **S-E02-13** | The observability profile stops being a claim | ✅ done | 2026-08-03 | 33/33 jest (124/124 across `src/shared/quality`) + 13/13 metrics + 6/6 on a **real worker socket**; the profile measured **unable to start** — all 3 of its bind-mount sources absent; the check run against that exact state **fails** naming all three |
| **S-E02-14** | The trace pipeline stops being a dead address: spans are emitted, and the gate runs the thing | ✅ done | 2026-08-04 | 17/17 tracing + 21/21 gate guard (112/112 across `src/shared/quality`); **api 2 spans, worker 2 spans** from a real request against the **built** `dist/`, where the number was 0 in all three applications before; the collector declaration measured at **five** services, not the three the finding named; 3 negative paths driven through the real script |
| **S-E02-17** | Job processing stops being invisible: BullMQ is instrumented, and a gate observes it | ✅ done | 2026-08-07 | **39/39** new worker observability tests (`queue-metrics.spec.ts` + the extended `metrics-server.spec.ts`) + **58/58** observability guard (was 42) + 15/15 API metrics including the D1 negative. Executed, not asserted: `prom-client@15.1.3` measured to **reject** on a throwing `collect()` (→ HTTP 500 through `version-server.ts`) and to **hang** on a never-settling one, and **both** shapes then driven through the real `node:http` socket → **200 with a body**, process series intact. Every negative shown able to fail: `jobLabel` made a pass-through turns T-SEC-1/T-SEC-2 **red**; the deadline removed makes both never-settling cases **time out**; check 9 removed turns **11/11** of its cases red. `readRegisteredQueues()` run against the real repository reads **3 registered queues** off the built modules' `BullQueue_*` provider tokens and the process **exits 0** — no Redis connection, no open handle. Ships **`ADR-028`** |
| **S-E02-18** | The queue gate can fail, its wiring is executed, and the dashboard stops under-reporting | ✅ done | 2026-08-08 | **53/53** worker observability (`queue-depth.collector.spec.ts` **new, 427 lines** + `queue-metrics.spec.ts`) + **71/71** api-side observability guard (`observability-gate.spec.ts`, +277 lines). `pnpm typecheck` **13/13, exit 0** — `@pilotage/api` and `@pilotage/worker` both **cache misses that executed** (the prior run's api verdict did not exist: turbo cancelled it); `git diff --check` exit 0. **`PF-106` closed by execution, not assertion**: C7/C9 call the three new `@OnWorkerEvent('stalled')` handlers **off the real processor prototypes** with a cuid jobId *and* a `{data:{tenantId}}` receiver, then assert the rendered exposition contains neither, with an anti-vacuity `sample(...) === 2` so it cannot pass on an implementation that recorded nothing; C11 reads `ObservabilityModule`'s **resolved** Nest `imports` metadata. **`PF-105` closed**: rule 6's `rendered` is now `pilotage_queue_depth` ∩ `pilotage_queue_jobs_total` (neither zero-seeded), driven from the collector's **own** resolved `self:paramtypes` — the independence is what turns `A ≡ A` into a comparison. **⚠️ `scripts/observability-check.js` exits 1 on this checkout** — `apps/worker/dist` still holds `S-E02-17`'s bytes (0 occurrences of `pilotage_queue_stalled_total`), so the gate's own green lines are evidence about the **previous** slice. **The PF-105 fix has never been executed against its own source.** Rebuild + re-run is the merge precondition; see the section below |
| **S-E02-15** | `apps/web` becomes the third observed artefact: metrics on its own socket, spans through the one redacting exporter | ✅ done | 2026-08-04 | **41/41** new web-observability guard + 40/40 tracing guard + 42/42 observability guard (**218/218** across 8 suites in `src/shared/quality`, was 124 — the sprint predicted 213; 218 is what the routine actually executed, and the difference is the runtime-guard-form test added when the build failed). Whole gate: **`GATE: PASS`, 12/12, exit 0**, after a first run of **`GATE: FAIL (3 stages)`** — build, web artefact, and `test:api (ratchet)`; see "What running it found" below. The gap measured first — `grep -rniE 'prom-client\|opentelemetry\|/metrics' apps/web/src` returned **0 hits** while `observability-check.js` exited **0** on that exact state; the probe yields **1 span** and a histogram **sample** labelled `route="/parent/students/[id]/grades"`, with the cuid and `tenantId` absent from both the exported payload and the exposition; 11 negative directions driven through the two pure evaluators; the anti-drift guard exercised in the negative (**4 failures** with both stages replaced by `true`, clean on restore) |
| **S-E02-19** | The observability gate stops false-redding, and its two new readers get coverage | ✅ done *(with two **open**, fail-**open** residuals — `PF-116`, `PF-117`)* | 2026-08-08 | **145/145** api-side observability guard (`observability-gate.spec.ts`, +493 lines, **33 new cases**) + **36/36** worker `queue-metrics.spec.ts`. `pnpm typecheck` **13/13**, `@pilotage/api` and `@pilotage/worker` **cache misses that executed**; `git diff --check` exit 0. `node scripts/observability-check.js` → **exit 0 / PASS**, *« 9 sum() aggregation(s) … read no gauge-typed metric family »*, 3/3 queues, `dist` present — so the green is **observed on this diff**, not inherited (the `S-E02-18` staleness caveat did not apply). `PF-114` reproduced verbatim on `HEAD` and closed: `sum by (queue) (max by (queue, state) (pilotage_queue_depth))` went PROBLEM → clean while `sum by (queue) (pilotage_queue_depth)` stayed PROBLEM. `PF-115` (a) closed by a 14-entry reason enum naming the file actually read (`queue-depth.collector.js`, not `queue-metrics.js`); (b) by the verified registry restore (`registryResidue`) — driven with the `finally` blanked → **exit 1 `INSTRUMENTATION UNREADABLE (registry-not-restored)`** enumerating all nine residues; (c) by driving the cuid through `observeJobStalled`'s one parameter, shown able to fail by mutating `queueLabel` to a pass-through. **⚠️ The shield introduced two fail-**open** regressions the escalation panel found and this land pass re-measured**: `topk`/`bottomk` and an unterminated quote are both **accepted now and were flagged on `HEAD`** — `PF-116`/`PF-117`, section below. Both latent in `pilotage-slo.json` today; neither is fixed here |
| **TOOL-06/07/08** | The merge gate stops gating; its meta-tests were reading the dead code | ✅ done | 2026-08-12 (run 43) | PR #223 → `545879f`. `run_stage` refuses a non-numeric timeout (exit 64); `csv escapers` executed for the **first time** since `#215` — 698 files across six roots, four sanctioned escapers. Block at the bottom of this file |
| **TOOL-10** | The drift check concludes "unreachable" in milliseconds; a killed ratchet stops reporting itself as a startup failure | ✅ done *(gate-hardening track; **two spec files typechecked but UNEXECUTED**)* | 2026-08-12 (run 44) | **Fail-before, measured on this worktree:** one unreachable-address `node scripts/schema-drift-check.js` **did not finish in 30 037 ms** (`SIGTERM`/`ETIMEDOUT`), and the whole `schema-drift-gate.spec.ts` **did not finish in 600 000 ms** when driven on `HEAD` — the story's `>30 037 ms` is confirmed and understated. Route C's `docker port pilotage_postgres 5432/tcp` measured **unbounded** (killed at 8 026 ms by the probe's own `spawnSync` timeout; bash-level `timeout` does **not** kill it — `ps -W` shows orphaned docker processes dated Aug 10). **Pass-after:** `DEAD_URL` → **519 ms**, exit **1**, `SCHEMA DRIFT CHECK: FAIL — tooling_unavailable`, output still naming `prisma db execute` / host `psql` / `docker exec pilotage_postgres`; the default `:5433` → **546 ms**, same verdict, same exit. **The verdict does not move** — that is the contract, and `scripts/ci-gate.sh` is **byte-identical** (`git diff --quiet` YES), so no stage bound went up. Both spec files under `--runInBand`: **17.5 s, 116 passed / 2 failed / 5 skipped**, the two failures **pre-existing** (`AC-5`, `AC-15` at `schema-drift-gate.spec.ts:721`, both asserting on `ci-gate.sh`, which this diff does not open). `pnpm typecheck` **13/13, 51.9 s**, `@pilotage/api` a real cache **miss**; `git diff --check` clean on unstaged, staged and `main...HEAD`. **⚠️ Those jest numbers come from a reviewer's own run, not from the gate**: the gate could not execute either spec (shell Node **v25.7.0** vs the **22.13.1** `.nvmrc` pin), and **no run has ever driven the ladder against a reachable PostgreSQL after the change** — see the `TOOL-10` block at the bottom of this file for why that is the one must-check |
| **TOOL-13** | A suite that stops existing must not read as green — the ratchet learns to count what did **not** execute | ✅ done *(gate-hardening track; the new half ships **disarmed**, by design — see the block at the bottom)* | 2026-08-12 (run 45) | **Fail-before, measured on this worktree:** the two spec files under `--runInBand` report `{"total":124,"passed":119,"failed":0,"pending":5}` — and `test-ratchet.js` on `HEAD` calls that **`✓ no drift.`**, including about *"the unmodified repository PASSES — the gate is not red on correct code"*, which had never executed on this machine. **Pass-after:** the same real report fed to the new core reduces to `skipped = {"src/shared/quality/schema-drift-gate.spec.ts": 5}` — the exact five — and a baseline two lower yields `{from:2,to:5}` → **exit 1**. **147 total / 142 passed / 0 failed / 5 pending**, wall **57 s**: `test-ratchet.spec.ts` **14 → 30** (the 14 byte-identical, the diff is 475/0 in one hunk after `:273`, AC-11) and `schema-drift-gate.spec.ts` **105 → 112**, its 5 pending unchanged because they are the story's *subject*. **`TOOL-12` non-vacuity, balanced against the shipped file:** `run('psql'` and `run(cli.command` are **1 site each at `HEAD`, neither carrying `timeoutMs`; 1 site each now, both carrying it** — genuinely red-before / green-after. **Typecheck, re-measured by the routine on the final rebased tree** (the sprint ledger credited this slice with a `13/13, exit 0, 5m34s` run that the test-architect had actually performed on the **docs-only** tree, before any implementation existed — that provenance is corrected here rather than inherited): `ci-gate.sh` stage **`✓ typecheck`**, with `@pilotage/api` and `@pilotage/web` both real cache **misses that executed**. `git diff --check` clean; **`scripts/ci-gate.sh` byte-identical** (AC-15). ⚠️ **`apps.<app>.skipped` is deliberately absent** — see the block at the bottom of this file; the gate prints `INACTIVE` and qualifies its verdict until an operator runs `--update` from a complete run ⚠️ **Gate verdict on this diff: `GATE: FAIL (1 stage(s))` — `test:api (ratchet)`, and NOT this diff.** Two runs of that one stage on this unchanged tree produced two DIFFERENT load failures — `audit-vocabulary-gate.spec.ts` on `__audit_write_probe.ts`, then `portal-landing-gate.spec.ts` on `__csv_escape_probe.tsx` — each a probe another spec wrote into the shared checkout and deleted mid-walk. Neither suite is in this diff; `audit-vocabulary-gate` passes **73/73 alone**. Recorded as **`TOOL-17`** (the measured mechanism behind `TOOL-16(b)`, and `TOOL-15` generalised). **The PR was left OPEN, not auto-merged.** Both reds were diagnosable only because `TOOL-16(a)` — batched into this very diff — prints jest own explanation |

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

---

## S-E02-3 — the restore stopped being a thing we assumed we could do

**Done 2026-08-07 (run 19).** `VAL-03`, risk `R-01`, gate `G-MIGRATION`. Target: the **local Docker stack**.

Every mitigation ever written for `R-01` — the safe migrator (`S-E02-1`), the baseline runbook, the drift measurement
(`S-E02-5`) — assumed that when something went wrong there was a backup to go back to. **Nothing in this repository had
ever executed a restore.** "We have `pg_dump`" is a claim about a backup strategy, not one, and claims nobody executed
were the largest category in the audit.

### What was executed, with the numbers

```
$ node scripts/restore-drill.js
  source     : 127.0.0.1:5433/pilotage as pilotage
  route      : docker exec pilotage_postgres
  scratch    : restore_drill_1786061599037

▶ source reachable — role pilotage (superuser=true, bypassrls=true)
▶ building the source manifest … 55 base tables, 13550 rows, ledger present
▶ dumping … 1242 ms
▶ restoring … 7488 ms
▶ verifying … 4001 ms — 55 base tables, 13550 rows
▶ scratch database "restore_drill_1786061599037" dropped

RESTORE DRILL: PASS — 55 tables, 13550 rows restored and verified row-count + checksum + schema
```

Exit 0. **55 base tables** (54 application tables + `_prisma_migrations`), **30 non-empty**, **13 550 rows**, from the
demo seed (tenant demo, school VOLTAIRE). Those durations are what `scripts/restore-drill-baseline.json` now records —
written by `--update` from a passing run, every entry carrying a written reason, **no placeholders**.

### The divergence paths were driven, not argued (AC-3)

Verification is its own phase taking two manifests, so a fault can be injected into the **scratch** database strictly
between restore and verify. Both directions were run against the real database:

| Injected into the scratch DB | Verdict | Exit | What it named |
|---|---|---|---|
| `DELETE FROM student … LIMIT 1` | `row_count_divergence` | 1 | `student — rowCount: source 2463, restored 2462`, plus the three tables the FK cascade reached (`enrollment`, `grade`, `guardianship`) — and each of their checksums |
| `UPDATE school SET name = name \|\| ' (drill mutation)' … LIMIT 1` | `checksum_divergence` | 1 | `school — checksum: source c70151c2…, restored 3d2862d3…` — **same row count**, which is exactly the divergence a counter-only check misses |

The seam that makes this reachable is `--inject-fault-sql`, and it is **not** a bypass: it is monotone in the failing
direction. It can make the drill fail; it can never make it pass, the verdict can never be `ok`, and such a run can
never write the baseline.

### It refuses to report a success it did not obtain (AC-4, DNC-08)

| Run | Verdict | Exit |
|---|---|---|
| `--source …/no_such_db` | `unreachable_source` | 1 |
| `--source …/postgres` (a database with no `_prisma_migrations`) | `unbaselined_ledger` | 1 |
| `--container pilotage_nope` | `tooling_unavailable` | 1, naming **both** routes it tried |
| `--update` from that failed run | *refused* — `refusing to write the baseline` | 1, and **no file was written** |

`grep -ic skip` over the unreachable run's whole output returns **0**. The `unbaselined_ledger` case is not
hypothetical: it is the state this exact database was in earlier in this run (`PF-03`, 52 tables, no ledger, 24 DDL
statements of drift).

### Two defects the first execution found in the drill itself

1. **`psql -A -t` renders an uncast boolean `t`/`f` and a `::text`-cast one `true`/`false`.** The first run reported
   `superuser=false` on a superuser role and `ledger ABSENT` on a database whose ledger was right there — i.e. it
   would have failed correctly-shaped databases and, worse, was reading its own inputs wrong in a way no assertion
   would have caught. Fixed with a helper that accepts both, and the reason is written next to it.
2. **CHECK constraints cannot be compared across two databases.** PostgreSQL names the implicit NOT NULL checks after
   object OIDs, which differ by construction, so including them in the schema manifest would have guaranteed a false
   divergence on every run — the kind that gets "fixed" by deleting the check. Only PK/UNIQUE/FK are compared, and
   the exclusion carries its reason.

### Decisions taken here rather than escalated

- **A duration outside tolerance is a WARN, not a failure.** These numbers are a laptop against a Docker volume under
  variable load. A timing flake that turned the drill red would train the operator to re-run until green, which is
  how a gate stops being read. Correctness diverging fails; slowness is reported. Stated in the script header and in
  the runbook so the concession is visible rather than discovered.
- **The manifest/dump race is closed at the acceptable floor, not the ideal.** A `pg_export_snapshot()` +
  `pg_dump --snapshot=…` needs a session held open across processes, which a script speaking through one short-lived
  `docker exec psql` per query cannot do. Instead the source manifest is **re-read after the dump** and any change is
  reported as its own verdict, `source_mutated_during_dump` — never as a data divergence, so the alert cron writing
  mid-dump can never be attributed to the restore.
- **The drill is deliberately NOT a `ci-gate.sh` stage** (ADR-025 D1). It needs a running Postgres; `ci-gate.sh`
  deliberately needs none. A stage that cannot run where the gate runs is either skipped — DNC-08, a success nobody
  obtained — or red every run and routed around (R-23). The guard spec asserts that absence **in the negative**, with
  the reason in the test name, so a future run does not "fix the missing stage".

### PF-84 cannot come back

The same file carries the `PF-84` guard: `.dockerignore` excluded `infra/docker`, so
`infra/docker/migrate-entrypoint.sh` was absent from **every** build of `Dockerfile.api` and the migrator exited 2
(`sh: can't open`) on every stack ever started — the safe migrator that replaced `prisma db push --accept-data-loss`
had never once run. The guard asserts the **general rule** — every `/app/…` path in a compose `command:`/`entrypoint:`
exists in the repository **and** survives `.dockerignore` — not "this literal string is absent". It parses all three
YAML forms (exec list, shell string, and the folded block `minio-init` uses), evaluates `.dockerignore` with
last-match-wins including `!` negation and `**` globs, **reads executable content only** (comments stripped, so the
five-line explanation that names `infra/docker` three times can neither break nor satisfy it — that is `PF-83`'s
lesson), and is **proven in the negative** on a synthetic pattern list, because a matcher that always returned false
would pass every positive assertion and cover nothing. **The guard never mutates `.dockerignore`** — it reads the file
as it stands and evaluates a synthetic pattern list for the negative case. (`.dockerignore` *is* edited by this slice:
the `infra/docker` line is removed and replaced by an eleven-line rationale naming `PF-84`. An earlier draft of this
paragraph said the file "was not touched by this slice", which was simply false, and is corrected here rather than
quietly deleted.)

### Not claimed

`R-01` stays **open**. The drill has run against the LOCAL seeded database; the hosted database is still un-baselined
and has never been dumped or restored. The runbook §7 states the nine things the drill does not prove — production
data volume, cross-machine restore, cross-PostgreSQL-version restore (the `md5(row::text)` checksum is comparable only
between two databases on the same server version and locale), PITR/WAL, retention, offsite copy, the hosted database,
the partial route-identity check, and that the drill is not a quiesce. `PF-86` (Compose resolving `.env` from `infra/`,
so `docker compose up -d` silently starts a portless stack) is **recorded here and in the runbook, not fixed** — fixing
Compose's env-file resolution is its own slice.

## Next slice

> ### ⚠️ SUPERSEDED 2026-08-06 (run 19) — this epic has unblocked work again
>
> **What changed.** The routine was retargeted at the **local Docker stack** (`SKILL.md` Step −1, landed as
> commit `99d7f1d` / PR [#187](https://github.com/Tanimou/projet-scolaire-claude/pull/187)). There is no production:
> `pilotage.srv861861.hstgr.cloud` is an audit fixture. Local data is expendable, and rebuilding or recreating local
> containers is permitted and expected.
>
> Every reason the pointer below gave for leaving this epic was a **hosted-access** reason, and hosted access was never
> the point:
> - **`S-E02-1` residual** — *"baselining the database is an operator action"*. Executed this run, locally: the local
>   database was reset, `docker compose … --profile app` ran the migrator, `0_baseline` applied, and
>   `migrate diff --from-url … --exit-code` returned **0, "No difference detected"**, 55 tables (54 + the ledger).
>   First time the baseline has been proven to *reproduce* `schema.prisma` on a real database rather than argued to.
> - **`S-E02-5` (source↔DB drift)** — measured locally for the first time (24 DDL statements: 5 enums, 2 tables,
>   columns/indexes/FKs on `import_batch`, `import_row`, `student`) and then **resolved by construction** by the reset.
>   The drift class is not closed — nothing yet *prevents* a `db push` database reappearing — but its local instance is.
> - **`S-E02-3` / `D-01`** — D-01 asks *"when may we take the hosted deployment down, and who signs off"*. That is a
>   question about a fixture. It does not gate a drill whose target is a local container, so **`S-E02-3` is the story
>   this run selected**.
>
> **And running the artefact found `PF-84`, which the pointer could not have known about:** the migrator that replaced
> `prisma db push --accept-data-loss` had **never been able to start** — `.dockerignore` excluded `infra/docker`, so its
> entrypoint was absent from every image ever built and the service exited 2 with *"can't open"*. This epic's central
> mechanism was inert for three days while the ledger recorded it as delivered. That is the strongest possible argument
> against the pointer's premise: an epic is not out of work because its stories are written down as done.
>
> *(Original pointer, retained because deleting it would hide why three runs routed away from this epic:*
> ~~The next slice is **not in this epic**. `S-E02-15` closed the last enumerated story; what remains here
> (`S-E02-1` residual, `S-E02-3`, `S-E02-5`) needs an operator or **D-01**, not a run. Under the roadmap's
> layer/dependency rule the next selectable story is **`S-E06-1`** in **`V3-E06` — production hygiene**.~~*)*
>
> `V3-E03` is still **not** selectable despite the tempting `PF-63`/`PF-65` triage below — it depends on `E01`, `E04`
> and `E05`, all open. That part of the pointer was, and remains, correct.

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
   cannot be invented by the routine any more than legal text can (R-13). *(The line that used to end this item —
   "the restore drill stays blocked on D-01" — is void: `S-E02-3` shipped 2026-08-07 against the local stack.)*
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

### The pointer, as of 2026-08-07 — **next slice → `S-E06-2`**, and this time the epic really is out of unblocked work

> **SUPERSEDED 2026-08-07 by `S-E02-5`, and for the second time in two runs by the same mistake.** This paragraph
> called `S-E02-5` a *hosted* half needing production credentials. It is not, and never was: the story is a
> **repository** invariant — the migration ledger reproduces `schema.prisma` — proven against the **local**
> `pilotage_postgres` container, exactly like `S-E02-3`. It shipped this run as `scripts/schema-drift-check.js`, wired
> into both harnesses, with `ADR-027`. What remains in `V3-E02` is **`S-E02-1`'s residual** alone. The lesson is now
> twice-recorded: *an epic is not out of work because a ledger row says a story needs an operator* — re-read the story
> before believing the pointer.

`S-E02-3` shipped this run, which was the last story here that a run could execute. What remains in `V3-E02` is
**`S-E02-1`'s residual** and **`S-E02-5`** — both the *hosted* half, both needing production credentials and an
operator, neither buildable from this checkout. So the epic stays **`code-complete`, not `shipped`**; recording it as
shipped would claim the operator half was delivered, which is the overstatement this epic exists to end. The two
residuals `S-E02-15` recorded (span-event redaction, BullMQ queue metrics) are follow-ups, not open findings.

**Next slice → `S-E06-2`** in **`V3-E06`** — enable CSP and sanitise branding injection (`PF-45`). `V3-E06` is
independent of everything (`dependency-map.md` §3) and its first story `S-E06-1` landed 2026-08-04, so `S-E06-2` is
the next unblocked story under the layer/dependency rule. `S-E06-4`'s content half stays blocked on **D-08**.

*(This paragraph previously read "`S-E02-1`'s residual, `S-E02-5` and `S-E02-3` all need an operator or **D-01**".
`S-E02-3` did not: D-01 is a question about a hosted audit fixture, and the drill's target is a local container. That
mis-read is what routed three runs away from this epic — see the SUPERSEDED note above.)*

---

## 2026-08-07 (run 20) — `S-E02-16`: the documented way to start the stack starts the documented stack

**The pointer above was wrong, and that is the first thing to record.** It said *"this time the epic really is out of
unblocked work"* and routed the next run to `V3-E06`. `PF-86` was sitting in this epic the whole time, marked `open`,
`V3-E02`, *"recorded, deliberately not fixed here"* — no blocker, no decision, no operator. The layer/dependency rule
selected it immediately on run 20. A finding parked with "deliberately not fixed here" is still open work; the pointer
counted it as absent because the previous run had *chosen* not to do it, which is not the same thing.

**And it was not the documentation defect it was filed as.** Step 2 measured the premise and re-scoped `PF-86` from
`TECH_DEBT` to `BROKEN_RUNTIME`. Inside `infra/docker-compose.yml` alone — no untracked file involved — `KC_HOSTNAME`
and `KEYCLOAK_PUBLIC_URL` hard-coded `http://localhost:8180` while `keycloak.ports` defaulted to `8080`. The api uses
`KEYCLOAK_PUBLIC_URL` as its **expected token issuer**. So on the documented path Keycloak published on 8080, announced
an issuer reachable on no port, the web sent the browser to 8080, and the api rejected every token that came back:
**login was broken by construction**, and looked fine only because one machine's gitignored `.env` said `8180` on a
code path where compose never read it.

**What landed.** Four corrections, because any one alone leaves the hole open (ADR-026):

1. Thirteen published host ports lose `${VAR:-…}` for `${VAR:?…}` — compose **refuses**, in the operator's terminal,
   naming the variable and `--env-file .env`. Same argument `S-E06-1` made about `?? 'admin'`: a default nobody wrote
   down *is* the defect, so the fix is a declaration, not a better default.
2. A host port is written **once**. Every browser-facing URL derives from the variable that publishes it. Rule 1 alone
   would still have shipped a wrong issuer at `KEYCLOAK_PORT=9999`.
3. Every profile activates its own dependencies — Compose refuses the *entire* project otherwise, it does not degrade.
4. `.env.example` stops describing a **third**, incompatible stack: it alone said 5432/8080 while `apps/api/.env.example`,
   the seed scripts, the restore runbook and the drill all said 5433/8180.

Plus `scripts/compose-invocation-check.js` as **stage 0c** of `ci-gate.sh` and a step of `ci.yml`, evaluating the
**parsed** compose file so a service added tomorrow inherits every rule, and executing `docker compose config` in both
directions where a docker binary exists.

**One finding discovered, by the gate, on its first execution.** `PF-89` — `--profile prod` alone was *also* an invalid
project (`service nginx depends on undefined service web`), confirmed live before the fix. Two of the file's five
profiles were unrunnable exactly as documented. Recorded separately from `PF-86` because it was found by an executed
gate rather than by reading: it is the evidence that rule C4 generalises rather than describing one mistake.

**The gate caught its own first defect.** Its very first run failed with `bad indentation of a mapping entry`: the `:?`
message this slice had just written contained a `": "`, which YAML reads as a mapping separator — the fix had broken
the file it was fixing, and the check said so before anything ran.

**Executed, not asserted.** Real script against the restored pre-slice file → exit 1, 4 problems, one per rule family;
restored → exit 0, `git diff` clean. Stage replaced with `true` in **both** wiring files → 2 failed / 32 passed.
Three live docker probes inside the script. And the stack was **recreated through the corrected command** and left
healthy: eight containers up on the ports the root `.env` declares, migrator idempotent, `/healthz` 200, web `/` 200,
and the running Keycloak reporting `issuer: http://localhost:8180/realms/pilotage-scolaire` — the port that is in fact
published.

### The pointer, as of 2026-08-07 (run 20) — **next slice → `S-E06-3`**

`V3-E02`'s open findings are now `PF-77` and `PF-80`, both of which live in the routine's own files
(`~/.claude/scheduled-tasks/…` and `bmad/workflows/sprint.workflow.js`) rather than in the product, plus `PF-82`
(V3-E06). `PF-63` and `PF-65` are red-spec findings owned by `V3-E03`, which is still blocked behind `V3-E01`/`E05`.

**Next slice → `S-E06-3`** in `V3-E06` — fix `/admin/classes/new` and add a route/link crawl gate (`PF-19`, `PF-39`).
`V3-E06` is independent of everything (`dependency-map.md` §3), `S-E06-1` and `S-E06-2` have both landed, and
`S-E06-3` has no `blockedBy`. `S-E06-4`'s content half stays blocked on **D-08**.

**Do not repeat this pointer's mistake:** before declaring an epic out of work, re-read its `open` findings in
`traceability-matrix.md` rather than its story list. `PF-86` had no story, which is exactly why the story list said the
epic was empty.

---

## 2026-08-07 — `S-E02-5`: the migration ledger must reproduce `schema.prisma`, and something now says so

**The pointer was wrong again, and in the same shape as last time.** Two consecutive runs read the slice table's
`S-E02-5` row — *"Reconcile source ↔ hosted schema drift · needs hosted access"* — and routed away from this epic on
the strength of it. The row was stale. Read the **story**, not the ledger row, and `S-E02-5` is a **repository**
invariant: *the migrations, applied to an empty database, must build the schema `schema.prisma` describes*. That needs
an empty PostgreSQL server, which the local stack and `ci.yml`'s build job both already have. No hosted credential, no
operator, no decision. The lesson from run 20 (*"re-read the open findings, not the story list"*) now has a twin:
**re-read the story, not the row that summarises it.**

**The defect was structural, and every gate was complicit.** `apps/api/prisma/schema.prisma` could be edited without
writing a migration and the whole harness stayed green: `ci-gate.sh` runs `prisma generate`, which happily produces a
client for a schema **no migration builds**, and lint, typecheck, build and boot then all validate against that
fiction. Meanwhile `infra/docker/migrate-entrypoint.sh` runs `migrate deploy` and only `migrate deploy` — so the edit
reaches no database, ever. That is `db push`'s failure mode arriving through the front door, one slice after `db push`
was removed. It is the residual half of `PF-03`.

**What landed.** `scripts/schema-drift-check.js` (1248 lines) creates a disposable, name-guarded scratch database in a
real PostgreSQL, applies `apps/api/prisma/migrations` into it with `migrate deploy`, diffs **that database** against
the datamodel, and drops it on every exit path. Wired as stage **0d** of `scripts/ci-gate.sh` (after
compose-invocation, before `prisma generate`, **outside** the `--quick` guard) and as a step of `ci.yml`'s `build`
job — the only job declaring a `postgres:15-alpine` service. Ships `ADR-027`, because this is `ci-gate.sh`'s **first
service-dependent stage** and it narrows `ADR-025 D1`; the distinction that keeps both decisions true is
*capability* (an empty server, which CI can provision) versus *state* (the seeded application database, which it
cannot and must not fabricate).

**Executed, not asserted.** `SCHEMA DRIFT CHECK: PASS`, exit 0, on the unmodified repository — 55 base tables, ledger
row finished and not rolled back, `migrate diff` exit 0 *"No difference detected"*, scratch dropped, ≈17 s. Four
negative paths driven against the real database: a temp copy of the datamodel with one extra model → **exit 2**,
`[+] Added tables - DriftProbe`; a temp migrations directory holding invalid SQL → **exit 1 (P3018)**, verdict
`migrate_deploy_failed`; a dead address → **exit 1** naming all three routes tried; the same dead-address run with
`SKIP_SCHEMA_DRIFT` / `ALLOW_SCHEMA_DRIFT` / `SCHEMA_DRIFT_CHECK=0` / `FORCE` / `CI=false` / `NODE_ENV=production` set
singly and together → **identical verdict**. `--from-migrations` was measured first and **rejected** — it returns exit
2 on this repository unchanged, reporting all five PostgreSQL extensions as `[+] Added` although `0_baseline` creates
every one — and its absence is now pinned by test, so nobody re-discovers it as a "simplification". 94/94 new guard
cases; `src/shared/quality` goes 499 → **593** across 14 suites.

**Not claimed.** It proves the ledger *reproduces* and *executes*; it does **not** prove a migration is **safe** (a
data-destroying `DROP COLUMN` passes), it never reads a **non-empty** or **deployed** database, and the `ci.yml` wiring
is asserted rather than observed because Actions has been billing-locked since 2026-07-28 (`PF-59`). The only real
execution is a local `bash scripts/ci-gate.sh`.

**Two consequences a human should accept rather than discover.** (1) Every `ci-gate.sh` run on this machine now
requires `pilotage_postgres` up; with the stack down the routine's gate fails at stage 0d. That is correct by design
(ADR-027 D3), but it changes the routine's failure profile. (2) The guard spec's environment-guarded block creates and
drops `schema_drift_%` databases on whatever `DATABASE_URL` names, so `pnpm --filter @pilotage/api test` became
DB-touching too when a server answers — name-guarded and safe, never able to reach an application database, but new.

### The pointer, as of 2026-08-07 — **next slice → `S-E06-6`**

`V3-E02` is `code-complete` and **not `shipped`**: `S-E02-1`'s residual is the single open row and it is genuinely
hosted (credentials + operator). The epic's other open findings — `PF-77`, `PF-80` — live in the routine's own files
under `~/.claude/scheduled-tasks/` and `bmad/workflows/sprint.workflow.js`, outside this checkout.

**Next slice → `S-E06-6`** in `V3-E06` — confirmation and explicit scope for bulk/irreversible controls (`PF-29`).
`S-E06-1`, `S-E06-2` and `S-E06-3` have all landed; `S-E06-4` stays ⛔ blocked on decision **D-08** (the routine may
ship holding pages, never author policy text — `R-13`); `S-E06-5` was never enumerated in `sprint-01`. `S-E06-6` is
therefore the next **unblocked** story under the layer/dependency rule.

---

## 2026-08-07 — `S-E02-17`: the queue third of `PF-56`

### The ledger disagreed, and it is recorded rather than quietly reconciled

`docs/daily-improvement-v3/stories/sprint-01.md` enumerates `S-E02-17`, and
`docs/spec/features/v3-e02/stories/S-E02-17.md` is its contract. Two other ledgers did not know about it and were
**stale, not authoritative**: `bmad/roadmap.md` marked this epic `code-complete` with `S-E02-15` as "the last
enumerated slice" and pointed at `PF-102` / a `V3-E04` `epic-spec` run, and the "Next slice" pointer at the bottom of
*this* file named `S-E06-*`. There is no `docs/spec/features/v3-e02/tasks.md` at all. The operator override won; both
pointers are corrected by this land pass. **`PF-56` does not close**: three of its four thirds were already done, this
is the fourth, and the alert-rules / SLO-threshold decision it also names stays open.

### The gap, measured before anything was written

`apps/worker/src/shared/observability/metrics.registry.ts` registered `collectDefaultMetrics` and nothing else — zero
queue series — and its own header said so, naming the gap as a deferred slice. Three queues (`exports`,
`notifications-email`, `imports`) are registered on **both** sides by two independently declared constant blocks, each
carrying a comment pointing at the other, and **nothing compared them**. Job payloads carry `tenantId`.

### Four things that were measured rather than assumed, and each changed the design

1. **`prom-client@15.1.3` rejects on a throwing `collect()`** — and `version-server.ts` turns a registry rejection into
   an HTTP 500. So "the collector swallows its errors" is not defence in depth; it is the only thing standing between a
   Redis blip and a scrape endpoint that reports the worker as broken.
2. **A `collect()` that never settles makes `registry.metrics()` hang** — no response is written at all. This is the
   *realistic* Redis failure (`ioredis` defaults to `enableOfflineQueue: true` with a retry strategy climbing to 20 s,
   so `getJobCounts()` waits rather than rejecting), and a test written as a `mockRejectedValue` would have passed on
   an implementation that hangs in production. Both shapes are driven through the real socket.
3. **BullMQ v5 has eight job states, not six.** `QueueGetters.sanitizeJobTypes` returns `active, completed, delayed,
   failed, paused, prioritized, waiting, waiting-children`. A job added with `priority` lands in `prioritized` and
   never in `waiting`. The six-state list is a BullMQ-v4 mental model, and a six-state gauge would read **0 on a
   backlogged queue**. Eight are published; the two extra are zero until someone uses them, and they do not lie on the
   day someone does.
4. **Requiring a built `queue.module.js` opens no Redis connection and leaves no handle.** That is what makes check 9's
   registered-queue reader safe — the gate has to exit, and an open handle would make stage 9 print `PASS` and then
   hang. Measured before being relied on, then confirmed on the real repository: **3 registered queues, exit 0**.

### What is published, and what is deliberately not

`pilotage_queue_depth{queue,state}` · `pilotage_queue_jobs_total{queue,job,outcome}` ·
`pilotage_queue_job_duration_seconds{queue,job}` · `pilotage_queue_depth_collection_failures_total{queue}`.

There is **no dead-letter series**, because BullMQ has no such mechanism — a job that exhausts `attempts` stays in the
`failed` set (`DNC-06`). What a panel for it would really be asked is `outcome="failed_terminal"`, and that predicate
mirrors BullMQ's own `Job.shouldRetryJob` rather than paraphrasing it: `attemptsMade >= opts.attempts` **or**
`job.discard()` **or** `UnrecoverableError`. Arithmetic alone would report "retryable" for a discarded job and for an
unrecoverable error — a promised retry that will never happen, inside the metric written to avoid exactly that.

The fourth family is the resolution of a real tension between `DNC-08` (a check that cannot run must fail) and D4 (the
collector must swallow its errors). A collector is a *measurement*, not a check, so it may degrade — but degrading
silently renders a Redis outage as a healthy system, which is `DNC-06` by omission. It is zero-initialised per queue,
so it is honest and present with **no Redis at all**, which is also what lets the gate confirm `INSTRUMENTED_QUEUES`
against the labels the process really renders rather than against a constant nobody executes.

Depth degrades to **stale**, never to zero: `reset()` is forbidden, because an operator reading `0 waiting` during an
outage is worse informed than one reading a stale number — zero is a value they will act on.

### The durable half: check 9

`instrumented ≡ registered`, failing in both directions, plus three rules whose absence would be a vacuous pass: a
`null` read is a failure not a skip, a registered set below a floor of 3 is a failure, and **the api side and the
worker side must agree** — named per queue, never unioned, because a union is exactly how a queue registered on one
side only would keep passing. "Registered" is the **resolved** `BullModule.registerQueue` registration read off the
built modules' `BullQueue_*` provider tokens, not the exported constant: a constant exported and never registered is
not a registered queue, and a regex over source finds nothing at all here (the site is
`registerQueue({ name: QUEUE_EXPORTS })` — an indirection through a constant). Reading the modules rather than editing
them is also what keeps this diff out of `PF-80`'s blast radius: **neither `queue.module.ts` was touched**, and neither
was `packages/contracts`.

No new `ci-gate.sh` stage and no new `ci.yml` step — check 9 extends stage 9, which is what keeps the two harnesses in
step (`S-E02-2` AC-4). Both stage comments were widened to say the stage now also holds instrumented ≡ registered.

### Every negative was shown able to fail (R-26 / PF-83)

- `jobLabel` reduced to a pass-through → **T-SEC-1 and T-SEC-2 red**.
- the `Promise.race` deadline removed → **both never-settling cases time out**, including the one over the real socket.
- `evaluateQueueInstrumentation` made a no-op → **11/11** of check 9's cases red, with the positive case still green.

### Gates

- **G-PORTAL — not applicable.** No portal surface is touched: no route, no page, no component, nothing under
  `apps/web`. Stated as n/a rather than scored, because "4/4 verified" would claim a check nobody performed.
- **G-MIGRATION — not triggered.** `schema.prisma` untouched; nothing persisted.
- **G-TENANT — discharged by an executed test.** The instrumentation is driven with a real `ExportJobPayload`
  carrying `tenantId`, `exportJobId` and a cuid, **and a cuid as the job name** — which is the value an attacker
  actually controls, since `exports.service.ts:74` does `queue.add(dto.kind, …)` and that is closed today only by an
  `@IsEnum` decorator on a DTO in another application. None of the three reaches the rendered exposition; the job
  label renders as `<other>`. A companion assertion proves the exposition *does* carry allow-listed job names, so the
  negative is not vacuous.
- **G-DNC — DNC-01** (depth in the worker only; asserted in the negative in `apps/api/.../metrics.spec.ts`),
  **DNC-06** (no dead-letter name in any series, title, description, legend or comment — asserted over the real
  dashboard file), **DNC-08** (every new reader returns `null` on failure and `null` is a problem), **DNC-10** (the
  bypass guard widened from three string literals to whole families — `SKIP_*`, `ALLOW_*`, `QUEUE_METRICS_*`,
  `--skip|force|no-verify` — and run over **comment-stripped** content, because a guard a comment can turn red is a
  guard that gets deleted).

### The red this leaves behind, predicted before the gate ran

`scripts/observability-check.js` reads `dist/`, and agents do not build. On the tree these agents leave, stage 9 is
**red** with `the instrumented queue set could not be read from apps/worker/dist/shared/observability/queue-metrics.js`
— the module exists in `src/` and not yet in `dist/`. That is the identical shape recorded for `S-E02-14`/`S-E02-15`
(stale `dist`) and for the Prisma-generate gate: mechanical, closed by the orchestrator's single `pnpm build`, and it
must not be misdiagnosed as a broken check. The property that build would otherwise be needed to prove was measured
directly instead, by compiling the two modules to a scratch directory: **four `# TYPE` lines present with no Redis**,
`INSTRUMENTED_QUEUES` **equal to the rendered queue labels**, and the process **exiting on its own**.

### Not claimed

- **No alert rules and no SLO thresholds.** What "too deep" or "too slow" means is a product decision. The panels carry
  no `thresholds.steps`, no `alert` block and no axis `max` — a threshold asserted in colour is still a threshold, and
  the more persuasive of the two. `PF-56` stays open for it.
- **Nothing is ingested.** The exposition is proven to *serve*; whether a Prometheus scrape lands would need the `obs`
  profile up, which the routine may not bring up.
- **No OpenTelemetry span propagation through job data**, and **no queue depth in the API** (D1).
- The `ci.yml` half of the wiring is asserted, not observed — GitHub Actions has been billing-locked since 2026-07-28
  (`PF-59`).
- The full `bash scripts/ci-gate.sh` was **not** run by this agent (agents do not build, and stage 9 reads `dist/`).
  The verdict line belongs to the orchestrator's post-build run and must be reported verbatim there (R-23), including
  stage 0d's PostgreSQL precondition inherited from `S-E02-5`.

### The gate: red first, then green — and the red was a seam, not a design

`pnpm typecheck` came back **FAIL, exit 2**, 11/13 tasks successful, `@pilotage/worker` alone red with **7 errors and
exactly two root causes**, both at the boundary where the new code meets BullMQ's *declarations* — never at the
predicate, the state list or the whitelist the slice is actually built on.

1. **`Job.discarded` is `protected`** (`bullmq@5.76.8`, `dist/esm/classes/job.d.ts:136`), and TypeScript refuses to
   assign a class instance with a protected member to a structural type that declares it public — so all three
   processors, the only production callers, could **not** pass a real `Job` to the very predicate written for them.
   `readonly discarded?: unknown` left `JobOutcomeSource`; `classifyFailure` reads it defensively instead. Runtime
   semantics are byte-identical (`protected` binds the type system, not the instance), `job.discard()` is still
   observed, and no call site was widened to `any` — the three payload types survive.
2. **The eight states were typed `string[]`, BullMQ wants `JobType[]`** (`queue-getters.d.ts:65`). Fixed at the seam
   and *typed*, not cast: `queue-metrics.ts` exports `JobStateName = (typeof JOB_STATES)[number]`, and
   `queue-depth.collector.ts` annotates its `map` return so `'prioritzed'` is now a **compile error at the one line
   where the two vocabularies meet**. A `string[]` seam would have accepted the typo and reported 0 on a backlogged
   queue — the exact defect the eight-states-not-six measurement exists to prevent. `bullmq` is still **not** imported
   by `queue-metrics.ts`, so the gate may keep requiring it in-process.

An eighth error was created and fixed in the same pass: `queue-metrics.spec.ts:252` passed `{…, discarded: true }` as a
fresh **object literal**, which excess-property checking rejects the moment `discarded` leaves the interface. Bound to a
variable — a job carrying *more* than the interface names is precisely what the case proves. Re-run: **13/13 green**,
`git diff --check` clean. Recorded because the shape recurs (`E11-S1`, `E3-S3`, the Prisma-generate gate): **the tests
were green while the compiler was red**, because every one of them fed `classifyFailure` a hand-rolled literal and none
ever fed it the only argument production has. That is the gap, not the type error.

### What this slice raised and did **not** fix — `PF-104` … `PF-110`, registered by this land pass

Cited before they existed would be `PF-103`'s own defect, so all seven are written into
`docs/daily-improvement-v3/audit-findings-index.md` §3 by this pass. Three of them sit **inside the gate this slice
just made blocking**, which is why the next pointer goes to them rather than to `PF-102`:

- **`PF-104`** — a job that fails by **stalling** reaches no counter. BullMQ emits `'failed'` only from `handleFailed`
  (the processor threw); `moveStalledJobsToWait` puts a job past `maxStalledCount` straight into the `failed` set and
  emits `'stalled'` alone. So an OOM-killed or SIGKILLed worker leaves panel 6 flat at zero while
  `pilotage_queue_depth{state="failed"}` climbs — green, silent, false, in the metric written against that shape.
- **`PF-105`** — check 9's rule 6 is a **tautology**. `rendered` is scraped from the `queue="…"` labels of the worker
  exposition, and in the gate's process the only queue-labelled samples are the ones `queue-metrics.ts` zero-seeds from
  `INSTRUMENTED_QUEUES`. `declared ≡ rendered` is `A ≡ A` and cannot fail. Rules 3/4/5 (api vs worker vs declared, read
  off the resolved `BullQueue_*` tokens) are real; rule 6 is not, and the header claim that it confirms the declaration
  "against what the process really publishes" must be corrected with it.
- **`PF-106`** — **nothing executes the wiring.** No test touches the six new `@OnWorkerEvent` handlers or
  `QueueDepthCollector.onModuleInit`; the 39 tests call the helpers directly. Drop `ObservabilityModule` from
  `app.module.ts`, or let one `@InjectQueue` token drift, or write `observeJobCompleted(QUEUE_EXPORTS, …)` inside
  `ImportsProcessor`, and everything stays green: 39/39 pass, check 6 sees the `# TYPE` lines, check 9 passes by
  `PF-105`, typecheck passes — and the headline capability is dead.
- **`PF-107`** — `pilotage_queue_depth_collection_failures_total` is **plotted nowhere**. Panel 5's description routes
  the on-call to it by name; the four `expr`s do not reference it. Depth degrades to *stale*, never zero (correct), so
  during a Redis outage the panel shows a flat, plausible line and nothing on the dashboard names the outage — while
  the frozen queues are the ones carrying bulletins and guardian alert email.
- **`PF-108`** — `sum by (queue, state) (pilotage_queue_depth)` **multiplies depth by the replica count**. Depth is a
  property of the queue, so every worker reports the same absolute number and Prometheus keeps them apart by
  `instance`; `docker compose up --scale worker=2` doubles every line with no code change. `max by` is correct for 1
  and for N. Panels 6–8 are right as written — they `sum` `rate()` over counters, which *is* additive.
- **`PF-109`** — the `DNC-06` guard (`observability-gate.spec.ts:846`) lists singular French terms only, and the
  dashboard it inspects already contains the plural at line 4 (« une file de lettres mortes »). The French half of the
  guard is defeated by one character, in the file it guards, with no companion "the guard can actually fail" case.
- **`PF-110`** — `ADR-028` takes a number `docs/daily-improvement-v3/architecture-impact.md` §4 reserved for a
  `V3-E04` decision. 025/026/027 collided the same way; the register is still not reconciled, so the next reader finds
  four reserved numbers all occupied by other subjects and no rule for which register wins.

Two residuals stay **recorded, not id'd**: `collectOne` folds an uninstrumented queue's gauge into `queue="<other>"`
(sound for a counter, last-writer-wins for a gauge — unreachable today), and the 2 s deadline abandons the
`getJobCounts` read without cancelling the ioredis command, so a Redis stall leaves ~3 pending commands per scrape
(bounded by outage duration, unbounded in principle).

## S-E02-18 — done 2026-08-08 (run 26)

The gate `S-E02-17` made blocking can now fail, and the seven findings that slice queued against itself are closed.

**What each closure actually is** — the distinction that matters is *executed* vs *asserted*, and it is not uniform
across the nine acceptance criteria:

| Finding | Closed by | Executed? |
|---|---|---|
| `PF-106` — nothing runs the wiring | `queue-depth.collector.spec.ts` (**new**, 427 lines): C7/C9 invoke the three `@OnWorkerEvent('stalled')` handlers **off the real processor prototypes**; C11 reads `ObservabilityModule`'s resolved Nest `imports` | ✅ **53/53 executed** |
| `PF-105` — rule 6 is `A ≡ A` | `rendered` becomes `pilotage_queue_depth` ∩ `pilotage_queue_jobs_total` (neither zero-seeded), driven from the collector's own resolved `self:paramtypes` rather than from `INSTRUMENTED_QUEUES` | ⚠️ **fixture-only** — see the stale-`dist` note below |
| `PF-104` — a stalled job reaches no counter | `pilotage_queue_stalled_total{queue}`, a **separate family** (not a fourth `outcome`), + three one-line handlers | ✅ driven, incl. G-TENANT |
| `PF-107` — the failure counter is plotted nowhere | new panel 9 "Jobs bloqués (stalled) par file" | ⚠️ **partially** — see the deviation below |
| `PF-108` — a gauge is `sum`-med across replicas | every gauge query `sum by` → `max by`, plus **new blocking check 10** stated over the declared `# TYPE` | ✅ 71/71 fixture cases |
| `PF-109` — a `DNC-06` guard defeated by a French plural | plural added **with** a companion case proving the guard can go red (T17b2) | ✅ shown red |
| `PF-110` — `ADR-028` takes a reserved number | the *shipped* ADR keeps its number; the **reservations** move to `ADR-032`…`035`; a **written precedence rule** now says `docs/adr/` is the register of record | ✅ (docs) |
| `PF-112` — the `PF-104` id collision | renumbered in the findings index + traceability matrix | ✅ (docs) |

**The security shape is structural, not conventional, and that is the point.** BullMQ's `stalled` event is the one
that hands the listener a raw job identifier as its first and only argument (`worker.js:908` emits
`('stalled', jobId, 'active')`). The symmetric API — `observeJobStalled(queue, job)`, matching its two neighbours —
would have put a cuid one missing `jobLabel()` call away from an **unauthenticated** exposition, on a platform whose
queues carry `tenantId`, `exportJobId`, `requestedBy` and guardian email addresses. What shipped is
`observeJobStalled(queue: string)`, **arity 1**: the identifier is *unrepresentable*, so labelling by job would require
changing the signature — a visible review decision rather than a silent omission.

**The counter is deliberately not zero-seeded** (C10), so panel 9's "No data" reads as *never happened* rather than
*not wired*. Two consequences follow, and both are recorded rather than smoothed over: prom-client 15.1.3 still emits
`# HELP`/`# TYPE` for an unincremented counter (measured), which is what lets checks 6 and 10 resolve the family at
all; and the `beforeEach` `.reset()` in both spec files means the two assertions whose stated claim is *"it is NOT
zero-seeded"* currently pass either way — an R-26 vacuity carried to `S-E02-19`.

### ⚠️ The gate this slice hardens is RED on this checkout, and the reason is not in the source

`node scripts/observability-check.js` → **exit 1**:

```
✗ pilotage-slo.json: panel "Jobs bloqués (stalled) par file" queries
  "pilotage_queue_stalled_total", which no application registers.
OBSERVABILITY CHECK: FAIL (1 problem(s))
```

`apps/worker/dist/shared/observability/queue-metrics.js` contains **0** occurrences of `pilotage_queue_stalled_total`,
`queueDepthSourcesBound` or `unboundInstrumentedQueues` — it is `S-E02-17`'s build. The gate reads `dist`, so **every
green line it printed is evidence about the previous slice's bytes**, including this slice's two headline claims
(check 10's `9 sum() aggregation(s)`, and the `PF-105` rule-6 rewrite). **The `PF-105` fix has never once been executed
against its own source.** Same class as the known Prisma-generate RED gate: mechanical, not a redesign — but not yet
proven, and stated that way.

**This is a merge precondition, and it has one correct fix.** Rebuild `apps/worker` (orchestrator, per §4b — agents do
not build), then re-run the check; it must print `OBSERVABILITY CHECK: PASS`. The two *incorrect* fixes both silently
undo the slice: **zero-seeding `queueStalledTotal`** destroys the "No data ⇒ never happened" property panel 9's
description promises, and **deleting panel 9** re-opens `PF-104`. The fixture in `observability-gate.spec.ts` hardcodes
the name into `exposedMetrics`, so **no unit test can catch this** — only the real run can.

### Two deviations from the story spec, named rather than quietly accepted

1. **AC-4 asked for the stalled series as a second target on panel 6**; the diff ships a **new panel 9**, and panel 6
   keeps its title (only its description was updated). The split is defensible — the series is neither subset nor
   superset of `pilotage_queue_jobs_total`, and stacking non-additive series on one axis is the read-projection lie
   this epic exists to close — but the story spec shipped in the same PR still states the panel-6 requirement, so the
   contract and the artefact disagree. `DNC-06` should be re-read against the panel the series actually landed on.
2. **The gauge was renamed** `pilotage_queue_depth_bound` → `pilotage_queue_depth_sources_bound` (architect condition
   C2). Documented in `queue-metrics.ts` and in the `ADR-028` amendment; **not** annotated in `S-E02-18.md`, which
   names the old identifier at three places (`:145`, `:159`, `:414`) — a reader grepping the spec's name finds zero
   hits in code.

### What this slice raised and did **not** fix — carried to `S-E02-19`

All four are **latent today** and all four sit inside the **blocking** stage 9:

- **`sumAggregationArguments()` scans the raw expression**, so a `sum` token inside a quoted label value returns
  `unbalanced: true` → a hard PROBLEM. Measured: `sum by (q) (rate(a{note="sum"}[5m]))` → `unbalanced: true`;
  `label_replace(sum by (q)(a), "x", "sum", "q", "(.*)")` → same. `metricNamesInExpr()`, the sibling reader **in the
  same file**, already blanks quoted spans for exactly this reason — the file contains the fix, applied inconsistently.
- **Check 10 rejects the canonical replica-de-duplication idiom** `sum by (queue) (max by (queue, state)
  (pilotage_queue_depth))` — the *correct* expression, and the one check 10's own message recommends. Measured against
  the shipped evaluator.
- **`readCollectorBoundQueues()` has no test** and `return null`s on six distinct causes that collapse into one message
  naming the **wrong file** (`queue-metrics.js`, when the unreadable file is `queue-depth.collector.js`).
- **`readInstrumentedQueues()` writes to the shared prom-client registry** and restores it in a `finally` nothing
  asserts. A leak there fabricates queue traffic that every later `registry.metrics()` reader in the process — a future
  check included — treats as real: the "green and false" shape this epic exists to close, relocated into the mechanism
  written to close it.

Plus two smaller ones, both R-26 vacuity in this slice's own tests: `T-STALL-6` declares a `JOB_ID` it never passes to
anything, so its `not.toContain(JOB_ID)` cannot fail (the genuine driven proof is C9 in the collector spec, and the
comment claims otherwise); and the `beforeEach` `.reset()` noted above. Also non-blocking: check 10 walks
`input.dashboards` only, so a future Prometheus **alerting rule** that `sum()`s the gauge is outside the gate, and the
type map merges the api/worker/web registries into one flat name→type map (no collision exists today).

### What the ROUTINE executed after the sprint returned — the half a sprint cannot reach

The sprint proved this slice against specs and against `dist/`. The routine then proved it against **running
containers**, per Step −1, and three of those results are things no row in this epic could previously claim.

**Verdict line first (`R-23`).** `bash scripts/ci-gate.sh` → **`GATE: PASS`, exit 0, 17/17 stages**, including the one
`pnpm build`. Reported as the verdict, not as a selection of stages that happened to be watched.

**1. The worker was rebuilt, because the running one predated the code.** `pilotage_worker` was serving an image built
at 20:42 the previous evening; its exposition carried 24 depth samples, **0** `pilotage_queue_stalled_total` and **0**
`pilotage_queue_depth_sources_bound`. That measurement is what makes the after meaningful, and it is `PF-111`'s shape
appearing again one run later. After `docker compose … build worker` + `up -d --force-recreate worker`, the collector
logged « Profondeur de file instrumentée pour 3 file(s) : exports, notifications-email, imports » and the exposition
carried `pilotage_queue_depth_sources_bound{queue=…} 1` for **all three** queues — `AC-2` observed in the real process
rather than in a testing module, and `PF-106`'s seam executed where it actually runs.

**2. A real SIGKILL produced a real `stalled` event.** `pilotage_postgres` was paused so the exports processor would
block on its first Prisma write; one job was enqueued, logged « `[audit_csv] … — start` », and `getJobCounts` confirmed
`active: 1`; then `docker kill -s SIGKILL pilotage_worker` — a genuine death mid-job, leaving the job in `active` with
a lock nobody would renew. Postgres unpaused, worker restarted, and **55 s later**:
`pilotage_queue_stalled_total{queue="exports",app="worker"} 1`. **The documented nuance held in the same run**, which
is why the claim is trustworthy rather than merely green: `stalledCount` was 1, not `> maxStalledCount`, so BullMQ
returned the job to `wait`, the worker re-ran it and it failed normally — so the exposition shows the stall **and** a
`failed_terminal` as two separate facts that do not sum, exactly as `queue-metrics.ts` and panel 9 say they must not.
**G-TENANT against the live artefact:** the probe carried `tenantId="probe-tenant-stall"`,
`exportJobId="nonexistent-stall-probe-id"` and `requestedBy="routine-run-26"`, with a non-allow-listed job name
`stall-probe`; `grep -c` for each of the four in the 14 721-byte exposition returns **0**, and the name rendered as
`<other>`.

**3. Both new gate rules were executed red, on real files.** `PF-105`: a fourth queue added to the **built**
`INSTRUMENTED_QUEUES` → **exit 1**, *« Declared with NO write path: [drift-probe-queue] »* — the queue is **named** —
against **exit 0** on the unmodified artefact, restored afterwards. `PF-108`: panel 5's expression reverted to the
pre-slice `sum by (queue, state) (pilotage_queue_depth)` → **exit 1** naming the panel, the metric and the remedy;
restored → **exit 0**.

**4. It was ingested — the first time in this programme.** `--profile obs` was started and **all four Prometheus scrape
targets report `up`** with no `lastError`. Every dashboard expression this slice touched was then resolved against the
real TSDB, and Grafana returns « Pilotage — SLO » with **nine** panels including the new *Jobs bloqués*, on a
provisioned datasource that resolves. That retires the *"proven coherent, never ingested"* residual `PF-56` has carried
since run 15 — recorded on its row, without closing it, because alert rules and SLO thresholds are still undefined.

**5. `PF-108`'s replica arithmetic was demonstrated, and its own reproduction command was found not to exist.** At one
replica `sum` and `max` agree, so a single-instance check proves nothing; injecting a second `instance` label gives
`sum by (queue,state)` → **4** and `max by (queue,state)` → **2** against a real depth of **2**. The prescribed
reproduction, `--scale worker=2`, is **refused**: `worker` declares `container_name`, and so do **16 of the 21**
services. Recorded as **`PF-113`** — the fix is proven by a weaker demonstration than the finding's own text implies,
and saying so is the point.

**Stack left up and healthy**, with the `obs` profile running. Probe jobs removed; the drill wrote nothing outside
Redis and the local queue state, which is expendable (Step −1).

**Two of the sprint's four self-reported residuals now carry ids** — **`PF-114`** (check 10 rejects the correct
de-duplication idiom; the routine confirmed it by driving the shipped evaluator rather than accepting the panel's
claim, `R-30`) and **`PF-115`** (the three smaller gaps). They were prose in this file and are now traceable rows.

### The pointer, as of 2026-08-08 (run 26) — **next slice → `S-E02-19`**, a `V3-E02` follow-up

`sprint-01` stays exhausted: `S-E02-1`'s hosted residual and `S-E06-4` (⛔ `D-08`) are the only enumerated rows left,
and neither is code the routine may write. **The previous pointer named `S-E02-18` and then `PF-102`; both are now
stale** — `S-E02-18` landed this run, and `PF-102` was closed by `S-E05-12` (run 25, `9f5085b`). Named rather than
overwritten, for the reason this file keeps repeating: a pointer the next autonomous run reads at Step 1 is exactly
the kind of stale truth that makes it re-implement shipped work.

The next slice is **`S-E02-19`** — **`PF-114`** then **`PF-115`**, the four residuals above, now carrying ids rather
than living as prose in this file — and it goes first for the mirror image of last run's reason. `S-E02-18` closed
"a gate that cannot go red"; `PF-114` is "a gate that goes red on a correct tree", and
`scripts/observability-check.js`'s own header says why that is equally corrosive: *it teaches people to skip the gate*.
It is **confirmed, not suspected**: the routine drove the shipped evaluator and
`sum by (queue) (max by (queue, state) (pilotage_queue_depth))` — correct PromQL, and the idiom check 10's own message
recommends — is flagged, while the bare `sum` of the gauge and the counter `rate()` classify correctly. Nothing is red
today, which is exactly why it should be closed while the code is one run old rather than after someone writes the
correct expression and wedges stage 9 for everyone.

**`PF-113` is deliberately NOT part of that slice.** It is not a defect to fix but a question to answer — is horizontal
scaling in scope? — and `container_name` is doing useful work locally. It belongs after a decision, not before one.

The `V3-E04` `epic-spec` run (audit trail and governance — `PF-14`, `PF-31`, `PF-32`) is the pick immediately after,
still gated on nothing but sequencing.

---

## `S-E02-19` — the observability gate stops false-redding, and its two new readers get coverage

**2026-08-08 (run 27) · `epic-slice` · P2 · closes `PF-114` + `PF-115` (a)(b)(c)**

> **The pointer immediately above this section is now stale by exactly one slice.** It reads
> *« next slice → `S-E02-19` »*; `S-E02-19` is this section. Named rather than overwritten, for the reason this file
> keeps repeating. The corrected pointer is at the end of this section.

### What changed, and where

| File | Change |
|---|---|
| `scripts/observability-check.js` | the replica-shield walk (`unshieldedGaugeReferences`, `REPLICA_LABELS`, `ACROSS_SERIES_AGGREGATIONS`, `groupingRemovesReplicas`), the same-length quote mask (`maskQuotedSpans`), discriminated results + a 14-entry reason enum for both queue readers, the verified registry restore (`registryResidue`, `DRIVEN_DEPTH_SENTINEL`), `readCollectorBoundQueues(collectorPath?)` exported |
| `apps/api/src/shared/quality/observability-gate.spec.ts` | **28 new cases** — `T20`…`T20g`, `T21`…`T21g`, `T22`…`T22e`, `T23`…`T23g`, `T24`…`T24f`, `T19b` |
| `apps/worker/src/shared/observability/queue-metrics.spec.ts` | `T-STALL-6` made able to fail, and its comment corrected |

**No production application code.** No schema, endpoint, controller, guard, permission, contract, dashboard *value*,
`packages/*` file or worker production file was touched. `infra/grafana/dashboards/pilotage-slo.json` is **not** edited
(AC-6 would otherwise be circular). The script's CLI flag surface is unchanged: it still has none (DNC-10).

### Proven by execution

**AC-6 — the positive path, on the real repository.** `node scripts/observability-check.js` → **exit 0**,
`OBSERVABILITY CHECK: PASS`, 10 dashboard queries, *« 9 sum() aggregation(s) … read no gauge-typed metric family »*.
Run before the diff and after it, same verdict.

**The `apps/worker/dist` staleness caveat did NOT apply in this environment** — stated because the story required the
question to be answered rather than assumed. `dist/shared/observability/` carried all four artefacts and checks 6/9/10
all resolved, so the exit-0 above is observed, not inherited. A run whose `dist` *is* stale will still see checks
6/9/10 red for that reason and not for this diff.

**AC-1…AC-5, AC-7 — red before, green after, measured rather than claimed.** The `HEAD` script (`79921da`) and the
new one were both driven with the same eleven expressions through `evaluateObservability`:

| case | expected | `HEAD` | now | red pre-fix |
|---|---|---|---|---|
| `T20` AC-1 `sum by (queue) (max by (queue, state) (pilotage_queue_depth))` | no problem | **PROBLEM** | no problem | **yes** |
| `T20b` AC-2 `sum by (queue) (pilotage_queue_depth)` | PROBLEM | PROBLEM | PROBLEM | no |
| `T20c` AC-4 `… (max by (queue, state, instance) (…))` | PROBLEM | PROBLEM | PROBLEM | no |
| `T20d` AC-4 `… (max_over_time(pilotage_queue_depth[5m]))` | PROBLEM | PROBLEM | PROBLEM | no |
| `T20e` AC-5 `… (max by (queue) pilotage_queue_depth)` | *cannot scan* | wrong message | *cannot scan* | **yes** |
| `T20f` AC-7 `… (rate(pilotage_queue_jobs_total{job="sum"}[5m]))` | no problem | **PROBLEM** | no problem | **yes** |
| `T20g` AC-7 `… (label_replace(…, "sum", …))` | no problem | **PROBLEM** | no problem | **yes** |
| `T18`, `T18b`, `T18c`, `T18g` (existing) | unchanged | unchanged | unchanged | n/a |

`PF-114` reproduced verbatim on `HEAD`: *« panel "Profondeur de file par état" aggregates the GAUGE
"pilotage_queue_depth" with sum() … Use max by (...) »* — emitted **about an expression that uses `max by (...)`**.
`T20e` is red pre-fix on its assertion rather than on its verdict: `HEAD` also produced a problem, but the *wrong* one
(it flagged the gauge instead of saying it could not parse), so the new parse path is genuinely new coverage.

**AC-9 / AC-10 / AC-8 cases could not be red pre-fix at all**, and that is stated rather than dressed up: neither
`readCollectorBoundQueues`, nor `registryResidue`, nor the reason enum existed on `HEAD`, so `T22`…`T24f` are new
mechanism plus its first coverage, not a regression pinned. What makes them non-vacuous is the four driven negatives
below.

### Four negative paths, driven end-to-end through the real script

1. **`PF-114` at the script level.** A throw-away `infra/grafana/dashboards/zz-negative-path.json` carrying **both**
   `sum by (queue) (pilotage_queue_depth)` and `sum by (queue) (max by (queue, state) (pilotage_queue_depth))` →
   **exit 1, one problem**, naming the metric, the panel and the file — and **not** the correct sibling panel in the
   same file. Fixture deleted; the dashboards directory holds `pilotage-slo.json` only.
2. **`PF-115` (a).** `queue-depth.collector.js` moved aside → `HEAD` said *« could not be read from
   `…/queue-metrics.js` »* (the wrong file, the finding verbatim); the new script says *« the built queue-depth
   collector is absent (`apps/worker/dist/shared/observability/queue-depth.collector.js`) »*. Replaced by a module that
   throws → *« could not be required (…queue-depth.collector.js) — collector exploded »*. Both **exit 1**; artefact
   restored byte-for-byte.
3. **`PF-115` (b).** The `finally` restore in `readInstrumentedQueues` deliberately blanked → **exit 1**,
   `INSTRUMENTATION UNREADABLE (registry-not-restored)`, and the message enumerated **all nine** residues: three
   `pilotage_queue_depth … 17`, three `pilotage_queue_jobs_total` driven outcomes, three
   `pilotage_queue_depth_sources_bound … 1`. Script restored from backup; re-run → **PASS**.
4. **`PF-115` (c).** `queueLabel`'s whitelist replaced by `return queue` in `queue-metrics.ts` → `T-STALL-6`
   **FAILS** (`Expected: 1, Received: undefined`), alongside `T-STALL-4`. On `HEAD`'s version of `T-STALL-6` that same
   mutation left the case green, which is exactly what made it vacuous. Source restored; `git diff` on it is empty.

### Targeted suites

- `pnpm --filter @pilotage/api test -- observability-gate` → **145 passed / 145**, 2 suites.
- `pnpm --filter @pilotage/worker test -- queue-metrics` → **36 passed / 36**.

### Decisions, and what is NOT claimed

- **AC-7 was DONE, not dropped.** It is one masking step inside the function the slice already edits, in the same
  defect class, and it was **red pre-fix on two expressions** (`T20f`, `T20g`), so it was cheap and load-bearing rather
  than speculative. The mask is **same-length** on purpose: `sumAggregationArguments` slices the *original* expression
  by an index found in the masked one, so a shortening mask would have returned a corrupted argument — a silent lie
  inside a blocking stage, worse than the false red it removes. `T21g` pins the length property; `T19b` pins that the
  returned argument is the real one, quotes included.
- **`REPLICA_LABELS` includes `job`, deliberately and conservatively.** In Prometheus `job` is a scrape-job name shared
  by a service's replicas, not unique to one — so keeping it in the set makes the shield test **refuse** to shield on a
  grouping that retains it. That is the fail-closed direction: it can produce a flag on an expression that was in fact
  safe, never a silent accept of one that was not. No dashboard expression is affected today (`T18e`'s
  `sum by (le, queue, job)` reads a histogram, not a gauge).
- **The optional `collectorPath` is a testability seam, not a flag (DNC-10).** It cannot be reached from the command
  line, `main()` reaches it only through `readInstrumentedQueues`, which calls it with no argument; it changes *which*
  file is read and can make no check pass. `T23g` proves the default **is** the real artefact, driven as an equality
  between the no-argument call and the explicit-path call, so it holds whether or not `dist` is present.
- **DNC-08 extended, not weakened.** Every new parse path fails closed: an inner aggregation that cannot be scanned to
  a matching parenthesis is a PROBLEM (`T20e`), and the reason enum fails closed **on itself** — an unrecognised reason
  (`T24d`) or a result with no reason (`T24e`) is still a PROBLEM naming what it did not understand.
- **G-TENANT strengthened, never weakened.** `T-STALL-6` previously declared a cuid and then drove `'exports'`, so
  `not.toContain(JOB_ID)` asserted over a value the system had never seen and no mutation could redden it. It now
  drives the cuid through the only seam that exists — the single queue-name parameter — and asserts it collapses to
  `<other>`. The arity assertion (`observeJobStalled.length === 1`) is kept, because that is what makes a job-id label
  *unrepresentable* rather than merely untaken. The comment was rewritten to claim only that (DNC-06).
- **No existing assertion was weakened.** `T18`, `T18b`…`T18i` and `T19` are unmodified and green.
  `evaluateQueueInstrumentation` deliberately still accepts the pre-existing fixture shape (`{ declared, rendered }`
  with no `ok`), so `T11`, `T13`, `T15c`, `T15c2` and `T15d` are unmodified too; the discriminated shape is additive
  and every non-conforming shape is still a failure (`T24f`).
- **No ADR.** §2.3's design was followed (shield stated over the grouping modifier; readers return a reason rather than
  throwing), so no new architectural decision was introduced. `ADR-036` stays free.
- **The `PF-110` residual in `architecture-impact.md` was already closed** — the file reads *« Superseding it with
  `ADR-032` »* with a 2026-08-08 correction note. Verified, not re-fixed; the file is untouched by this slice.
- **`PF-113` remains out of scope, deliberately.** It is a question — is horizontal scaling in scope? — not a defect;
  `container_name` is doing useful work locally. It belongs after a decision, not before one.
- **Not claimed:** that Prometheus was started or scraped this run (no `--profile obs`), that the shield walk is a
  PromQL parser (it is a scanner over aggregation tokens and grouping modifiers; anything it cannot scan is a
  PROBLEM), or that `unshieldedGaugeReferences` reasons about vector matching, subqueries or `@`/`offset` modifiers —
  none appear in `pilotage-slo.json`, and an expression using them is flagged or reported unscannable, never silently
  accepted.

### What this slice raised and did **not** fix — `PF-116`, `PF-117`, `PF-118` (land pass, 2026-08-08)

> **This section was written by the land pass, not by the implementer, and it contradicts the paragraph the implementer
> wrote below it.** That paragraph said the gate-hardening track had "no enumerated follow-up left". The escalation
> panel — architect, security and test-architect independently — found two fail-**open** regressions in the same
> blocking stage, and this land pass **re-measured both rather than accepting them on the panel's word** (`R-30`).
> Both reproduce. The pointer at the very bottom is corrected accordingly.

Every previous residual this epic recorded was **fail-closed** (a gate that flags too much). These two are the other
direction, which is the direction that matters: a stage that stops catching its own defect.

**`PF-116` — the replica shield accepts `topk`/`bottomk`, which SELECT series rather than collapse them.**
`ACROSS_SERIES_AGGREGATIONS` (`scripts/observability-check.js:409`) lists both, and `groupingRemovesReplicas(null, …)`
(`:441`) returns `true` for "no grouping modifier", so the walk marks their argument shielded at `:558`. But `topk(3, x)`
returns the three input series **with every original label, `instance` included** — it removes no dimension, so the
enclosing `sum` still double-counts every replica. That is literally `PF-107`/`PF-108`, the defect check 10 exists to
catch. Measured this land pass, both directions:

| expression | `HEAD` (`79921da`) | after this slice |
|---|---|---|
| `topk(3, pilotage_queue_depth)` | `metricNamesInExpr` → `['pilotage_queue_depth']` → **PROBLEM** | `unshieldedGaugeReferences` → `{families: [], unscannable: false}` → **accepted** |
| `bottomk(1, pilotage_queue_depth)` | **PROBLEM** | **accepted** |
| `topk by (queue) (3, pilotage_queue_depth)` | **PROBLEM** | **accepted** |
| `max by (queue, state) (pilotage_queue_depth)` | PROBLEM *(this is `PF-114`)* | accepted *(correct — the fix)* |
| `max_over_time(pilotage_queue_depth[5m])` | PROBLEM | PROBLEM *(correct — `T20d`)* |
| `quantile(0.9, pilotage_queue_depth)` | PROBLEM | accepted *(correct — `quantile` does collapse)* |

So the `max_over_time` trap the story warned about is caught, and the same trap on an operator that **is** in the list is
not — which is the point: **membership in `ACROSS_SERIES_AGGREGATIONS` cannot be what decides the shield.** The fix is
narrow and stays inside §2.3's design — a `SELECTOR_AGGREGATIONS = new Set(['topk','bottomk'])` consulted at `:558` so
the operators are still *parsed and consumed* (the `unscannable`/DNC-08 path must not change) but never shield — plus
the three AC-4-shaped negatives above, red pre-fix. Nothing in `infra/grafana/dashboards/pilotage-slo.json` uses either
operator today (`grep -c 'topk\|bottomk'` → 0), so it is **latent**, same posture as everything else this slice closed.

**`PF-117` — an unterminated quote blanks the rest of the expression, with no signal.** `maskQuotedSpans` (`:349`) opens
on `"`, `'` or `` ` `` and, if no closing delimiter follows, emits every remaining character as a space and **returns
normally**. Both callers then see an expression with no `sum` token and no metric reference and report nothing:

```
HEAD: sumAggregationArguments('foo{a="b} + sum by (queue) (pilotage_queue_depth)')
      -> { args: ['pilotage_queue_depth'], unbalanced: false }   → PROBLEM
now : -> { args: [], unbalanced: false }                          → silent accept
```

This is a **DNC-08 violation introduced by the AC-7 masking step**, and the same diff restates the rule it breaks at
`:381`: *an expression the reader cannot parse must be a PROBLEM, never an accepted expression*. The function it was
modelled on — `metricNamesInExpr`'s `.replace(/"[^"]*"/g, ' ')` — **cannot** swallow a tail, because it requires a
closing quote. It is also wider than PromQL suggests, because the mask treats a bare `'` and a bare `` ` `` as openers,
so one stray apostrophe in a hand-edited panel expression is enough. Fix ≈ 4 lines: return `{ masked, unterminated }`
and route `unterminated` into the existing `unbalanced`/`unscannable` PROBLEM path, plus one case pinning that an
unterminated quote goes **red**.

**`PF-118` — `registryResidue`'s outcome branch is vacuous on the throw path.** `readInstrumentedQueues` populates
`drivenOutcomes` only inside the `try`, so if the drive throws on the first queue, `driven` is empty and the
`pilotage_queue_jobs_total` residue branch cannot match. AC-10 is **not** defeated — the depth sentinel and
`pilotage_queue_depth_sources_bound` branches still cover that path — but the claim *"three things, one per thing the
drive writes"* is one third weaker than stated on that path (`DNC-06` territory). Cheapest honest fix: record each
outcome label **before** the write that produces it.

**Recorded and deliberately not fixed here** (fail-*closed*, so it is the safe direction): the shield is evaluated only
**inside** a `sum` argument and never over enclosing context, so `max by (queue) (sum by (queue, instance) (gauge))` is
still flagged. Verified this land pass. That is a false red, consistent with the file's stated posture, and it is
cheaper to leave than to widen the walk.

### The pointer, as of 2026-08-08 (run 27) — next slice → **`S-E02-20`**, then the `V3-E04` `epic-spec` run

**Corrected by the land pass.** The paragraph the implementer wrote — *"`V3-E02`'s gate-hardening track has no
enumerated follow-up left … the next pick is the `V3-E04` `epic-spec` run"* — was true of the slice as specified and
became false the moment the panel measured the shield. It is named rather than overwritten, for the reason this file
keeps repeating: a pointer the next autonomous run reads at Step 1 is exactly the stale truth that makes it skip queued
work. `PF-114` and `PF-115` **are** closed; what replaces them is `PF-116` + `PF-117` + `PF-118`.

**`S-E02-20` — the replica shield stops shielding on selectors, and the quote mask stops swallowing its tail. `L0`,
~8 production lines + ~4 test cases.** Both items are fail-**open**, both are inside the **blocking** stage this
programme has now hardened three times, and both were flagged on `HEAD` and are accepted after `S-E02-19` — so this is
a regression in gate power, not a pre-existing hole, which is what puts it ahead of a new epic. Carry `PF-118` as the
third, cheapest item. Owner `V3-E02` *(follow-up)*.

After it: the **`V3-E04` `epic-spec` run** (audit trail and governance surfaces — `PF-14`, `PF-31`, `PF-32`), which has
no `docs/spec/features/v3-e04/` yet and must open with the `trust proxy` decision recorded on the `S-E06-6` row of
`docs/spec/features/v3-e06/PROGRESS.md`. The epic stays **`code-complete`**, not `shipped`: `S-E02-1`'s hosted residual
still needs an operator, and `PF-113` is blocked on a decision rather than on code.

---

## `S-E02-19`, part two — the routine closed the holes the slice opened, before the PR existed

> **Read this section before the one above.** The section above was written by the sprint's land pass and ends by
> recommending `S-E02-20` for the three defects it had just introduced or found. **That recommendation is spent:** the
> routine's Step 5 closed all three in the same run, on the same branch, before the PR was opened. `PF-116`, `PF-117`
> and `PF-118` are `closed` in `traceability-matrix.md`, and roadmap candidate 0 is struck.

### Why this was not deferred to the next slice

Every residual this epic had recorded before was **fail-closed** — a gate too strict. Annoying, and self-announcing:
someone hits it, complains, and it gets fixed. `PF-116` and `PF-117` were **fail-open**: a blocking stage that went
**green** on expressions `HEAD` reddened. That is the defect `S-E02-18` spent an entire slice closing, reintroduced by
the slice that follows it — and it announces nothing, because a gate that stops catching its own defect looks exactly
like a gate with nothing to catch. Shipping it for one run, in the stage this programme has now hardened four times,
would have made every "GATE: PASS" in that window mean less than it says.

### `PF-116` was five holes, not two — and the shape of the fix is the lesson

The land pass named `topk`/`bottomk`. Driving **all thirteen** operators through `evaluateObservability` — the real
entry point, with a real dashboard shape — found five:

| Operator | Why it cannot shield |
|---|---|
| `topk`, `bottomk` | **Selectors.** They return k of the ORIGINAL series with every label intact, `instance` included |
| `count`, `count_values` | Return **N**, so the enclosing `sum` adds process counts rather than the resource |
| `stddev`, `stdvar` | Return **0** across identical replicas — not the resource's value at all |

The root cause is one conflation: **parsing an operator and trusting it are different questions**, and
`ACROSS_SERIES_AGGREGATIONS` was being asked both. Every operator must still be *parsed and consumed*, or the walk
mis-reads the nesting and the residual scan sees text it should not; only some may *shield*.

The roadmap proposed a `SELECTOR_AGGREGATIONS` deny-list. **That would have fixed `topk`/`bottomk` and left the four
arithmetic holes open**, because a deny-list enumerates what is unsafe and is therefore wrong by default about anything
nobody thought of. The shipped fix enumerates what is **safe** — `REPLICA_IDEMPOTENT_AGGREGATIONS` = {`max`, `min`,
`avg`, `group`, `quantile`}, the operators for which N copies of *v* give *v* — so an operator absent from it shields
nothing, and a PromQL operator added to the language later is unsafe until someone deliberately proves otherwise. Same
file, same line, opposite default. Worth recording because the deny-list instinct is what produced the defect.

The roadmap also asserted that `count_values` *"genuinely does collapse"*. It does not — it counts the series carrying
each distinct value. That claim is corrected in `bmad/roadmap.md` rather than left to mislead the next reader.

### `PF-117` — one scanner, not two

`scanQuotedSpans` now returns `{ masked, unterminated }`, and both callers route `unterminated` into the PROBLEM path
they already had (`unbalanced` in `sumAggregationArguments`, `unscannable` in `unshieldedGaugeReferences`). It is a
**separate function** rather than a changed return type on `maskQuotedSpans`, deliberately: that keeps the string
contract `T21g` pins, while the mask and the failure signal come from ONE scan and cannot drift apart — two scanners
eventually disagree about which quote characters exist, and then the mask silently contradicts the signal.

A *terminated* quote is still masked and still silent (`pilotage_queue_depth{tenant="a"}` stays accepted), so this does
not trade one false red for another.

### `PF-118` — two lines, and the ordering is the point

`drivenOutcomes.push(...)` now runs **before** `observeJobCompleted(...)`. The write can throw mid-flight; a tuple
pushed afterwards would be missing for a sample that may already exist, so `registryResidue` would not look for the
residue this drive is *most* likely to have left — on exactly the path the catch-and-still-verify design exists to
cover. What the residue check needs is the **intent** to write; whether the write finished is precisely the unknown.

### Evidence — executed in both directions

- `pnpm --filter @pilotage/api test -- observability-gate` → **167/167**, 2 suites (was 145). The new block is a
  19-row matrix driven through `evaluateObservability`, plus `T22` (the shielding set is a strict, named subset of the
  parsed set, and seven named operators must stay out), `T23` (mask and signal come from one scan) and `T24` (an
  unterminated quote reaches the caller as `unbalanced`, not as no-tokens).
- **Red before the fix, named individually.** With the shielding set widened back to every parsed operator and the
  `unterminated` routing removed, **9 cases fail**: `topk`, `bottomk`, `count`, `count_values`, `stddev`, `stdvar`, the
  `PF-117` row, `T22` and `T24`. Restored → 167/167. The probe was applied to the real file and reverted; nothing of it
  is in the diff.
- Full `scripts/ci-gate.sh` → **`GATE: PASS`, exit 0, 17/17 stages** (the verdict line, not a stage selection — `R-23`),
  with `test-ratchet` reporting **no drift** on api *and* worker (the `PF-80` check), and stage 9 printing
  `OBSERVABILITY CHECK: PASS` against the real dashboards.
- `pnpm build` → **8/8 tasks, exit 0** (the run's single build).

### Not claimed

- The walk reasons about grouping modifiers **syntactically**. A `by (...)` naming a replica label this repository has
  never used is judged by `REPLICA_LABELS` alone; nothing consults a live Prometheus for the label set actually present.
- One case — `sum by (queue) (sum by (queue, state) (…))` — stays green under the probe, because
  `sumAggregationArguments` yields the inner `sum`'s argument separately and catches it by a second, incidental route.
  It is recorded as passing in **both** states rather than presented as a proof.
- **`PF-118` has no executed negative.** Forcing `observeJobCompleted` to throw means mutating the built worker module
  the check is reading. The fix is an ordering argument verified by reading the path, and it is recorded as such rather
  than dressed up as a driven test.
- Nothing here was *ingested*: no Prometheus scrape and no Grafana render this run. The `obs` profile was started in
  run 26 and that evidence stands; this slice did not re-prove it.

### The pointer, as of 2026-08-08 (run 27)

**Next slice → the `V3-E04` `epic-spec` run** (audit trail and governance surfaces — `PF-14`, `PF-31`, `PF-32`). There
is no `docs/spec/features/v3-e04/` yet, so it is an `epic-spec` run, and it must open with the `trust proxy` decision
recorded on the `S-E06-6` row of `docs/spec/features/v3-e06/PROGRESS.md`. `V3-E02` stays **`code-complete`**, not
`shipped`: `S-E02-1`'s residual is a capability gap (`PF-111` — nothing detects a container older than the code), and
`PF-113` is blocked on a decision (is horizontal scaling in scope?) rather than on code.

> **Discharged 2026-08-08 (run 28).** The `V3-E04` `epic-spec` run happened: `docs/spec/features/v3-e04/` now exists
> (8 files, 8 run-sized slices `S-E04-1`…`S-E04-8`), it opens with the `trust proxy` decision as instructed, and
> `V3-E04`'s own ledger carries the pointer from here on. **Two corrections this file owes its readers, both found by
> run 28 rather than asserted by it:**
>
> 1. **The earlier pointer at §*"next slice → `S-E02-20`, then the `V3-E04` `epic-spec` run"* is spent, and this file
>    said so in two places at once.** `S-E02-20` existed to close `PF-116` + `PF-117` + `PF-118`; `S-E02-19` closed all
>    three itself at its own Step 5. Run 28 verified that against the shipped code, not against either ledger:
>    `scanQuotedSpans` returns `{masked, unterminated}` and both callers route it into their PROBLEM path
>    (`scripts/observability-check.js:289`/`:295`/`:403`), and `topk`/`bottomk` are held out of the shielding set as
>    SELECTORS (`:443`/`:449`/`:477`).
> 2. **`docs/daily-improvement-v3/audit-findings-index.md` disagreed with `traceability-matrix.md` for a full run** —
>    the index still carried `PF-116`/`PF-117`/`PF-118` as `TECH_DEBT` while the matrix already read `closed`. Corrected
>    in run 28 by reading the code rather than by picking a ledger. Named here because a pointer that says *"next slice
>    → `S-E02-20`"* beside an index that says its findings are open is exactly the stale truth that makes the next
>    autonomous run redo finished work.
>
> `V3-E02` remains **`code-complete`**, unchanged: `PF-111` and `PF-113` are still the two residuals, and neither moved.

---

> **The gate this epic built stopped gating, and it took eight PRs to notice (run 43, 2026-08-12).** `TOOL-06`,
> `TOOL-07` and `TOOL-08` are closed by `ci/2026-08-12-v3-a-gate-unbounded-stages`. All three are the same rewrite's
> blast radius: `#214` introduced the tiered fast/full structure but left the **old stage list in place above it**,
> and its seven `run_stage` calls passed the stage NAME where the function expects seconds.
>
> `timeout` read the name as its interval and exited **125** before the command ran; `run_stage` filed each as an
> ordinary stage failure; the summary exits non-zero whenever `FAILED[]` is non-empty. **Every code-change gate
> therefore reported `GATE: FAIL` on a diff it had never examined**, and every docs-only run reported `PASS` because
> its `exit 0` fires before the summary and discards the seven failures unread. The banner said `▶ node` rather than
> the stage name — with the timeout omitted the name sat in `$limit` and the command in `$2` — which is why the
> output was in front of 39 runs and read by none of them.
>
> **What was actually lost, as opposed to merely duplicated:** one stage. Six of the seven had working counterparts in
> a tier. `csv escapers` had **no other call site anywhere**, so the ratchet `#215` landed as blocking had never
> executed once. It now runs in TIER 1; its first-ever execution scanned 698 files across six roots and found the
> four sanctioned escapers.
>
> **The two that only a measurement could find**, and the reason this note is long: the meta-tests guarding all of it
> were reading the dead code. `TOOL-08` — `prisma generate` ran *before* `schema drift` in the live tier, inverting
> `S-E02-11` AC-6, while the test that asserts that order anchored on the literal `run_stage "prisma generate"`, which
> matches only the pre-`#214` line, where the order did hold. `TOOL-07` — three more meta-tests (`boot`,
> `web artefact`, `link integrity`) were **red on `main`** because `run_stage "build"` stopped matching when `#214`
> added timeouts, and two (`audit writes`, `csv escapers`) **could not fail**, because they hunt for a `${QUICK}`
> guard `#214` had renamed to `$MODE`, find nothing, and conclude "not inside a guard" wherever the stage is wired.
> The three reds stayed invisible because the api ratchet runs `--skip src/shared/quality/` unless the diff touches
> gate machinery, and no PR had touched it since.
>
> **Ratchet, so the class cannot return quietly:** `run_stage` now refuses a non-numeric timeout and exits 64, and
> `csv-escape-gate.spec.ts` asserts that every `run_stage` call in the file declares one. Both depth-scanning specs
> now assert their guard string exists before trusting their own negative result.
>
> `V3-E02` remains **`code-complete`** — `PF-111` and `PF-113` are still its two residuals, and neither moved.
> `TOOL-09` (P3) is recorded, not storified: `runtime engines` is source-only and ~2 s but now runs only under
> `--full`, and widening the fast tier's contract is a decision for `open-decisions.md`, not a side effect of
> repairing a timeout.

---

## `TOOL-10` — the gate reached the right verdict and took forever to say so (run 44, 2026-08-12)

`TOOL-06`/`07`/`08` gave the merge gate its eyes back. The first thing it saw with them was that it could not
finish: `test:api (ratchet)` hit its **2 400 s** bound on PR #223, and inside the killed run
`schema-drift-gate.spec.ts` reported `exitCode=143` — SIGTERM, still running when the bound expired.

**The defect is not a slow suite.** `node scripts/schema-drift-check.js` against an unreachable address is
*correct* — `SCHEMA DRIFT CHECK: FAIL — tooling_unavailable`, exit 1, which is the `DNC-08` fail-closed behaviour
this epic wants. It is only wrong about **how long it takes to find out**: it tries three SQL routes in turn, and
route C (`docker exec pilotage_postgres psql`, reached through an **unbounded** `docker port`) does not answer on
this host at all. Measured here before anything was written: the CLI **did not finish in 30 037 ms**, the docker
metadata call **did not answer in 8 026 ms**, and the spec file — which reaches the ladder ten times — **did not
finish in 600 000 ms**. Ten unbounded ladders is what overruns a 2 400 s stage.

**Raising the bound was refused, in writing, before it could be tried again.** `2bd1a25` already raised
`test:api (ratchet)` once on the "the suite got slower" reading. `scripts/ci-gate.sh` is **byte-identical** in this
diff (`git diff --quiet` YES), and a test asserts it.

### What landed

| Piece | Why it is that and not something cheaper |
|---|---|
| `probeAddress(host, port)` — an out-of-process `node -e` TCP probe, run **once** per routes object, lazily and memoised per closure | The ladder's cost is three child processes deep. One bounded socket connect answers the only question the ladder is really asking, in ~230 ms |
| Three states — `open` / `refused` / `indeterminate` — where the story authored two | **This is a deliberate deviation and it is the most important line of the slice.** A 2-state probe reads a *timeout* as absence, which turns a loaded-but-alive PostgreSQL into a permanently red gate with no route back to green — the story's own #1 pre-mortem. Only `refused` is evidence of absence |
| The short-circuit fires only on `refused && loopback` | Route C is elided against a **predicate, not luck**: `containerAddressesTheUrl()` admits C only when the container publishes the port **on this host**, so refused-on-loopback genuinely implies C is unusable. A non-loopback URL still descends the ladder, now bounded |
| `spawnSync`-level `timeoutMs` on both `docker` call sites, with the named-bound sentence `… did not answer within N ms and was killed` | bash-level `timeout` does **not** kill a hung docker CLI on this host (`ps -W` shows orphans dated Aug 10); libuv maps `SIGTERM` to `TerminateProcess`, so the bound has to live in `spawnSync`. The sentence is the register `tracing-check.js` and `boot-check.js` already use |
| `scripts/test-ratchet.js` splits signal / spawn-error / elapsed-ceiling | A suite killed at 2 400 s was being reported as *"it probably failed to start"*. That is the same misdirection at the meta level: the operator hunts an install problem instead of a bound |

The probe child receives **host and port only**, never a connection string (`ADR-025 D6`), from a constant `-e`
source with `shell: false` — pinned by a case asserting the literal contains no `://`.

### The verdict does not move — measured

| Address | Before | After |
|---|---|---|
| `127.0.0.1:59999` (dead) | did not finish in 30 037 ms | **519 ms**, exit **1**, `tooling_unavailable`, all three routes still named |
| default `:5433` | — | **546 ms**, exit **1**, same verdict |
| open listener that is not PostgreSQL | — | 5 308 ms, ladder **descended** (`B. host psql …`, `C. docker exec … was killed`) |
| `192.0.2.1:5433` (blackhole) | — | 7 334 ms, `indeterminate`, ladder **descended** |

### ⚠️ What this slice does **not** have, stated plainly

1. **The two spec files are typechecked and UNEXECUTED by the gate.** Shell Node is **v25.7.0**; `.nvmrc` pins
   **22.13.1** and Node ≥ 23 breaks the local run. No jest signal was manufactured under an unpinned runtime. The
   `17.5 s / 116 passed / 2 failed / 5 skipped` figure comes from a reviewer's own pass, and the elapsed numbers
   should be re-read once on Node 22.
2. **The ladder has never been run against a reachable PostgreSQL after the change.** Every CLI-level case drives
   `DEAD_URL`; the only `open` proof is unit-level, against a bare `net` listener. If the preflight ever answered
   `refused` on a healthy server the CLI would go red (safe) — but `probeServer` at module scope would turn the
   whole end-to-end block, **including "the unmodified repository PASSES"**, into `describe.skip`, and jest would
   report **green**. `test-ratchet.js` compares *failures* against a baseline, not test counts, so it cannot see
   tests that stopped existing.
3. **The central claim — `test:api` no longer overruns 2 400 s — is unobserved.** The docker half rests on a source
   assertion plus a synthetic `spawnSync` proof; no case invokes `docker` for real.
4. **Two scope deviations.** `PRISMA_CLI_PROBE_TIMEOUT_MS = 60000` bounds the `pnpm exec prisma --version`
   fallback although §3.4 says to leave `pnpm` unbounded (the call sits on the same critical path, paid by every
   jest worker at module scope — defensible, but a departure, and the number carries no measurement). And routes A
   and B (`prisma`, host `psql`) stay **unbounded**, so the `indeterminate` branch — the branch that most resembles
   a real CI stall — still descends an unbounded ladder.
5. **`exec()` now throws where its own docstring says it never does.** The new cross-server guard is unreachable
   today (`deriveMaintenanceUrl`/`buildScratchUrl` replace only the path segment), but `dropScratch` reaches
   `exec()` from `cleanup()` inside a `finally` — a throw there escapes past `report(state)` and ends the run with
   no verdict at all, which is `DNC-08` at the address of the `DNC-08` guard. Recorded as a follow-up rather than
   widened into this diff.

`V3-E02` remains **`code-complete`**. `PF-111` and `PF-113` are still its two residuals and neither moved; this
slice repaired the machinery, not the epic's open surface.

### The pointer, as of 2026-08-12 (run 44)

**Next slice → `S-E01-2b`** in **`V3-E01`** (tenant-context hardening, the follow-on to `S-E01-2` / `PF-02(b)`,
landed at `#221`). It is the next selectable story in track a's seam, and the dependency map makes `E01 → E03` a
hard edge, so it must precede any `V3-E03` pick.

**One precondition a human owns, and it is the same one this slice could not discharge:** `S-E01-2b` writes
migrations, so `schema drift` will **not** be skipped — it needs a working PostgreSQL on `127.0.0.1:5433`, which
today **refuses connections** (something unrelated answers on 5432; do not mistake it for the stack). Settling that
database also discharges must-check #2 above in the same motion: with the container up, `node
scripts/schema-drift-check.js` must print `▶ server reachable at <host>:<port>` and reach `▶ migrate diff …`, and a
jest run of `schema-drift-gate.spec.ts` must **not** print the `[schema-drift-gate] no PostgreSQL server answered
at …` warning. Do that before planning the story, not during it.

---

## `TOOL-13` — a suite that stops existing must not read as green (run 45, 2026-08-12)

`TOOL-10` ended with a must-check it could not discharge, and wrote it down: *"`test-ratchet.js` compares failures
against a baseline, not test counts, so it cannot see tests that stopped existing."* This slice closes that
sentence.

**The defect is one direction of wrongness.** A merge gate may cry wolf; it may **never** report green about a
check it did not perform. `scripts/test-ratchet.js` decided on a **set of failures** — `t.status === 'failed'`
plus one `<suite failed to load>` sentinel — and compared it against a baseline of failures. A test that stops
executing is not a failure. So it was not in the set. So the gate said `✓ no drift.`

**Measured here, on `HEAD`, before anything was written:**

```
{"total":124,"passed":119,"failed":0,"pending":5}
schema-drift-gate.spec.ts  {"passed":105,"pending":5}
    pending | … the unmodified repository PASSES — the gate is not red on correct code (AC-2)
    pending | … leaves no scratch database behind (AC-11)
    pending | … the ledger really builds the schema the datamodel describes (AC-2)
    pending | … a datamodel the ledger does not build FAILS, naming the drifted object (AC-1)
    pending | … a migration that does not execute on PostgreSQL FAILS (AC-3)
```

`numFailedTests` is **0**, and the ratchet's verdict on that report was `✓ no drift.` — including about the one
case whose entire job is to prove the drift gate is *not red on correct code*. It has never executed on this
machine, and nothing said so.

### What landed

| Piece | Why it is that and not something cheaper |
|---|---|
| `scripts/lib/ratchet-core.js` — a **pure** decision layer (319 lines): `NOT_EXECUTED_STATUSES`, `LOAD_FAILURE_SENTINEL`, `suiteKey`/`testKey`, `reduceReport`, `compareToBaseline`, `formatInactiveWarning` | A module, **not** an env var and **not** a `--report-file` flag: a gate whose input can be chosen from the environment is a gate that can be bypassed (`DNC-10`, pinned by a source case). Purity is what makes the evidence fixture-driven — hand-written jest reports through *the exact code the gate runs*. No `require(`, no `process.`, no clock, no `console.` — asserted |
| `NOT_EXECUTED_STATUSES = pending · todo · skipped · disabled`, with the measurement in its comment | `describe.skip` and `it.skip` surface as **`'pending'`**, not `'skipped'`. A `['skipped']`-only set counts **zero** on the real report — the story's #1 pre-mortem, kept as an executed mutant |
| A **rise** fails · a baselined suite **absent** from the report fails · a **fall** is reported, never failed | The asymmetry with the failure list is deliberate and documented in code: a failure key is an *identity*, a skipped count is a *measurement* over a membership that moves for legitimate reasons. Failing on a fall reds the gate on the author who un-skipped a test, and the gate gets routed around within a week |
| `--skip` holds counts out in **both** directions; `--update` under `--skip` stays refused, and its message names the counts as a **second** reason | A partial run has no entry for the suites it did not run, so an `--update` under `--skip` would write a `skipped` block with those suites **deleted** — leaving the ratchet permanently blind to exactly the paths the tiering skips, which are the gate's own meta-tests |
| **`TOOL-16(a)`** — a load failure's cause, read from `suite.message`, ANSI-stripped, truncated with a stated marker, printed for **every** load-failed suite | `suite.failureMessage` does **not** exist in jest 29.7.0's `--json` output; reading it would print nothing forever. Asserted as a mutant rather than trusted |
| **`TOOL-11`** — `exec()`'s cross-server guard **returns** `{ok:false, detail}` with the same refusal words | `exec()` is reached from `cleanup()` ← the `finally` of `check()`. A throw in a `finally` replaces the block's normal completion, so it escaped past `report(state)` and ended the run **with no verdict** — `DNC-08`, committed by the anti-`DNC-08` machinery. The one deletion in that spec file is the old `AC-P7` case, which asserted `.toThrow` and had to move with the shape |
| **`TOOL-12`** — `PSQL_HOST_TIMEOUT_MS = 120 000` and `PRISMA_RUN_TIMEOUT_MS = 300 000`, exported and pinned as **different** from the control-plane bounds | Routes A and B were the last two unbounded spawns on the SQL ladder — the `indeterminate` branch, the one that most resembles a real CI stall, still descended them on every PR. They are **data-plane** numbers: reusing `DOCKER_TIMEOUT_MS` or the version-probe bound would kill a legitimate `migrate deploy` and report `scratch_create_failed` on correct code |

### Measured — this worktree, this diff

```
jest src/shared/quality/{test-ratchet,schema-drift-gate}.spec.ts --runInBand
  {"total":147,"passed":142,"failed":0,"pending":5}          wall 57 s
  test-ratchet.spec.ts        14 → 30 passed   (+16; the 14 byte-identical, diff 475/0, one hunk after :273)
  schema-drift-gate.spec.ts  105 → 112 passed  (+7), 5 pending unchanged — the story's subject, untouched
```

The **real** report above, fed to the new core, reduces to
`skipped = {"src/shared/quality/schema-drift-gate.spec.ts": 5}` — the exact five the old ratchet called
`✓ no drift.` A baseline two lower yields `{from: 2, to: 5}` → **exit 1**.

`TOOL-12` non-vacuity, balanced against the file as shipped: `run('psql'` and `run(cli.command` are **one site each
at `HEAD`, neither carrying `timeoutMs`; one site each now, both carrying it.** Red before, green after.

`pnpm typecheck` **13/13, exit 0, 5m34s** — 4 errors surfaced on the first pass, all mine, all
`noUncheckedIndexedAccess` on the new cases; fixed, and both specs re-run green. `git diff --check` exit 0.
**`scripts/ci-gate.sh` is byte-identical** (AC-15) — no stage bound moved, up or down.

### ⚠️ The new half ships **disarmed**, deliberately — and here is the operator step

`apps.<app>.skipped` is **absent** from `scripts/known-test-failures.json`. That is a decision, not an oversight. A
skip baseline may only be written from a **complete** run (which is why `--update` is refused under `--skip`), and
this slice was forbidden to produce one: the full `apps/api` suite is ~350 s and currently **non-deterministic**
(`TOOL-16(b)`, explicitly out of scope). Inventing numbers would make the gate *look* armed while comparing against
fiction — the same class of lie the slice exists to remove.

So the ratchet takes the loud path instead:

```
⚠ test-ratchet[api]: … The skip ratchet is INACTIVE for this app; run --update from a COMPLETE run.
✓ test-ratchet[api]: no drift (skipped-count ratchet INACTIVE — baseline has no "skipped" block).
```

**To arm it:** `node scripts/test-ratchet.js api --update`, then `node scripts/test-ratchet.js worker --update`,
each from a complete run, and review the written counts before committing them.

**One residual, stated rather than left unconsidered:** a suite with **zero** recorded skips that vanishes entirely
is still not caught — only baselined suites are checked for absence. Catching that needs a full suite inventory
(the shape of `scripts/web-route-baseline.json`) and is a follow-on, not part of this slice. The comment in
`known-test-failures.json`'s `$doc` says so at the point of use.

`V3-E02` remains **`code-complete`**. `PF-111` and `PF-113` are still its two residuals and neither moved;
`TOOL-15` (the non-hermetic `csv-escape-gate` probe) and `TOOL-16(b)` are untouched and still open.

### The pointer, as of 2026-08-12 (run 45)

**Next slice → `S-E01-2b`** in **`V3-E01`** (tenant-context hardening, the follow-on to `S-E01-2` / `PF-02(b)`,
landed at `#221`). The run-44 pointer above is **not spent** — `TOOL-13` was an operator-supplied gate-hardening
pick that jumped the queue, so `S-E01-2b` is still the next selectable story in track a's seam, and the dependency
map still makes `E01 → E03` a hard edge.

**Its precondition is now shared by three things, which is the argument for discharging it first:** `S-E01-2b`
writes migrations, so `schema drift` will not be skipped and it needs a working PostgreSQL on `127.0.0.1:5433`
(which today **refuses connections**). The same database (a) discharges `TOOL-10`'s must-check #2, (b) un-skips the
five `schema-drift-gate.spec.ts` cases this slice just made *visible* — and the skip ratchet will then see their
count **fall**, report it, and ask for an `--update`, which is exactly the designed behaviour, and (c) makes a
complete, deterministic run possible, which is the precondition for arming the skip baseline at all.

**If the database cannot be settled, the honest alternative pick is `TOOL-16(b)`** — the `apps/api` suite's
non-determinism. It now blocks more than it did this morning: an unarmed skip ratchet is a gate half-built, and
`TOOL-15` says two consecutive full-ratchet runs on the same branch already produce different failure sets, so
`GATE: PASS` on gate-machinery diffs is not reproducible. Nothing downstream gets more trustworthy until that is
fixed.
