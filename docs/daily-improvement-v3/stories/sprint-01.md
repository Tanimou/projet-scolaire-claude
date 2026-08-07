# Sprint 01 stories — release safety and hygiene

**Sprint goal.** Make releases reversible and stop the product advertising that it is a demo. These two epics
(`V3-E02`, `V3-E06`) are the only L0 work with **no upstream dependency**, so they are what the routine can start on
day one.

**Story contract.** Each story is sized for one autonomous run and carries enough context that an agent can implement it
without re-reading the four audit reports. Fields: `id`, `epic`, `finding`, `gates`, `dnc`, `blockedBy`,
`requiresDecision` / `requiresCredential` / `requiresLegalReview`, `preconditions`, `implementation notes`,
`acceptance criteria`, `test`, `out of scope`.

---

## S-E02-0 — Land the V3 substrate on `main` · `in-progress` 2026-08-02

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-58 · **Gates** G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** S · **docsOnly** |

**Why.** The four audits, the 17 planning documents and the 40 evidence files were authored only as *untracked* files
inside the disposable worktree `.claude/worktrees/youthful-chaum-6aad5c`. None of it was ever committed, so `main` had
none of it. Routine Step 1 reads five files that did not exist — **V3 could not perform a single run.** The in-repo
`routine/` copies had also drifted behind the installed `SKILL.md`.

**Acceptance criteria.**
1. The four audits are tracked at the repo root.
2. `docs/daily-improvement-v3/` is tracked in full (17 files).
3. `audit-evidence/` is tracked in full (40 files, including the screenshots the audits cite).
4. `routine/daily-improvement-v3.md` and `routine/routine-lock.sh` are **byte-identical** to the installed artefacts
   under `~/.claude/scheduled-tasks/daily-improvement-v3/`, so drift is detectable with `diff`.
5. Every one of routine Step 1's six reads resolves against `main`.

**Test.** None — `docsOnly`, no executable surface. Evidence is the tracked file set plus a clean `diff` against the
installed routine.

**Out of scope.** Any product change. This story only makes the routine runnable.

---

## S-E02-1 — Baseline migration from the hosted schema, and stop `db push` · 🟡 `partial` 2026-08-02

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-03, VAL-10 · **Gates** G-MIGRATION |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

> **Status 2026-08-02.** The **code half is delivered and evidenced** (baseline committed, `db push` gone from every
> executable path, fail-safe migrator, boot preflight, `/version` manifest — see `docs/spec/features/v3-e02/PROGRESS.md`).
> The **hosted half is not**: introspecting and baselining the production database needs credentials the unattended
> routine does not hold, so implementation note 1–2 became `docs/runbooks/baseline-hosted-database.md` instead.
> Because the baseline was generated from `schema.prisma` rather than from the hosted database, the runbook's **drift
> check is mandatory before `migrate resolve`** — a non-empty diff is S-E02-5, not a baseline.

**Why.** Production startup runs `prisma db push --accept-data-loss` against a database with **no migration history**.
No one can prove which schema transition produced the hosted database, or roll one back. This is the single change that
makes every later schema fix survivable.

**Preconditions to verify first (Step 2 of the routine).**
- Confirm the compose/migrator still invokes `db push --accept-data-loss`.
- Confirm `prisma/migrations/` is absent or empty.
- Capture the **hosted** schema (not `schema.prisma`) — they are known to differ; A2 App. C.4 records the hosted
  database as pre-E11 while the source is newer.

**Implementation notes.**
1. Introspect the **hosted** database and generate a baseline migration that reproduces it exactly.
2. Mark the baseline as already-applied on the hosted database (`migrate resolve --applied`), so no destructive
   replay occurs.
3. Replace `db push` in every non-development profile with `migrate deploy`.
4. Add a startup preflight that fails loudly if `migrate status` is not clean.
5. Leave `schema.prisma` alone in this story — reconciling source-vs-hosted drift is `S-E02-5`.

**Acceptance criteria.**
1. `prisma migrate status` reports clean against the hosted database.
2. No non-development code path invokes `db push`.
3. A deploy with a pending, unapplied migration **fails preflight** rather than mutating the schema.
4. The baseline migration file is committed and reviewable.
5. The running schema version is reported by a health/manifest field (VAL-10).

**Test.** Restore a snapshot into a scratch database; apply the baseline; assert schema equality with the source
snapshot. Negative: introduce a pending migration and assert the preflight blocks.

**Out of scope.** Any schema *change*. This story only establishes the ledger.

---

## S-E02-2 — Make CI actually run (clean install, generate, gate)

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-55, VAL-01 · **Gates** — |
| **blockedBy** | — · **Size** M |

**Why.** 50 spec files exist (32 API, 12 worker, 6 web/Playwright) but **none could be executed** in the audited
worktree: Jest absent, API typecheck cannot resolve Jest types, worker cannot resolve a workspace tsconfig, web cannot
resolve Next/React/generated `.next` route types. Their presence is therefore not evidence of passing.

**Implementation notes.**
1. CI job: clean lockfile install → `prisma generate` → `next build`-time type generation → lint → typecheck → unit →
   integration → Playwright → axe.
2. Fix the workspace/tsconfig resolution errors the audit named, rather than skipping those packages.
3. Gate merges on the result. Report per-suite pass counts in the PR.
4. Do **not** silence failing tests to make the gate green — a genuinely failing suite is a finding; record it.

**Acceptance criteria.**
1. CI runs all six stages from a clean install and fails the build on any failure.
2. Every currently-existing spec file is either executed or explicitly listed as skipped **with a reason and a finding
   id**.
3. Local `pnpm typecheck` succeeds in each app.
4. The routine's Step 4 build result and the CI result agree.

**Test.** The CI run itself is the evidence. Add a deliberately failing test on a branch to prove the gate blocks.

