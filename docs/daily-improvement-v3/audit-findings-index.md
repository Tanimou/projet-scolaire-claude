# Audit Findings Index — the traceable backbone of Daily Improvement V3

Every V3 epic, story and acceptance criterion traces back to a row in this file. Nothing enters the roadmap without a
finding id; nothing is closed without evidence against the finding.

**Sources** (round-5 authoritative, 2026-08-02)
`A1` = `01_Lakoli_Platform_Audit.md` · `A2` = `02_Internal_Platform_Audit.md` · `A3` = `03_Comparative_Gap_Analysis.md`
`A4` = `04_Exploration_Coverage_Matrix.md` · `E1` = `audit-evidence/lakoli/lakoli_deep-workflow-browser-audit-07.md`
`E2` = `audit-evidence/internal/internal_hosted-multirole-browser-audit-04.md`

**Classification vocabulary** — deliberately *not* collapsed to "missing/present", per A2 Appendix A and A4 §1:

| Code | Meaning |
|---|---|
| `BROKEN_RUNTIME` | Route/action exists and fails at runtime |
| `BROKEN_TRUTH` | Multiple surfaces report mutually incompatible facts from one dataset |
| `BROKEN_SECURITY` | Reachable path violates tenancy, ABAC or privilege boundaries |
| `SOURCE_ONLY` | Implemented in repo; hosted API/schema cannot serve it |
| `BACKEND_ONLY` | Endpoint/model exists with no reachable product control |
| `UI_ONLY / MOCK` | Surface exists without dependable backend truth |
| `NOT_IMPLEMENTED` | Explicitly deferred or absent |
| `BLOCKED_BY_DEPENDENCY` | Needs a record, provider, credential or installed dependency |
| `MISSING_CAPABILITY` | Competitor-proven capability we do not have |
| `DO_NOT_COPY` | Lakoli behaviour we must consciously *not* reproduce |
| `TECH_DEBT` | Working code carrying quantified, tracked debt — added 2026-08-03 for `PF-71`, whose 996 lint warnings are neither a runtime failure nor a security hole, but must not be silenced or forgotten |

**Work-type vocabulary** — drives which V3 layer a finding lands in:
`DEFECT` · `ARCH_PREREQ` (architectural prerequisite) · `CAPABILITY` (net-new) · `VALIDATION` (evidence, not code).

---

## 1. P0 — release-blocking (Pilotage)

| ID | Finding | Class | Type | Source | Layer | Epic |
|---|---|---|---|---|---|---|
| **PF-01** | New/unmapped authenticated profiles are attached to a hard-coded `demo` tenant (`UserSyncService`, public registration) | `BROKEN_SECURITY` | ARCH_PREREQ | A2 §11, §14; E2 | L0 | V3-E01 |
| **PF-02** | `withTenant` helper exists with **no call sites**; no `CREATE POLICY` / `ENABLE ROW LEVEL SECURITY` anywhere. The "repositories are RLS-isolated" comment is unsupported | `BROKEN_SECURITY` | ARCH_PREREQ | A2 §11, §14; E2 | L0 | V3-E01 |
| **PF-03** | Production startup runs `prisma db push --accept-data-loss`; repository has **no SQL migration history**; prod compose runs demo seed outside `NODE_ENV=production` | `BROKEN_SECURITY` | ARCH_PREREQ | A2 §12, §14; E2 | L0 | V3-E02 |
| **PF-04** | One dataset yields mutually incompatible grade/assessment/enrollment/alert counts across admin, teacher, parent, student | `BROKEN_TRUTH` | ARCH_PREREQ | A2 §5.1, §5.3, App. D | L0 | V3-E03 |
| **PF-05** | Parent grades page returns **zero** for a child whose published grade is visible on dashboard, subjects, printable report and the student portal | `BROKEN_TRUTH` | DEFECT | A2 §7, §14; E2 | L0 | V3-E03 |
| **PF-06** | Attendance can **silently partially save**; downstream rates then consume corrupt completeness | `BROKEN_RUNTIME` | DEFECT | A2 App. C.3, App. G | L1 | V3-E09 |
| **PF-07** | Two attendance read endpoints have **no teacher ABAC** — any teacher reads any class's roster and student PII | `BROKEN_SECURITY` | DEFECT | A2 App. C.2, App. G | L0 | V3-E05 |
| **PF-08** | Custom roles are **global across tenants** — cross-tenant read, write and delete of another school's roles and permission sets | `BROKEN_SECURITY` | DEFECT | A2 App. C.3, App. G | L0 | V3-E05 |
| **PF-09** | An administrator can mint a role carrying permissions they do **not** themselves hold (privilege escalation) | `BROKEN_SECURITY` | DEFECT | A2 App. C.3, App. E | L0 | V3-E05 |
| **PF-10** | Coefficient-matrix save accepts **foreign-tenant identifiers**, re-weighting another tenant's averages | `BROKEN_SECURITY` | DEFECT | A2 App. B.1, C.3 | L0 | V3-E05 |
| **PF-11** | Notification fan-out **dedup query is not tenant-scoped** | `BROKEN_SECURITY` | DEFECT | A2 App. B.4, C.3 | L0 | V3-E05 |
| **PF-59** | GitHub Actions is **account-locked for billing**, so no CI job starts on any branch. Every check reports `failure` in ~3 s having executed zero steps. V3's premise — gates *executed*, not asserted — has no runner to execute them on; `VAL-01` cannot be satisfied and every gate needing a test run degrades to `evidence: deferred` | `BROKEN_RUNTIME` | ARCH_PREREQ | Discovered by the V3 run of 2026-08-02 | L0 | V3-E02 |
| **PF-62** | **The entire teacher grading REST surface is unmounted in production.** `3341ed0` (2026-06-01) deleted `controllers: [AssessmentsController, GradesController]` from `GradesModule` while exposing `GradesService` to the parent dashboard. Both controller files still exist and still compile; they are simply registered in **no NestJS module anywhere**, so `/api/v1/assessments/*` (create/edit evaluations) and `/api/v1/grades/*` (enter notes, batch, gradebook, flag, revise) return router-level 404. Teachers cannot create an assessment or enter a grade on the hosted deployment | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-02, by executing the suite for the first time | L1 | V3-E02 → V3-E07/E08 |

