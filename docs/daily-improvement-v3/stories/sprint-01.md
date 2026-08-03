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

## S-E06-1 — Purge development artefacts from production builds

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

## Sprint 01 exit criteria

- `prisma migrate status` clean; no `db push` outside development; preflight blocks unapplied migrations.
- CI runs six stages from a clean install and gates merges.
- No dev artefact, hard-coded credential or dev URL in a production build (CI-enforced).
- CSP enforcing; branding injection neutralised.
- Zero internal 404s on an authenticated per-role crawl (CI-enforced).
- Consent-referenced routes resolve.
- Bulk controls confirm, scope and audit.
- `traceability-matrix.md` updated for every finding touched; D-01 and D-08 escalated if still open.