**Out of scope.** Writing new tests for uncovered domains (that belongs to each domain's epic).

---

## S-E02-3 — Timed backup → restore rehearsal

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** VAL-03 · **Gates** G-MIGRATION |
| **blockedBy** | S-E02-1 · **requiresDecision** **D-01** · **Size** S |

> **STOP condition.** D-01 (backup/restore window) is unresolved. The routine must **not** start this story; it should
> report that D-01 blocks it and select the next eligible story.

**Why.** Risk R-01: the first tenancy migration is an unrecoverable bet without a proven restore.

**Acceptance criteria.** A restore into a scratch stack completes, is timed, and the restored data is verified against a
checksum/row-count manifest · the duration is recorded as a baseline SLO · sign-off is captured in `open-decisions.md`.

---

## S-E02-4 — Seed cannot run in production; demo tenant becomes explicit · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-03 (seed half), R-12 · **Gates** G-MIGRATION |
| **blockedBy** | S-E02-1 · **Size** S |

**Why.** Production compose deliberately runs demo seed logic outside `NODE_ENV=production`, and the hosted deployment
visibly contains seed records and internal author labels (A2 §12; PF-17).

> **Step 2 found the defect wider than written.** Not "the compose runs seed outside production" but three compounding
> facts: (1) **one of seven** seed scripts carried any guard at all; (2) `docker-compose.prod.yml` neutralised that one
> by forcing `NODE_ENV: development` on the **only** service in the file not given `production`, with a comment stating
> the reason; (3) `deploy-prod.sh` ran all seven **by default** — `--no-seed` was the opt-out. `ALLOW_SEED` existed
> nowhere in the repository. The seed chain firing on every production deploy is the mechanism behind `PF-17`.

**Design — why two signals.** A guard reading only `NODE_ENV` is disabled by one line of compose, which is exactly what
happened. `prisma/seed-guard.ts` therefore decides on `NODE_ENV` (per-service, what the *process* claims) **and**
`DEPLOY_ENV` (stack-level, what the *deployment is*), applying the `S-E02-6` lesson. A disagreement is not resolved in
favour of the permissive value — it is its own refusal verdict, because that disagreement is the historical signature.
`ALLOW_SEED` never lifts a production refusal, so it is an opt-in, not a bypass (DNC-10).

**Implementation notes.** Seed becomes a separately-invoked command that **refuses to run** unless an explicit
`ALLOW_SEED` flag and a non-production profile are both present. Keep a deliberately-labelled demo tenant provisionable
on demand (R-12: stakeholders rely on the demo — do not simply delete it).

**Acceptance criteria.**
1. An attempted seed under the production profile **refuses and exits non-zero**. ✅ — all **7** scripts executed under
   `DEPLOY_ENV=production` *with the correct token*: exit 1, `[refused-production]`, no DB connection opened.
2. The hosted demo remains reproducible via the explicit command. ✅ — `DEPLOY_ENV=demo` + token, executed: the script
   **crosses** the guard and fails downstream on `PrismaClientInitializationError`, proving the guard is not a blanket
   refusal. Runbook: `docs/runbooks/provision-demo-tenant.md`.
3. No seed author label is reachable from a production build. ⛔ **not claimed** — this run stops the seed from *running*;
   removing labels already written to the hosted database, and the UI-visible author strings, is `S-E06-1` plus an
   operator cleanup (destructive action on hosted data → routine STOP condition #3).

**Test.** `apps/api/prisma/seed-guard.spec.ts` — 34/34, covering the decision table, that all seven scripts invoke the
guard *before* `new PrismaClient()`, and that neither the compose override nor the deploy opt-out can return.

**Out of scope.** Removing demo data already present in production (operator); seed author labels (`S-E06-1`);
the ESLint flat-config migration (`PF-70`) and the `prisma/` gate gap (`PF-69`) surfaced while running the gate.

---

## S-E02-6 — The release manifest becomes real, and the deploy gate compares it · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** VAL-10 (second half), PF-68 · **Risk** R-05 · **Gates** G-MIGRATION |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** `S-E02-1` delivered the *exposure* half of VAL-10: `GET /version` returns `buildSha` and `schemaVersion`.
R-05's mitigation asks for more — *"deploy gate compares them"* — and that half did not exist. Step 2 of this run found
the exposure half was itself **inert**, for two independent reasons:

1. **Nothing ever set `GIT_SHA`/`BUILD_SHA`.** No Dockerfile `ARG`, no compose `build.args`, no deploy-script export.
   `buildSha()` therefore returned `"unknown"` in every environment, always.
2. **`/version` was unroutable.** nginx proxies `/api/` to the API, but `/version` is *excluded* from Nest's global
   `api/v1` prefix, so it fell through to `location /` → Next.js. An external caller got the web app's 404. Confirmed
   against the hosted deployment during Step 2.

A manifest that always says `unknown` and cannot be read from outside cannot gate anything.

**Implementation notes.**
1. Two **independent** sources, or the comparison proves nothing: `GIT_SHA` baked into the image at build time
   (`ARG` → `ENV`, all three Dockerfiles), `EXPECTED_GIT_SHA` injected into the container at deploy time.
2. Pure `evaluateRelease()` decision function so the verdict table is unit-testable.
3. Boot preflight refuses a non-servable verdict **in production**, mirroring `assertMigrationsClean`.
4. `location = /version` in nginx (exact match, rate-limited) so the manifest is readable.
5. `scripts/release-gate.sh` re-checks **independently** rather than trusting the verdict the artefact reports about
   itself; `deploy-prod.sh` runs it after `healthy` and fails the deploy on a bad verdict.
6. `deploy-prod.sh` refuses a dirty working tree — the exact root cause of R-05/PF-62.

**Acceptance criteria.**
1. The running artefact's commit is comparable to the expected commit from outside the container. ✅
2. A drifted, dirty or unstamped artefact **fails the deploy**, and refuses to serve in production. ✅
3. Not comparing is reported as `unverified`, never as success (DNC-08). ✅
4. No bypass flag exists (DNC-10). ✅ — locked by a test that tries three plausible flag names.
5. The manifest exposes no tenant data and no connection string. ✅

**Test.** `apps/api/src/shared/release/release-manifest.spec.ts` — 19/19. Plus the script executed against a live API
(fails on the real drifted artefact) and against a synthetic manifest for all five verdicts.

**Out of scope.** Baselining the hosted database (operator, `S-E02-1`); source-vs-hosted schema drift (`S-E02-5`);
worker/web HTTP manifests and schema-version comparison (`PF-68`).

---

## S-E02-7 — The `lint` stage stops being fictional, and covers `prisma/` · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-70, PF-69 · **Risk** R-21 · **Gates** G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** `scripts/ci-gate.sh` has six stages. Stage 2 had never once passed. ESLint was bumped to v9, which stopped
reading `.eslintrc.*`, and **no package in the workspace had a flat `eslint.config.js`** — the three apps carried v8-format
`.eslintrc` files and the five shared packages had no config at all. Turbo replayed pre-bump cache entries as ✓ for
some tasks, and `apps/web` genuinely exited 0 only because `next lint` silently forces eslintrc mode. Runs 5, 6 and 7
each declared their change green while citing typecheck, the ratchet and the build, and never naming stage 2.

> **Step 2 found it wider than PF-70 recorded.** PF-70 was written from one observed cache-miss failure and inferred
> the rest. Executed package by package, **7 of the 8 lintable packages exited 2**; only `apps/web` exited 0, and only
> via the deprecated path. So the lint gate was not "partly cached-green" — it was linting **nothing but web**.

**Design — why flat, and why one format only.** ESLint 9 can be forced back into eslintrc mode with
`ESLINT_USE_FLAT_CONFIG=false`. That would have made the stage pass today and broken on the next major, and it is
exactly the shape of fix V3 exists to refuse: it makes the *report* green without making the *check* real. Both
formats coexisting would be worse still — a package could carry a `.eslintrc` that never loads and believe it is
governed by rules that do not apply. The migration is therefore total: every `.eslintrc*` is deleted, every lintable
package gets an `eslint.config.js`, and a guard asserts that neither condition can silently revert.

**PF-69 folds in.** `apps/api/prisma/` — ~2 900 lines including the seed chain behind `PF-17` — sat outside the lint
glob (`{src,test}/**/*.ts`) *and* outside the typecheck include (`src/**/*`). It is the one directory that writes the
entire demo dataset and the one directory no gate looked at. Both gates now cover it.

**Acceptance criteria.**
1. `pnpm lint` executes in every lintable package and exits 0. ✅ — **13/13 turbo tasks, 0 cached**, executed with
   `--force` so no task could report a stale ✓.
2. A genuine lint error fails the stage. ✅ — probe executed: `no-useless-escape` in `@pilotage/i18n` → **exit 1** at
   package level *and* through turbo. Probe deleted; the stage returns to 0.
3. No package is linted through `next lint`. ✅ — `apps/web` moved to the ESLint CLI with `FlatCompat` over
   `next/core-web-vitals`.
4. `apps/api/prisma/` is inside both gates. ✅ — `eslint .`; `tsc --noEmit -p prisma/tsconfig.json` added to the api
   typecheck script and the two `TS2571` casts fixed. `pnpm typecheck` **13/13, 0 cached**.
5. No gate is weakened to achieve this. ✅ — the six real errors were **fixed**, not disabled; the single
   `eslint-disable-next-line` added is on a deliberate lazy `require()` in a spec and carries its reason.

**Test.** `apps/api/src/shared/quality/lint-gate.spec.ts` — 26/26. Asserts every lintable package has a flat config,
no `.eslintrc*` survives anywhere, no script uses `next lint`, the shared config exports arrays, `ci-gate.sh` still
runs the stage, and the api's `prisma/` coverage. Both negative directions executed: a reintroduced `.eslintrc.js` and
a removed `eslint.config.js` each fail the guard.

**Out of scope, stated.** The **996 warnings** the working gate now surfaces are recorded as `PF-71`, not silenced:
warnings do not fail the build, so this story turns the light on without also demanding the room be tidied in one run.
Linting `scripts/` and `bmad/` (neither is a workspace package) is likewise left open.

---

## S-E02-8 — The warning count becomes a ratchet, and the first cut is taken only where it is safe · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-71 *(closed)*, PF-67 *(widened)* · **Risk** R-23, **R-24 (new)** · **Gates** G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** `S-E02-7` turned the `lint` stage on for the first time and exposed **996 warnings**. Warnings do not fail a
build, so the stage was honestly green and the debt honestly unmeasured — and with nothing holding it, the number
drifts straight back up. That is how it reached 996.

> **Step 2 contradicted the finding, and that is the main result of this run.** `PF-71` recorded "952 of the 996 are
> `--fix`-able, so the first cut is nearly free". The obvious reading — repo-wide `pnpm lint --fix` — would have
> shipped a production outage that every gate reports as green.

**What is actually dangerous.** 243 of the 952 are `@typescript-eslint/consistent-type-imports` in `apps/api` (218)
and `apps/worker` (25) — the only two packages extending `@pilotage/tsconfig/node.json`, the only shared tsconfig
setting `emitDecoratorMetadata`. Nest resolves constructor dependencies from `design:paramtypes`, which TypeScript
only emits when the parameter's type is a **value** import. The autofix rewrites it to `import type`.

Measured on `apps/api/src/modules/analytics/analytics.service.ts`, compiled before and after one `eslint --fix`:

| | `design:paramtypes` | relative `require()` |
|---|---|---|
| before | `[PrismaService, GradesService, RemediationService]` | 3 |
| after | `[Object, Object, Object]` | 0 |

`tsc --noEmit -p tsconfig.json` was **executed on the broken file and returned exit 0**. `nest build` passes. ESLint is
satisfied — it authored the change. The module-wiring guards read module source and never see a constructor. Nothing
in this repository detects it, which widens `PF-67` from "the wiring guards are textual" to "**nothing boots the app**"
and is recorded as new risk **R-24**.

**Design — why the rule is turned off rather than left to rot.** Leaving it on is the actively dangerous option: it
advertises 243 "fixable" findings whose obvious remedy breaks boot invisibly, and no future maintainer will have this
context. The rule is `warn`, so it gated nothing and turning it off weakens nothing. The exemption is keyed to
`emitDecoratorMetadata`, **not** to "looks like a Nest package" — `packages/imports-core` consumes the same `node`
preset but extends `base.json`, has no decorator metadata, and its type imports are fixed normally.

**Acceptance criteria.**
1. The warning count is bounded per package and can only decrease. ✅ — `scripts/lint-ratchet.js` +
   `scripts/lint-warning-baseline.json`, wired into `ci-gate.sh` stage 2 **and** `ci.yml`, with a test asserting the
   two cannot drift.
2. An increase fails the gate. ✅ — probe executed: unused var in `@pilotage/i18n` (ceiling 0) → **exit 1**, naming the
   rule and the delta. Probe removed → exit 0.
3. A ceiling left too high fails the gate. ✅ — executed → **exit 1**, "the ratchet only turns one way".
4. A lintable package cannot escape by omission. ✅ — executed → **exit 1**. This is the rule that stops `PF-69` and
   `PF-70` recurring at a new address; discovery is from the filesystem, not from the baseline.
5. The first cut is taken. ✅ — **996 → 44**: 694 `import/order`, 10 dead `eslint-disable` directives, 5
   `consistent-type-imports` where safe, and 243 where the rule was **removed as incorrect** — recorded as removed, not
   as fixed.
6. No gate is weakened. ✅ — errors still fail outright; the one rule disabled is disabled where satisfying it breaks
   production, with the measurement in the config header and a guard binding the exemption to the tsconfig flag in
   both directions.

**Test.** `apps/api/src/shared/quality/lint-ratchet.spec.ts` — 20/20 (46/46 with `lint-gate.spec.ts`). Asserts every
lintable package has a ceiling, no non-zero ceiling carries a `TODO` note, no stale entries, the total stays ≤ 44, both
gate files invoke the ratchet, exactly `apps/api` and `apps/worker` inherit decorator metadata, both carry the
exemption, no other package does, and the layer turns the rule `off` and records why.

> **The guard caught a bug in this slice.** Its first version detected *zero* decorator-metadata packages — the JSONC
> comment stripper ate `"@/*"` inside `paths` as a block-comment opener, which would have made the whole describe block
> pass vacuously. Replaced with a string-aware scanner. A guard that finds nothing is the failure mode `PF-70` was made
> of, so the first assertion in each block now checks that discovery found something.

**Out of scope, stated.** The remaining **44** warnings (api 9, web 34, ui 1) are debt under a ceiling, not debt gone;
each is named and owned in the baseline. Closing `PF-67` properly needs a booted-application assertion, which needs an
ESM-capable jest project (`AuthModule` → `jose`) — that is the next slice, not a tail on this one. A full ratchet pass
takes ~4–5 minutes. `scripts/` and `bmad/` remain unlinted.

---

## S-E02-9 — Something starts the applications: module graph + booted route table · ✅ `done` 2026-08-03

Authored and delivered in flight by run 11; its full record — including the `PF-72` empty-`dist/` defect the gate found
on its first real run — is in `docs/spec/features/v3-e02/PROGRESS.md`. Closed `PF-67` and `PF-72`; mitigated `R-24`,
opened `R-25`.

---

## S-E02-10 — The release gate stops judging one third of the deployment · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-68 *(closed)* · **Risk** R-05 · **Gates** G-MIGRATION, G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** `S-E02-6` built a real, executed release gate — **for one artefact**. The deployment ships three (`api`,
`worker`, `web`), built and deployed separately; all three already carried a `GIT_SHA` baked at build time and two of
them had nothing that could read it. The gate also *printed* `schemaVersion` without ever comparing it, and never read
`migrations.status` at all.

> **Step 2 measured the residual instead of restating it.** `git show main:scripts/release-gate.sh` was run against
> synthetic deployments and returned **exit 0** for (a) a deployment where only the API answers, and (b) an API at the
> right commit sitting on a database that was **never baselined** — `PF-03`'s exact live state. Both now **exit 1**.

**Design — one comparator, not three.** The obvious implementation copies the comparator into the worker and the web.
Three copies drift, and a drifted copy turns green the third of the deployment it is not looking at — which is how this
finding came to exist. It lives once, in `packages/contracts/src/release/`, the only package all three already depend
on. *(A `@pilotage/contracts/release` subpath export was written first and reverted: this workspace compiles with
`moduleResolution: Node`, which does not read the `exports` map — which is also why the pre-existing `./enums`,
`./dto` and `./events` entries are imported by nothing.)*

**Design — why the worker gets an HTTP socket.** It runs `createApplicationContext` and deliberately has no HTTP
surface. But `docker inspect` reads the *image*, not the process, and R-05 materialised precisely because a running
artefact matched no ref of the repository. A gate that can interrogate one artefact in three is an API gate. The socket
serves one method, two paths, and a payload of a name, two short SHAs and a verdict; everything else is a 404, and it
is published on loopback only.

**Design — why the schema is compared to the checkout.** `migrations.status: clean` means only "every migration *this
image* ships is applied", so an older image is clean about its own lag. The comparison opposes the applied migration to
what **this checkout** ships, read off the filesystem — independent sources, as with the SHA.

**Acceptance criteria.**
1. Every deployed artefact publishes a manifest. ✅ — `GET /version` (api), `/version/worker`, `/version/web`; each
   names itself, and the gate checks that name.
2. The gate interrogates all three. ✅ — executed; a drifted worker and an absent web manifest each **exit 1**.
3. An unreachable artefact is a failure, not a skip. ✅ — executed. The URL variables are addresses, not switches.
4. A misrouted proxy is detected. ✅ — executed: the api manifest answered on the worker path → **exit 1**.
5. The schema is compared, not printed. ✅ — executed: `unbaselined` → 1, and a database `clean` about its own older
   migration → 1.
6. The gate does not delegate its verdict. ✅ — an artefact **claiming** `match` at a foreign SHA → **exit 1**.
7. No bypass flag. ✅ — DNC-10, locked by a test over six plausible flag names.
8. A drifted worker refuses to start in production, as the api does. ✅ — same shared preflight.

**Test.** `apps/api/src/shared/release/release-surface.spec.ts` — 19/19 (38/38 with the comparator spec);
`apps/worker/src/shared/release/version-server.spec.ts` — 8/8, starting a **real** socket on an ephemeral port and
querying it, including an assertion that the response leaks neither `DATABASE_URL` nor `REDIS_URL`.

> **The ratchet caught this slice's own code.** `lint-ratchet.js` returned **exit 1** — `apps/api: 10 warnings exceeds
> the ceiling of 9`, an `import/order` in the file this slice had just rewritten. Fixed at the source; raising the
> ceiling is the move the ratchet exists to refuse.

**Out of scope, stated.** The gate has **never run against the hosted deployment** — it would fail there today, which
*is* the drift. Run against the local stack it fails **4/4**, honestly: those containers predate their manifests. It
proves *which* artefact runs, not that it works. Keycloak, Postgres, Redis, MinIO and nginx are upstream images pinned
by tag and outside this control.

---

## S-E06-1 — Purge development artefacts from production builds · ✅ `done` 2026-08-04

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-17, PF-54 · **Gates** G-AUTHZ |
| **blockedBy** | — · **Size** S |

**Why.** Hosted admin and teacher registration pages ship **Maildev `localhost` instructions**; hard-coded credential
fallbacks and development URLs ship in production-facing code.

**Implementation notes.** Remove the dev-only copy from the registration surfaces; move any fallback credential to
required configuration that fails fast when absent; add a **CI string scan** over the production bundle for
`localhost`, `maildev`, seed author labels and known dev URLs.

**Acceptance criteria.** None of the scanned strings appears in a production build · the scan runs in CI and fails the
build on a hit · absent required configuration fails fast at startup with a clear message rather than falling back.

**Test.** CI scan (evidence) + a startup test asserting fail-fast on missing config.

**Out of scope.** CSP (that is `S-E06-2`).

**Evidence 2026-08-04.** The scan is `scripts/production-artefact-check.js`, wired into **both** `scripts/ci-gate.sh`
(stage 0b) and `.github/workflows/ci.yml`, executed → exit 0 over 562 files (Tier A clean, Tier B 17/17 at baseline);
its spec runs it in both directions over a fixture, so it is shown to fail on the pre-fix state. Fail-fast is
`apps/api/src/shared/config/config-preflight.ts`, called from `main.ts` before `NestFactory.create`, 12 spec cases,
no bypass flag, names-only messages. **AC-1 is honoured over source, not over a built bundle** — no agent may build;
extending the same rules to `.next/server` and `dist/` is carried forward. **`PF-54` closes in code only:** the hosted
master credential is still `admin`/`admin` and its rotation is operator work — see
`docs/spec/features/v3-e06/PROGRESS.md`.

---

## S-E06-2 — Enable CSP and sanitise branding injection

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-45 · **Gates** G-AUTHZ |
| **blockedBy** | — · **Size** M |

**Why.** Helmet is enabled but its **content security policy is explicitly disabled**, and tenant-controlled branding
values are injected unvalidated into a server-rendered `<style>` block — a stored CSS-injection path in a multi-tenant
product.

**Implementation notes.** Validate/whitelist branding values (colour formats, lengths, no `}` or `<`) at write time
*and* escape at render time; adopt a nonce- or hash-based CSP; roll out report-only first, review violations, then
enforce.

**Acceptance criteria.** CSP header present and enforcing · a branding value containing CSS/HTML control characters is
rejected at write and neutralised at render · no console CSP violation on any of the four portals' main journeys.

**Test.** Injection fixture (`}` + `<script>` + `expression(`) asserted rejected and escaped; CSP header assertion per
portal; report-only violation log reviewed before enforcing.

---

## S-E06-3 — Fix `/admin/classes/new` and add a route/link crawl gate

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-19, PF-39 · **Gates** — |
| **blockedBy** | — · **Size** M |

**Why.** `/admin/classes/new` is linked prominently from the classes page and **crashes**, because it falls through to
the `[id]` dynamic route. The same class of defect produces teacher/parent profile 404s and a teacher class-messaging
404. Navigation quality is not currently a build invariant.

**Implementation notes.** Implement the create route as a real page (or change the link to the correct affordance);
then add an **authenticated link crawl per role** to CI that asserts zero internal 404s and zero error boundaries. This
gate is what stops the class of defect, not the single fix.

**Acceptance criteria.** `/admin/classes/new` renders a working create form · the crawl runs for admin, teacher, parent
and student · the crawl fails CI on any internal 404 or error boundary · every currently-known dead link is either fixed
or removed from navigation.

**Test.** The crawl itself; plus an E2E creating a class through the new route and asserting it appears in the list.

---

## S-E06-4 — Legal, help and contact routes exist before consent is requested

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-38 · **Gates** — |
| **blockedBy** | — · **requiresDecision** **D-08** · **Size** S |

> **Partial STOP.** The routine may ship **holding pages**; it may **not author policy text** (risk R-13). If D-08 is
> unresolved, implement the holding pages and leave the content task open.

**Why.** `/legal/privacy`, `/legal/terms`, `/legal/cookies`, `/pricing`, `/contact` and `/help` all return **404 while
parent registration requires accepting the terms and privacy policy**. That is a live consent problem, not cosmetics.

**Acceptance criteria.** Every route referenced by a consent checkbox resolves · the holding page states the policy is
being finalised and gives a contact route · registration links resolve to the correct locale · no invented policy text.

---

## S-E06-6 — Confirmation and explicit scope for bulk/irreversible controls

| | |
|---|---|
| **Epic** | V3-E06 · **Finding** PF-29 · **Gates** G-AUDIT |
| **blockedBy** | — · **Size** S |

**Why.** The calendar "import French holidays" control executed **immediately, with no confirmation**, during the audit
itself — writing 22 rows into the stale active academic year. The audit's own residue disclosure records it. Any control
that writes in bulk must state its scope and ask.

**Implementation notes.** Confirmation dialog naming the exact target (year, count, scope); explicit year selection
rather than implicit active-year; idempotency so a second import does not duplicate; an audit row for the bulk write.

**Acceptance criteria.** No bulk-write control fires without an explicit confirmation naming its scope · the target year
is chosen, not assumed · re-running produces no duplicates · the action writes an audit row with actor and count.

**Test.** Click-without-confirm asserted to write nothing; double-import asserted idempotent; audit row asserted.

---

## S-E02-11 — The web build enters a gate · ✅ `done` 2026-08-03

*No contract was written for this slice before it shipped; its full record — design, nine executed probes and stated
limits — is `docs/spec/features/v3-e02/PROGRESS.md` § S-E02-11. Noted here rather than back-filled, because a contract
written after the fact describes the implementation instead of constraining it.*

---

## S-E02-12 — The declared runtime stops blessing a Node the API cannot boot on · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-73 *(closed)*, PF-75, PF-76 *(both found and closed here)* · **Gates** G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** S |

**Why.** `engines.node` said `>=20.0.0`, and on Node 20.0–20.18 the API cannot start at all: `jwt.strategy.ts` imports
`jwks-rsa` at module top level, `jwks-rsa@4` `require()`s `jose` from CommonJS, and `jose@6` is ESM-only. `AuthModule`
is on the boot path via `AlertsModule`. Nothing in the repository ever checked that claim — the same shape as `PF-69`
(a directory in no gate), `PF-70` (a stage that never ran), `PF-72` (a build that emitted nothing) and `PF-74` (an
artefact nothing inspected).

> **Step 2 contradicted the finding, and that is this slice's main result.** `PF-73` prescribed a one-line fix,
> `>=22.12.0`. Measured against all **671** installed packages that declare `engines.node`, that fix is wrong in
> **both** directions: it excludes 20.19.x, which every dependency accepts (`require(esm)` was backported there —
> `jwks-rsa@4.0.1` says so itself), and blesses 22.12.x and 23.x, which `eslint-visitor-keys@5.0.1` refuses. Run against
> the unfixed repository, the new check named **35** contradicting dependencies where the finding named one.

**Design — why this is not a one-line fix.** Applying the prescription would have replaced an unverified declaration
with another unverified declaration. The declaration therefore becomes arithmetic that runs:
`scripts/runtime-engines-check.js` asserts with `semver.subset` that the root range blesses no Node version any
installed dependency refuses — which catches the *next* bump that raises a floor, not only this one.

**Design — why the declared range is narrower than what works.** The compatible set is 20.19.x · 22.13.x · ≥24; the
declaration is `^22.13.1 || >=24.0.0`. `engines` is a **support** statement, not a compatibility one: 22.13.1 is what
the three Dockerfiles ship, ≥24 is what local development runs on, and 20.19 is compatible-but-untested.

**Design — why `semver` becomes a real dependency.** It was reachable only transitively from pnpm's virtual store. The
alternative is hand-rolling version-range algebra inside a guard, which is how run 10's JSONC-by-regex nearly passed
vacuously. Three lockfile lines; a test asserts the dependency is direct, so a future lockfile change cannot silently
remove what the arithmetic rests on.

**Acceptance criteria.**
1. The declared range excludes every Node on which the API cannot boot. ✅ — executed: the old range **exit 1**, the new
   one **exit 0**, against 671 dependency ranges.
2. The check fails on a dependency that outgrows the declaration. ✅ — probed with a synthetic `>=26.0.0` dependency.
3. Every Node pin is concrete, in range, and agrees with the others. ✅ — `.nvmrc`, three `ARG NODE_VERSION` defaults
   and `ci.yml` all pin `22.13.1`; Dockerfiles are discovered from the filesystem, not listed.
4. A floating pin fails. ✅ — `PF-76`; executed.
5. `engines.pnpm` cannot bless a major that never produced this lockfile. ✅ — `PF-75`; executed.
6. The gate refuses to run on an unsupported runtime. ✅ — probed at Node 20.11.
7. An uninstalled dependency set is a failure, not a skip. ✅ — otherwise check (1) passes vacuously.
8. Wired into `ci-gate.sh` **and** `ci.yml`, with a guard against drift. ✅ — S-E02-2 AC-4.
9. No bypass flag and no `--update`. ✅ — DNC-10; the reviewed record is `engines` itself, so widening shows in the diff.

**Out of scope, stated.** The boot failure below 20.19 is **not executed against a Node 20 runtime** — that needs a
second runtime the gate does not have, so it stays inferred from the require(ESM) support matrix, exactly as `PF-73`
already said. The check also cannot see a Docker `build.arg` overriding `ARG NODE_VERSION` at build time; no compose
file sets one today (verified), but that gap is real.

---

## S-E02-13 — The observability profile stops being a claim · ✅ `done` 2026-08-03

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-56 *(observability third — advanced, not closed)*, PF-77, PF-78 *(both found here)* · **Gates** G-TENANT, G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** A2 §13 recorded PF-56 as *"observability configuration is optional rather than proven active"*.
`infra/docker-compose.yml` has declared an `obs` profile — Prometheus, Grafana, Loki — since it was written.

> **Step 2 measured it, and it is worse than "optional": the profile cannot start.** All **three** of its bind-mount
> sources — `./grafana/prometheus.yml`, `./grafana/dashboards`, `./grafana/provisioning` — **did not exist in the
> repository**. Docker creates a *directory* for a missing bind-mount source, so Prometheus would have received a
> directory where it expects its config file. And no application registered a single metric, so a working Prometheus
> would have scraped nothing. 3 of the 8 relative bind-mount sources in that file were missing, and all 3 were this
> profile.

That is **R-26** — a declared invariant trusted because it is written down — for the sixth time in seven runs.

**Design — why an HTTP histogram and not just process metrics.** PF-56 asks for **SLOs**. An SLO needs a latency
distribution and an error rate; process CPU and heap produce neither. `collectDefaultMetrics` alone would have been the
cheap answer that does not advance the finding.

**Design — the cardinality rule is the security rule.** `/metrics` is unauthenticated by construction: Prometheus
carries no token, and a shared secret in a read-only mounted config is the appearance of a control rather than one. Its
access control is therefore the docker network. Two consequences, both enforced: series are labelled by the **matched
route template** (`/api/v1/students/:id`) and never by the resolved URL — labelling by `req.originalUrl` would turn
every student id into a time series, which is an unbounded cardinality explosion *and* a tenant-identifier leak onto an
unauthenticated surface (G-TENANT) — and the gate fails if nginx ever publishes the path.

**Design — why a middleware and not an interceptor.** An interceptor wraps the handler, putting measurement code
between the client and the response. The middleware subscribes to the response's `finish` event, calls `next()`
immediately, and swallows its own errors: a metrics failure degrades to a missing data point, never to a failed
request.

**Design — why the worker reuses one socket.** The worker already listens for exactly one reason (`S-E02-10`'s release
manifest). A second port for the same reason would double the compose config, the nginx rule and the number of things
that can diverge.

**Acceptance criteria.**
1. Every bind-mount source declared by a compose file exists. ✅ — executed; the pre-slice state (3 absent) **fails**.
2. Both Nest applications expose a Prometheus endpoint. ✅ — the worker's is queried over a **real socket**; the API's
   is asserted against the route table read off the **booted** container.
3. No metric label can carry an identifier. ✅ — driven with a request carrying both the template and the resolved URL
   with an id; the id does not appear in the exposition.
4. Every scrape target names a real service on the port it really listens on. ✅ — both negative paths executed.
5. Every scraped path is a route the application really boots. ✅ — compared against `scripts/boot-route-baseline.json`,
   so a controller unmounted (PF-62's shape) breaks the scrape config too.
6. Every dashboard query names a metric the applications really register. ✅ — read from the **built** registries via
   `getMetricsAsJSON()`, not from source text (R-26 rule (a)).
7. nginx does not publish `/metrics`. ✅ — asserted against the real config and against a synthetic one that does.
8. An unreadable build output is a failure, not a skip. ✅ — three separate paths.
9. Wired into `ci-gate.sh` **and** `ci.yml`, with a guard against drift. ✅ — S-E02-2 AC-4; exercised in the negative.
10. No bypass flag. ✅ — DNC-10.

**Out of scope, stated plainly.** This does **not** start Prometheus and watch a scrape succeed — that needs
`docker compose --profile obs up`, which the routine forbids. So the profile is proven **coherent and complete**, not
**ingesting**; the endpoints are proven to serve, but the hop between Prometheus and them is configuration this gate
reads rather than traffic it observes. **Traces are not delivered**: `OTEL_EXPORTER_OTLP_ENDPOINT` and a `jaeger`
service are declared in the compose file and no application emits a span — recorded as `PF-78` rather than built here.
**Queue depth, failure rate and DLQ are not exposed**; that needs BullMQ processors instrumented one by one. **Alert
rules and SLO thresholds are not defined** — that is a product decision about what "good" means, not a build.
`apps/web` exposes no metrics. The restore third of PF-56 stays blocked on **D-01**.

**One half of the exposure argument is enforced and the other is convention — say which.** The gate proves nginx does
not publish `/metrics`. It cannot prove the API's own published port is loopback-bound, because that lives in
`.env.prod` (`API_PORT`), outside the repository; `docker-compose.prod.yml`'s header states the convention
(*"the 127.0.0.1-bound `*_PORT` values, so no infra port is exposed publicly"*) and the routine has no way to check it.
So: reachable from the docker network by design, not routed publicly by the reverse proxy — verified — and not bound to
`0.0.0.0` **provided the operator honours the documented convention** — not verified. What that leaks if the convention
lapses is bounded by construction and tested: route templates, counts, latencies and process stats; no identifier, no
connection string.

---

## S-E02-16 — The documented way to start the stack starts the documented stack · ✅ `done` 2026-08-07

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-86 *(closed, re-scoped)*, PF-89 *(discovered and closed)* · **Risk** R-26 · **Gates** G-DNC, G-MIGRATION |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** The routine's target *is* the local Docker stack (`SKILL.md` Step −1), so "the documented command starts the
documented stack" is a release property, not a documentation nicety. It was false. Compose resolves `.env` from the
**project directory** — the compose file's directory, `infra/` — not from the caller's cwd, and `infra/.env` does not
exist. Every port lives in the root `.env`, beside the `DATABASE_URL` that prisma, the seeds and every host-side script
read. So the command in `infra/docker-compose.yml`'s own header, and the one in `SKILL.md` Step −1, resolved none of
them and fell silently through to `${VAR:-default}`.

**Step 2 measured the premise, and it was a functional break rather than the documentation defect that was filed.**
`PF-86` was recorded as `TECH_DEBT`, closing with *"neither is a runtime defect in the application"*. The
counter-evidence is inside `infra/docker-compose.yml` alone and needs no untracked file: `KC_HOSTNAME` and
`KEYCLOAK_PUBLIC_URL` hard-coded `http://localhost:8180` — the api uses the latter as its **expected token issuer** —
while `keycloak.ports` defaulted to `8080` and the web's `NEXT_PUBLIC_KEYCLOAK_URL` defaulted to `8080` too. On the
documented path Keycloak published on 8080, announced an issuer reachable on no port, sent the browser to 8080, and the
api rejected every resulting token. **Login was broken by construction**, and appeared to work only because one
machine's gitignored `.env` said `8180` on a path where compose never read it. Re-scoped to `BROKEN_RUNTIME`.

**Design — a refusal is a control, a default is a second stack.** Thirteen published host ports lose their
`${VAR:-…}` and take `${VAR:?…}`: compose now refuses in the operator's terminal and names the remedy. This is
`S-E06-1`'s argument about `?? 'admin'` applied one layer out — *a default nobody wrote down is the defect, so the fix
is a declaration, not a better default.* Rule 1 alone would not have prevented the login break, so rule 2 is separate:
**a host port is written exactly once**, and every browser-facing URL derives from the variable that publishes it.
ADR-026 records both, and why `infra/.env` and `--project-directory ..` were rejected.

**Discovered by the gate, on its first execution.** `--profile prod` alone was *also* an invalid Compose project
(`service nginx depends on undefined service web`) — a third instance of the profile-reachability defect, at an address
nobody had read. Recorded as **`PF-89`** and closed in the same run. Two of the file's five profiles were unrunnable
exactly as documented.

**Acceptance criteria.**
1. No published host port carries a silent default; the wrong invocation is **refused**, naming the variable. ✅
2. No host port is written twice; the announced Keycloak issuer equals the published port by construction. ✅
3. Every profile activates its own dependencies — `--profile seed` and `--profile prod` are valid projects. ✅
4. `.env.example` stops describing a third, incompatible stack, and declares all thirteen required variables. ✅
5. A gate holds all of it, wired into `scripts/ci-gate.sh` **and** `.github/workflows/ci.yml`. ✅

**Test.** `apps/api/src/shared/quality/compose-invocation-gate.spec.ts` — **34/34**. The evaluator is a pure function
driven with configurations known to be wrong, including the pre-slice shapes verbatim (`${KEYCLOAK_PORT:-8080}:8080`,
`KC_HOSTNAME: http://localhost:8180`, `seed depends_on api`, `nginx depends_on web`).

**Evidence — executed in both directions.**
- The **real script** run against the restored pre-slice compose file → **exit 1, 4 problems**, one per rule family
  (C1 silent default, C3 hard-coded issuer, C4 ×2 invalid profiles). Restored → exit 0, `git diff` clean.
- The stage replaced with `true` in **both** `ci-gate.sh` and `ci.yml` → **2 failed / 32 passed**, one per disconnected
  file. Restored → 34/34.
- Three **live** docker probes inside the script itself: without `--env-file` compose **refuses** (exit 1, naming the
  missing variable); with `--env-file .env` it accepts; `--profile seed` alone is a valid project.
- `--profile prod` alone, before the fix, observed live: `service "nginx" depends on undefined service "web"`.
- **The stack was recreated through the corrected command** and left healthy: `keycloak`, `api`, `worker`, `web`
  force-recreated, migrator idempotent (*"No pending migrations to apply"*), all eight containers healthy on the ports
  the root `.env` declares (5433, 8180, 3000, 4000, 4001-loopback). `GET /healthz` 200, `GET /version` answers, web `/`
  200, and the **running** Keycloak's discovery document reports
  `issuer: http://localhost:8180/realms/pilotage-scolaire` — the port that is actually published.

**A second live instance of `PF-80`'s shape, caught by the ratchet rather than by the author.** Removing the `:-`
defaults turned `release-surface.spec.ts` red: its loopback assertion read
`toContain('127.0.0.1:${WORKER_HTTP_PORT:-4001}:4001')`, pinning the **default** as a side effect of pinning the
**bind address**. A change that strengthened the exact property that spec exists to protect therefore broke it, from a
file the editing view never opens. `node scripts/test-ratchet.js api` reported **1 NEW test failure**, and it was
fixed by asserting the intent (bound to `127.0.0.1`, mapped to container `4001`, interpolation form unconstrained)
rather than by baselining it. This is the argument for running the **full** gate before merging (`R-23`) rather than
the stages one happens to watch.

**And `PF-90`, found by being bitten.** Stopping a background `ci-gate.sh` reported success but left the process
running — the harness kills the task shell, not the tree beneath it — so relaunching produced **five** concurrent
gates, one inside `pnpm build`, all truncating the same log. The tell was a stage list that read back in an impossible
order. Every verdict from those logs was discarded and one clean, uncontended run was taken as the gate result. The
write lock cannot catch this: all five belong to the same run and hold the same lock, so single-writer is *satisfied*
while the guarantee fails. Recorded as `PF-90` / **R-29**; the durable fix is in the harness, outside this checkout.

**Out of scope, stated.** This does **not** prove a full login journey (that is `V3-E05`); what is proven is that the
issuer and the published port agree, on a running container. `infra/docker-compose.prod.yml` is deliberately outside
the gate's C5 scope — it is driven by `scripts/deploy-prod.sh` with its own `--env-file .env.prod`, and per Step −1 the
hosted host is an audit fixture; **its own port coherence is unexamined and stays so.** The C3 rule catches a
hard-coded port that no service publishes as a literal; a value hard-coding a port some *other* service publishes
literally would still pass.

**Two full gate runs, stated plainly, and why (`R-23`).** The routine permits one `pnpm build` per run. This slice
spent two, and neither was avoidable once `PF-90` and the ratchet regression appeared. Run 1 completed all fourteen
stages and returned **`GATE: FAIL (1 stage)`** — `test:api`, on the `release-surface.spec.ts` assertion described
above, which was fixed *after* that stage had already run. Every other stage passed, including `build`, `boot`,
`web artefact`, `observability`, `tracing` and `csp`. Run 2 is the authoritative verdict: **`GATE: PASS`, all 14
stages** — ✓ runtime engines · ✓ production artefacts · ✓ **compose invocation** · ✓ prisma generate · ✓ lint ·
✓ lint:warnings *(no drift, this slice added none)* · ✓ typecheck · ✓ test:api **1013/1024**, 11 known-failing
*(was 1012/1024 — exactly +1, the spec repaired above, no other drift)* · ✓ test:worker **160/167**, 7 known-failing,
no drift · ✓ build · ✓ boot · ✓ web artefact · ✓ observability · ✓ tracing · ✓ csp.

Two earlier attempts were discarded entirely rather than quoted: the first died on a lint error in this slice's own
spec (wrong disable-rule name), and its successor was corrupted by `PF-90`. **No verdict from a contended log was
used for anything.**

**Operator note.** Thirteen variables are now mandatory. `WORKER_HTTP_PORT`, `HTTP_PORT` and `HTTPS_PORT` were never in
`.env.example` and are now required — this run added them to `.env.example` and to the local gitignored `.env`, so this
machine's stack keeps working. Any other checkout needs `cp .env.example .env` or the three lines appended. The break
is one-time and self-describing: compose names the missing variable.

---

## S-E02-5 — The migration ledger must reproduce `schema.prisma`, and something must say so

| | |
|---|---|
| **Epic** | V3-E02 · **Finding** PF-03 *(residual half)* · **Gates** G-MIGRATION, G-DNC |
| **blockedBy** | — · **requiresDecision** — · **Size** M |

**Why.** `S-E02-1` established the ledger and `S-E02-3` proved the restore. Neither prevents the *next* database from
being a `db push` database at a new address. The residual recorded on `PF-03` says it exactly: *"nothing yet PREVENTS a
`db push` database reappearing at a new address, which is the class `S-E02-5` owns."*

The concrete, unguarded path today: edit `schema.prisma`, do not write a migration. **Every gate stays green.**
`ci-gate.sh` runs `prisma generate` — so it will happily generate a client for a schema **no migration produces** — then
lints and typechecks against that client. `infra/docker/migrate-entrypoint.sh` correctly runs `migrate deploy` and only
`migrate deploy`, so the change reaches no database, ever. The application then queries columns that do not exist. That
is `db push`'s failure mode arriving through the front door of the very machinery built to stop it: the source of truth
and the ledger diverge, and nothing in the repository can say so.

**Step 2 measured the premise, and the obvious implementation is wrong.** The reflex check is
`prisma migrate diff --from-migrations ./prisma/migrations --to-schema-datamodel ./prisma/schema.prisma --exit-code`.
Executed against this repository, unchanged, it returns **exit 2** and reports all five PostgreSQL extensions
(`btree_gin`, `citext`, `pg_trgm`, `pgcrypto`, `uuid-ossp`) as `[+] Added`. They are **not** missing:
`0_baseline/migration.sql` lines 2–14 create all five, and the shadow database *that same command builds* has all five
plus 54 tables. Diffing **that database, by URL**, against the datamodel returns **`No difference detected`, exit 0**.
So the `--from-migrations` path does not introspect extensions from the shadow it just built, and a gate written that
way would be **permanently red on a correct repository** — the `catch-all` trap `S-E06-3` had to design around, where
the only route back to green is to break correct code.

**Design consequence.** The check must apply the migrations to a scratch database and then diff **that database by
URL** against the datamodel. That is strictly stronger than a text comparison anyway: it proves the migrations
**execute**, in order, on a real PostgreSQL — not merely that their SQL parses.

**Implementation notes.**
1. `scripts/schema-drift-check.js`: create a disposable scratch database in the local Postgres container, run
   `prisma migrate deploy` into it, then `prisma migrate diff --from-url <scratch> --to-schema-datamodel --exit-code`.
   Drop the scratch database on every exit path, including failure.
2. **Unreachable tooling is a failure, never a skip** (DNC-08). No Postgres, no docker, no scratch database → exit
   non-zero naming what was tried. A drift check that silently passes when it could not run is worse than none.
3. Report the drift Prisma reports, verbatim, rather than "schemas differ".
4. No `SKIP_*` / `ALLOW_*` / `--force` escape (DNC-10). The reviewed record is the migration file in the diff.
5. Wire it into `ci-gate.sh` **and** `.github/workflows/ci.yml`, with a guard asserting both so they cannot drift —
   reading comment-stripped executable content, so a comment can neither create nor destroy the wiring (`PF-83`).

**Acceptance criteria.**
1. Editing `schema.prisma` without a migration makes the check **fail**, naming the drifted object.
2. The unmodified repository **passes** — the check is not red on correct code (the `--from-migrations` false positive
   is not reproduced).
3. A migration that does not execute on PostgreSQL fails the check.
4. Tooling that cannot run fails; it never reports success by omission.
5. The stage is wired into both `ci-gate.sh` and `ci.yml`, and a test fails if either wiring is removed.

**Test.** `apps/api/src/shared/quality/schema-drift-gate.spec.ts`. Executed in **both** directions against the real
script: a real field added to `schema.prisma` with no migration → exit 1; reverted → exit 0.

**Out of scope.** Checking a *deployed* database against the ledger — `infra/docker/migrate-entrypoint.sh` already
refuses an un-baselined non-empty database, and the running-database half is `restore-drill.js`'s seam. This story owns
the **repository** invariant: the ledger reproduces the source of truth.

---

## Sprint 01 exit criteria

- `prisma migrate status` clean; no `db push` outside development; preflight blocks unapplied migrations.
- CI runs six stages from a clean install and gates merges.
- No dev artefact, hard-coded credential or dev URL in a production build (CI-enforced).
- CSP enforcing; branding injection neutralised.
- Zero internal 404s on an authenticated per-role crawl (CI-enforced).
- Consent-referenced routes resolve.
- Bulk controls confirm, scope and audit.
- `traceability-matrix.md` updated for every finding touched; D-01 and D-08 escalated if still open.