**PF-62 evidence — measured on the live deployment, not inferred.** Probing
`https://pilotage.srv861861.hstgr.cloud`, using an unmatched path and a mounted path as controls:

```
404  /api/v1/definitely-not-a-route     ← control: unmatched → 404 "Cannot GET …"
404  /api/v1/assessments                ← UNMOUNTED
404  /api/v1/grades/gradebook/x         ← UNMOUNTED
401  /api/v1/notifications              ← control: mounted → guard rejects
```

A mounted-but-unauthorised route answers `401`; these answer `404`, exactly like a route that does not exist.

**Why nobody saw it for seven weeks.** A regression guard for *precisely this defect*
(`apps/api/src/modules/grades/grades.module.spec.ts`) was written on 2026-06-10 (`d0c3841`) and has been **red ever
since** — because the suite had never been executed. This is the concrete cost of `PF-55`, and the reason `S-E02-2` is
not a hygiene story.

**A second, independent defect this exposed.** The local Docker image (built 2026-06-06) *does* carry
`controllers: [AssessmentsController, GradesController]` in its compiled `dist/modules/grades/grades.module.js`, yet
**no ref in the repository** has contained that line since 2026-06-01. The running artefact was therefore built from an
uncommitted working tree and diverges from `main`. Local behaviour stayed healthy while production was broken — which
is why manual testing never caught it either. This is the deploy-gate half of `VAL-10` / `R-05` (compare the running
SHA against the expected one) arguing for its own existence.

**PF-59 evidence.** The GitHub check-run annotation is explicit — no inference involved:

```
GET /repos/Tanimou/projet-scolaire-claude/check-runs/91540293327/annotations
[{"annotation_level":"failure","path":".github",
  "message":"The job was not started because your account is locked due to a billing issue."}]
```

Scope: repository-wide and content-independent. The unrelated Dependabot PR #169 (2026-07-28) fails identically,
as does every `main` run since. Job logs return `BlobNotFound` because no job ever produced any.
Resolution is an account/billing action by the owner — **not** a code change, so no story can close this.
It is a Step-6 *credential/decision-required* stop condition for any story whose gate evidence depends on CI.

## 2. P1 — blocks trustworthy operation

| ID | Finding | Class | Type | Source | Layer | Epic |
|---|---|---|---|---|---|---|
| **PF-60** | The BMAD sprint workflow **silently overrides the routine's story selection**. `bmad/workflows/sprint.workflow.js:138` resolves `epicId = (intake && intake.epic) \|\| ARG_EPIC`, so the intake agent's own pick beats the operator override in `args`; the prompt (line 125) only asks it to "honor it unless clearly unsafe". Observed live: the routine selected `S-E02-1` and the workflow started implementing `S-E06-2`. **V3's layer/priority selection rule becomes decorative — the V2 failure mode V3 exists to prevent** | `BROKEN_RUNTIME` | ARCH_PREREQ | Discovered by the V3 run of 2026-08-02 | L0 | V3-E02 |
| **PF-63** | **7 `AnalyticsService.adminDashboard` specs are red** — every one dies on `TypeError: Cannot read properties of undefined (reading 'getTime')`, i.e. the spec's academic-year fixture no longer supplies a date the service reads. The admin dashboard's cycle drill-down, teacher-coverage, grading-rate and student-teacher-ratio figures therefore have **no passing test behind them** — precisely the numbers `PF-04`/`PF-36` say disagree across portals | `BROKEN_TRUTH` | DEFECT | Discovered by the V3 run of 2026-08-02 (first execution of the suite) | L0 | V3-E03 |
| **PF-64** | **4 remediation specs are red on stale Prisma test doubles** — `this.prisma.booking.updateMany is not a function` (3) and a missing model on the catalogue query (1). The catalogue one asserts *tenant scoping*, so a **G-TENANT guard is currently not executing**; the transition ones cover the teacher booking state machine | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-02 | L1 | V3-E10 |
| **PF-65** | **5 `SnapshotRecomputeService.recomputeScope` specs are red**: the harness captures **no snapshot write at all** (`Cannot read properties of undefined`), so the assertions that snapshots are byte-identical to the live computation, and idempotent, never run. Attribution between a stale harness and a genuinely inert snapshot pipeline is **not yet established** — if it is the pipeline, this is the same defect as `PF-24` and the analytics layer has no G-TRUTH evidence at all | `BROKEN_TRUTH` | DEFECT | Discovered by the V3 run of 2026-08-02 | L0 | V3-E03 |
| **PF-66** | **2 parent-digest specs are red**: the rendered digest does not contain the absolutised recommended-action CTA the spec asserts, and the cron re-entrancy guard dies on `release is not a function`. The guard that stops a parent receiving **duplicate digests** is therefore unverified | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-02 | L1 | V3-E11 |
| **PF-67** | **Nothing boots either Nest application, so a type-correct change that breaks dependency injection ships green.** Originally raised (run 5) as "the module-wiring guards assert on module *source*, not on a booted route table" — `grades.module.spec.ts` reads the module as text because importing it pulls `AuthModule → JwtStrategy → jwks-rsa → jose` (pure ESM) into a CommonJS ts-jest runtime. **Widened run 10 by a second, independent trigger** (`S-E02-8`): `eslint --fix` for `@typescript-eslint/consistent-type-imports` rewrites constructor-injected imports to `import type`, erasing the runtime `require()` so TypeScript emits `design:paramtypes` as `[Object, Object, Object]`. Measured on `analytics.service.ts`: 3 relative `require()` → 0. `tsc --noEmit -p tsconfig.json` **executed on the broken file returns exit 0**, `nest build` passes, ESLint is satisfied because it authored the change, and the wiring guards never look at a constructor. So the class is not "the guards are textual" but "**nothing starts the app**". One trigger is now fenced (`packages/eslint-config/decorator-metadata.js` + a guard binding the exemption to `emitDecoratorMetadata` in both directions); the class is open. Closing it needs `Test.createTestingModule({imports:[AppModule]}).compile()` or a route-table snapshot in an ESM-capable jest project | `BROKEN_RUNTIME` | ARCH_PREREQ | Discovered by the V3 run of 2026-08-02 (run 5); widened run 10 | L0 | V3-E02 |
| **PF-68** | **The VAL-10 release manifest shipped inert**, for two independent reasons: (a) **nothing anywhere set `GIT_SHA`/`BUILD_SHA`** — no Dockerfile `ARG`, no compose `build.args`, no deploy export — so `buildSha()` returned `"unknown"` in every environment; (b) **`/version` was unroutable**: nginx proxies `/api/`, but `/version` is excluded from Nest's global `api/v1` prefix, so it fell through to `location /` → Next.js and an external caller got the *web app's* 404. Verified against the hosted deployment. Both fixed by `S-E02-6`; the **residual** open half is that worker/web carry a `GIT_SHA` but expose no HTTP manifest (a worker/web drift is undetected), and the gate publishes `schemaVersion` without comparing it to the checkout's latest shipped migration | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-03 | L0 | V3-E02 |
| **PF-69** | **`apps/api/prisma/` is a fourth TypeScript project that neither passes typecheck nor is gated by one.** The api's own `tsconfig.json` sets `include: ["src/**/*"]`, so `pnpm typecheck` — the gate `PF-55` declared green — never looks at the 7 seed scripts (~2 900 lines) that write the demo dataset. Running their own `prisma/tsconfig.json` fails: `seed-demo-parent.ts:53` and `seed-demo-teacher.ts:49` both do `(await res.json()).access_token` on a `unknown`-typed body (TS2571). **Verified pre-existing**, byte-identical to `HEAD`, not introduced by `S-E02-4`. The same directory is invisible to **lint** as well: the api's script is `eslint "{src,test}/**/*.ts"`, which excludes `prisma/`. Three halves: fix the two casts, add `prisma/tsconfig.json` to `ci-gate.sh`'s typecheck stage, and widen the api lint glob — so the directory that writes the entire demo dataset stops being invisible to both gates | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-03 | L0 | V3-E02 |
| **PF-70** | **The `lint` stage of `scripts/ci-gate.sh` is fictional, and has never passed.** ESLint was upgraded to **v9**, which requires a flat `eslint.config.js`, but **no package has one**: the repo ships `apps/*/.eslintrc*` (v8 format) and five workspace packages whose lint script is a bare `eslint .` with no config at all. Executed: `@pilotage/i18n` is a turbo **cache miss**, actually runs, and fails with *"ESLint couldn't find an eslint.config.(js\|mjs\|cjs) file"* — this is what makes `ci-gate.sh` print `GATE: FAIL`. `@pilotage/contracts` reported ✓ in the same run purely as a **cache hit**; running its `eslint .` directly reproduces the identical failure. So four of the lint tasks are green only from turbo cache predating the v9 bump, and the one that truly executes is red. **Consequence:** runs 5, 6 and 7 each declared their change green while citing typecheck/ratchet/build and never reporting that gate stage 2 was failing — the R-21 failure mode in a new shape, a gate stage that is *executed but permanently red* and quietly reported around. Fixing it is a repo-wide flat-config migration, deliberately **not** attempted inside `S-E02-4` | `BROKEN_RUNTIME` | ARCH_PREREQ | Discovered by the V3 run of 2026-08-03 | L0 | V3-E02 |
| **PF-71** | **996 lint warnings became visible the moment the lint gate started running** (`S-E02-7`, closing PF-70). Measured per package once every package exited 0: web 597, api 321, worker 49, ui 24, imports-core 5; contracts, design-tokens and i18n are clean. They are dominated by three rules — `import/order`, `@typescript-eslint/consistent-type-imports` and `@typescript-eslint/no-explicit-any` — and **952 of the 996 are auto-fixable** (`eslint --fix`). This is not new debt; it is debt that was never measurable because no package could load a config. Warnings do not fail a build, so the gate is genuinely green: this finding exists so the number is tracked and can be ratcheted down deliberately (a `--max-warnings` ceiling that only ever decreases) rather than discovered again later as a surprise. — **CORRECTED 2026-08-03 (run 10, `S-E02-8`), and the correction is the point: "auto-fixable" ≠ "safe to auto-fix."** 243 of the 952 are `consistent-type-imports` in `apps/api` and `apps/worker`, the only two packages inheriting `emitDecoratorMetadata`; the autofix rewrites constructor-injected imports to `import type`, which erases the runtime `require()` and collapses `design:paramtypes` to `[Object, …]`, so Nest cannot resolve the provider at boot. Measured on the emitted JS of `analytics.service.ts`. `tsc --noEmit` returns **exit 0** on the broken file and `nest build` passes, so a repo-wide `--fix` would have shipped an outage that every gate called green (see **R-24**, and `PF-67`, which this widens). **Closed:** 996 → 44 via `scripts/lint-ratchet.js`; the 243 were resolved by removing the rule where it is incorrect, not by "fixing" them | `TECH_DEBT` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 9); corrected and closed run 10 | L0 | V3-E02 |
| **PF-72** | **`pnpm build` reports success while producing an empty worker artefact.** `apps/worker/nest-cli.json` sets `deleteOutDir: true`, and `apps/worker/tsconfig.json` inherited `incremental: true` from `@pilotage/tsconfig/base.json`. The two are silently destructive in combination: the build **deletes `dist/`**, then asks a compiler holding a `.tsbuildinfo` that says every file is already emitted to emit — and it emits **nothing**, exiting **0**. Measured during `S-E02-9`: with the stale build-info present, `nest build` produced **0 files, exit 0**; removing *only* the build-info and rerunning produced **53 files including `main.js`, exit 0**. `apps/api` is unaffected solely because it carries an explicit `incremental: false`, which until now looked like a stylistic difference between two app configs rather than a load-bearing setting. **Nothing in the repository noticed**: `pnpm build` exits 0, and turbo — whose `build` task declares `outputs: ["dist/**", …]` — caches the empty `dist/**` as that build's successful output and replays it on every later cache hit, so the emptiness is *propagated*. `.tsbuildinfo` is gitignored, so a clean clone reproduces it as soon as anything builds twice. A hosted deploy is protected only by Docker's fresh-checkout builds; any workflow reusing a workspace or a warm turbo cache can ship a worker image with no `main.js`. Found by the boot check the moment it tried to load an artefact instead of reading source — the same class as `PF-67`, one layer earlier: not "the app does not boot" but "**there is no app to boot, and every gate said fine**". Fixed in `S-E02-9` by pinning `incremental: false` in the worker, with a guard asserting that *every* app whose `nest-cli.json` deletes its outDir resolves `incremental: false` through `tsc --showConfig` | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 11) | L0 | V3-E02 |
| **PF-73** | **`engines.node` blesses a Node version on which the API cannot start.** The root `package.json` declares `"node": ">=20.0.0"`, but `apps/api/src/shared/auth/jwt.strategy.ts` imports `jwks-rsa` at module top level, and `jwks-rsa@4`'s `src/utils.js` does a CommonJS `require('jose')` — and `jose@6.2.3` is **ESM-only** (`dist/webapi/index.js` begins with `export {…}`; measured directly while diagnosing `PF-67`). `require()` of an ESM module is unflagged only from Node **22.12**. So on Node 20, loading `AuthModule` — which is on the boot path via `AlertsModule` — throws before the application starts. In practice everything runs 22: `.nvmrc` says `22`, both Dockerfiles pin `22.13.1`, and CI sets `NODE_VERSION: '22'`. The defect is therefore **latent**, not live: it is a declared support range that is wrong, which will mislead the first contributor who honours it. **Stated limitation:** this was **not executed against a Node 20 runtime** — the ESM-only packaging of `jose` and the CJS `require` in `jwks-rsa` were both verified directly, and the failure on Node 20 is inferred from the documented require(ESM) support matrix rather than measured. Fix is one line (`>=22.12.0`), but it belongs with a deliberate engines review rather than being smuggled into an unrelated slice. **CORRECTED 2026-08-03 (run 14, `S-E02-12`) — the prescription above is wrong in both directions, and is left in place only so the correction is legible.** Measured against all **671** installed packages that declare `engines.node`: `>=22.12.0` **excludes** Node 20.19.x, which every dependency accepts (`require(esm)` was **backported to 20.19**, and `jwks-rsa@4.0.1` states exactly that itself — `^20.19.0 \|\| ^22.12.0 \|\| >= 23.0.0`), and it **blesses** 22.12.x and 23.x, which `eslint-visitor-keys@5.0.1` refuses (`^20.19.0 \|\| ^22.13.0 \|\| >=24`). The finding also understated the blast radius: run against the unfixed repository, the new gate named **35** contradicting dependencies, not one. The declared range is now `^22.13.1 \|\| >=24.0.0` — deliberately narrower than the compatible set, because `engines` is a *support* statement — and it is checked by `scripts/runtime-engines-check.js` rather than asserted | `TECH_DEBT` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 11) | L0 | V3-E02 |
| **PF-74** | **Nothing asserted that the Next.js build emitted anything, and `/version/web`'s `force-dynamic` was documented but unenforced.** `R-25`'s residual half, given an id so its closure is traceable. *(Recorded in `traceability-matrix.md` and `risk-register.md` by run 13 but never added here — the omission was caught and repaired by run 14.)* Measured: with `apps/web/.next` moved aside in its entirety, `node scripts/boot-check.js` returned **exit 0**, and `grep -rn '\.next' scripts/` returned nothing — no stage of `ci-gate.sh` read the directory at all. turbo's `build` task declares `outputs: [".next/**", …]`, so the caching rule that replayed `PF-72`'s empty `dist/` applies verbatim. The sharp half: `/version/web` is the web third of the release gate (`S-E02-10`, **R-05**) and its own header states `force-dynamic` is mandatory, yet deleting that one line left the route present, the build green, and the gate answering 200 with a build-time constant | `TECH_DEBT` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 13) | L0 | V3-E02 |
| **PF-75** | **`engines.pnpm` blesses a pnpm major that never produced this lockfile.** The root declared `"pnpm": ">=8.0.0"` beside `packageManager: "pnpm@9.12.3"`, while `pnpm-lock.yaml` carries `lockfileVersion: '9.0'` — pnpm 8 writes lockfile 6.0. The same shape as `PF-73`, in the same field: a support claim nothing ever checked. Now `>=9.0.0`, with the floor required to sit inside the `packageManager` pin's major, and `ci.yml`'s `PNPM_VERSION` required to equal that pin | `TECH_DEBT` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 14) | L0 | V3-E02 |
| **PF-76** | **`.nvmrc` and `ci.yml` pinned a floating Node major that includes the window in which the API cannot boot.** `PF-73` called itself latent because "in practice everything runs 22"; it was latent for a weaker reason than that. A bare `22` *declares* 22.0.0–22.99.x, which includes 22.0–22.11 — the range where `jose@6` cannot be `require()`d and `AuthModule` cannot load. It was safe only because nvm and `actions/setup-node` happen to resolve a bare major to the newest release; a statement that is true by accident is the same defect one level down. Both now pin **22.13.1**, equal to the three `ARG NODE_VERSION` defaults, with the agreement checked | `TECH_DEBT` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 14) | L0 | V3-E02 |
| **PF-77** | **The routine's single-writer lock expires mid-run, and a concurrent tick reaps it and resets the working tree.** `routine-lock.sh` reclaims a `write.lock` whose heartbeat is older than `STALE_MIN` (60 min). V3's Step 4 says "heartbeat while polling" the build, and nothing asks for a heartbeat during **Step 3**, which in every run since run 9 has taken well over an hour. Measured on run 15: the lock was acquired at 20:03 and, with no heartbeat since, a **second V3 tick at 21:08 reaped it as stale**, took it, and released it at 21:11 — so from 21:09 the run held no lock while still writing to the checkout, which is precisely the pile-up the lock exists to prevent. The consequence was nearly destructive: re-acquiring the gate ran the salvage path, which `git stash`ed every tracked modification and reset the branch to `origin/main`. The work survived **only** because that salvage stash exists; the untracked new files survived by not being tracked. Two defects, one mechanism: the routine's own protocol does not keep the lock alive long enough to cover the phase that takes longest, and `heartbeat` reporting `no lock held` is the only signal that the guarantee has already lapsed | `BROKEN_RUNTIME` | DEFECT | Discovered by the V3 run of 2026-08-03 (run 15) | L0 | V3-E02 *(routine)* |
| **PF-78** | **Tracing is configured end to end and emitted by nothing.** `infra/docker-compose.yml` declares a `jaeger` service and sets `OTEL_EXPORTER_OTLP_ENDPOINT: http://jaeger:4318` in the shared application environment, so every application receives a collector endpoint. No application imports an OpenTelemetry SDK or creates a span — `grep -rn 'opentelemetry\|otel' apps/*/src` returns nothing. The only `@opentelemetry/api` in the tree arrives transitively through `prom-client`. This is the trace third of `PF-56`, separated because it is a build rather than a gate: the collector is reachable, the exporter variable is set, and the absence is upstream of both. Left open deliberately by `S-E02-13` rather than half-built | `NOT_IMPLEMENTED` | CAPABILITY | Discovered by the V3 run of 2026-08-03 (run 15) | L0 | V3-E02 |
| **PF-79** | **`apps/web` is the one artefact no observability surface covers — no metrics, no traces.** Recorded as a residual by `S-E02-13` ("apps/web exposes no metrics") and made explicit by `S-E02-14`, which **removed** `OTEL_EXPORTER_OTLP_ENDPOINT` from the `web` service rather than leave a collector declared to an application that could never reach it. The removal must not be read as coverage: web is the artefact users actually touch, and today a slow or failing page is invisible to both Prometheus and Jaeger while api and worker are visible to both. Next.js instruments through its own `instrumentation.ts` `register()` hook and a Next-aware exporter, so it is a different build from the two Nest applications — separated rather than half-built, exactly as `S-E02-13` separated traces from metrics | `NOT_IMPLEMENTED` | CAPABILITY | Discovered by the V3 run of 2026-08-03 (run 16) | L0 | V3-E02 |
| **PF-12** | Parent child/enrollment state contradicts itself: dashboard/detail say active; children list, "My family" and claim panel say none | `BROKEN_TRUTH` | DEFECT | A2 §7, App. B.7 | L0 | V3-E03 |
| **PF-13** | Class gradebook links pass a **class-section id** where the page expects a **teaching-assignment id**; dashboard "create assessment" shares the broken URL | `BROKEN_RUNTIME` | DEFECT | A2 §6.1, App. B.6 | L1 | V3-E07 |
| **PF-14** | `/admin/audit` crashes (server/client boundary); `/admin/reports` is 404 | `BROKEN_RUNTIME` | DEFECT | A2 §5.6, App. B.5 | L0 | V3-E04 |
| **PF-15** | Active academic year is **2023–2024** on a 2026 audit date; 2026 events attach to it; printable report mixes 2026 generation with 2023–24 | `BROKEN_TRUTH` | DEFECT | A2 §5.2, App. D | L0 | V3-E03 |
| **PF-16** | Whole-school announcement estimated 191 accounts but broke down as 1 parent / 0 teachers / 0 admins / **190 "other"**; the student never received it; recipient roles blank | `BROKEN_TRUTH` | DEFECT | A2 §5.4, §8 | L1 | V3-E11 |
| **PF-17** | Hosted UI ships **development-only Maildev `localhost` instructions** and visible seed artefacts/author labels | `BROKEN_SECURITY` | DEFECT | A2 §4, §12 | L0 | V3-E06 |
| **PF-18** | Student identity client is **aliased to the parent client**; student password reset targets the parent client | `BROKEN_SECURITY` | DEFECT | A2 §8, §11 | L0 | V3-E01 |
| **PF-19** | `/admin/classes/new` is linked prominently but falls into the `[id]` dynamic route and crashes | `BROKEN_RUNTIME` | DEFECT | A2 §5.2, App. B.1 | L0 | V3-E06 |
| **PF-20** | Dashboard enrollment/alert totals disagree with their own queues and rule lists (28 pending vs empty queue; 4 alerts vs 0 rules) | `BROKEN_TRUTH` | DEFECT | A2 §5.1 | L0 | V3-E03 |
| **PF-21** | Student **date of birth is silently dropped** on create/read-back | `BROKEN_RUNTIME` | DEFECT | A2 §5.2, App. G | L1 | V3-E08 |
| **PF-22** | Editing a cahier-de-texte entry returns **400 every time** | `BROKEN_RUNTIME` | DEFECT | A2 App. B.6, C.3 | L1 | V3-E08 |
| **PF-23** | Calendar edit **destroys `cycle_scope`** and drops `academicYearId`; multi-month events are invisible outside their start month | `BROKEN_RUNTIME` | DEFECT | A2 App. B.3, C.3 | L1 | V3-E08 |
| **PF-24** | Snapshot recompute is enqueued but **no consumer exists in this codebase**; comments assert a worker that is not here; the hosted drain cannot mark a repeated scope `done` | `SOURCE_ONLY` | DEFECT | A2 App. C.3, C.4 | L0 | V3-E03 |
| **PF-25** | Wrong password is reported as **"MFA required"**; `mfaEnabled` is hard-coded `false` | `BROKEN_RUNTIME` | DEFECT | A2 App. C.3, G | L0 | V3-E05 |
| **PF-26** | Logout does not end the Keycloak session (no RP-initiated logout); middleware never inspects `session.error`, so dead sessions keep browsing; middleware declares 9 non-existent auth routes | `BROKEN_SECURITY` | DEFECT | A2 App. C.2, C.3 | L0 | V3-E05 |
| **PF-27** | Parent can **terminally close a school-created remediation plan**; no direct booking action | `BROKEN_SECURITY` | DEFECT | A2 §7, App. B.7 | L1 | V3-E10 |
| **PF-28** | Alert filters, exports and totals operate on a truncated **≤100-row per-status window**; announcement engagement truncates at 500; announcement list is unpaginated | `BROKEN_TRUTH` | DEFECT | A2 App. C.3 | L1 | V3-E10 |
| **PF-29** | Calendar "import French holidays" executes **immediately with no confirmation** and wrote 22 rows into the stale active year | `BROKEN_RUNTIME` | DEFECT | A2 §5.5; E2 | L0 | V3-E06 |
| **PF-30** | `POST /grades/batch` is an **N+1 inside a transaction** and fabricates phantom revisions | `BROKEN_RUNTIME` | DEFECT | A2 App. C.3 | L1 | V3-E08 |
| **PF-31** | Role grant/revoke and school mutations write **no audit row** (ADR-015 mandates it); audit actor role is hard-coded `school_admin`; `ip_address`/`user_agent`/`hash`/`prev_hash` are **never written** | `BROKEN_SECURITY` | DEFECT | A2 App. B.5, C.2 | L0 | V3-E04 |
| **PF-32** | Audit `to` date filter silently drops the selected end day; **three of four audit KPIs are structurally wrong** | `BROKEN_TRUTH` | DEFECT | A2 App. B.5 | L0 | V3-E04 |
| **PF-33** | An existing class is **29/28 over capacity** although manual enrollment correctly rejects overflow — import/history bypasses the invariant | `BROKEN_TRUTH` | DEFECT | A2 §5.2, App. G | L2 | V3-E12 |
| **PF-34** | Teacher class messaging link is 404; the alternate composer computes **zero recipients** for a class with known families | `BROKEN_RUNTIME` | DEFECT | A2 §6.3 | L1 | V3-E11 |

## 3. P2 / P3 — correctness, safety and credibility

| ID | Finding | Class | Type | Source | Layer | Epic |
|---|---|---|---|---|---|---|
| **PF-35** | Parent attendance mixes a **different class** into the child's history without labelling and shows an invalid **−71.4-point trend** | `BROKEN_TRUTH` | DEFECT | A2 §7 | L1 | V3-E09 |
| **PF-36** | Teacher counts vary 43 / 46 / 48 and one class alternates 25 / 26 | `BROKEN_TRUTH` | DEFECT | A2 §6 | L0 | V3-E03 |
| **PF-37** | New lesson defaults to **Published** — parent-visible before review | `BROKEN_RUNTIME` | DEFECT | A2 §6.2 | L1 | V3-E08 |
| **PF-38** | Legal (`/legal/privacy`, `/terms`, `/cookies`), `/pricing`, `/contact`, `/help` all **404 while parent registration requires accepting them** | `NOT_IMPLEMENTED` | DEFECT | A2 §4; E2 | L0 | V3-E06 |
| **PF-39** | Teacher/parent profile and help links 404; teacher notification settings contain parent copy ("your child"); teacher "Import grades" points into the admin portal | `NOT_IMPLEMENTED` | DEFECT | A2 §6.3 | L0 | V3-E06 |
| **PF-40** | Async KPI counters expose contradictory interim values (parent calendar 14→36; credit 0↔99 analogue) | `UI_ONLY / MOCK` | DEFECT | A2 §14 | L0 | V3-E03 |
| **PF-41** | Guardians list has a hard **200-row ceiling**; filters and export operate on the truncated set | `BROKEN_TRUTH` | DEFECT | A2 App. B.2 | L2 | V3-E12 |
| **PF-42** | `/admin/students` "Niveau" filter is **wired to nothing**; the table **fabricates some metrics as facts**; search triggers a full server render per keystroke | `UI_ONLY / MOCK` | DEFECT | A2 App. B.2 | L1 | V3-E08 |
| **PF-43** | Conversation moderation is **write-only** — `reviewed`/`dismissed`/`blocked` are unreachable | `NOT_IMPLEMENTED` | DEFECT | A2 App. B.4 | L1 | V3-E11 |
| **PF-44** | Meeting request "Clôturer" **resolves** with different semantics — the UI reports a lie | `BROKEN_RUNTIME` | DEFECT | A2 App. B.4 | L1 | V3-E10 |
| **PF-45** | Helmet **CSP is explicitly disabled**; branding values are injected unvalidated into a server-rendered `<style>` | `BROKEN_SECURITY` | DEFECT | A2 §11, App. E | L0 | V3-E06 |
| **PF-46** | `POST /auth/register-parent` is **public, unthrottled and self-verifies email** | `BROKEN_SECURITY` | DEFECT | A2 App. C.3 | L0 | V3-E05 |
| **PF-47** | Enrollment **approval/rejection workflow is explicitly not implemented** | `NOT_IMPLEMENTED` | CAPABILITY | A2 App. B.2 | L2 | V3-E12 |
| **PF-48** | "Documents" / "Ressources" are two full sidebar features over a field **nothing writes**; direct upload deferred | `BACKEND_ONLY` | CAPABILITY | A2 §6.3, App. B.6 | L2 | V3-E13 |
| **PF-49** | `BEHAVIOR_ALERT` can be enabled but **can never fire**; rule bounds are not server-enforced and the UI minimum disagrees with the evaluator | `NOT_IMPLEMENTED` | DEFECT | A2 App. B.3 | L1 | V3-E10 |
| **PF-50** | `/admin/assignments` renders **290 rows unpaginated**; unread counts fetch every message; parent dashboard fans out per child | `UI_ONLY / MOCK` | DEFECT | A2 App. K.4 | L1 | V3-E03 |
| **PF-51** | `PATCH /cycles/grade-levels/:levelId` runs **zero validation** and mass-assigns straight into Prisma; several query params bypass validation; notification `kind` accepts arbitrary strings | `BROKEN_SECURITY` | DEFECT | A2 App. C.2, C.3 | L0 | V3-E05 |
| **PF-52** | `hasPermission()` exists and is **never used** — no client-side permission gating; `users.suspend` is granted with **no implementation**; role revocation is backend-only | `BACKEND_ONLY` | DEFECT | A2 App. C.3 | L0 | V3-E05 |
| **PF-53** | Invite flow and permission rewrites are **non-atomic** and leave orphan/partial state; 18 granted permission codes are absent from the role builder; 5 required codes unseeded | `BROKEN_RUNTIME` | DEFECT | A2 App. C.3 | L0 | V3-E05 |
| **PF-54** | Hard-coded credential fallbacks and development URLs ship in production-facing code | `BROKEN_SECURITY` | DEFECT | A2 App. C.3 | L0 | V3-E06 |
| **PF-55** | 50 spec files exist but **test/typecheck execution is blocked** by missing dependencies and generated artefacts; no CI evidence of pass | `BLOCKED_BY_DEPENDENCY` | VALIDATION | A2 §13 | L0 | V3-E02 |
| **PF-56** | Optional observability only; no traces, SLOs, alert delivery or restore exercise; landing-page availability/security claims unvalidated | `BLOCKED_BY_DEPENDENCY` | VALIDATION | A2 §13, §4 | L0 | V3-E02 |
| **PF-57** | Student portal has **no profile/settings** surface; help 404 | `NOT_IMPLEMENTED` | CAPABILITY | A2 §8 | L2 | V3-E06 |
| **PF-61** | `risk-register.md` carried **two different risks under the id `R-17`** — the CI-billing risk (added alongside PF-59) and the market-decision risk that `open-decisions.md` D-04 and `roadmap.md` already referenced. Any cross-reference to "R-17" was therefore ambiguous, including the routine's own Step-1 read | `BROKEN_TRUTH` | VALIDATION | Discovered by the V3 run of 2026-08-02 | L0 | V3-E02 |
| **PF-58** | The entire V3 substrate (4 audits, 17 planning docs, 40 evidence files) was authored **only as untracked files inside a throwaway git worktree** and never committed. `main` had none of it, so the routine's Step 1 — which reads `roadmap.md`, `traceability-matrix.md`, `dependency-map.md`, `risk-register.md`, `open-decisions.md` — could not execute at all. The in-repo routine copy had also drifted behind the installed `SKILL.md` | `BLOCKED_BY_DEPENDENCY` | ARCH_PREREQ | V3 run 2026-08-02 | L0 | V3-E02 |

> **PF-58 is the class of failure the routine is least able to see.** The planning work was done well and lost anyway,
> because "produced" was conflated with "committed". Same conflation as A2 App. A's *UI exists ≠ feature delivered*.
> Mitigation now in force: the in-repo `routine/` copies must be byte-identical to the installed artefacts, so drift is
> a one-line `diff` (see `README.md` → *Where the routine lives*). Related: the known Workflow worktree-path bug, where
> sprint agents edit the main repo rather than their assigned worktree — here the failure ran in the opposite direction.

## 4. Capability gaps proven by Lakoli (`MISSING_CAPABILITY`)

Sequenced *after* L0/L1 by design — see `roadmap.md` §3 for why.

| ID | Capability | Lakoli evidence | Pilotage today | Layer | Epic |
|---|---|---|---|---|---|
| **LG-01** | Fee catalogue: 18 fee types, schedule, cycle/class/service scope, non-retroactive scope changes | A1 §5.3, App. A.2 | Absent | L3 | V3-E15 |
| **LG-02** | Receivable ledger with balance/status/adjustments; post-payment identity lock | A1 App. A.2 | Absent | L3 | V3-E15 |
| **LG-03** | Counter payment: 8 modes, receipt, cashier session, journal | A1 App. A.2 | Absent | L3 | V3-E16 |
| **LG-04** | Daily cash closing with theoretical-vs-counted variance and formal PV | A1 App. A.2 | Absent | L3 | V3-E16 |
| **LG-05** | Two-layer reconciliation (internal ledger + provider settlement) | A1 App. A.2 | Absent | L3 | V3-E16 |
| **LG-06** | Discounts/bursaries, 8 default criteria, targeted grant | A1 App. A.2 | Absent | L3 | V3-E15 |
| **LG-07** | Refund and typed mass-cancellation as dedicated operations | A1 App. A.2 | Absent | L3 | V3-E16 |
| **LG-08** | Forecast-vs-actual budget | A1 App. A.2 | Absent | L4 | V3-E18 |
| **LG-09** | Online payment providers, payment links, signed callbacks | A1 App. C.3 | Absent | L3 | V3-E16 |
| **LG-10** | SMS campaigns: mandatory simulation, 16 trigger events, wallet, delivery log, J+7/30/60/90 ladder | A1 App. A.4 | Absent | L4 | V3-E17 |
| **LG-11** | WhatsApp deep-link assistants | A1 App. A.4 | Absent | L4 | V3-E17 |
| **LG-12** | Unified admissions funnel: `preinscription_creee → paiement_demande → paiement_recu → dossier_complet → validee` + document conformity states | A1 App. A.1 | Enrollment requests exist; approval not implemented | L2 | V3-E12 |
| **LG-13** | Re-enrollment campaign: 6 steps, 4 independent state axes | A1 App. A.1 | Absent | L2 | V3-E14 |
| **LG-14** | End-of-year decisions: 7 outcomes, 6 non-computability codes, publish/freeze/hash/reopen with reason | A1 App. A.1 | Absent | L2 | V3-E14 |
| **LG-15** | 10+ official document generators, registry, branding, QR authenticity | A1 App. A.7 | Bulletins/exports only; reports 404 | L2 | V3-E13 |
| **LG-16** | Timetable: rooms, slots, conflicts, workload, print | A1 App. A.3 | Absent | L4 | V3-E18 |
| **LG-17** | Discipline: incident/measure/convocation lifecycles with Direction validation | A1 App. A.6 | Absent | L4 | V3-E18 |
| **LG-18** | Clubs/activities: 18 types, 16 domains, publication, printed recap | A1 App. A.6 | Absent | L4 | V3-E18 |
| **LG-19** | HR: staff registry, 9 departments, 6 contract types, contract lifecycle | A1 App. A.5 | Absent | L4 | V3-E18 |
| **LG-20** | Statutory payroll: 19 rubric codes, CNPS/CMU/IRPP, batch validation | A1 App. A.5 | Absent | L4 | V3-E18 |
| **LG-21** | Staff timekeeping: 6 event types, bulk four-eyes, monthly report | A1 App. A.5 | Absent | L4 | V3-E18 |
| **LG-22** | Cafeteria / transport / other services as subscription + charge primitives | A1 App. A.2 | Absent | L4 | V3-E18 |
| **LG-23** | Student document control: `a_controler / conforme / a_corriger` with reason | A1 App. A.1 | Empty; no writer | L2 | V3-E13 |
| **LG-24** | Guided tours (63) + 10-step onboarding checklist + 73 help articles | A1 App. A.7 | Thin guidance; help 404 | L2 | V3-E13 |
| **LG-25** | Tenant exit export: reason, name confirmation, idempotency key, SHA-256 manifest | A1 App. A.7 | Exports exist; no whole-tenant package | L2 | V3-E13 |
| **LG-26** | Sensitive follow-up behind **nominative, time- and domain-limited habilitation** | A1 App. A.6 | Absent | L4 | V3-E18 |
| **LG-27** | Bulk import: aliases, preview, 2 000-row cap, receivable side effect, double confirmation | A1 App. A.1 | Async design exists, **runtime unproven** | L2 | V3-E12 |
| **LG-28** | Period closure lifecycle with prechecks; reopen depublishes official results | A1 App. A.3 | Absent | L2 | V3-E14 |
| **LG-29** | Lesson book `draft → submitted → visa → correct` | A1 App. A.3 | Lessons default Published, edit broken | L1 | V3-E08 |

## 5. `DO_NOT_COPY` register — Lakoli behaviours V3 must consciously avoid

Sourced from A3 Appendix C and A1 §11. **V3's routine must fail a story that reproduces any of these.**

| ID | Lakoli behaviour | Why it must not be copied |
|---|---|---|
| **DNC-01** | Debt KPI (~5k) disagrees with detailed ledger (~8k) | Finance loses trust; build ledger invariants first |
| **DNC-02** | Future-dated attendance accepted | Official registers become impossible |
| **DNC-03** | Discipline event date drifts after save | Safeguarding chronology fails |
| **DNC-04** | Public and staff pre-enrollment are separate silos | Duplicate applicants and manual matching |
| **DNC-05** | HR → teacher assignment email deadlock | Cross-module onboarding blocks |
| **DNC-06** | Guides promise deeper behaviour than runtime delivers | Expectation debt |
| **DNC-07** | WhatsApp templates/state in `localStorage`; one hard-coded client template | No central audit or delivery truth; tenant leakage |
| **DNC-08** | AI health audit missed manually reproduced defects | Automation is a signal, never a release gate |
| **DNC-09** | Gated shipped modules labelled "coming soon" | Bundle/support/security ambiguity |
| **DNC-10** | Hard-coded demo-account billing bypass | Backdoor by string comparison |
| **DNC-11** | Refused applicant leaks into official document population | Admission-state/privacy boundary failure |
| **DNC-12** | "Irreversible" cash close contradicted by later mass-cancellation tooling | Accounting policy incoherence |

## 6. Validation obligations (not code — evidence)

| ID | Obligation | Source | Owner lens | Gate |
|---|---|---|---|---|
| **VAL-01** | Clean dependency install + full CI run (lint, typecheck, unit, integration, Playwright, a11y) — **blocked by `PF-59`** (no runner starts) | A2 §13, §16 | Engineering | G1 |
| **VAL-02** | Two-tenant adversarial suite on every read/write/export/job | A2 §16, App. E | Security | G0 |
| **VAL-03** | Migration upgrade/downgrade + backup/restore rehearsal, timed | A2 §16; A3 §8 Phase 0 | Operator | G1 |
| **VAL-04** | Production Keycloak client/redirect/audience review | A2 §16 | Security | G0 |
| **VAL-05** | Provider sandbox: delivery, retry, callback, outage, reconciliation | A2 §16; A3 §4.3 | Finance/Comms | G4/G6 |
| **VAL-06** | Import batch validation → apply → rollback with a synthetic batch | A2 §16; A4 §4.2 | Data migration | G6 |
| **VAL-07** | Custom-role create/edit/deny scenarios | A2 §16 | Security | G0 |
| **VAL-08** | Full WCAG keyboard / screen-reader / contrast audit | A2 §16 | Accessibility | G7 |
| **VAL-09** | Load, queue/DLQ, object-storage and observability/SLO tests | A2 §16 | Operations | G7 |
| **VAL-10** | Confirm which build SHA + Prisma schema version actually run in web/API/worker | A2 App. I Q1–Q2 | Operator | G1 |

## 7. Counting summary

| Bucket | Count |
|---|---|
| P0 defects/prerequisites | 12 |
| P1 | 24 |
| P2/P3 | 26 *(+`PF-71`)* |
| Lakoli capability gaps | 29 |
| Do-not-copy rules | 12 |
| Validation obligations | 10 |
| **Total tracked items** | **121** *(+`PF-72`, `PF-73`, `PF-74`, `PF-75`, `PF-76`, `PF-77`, `PF-78`, `PF-79`)* |

Delta since the 2026-08-02 baseline: **+13**. Four were discovered by V3 runs on 2026-08-02 —
`PF-58` (substrate not on `main`, §3), `PF-59` (Actions billing lock, §1),
`PF-60` (sprint workflow overrides story selection, §2) and `PF-61` (duplicate `R-17` id, §3).
The fifth, `PF-71`, was discovered on 2026-08-03 (run 9) by the act of making the lint gate executable: the 996
warnings it counts had existed all along and were simply unmeasurable while no package could load a config.
The sixth, `PF-72`, was discovered on 2026-08-03 (run 11) by the act of making the *boot* gate executable — the worker
had been building to an empty `dist/` behind a green `pnpm build`, and no gate that reads source could ever have seen
it. `PF-73` was found in the same run while verifying *why* the boot check cannot run inside jest. `PF-74` (run 13)
was `R-25`'s residual half at the web address. `PF-75` and `PF-76` were found on 2026-08-03 (run 14) by the act of
making the *runtime declaration* checkable: `engines.pnpm` blessed a pnpm major that never produced this lockfile, and
`.nvmrc`/`ci.yml` pinned a floating Node major that includes the window where the API cannot boot. `PF-78` was found on
2026-08-03 (run 15) the same way — making the *observability profile* startable exposed that a Jaeger collector and an
`OTEL_EXPORTER_OTLP_ENDPOINT` are declared for three applications, none of which emits a span. `PF-79` was found on
2026-08-03 (run 16) while **closing** `PF-78`: enumerating which services actually receive the OTLP endpoint showed it
was **five**, not three — the variable sat on the shared environment anchor, so the two one-shot jobs got it too — and
narrowing it to the two applications that emit left `apps/web` observable by nothing at all, which needed an id rather
than a silence. All follow the same pattern as `PF-62`: **turning a gate on is what finds the defect it was written
for.**

`PF-77` is the exception to that pattern, and worth naming as such: it was not found by turning a gate on, it was found
by **being bitten**. The routine's own single-writer lock expired mid-run and a concurrent V3 tick reaped it, after
which recovering by re-running `gate` stashed and reset the working tree. It is the first finding in this register
whose subject is the routine's *own* machinery rather than the product, and it is `CRITICAL` (`R-27`) because the
guarantee it breaks — one writer at a time — is what every other run has silently depended on.

*(Bookkeeping note, run 14: `PF-74` was recorded in `traceability-matrix.md` and `risk-register.md` by run 13 but never
added to this index, so the register the routine reads at Step 2 was missing a finding the matrix already tracked.
Repaired inline, the same way run 9 repaired `PF-61`. The check this run built has no equivalent for the planning
substrate itself — a matrix row with no index entry is exactly the class of defect V3 keeps finding in code, and here
it is in the ledgers.)*

Every one of these appears in `traceability-matrix.md` with its epic, story, test and evidence slot.
