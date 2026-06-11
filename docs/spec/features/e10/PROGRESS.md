# E10 — Progress

> Epic: **E10 — Quality bar: authenticated E2E + WCAG 2.2 AA** · Tier 4 (Foundation, quality & interop) ·
> Size ~M · Maps to **R9 (Accessibility)** + **R10 (E2E)** of the foundation backlog.
> Spec-kit run: **2026-06-10** (docs-only; no code, no schema, no build). Roadmap status: `proposed` →
> promoted to **in-progress** (spec authored on this run). **Next slice → E10-S1.**

## Slice status

| Slice | Title | Tags | Risk | Status | PR |
|---|---|---|---|---|---|
| S1 | Auth-session fixture + grade→alert journey + authenticated a11y smoke → **ADR-023** | `[test][a11y][e2e]` | P2 | `[x]` shipped | (this run) |
| S2 | Journey #2: parent child-claim → admin approval (E9) | `[test][e2e]` | P2 | `[ ]` not started | — |
| S3 | Journey #3: parent ↔ teacher messaging (E2) | `[test][e2e]` | P2 | `[ ]` not started | — |
| S4 | Cross-portal WCAG 2.2 AA sweep + remediation (R9 payoff) | `[a11y][test][ui]` | P2 | `[ ]` not started | — |

## What landed this run (spec run)

- `docs/spec/features/e10/` spec-kit authored: `spec.md`, `plan.md`, `data-model.md`, `ux.md`,
  `contracts/` (`openapi.yaml` + `README.md` + the `auth-fixture` / `journeys` / `a11y-scan` contract
  notes), `tasks.md`, `quickstart.md`, and this `PROGRESS.md`. **Docs only** — no code, no schema, no
  migration, no build.
- Roadmap: **E10 to be promoted `proposed` → `in-progress`** (`bmad/roadmap.md`, reconcile on land).

## Key locked decisions (the spec's spine)

- **Reuse the existing harness, don't invent it.** `@playwright/test` ^1.60 + `@axe-core/playwright` ^4.11
  are already devDeps; `apps/web/playwright.config.ts` (testDir `./tests/e2e`, port 3100, `fr-FR`, chromium,
  `webServer: pnpm dev`, `PLAYWRIGHT_SKIP_SERVER`) + `apps/web/tests/e2e/smoke.spec.ts` (public-login smoke
  + `@a11y` scan) + the `test:e2e*` scripts all exist. **Verified on disk this run.** E10 **extends** this
  (a `setup` project + per-role `storageState` + journey/a11y specs), keeping the smoke spec unchanged.
- **The spine = a portal-aware authenticated-session fixture** (auth once per role → cached `storageState`
  in a **git-ignored** `.auth/{role}.json`), seeded from the **existing `voltaire-demo`** tenant + demo
  logins — **no new seed, no new test users, no real children's data**. A future epic appends a **one-line**
  authenticated journey on top of it (the standing regression net).
- **Critical journeys, sliced thin:** S1 grade publish → parent **explainable + actionable** alert (the
  cahier's core promise made runnable); S2 the E9 parent child-claim → admin approval (atomic approve =
  access, end-to-end); S3 the E2 parent ↔ teacher messaging dual-wall round-trip. Each is an executable
  assertion of a **shipped** promise.
- **WCAG 2.2 AA via axe-core** (tag set `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, incl. SC 2.5.8 target
  size), **critical/serious = hard fail** (matches the smoke spec). S1 scans the authenticated parent
  dashboard; **S4 sweeps a representative authenticated page per portal and remediates** what it surfaces
  (reuse `@pilotage/ui` first; shared fixes in `packages/ui`).
- **No new product capability.** No schema, no endpoint, no permission, no `NotificationKind`, no second
  queue. The only behaviour-changing code is **WCAG remediation of existing UI**. The journeys **assert**
  the ABAC/tenant/portal walls; they never widen them.
- **Never builds; runs on the running stack.** No `next build` / `docker build` / `infra rebuild` in the
  E2E path (project-context §4); Playwright's `webServer` is `next dev`. CI-**runnable**; standing up a
  specific CI provider workflow is a **recorded follow-on**, not an E10 deliverable.
- **The one new architectural decision** = the authenticated, CI-runnable E2E + a11y **layer** →
  **`docs/adr/ADR-023`**, authored on **S1**. ADR number **023** = next free after `ADR-022` (verified the
  last on disk this run is `ADR-022-enrollment-self-service-child-claim.md`; the S1 implementer re-verifies
  at authoring time — the E6/E7/E8/E9 precedent).

## Schema posture (Winston — authoritative)

- **NO schema change in any slice.** Zero new model/enum/column/index/migration/`db push`. See
  `data-model.md` (a deliberate "no schema change" record). E10 touches only test files, Playwright
  config/scripts, `.gitignore`, WCAG remediation of existing markup, and docs/ADR.

## Reuse map (what E10 does NOT rebuild)

- The Playwright harness + axe-core + `playwright.config.ts` + `tests/e2e/` + the `test:e2e*` scripts +
  the `@smoke`/`@a11y` tag convention — **extended**, not invented.
- The `voltaire-demo` seed + the project-context §6 demo logins — the test data; no new seed.
- The shipped surfaces under test (E1 explainable alert + "What should I do?", E9 child-claim + admin
  queue, E2 messaging) — **asserted**, not modified (except WCAG remediation).
- `@pilotage/ui` / `packages/ui` (incl. the E3-S3 hardened `Drawer` focus-trap) — WCAG fixes reuse the
  design system first; shared fixes land in `packages/ui`.
- The existing ABAC/tenant/portal walls (ADR-002/003/004/015/021) — observed + asserted, **unchanged**.

## Cross-artifact reconciliation note (for the S1 implementer)

- **ADR-023 filename (RESOLVED):** all kit artifacts now agree on
  `docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` (Winston aligned `data-model.md` + `contracts/`
  to the `spec.md`/`plan.md`/`tasks.md` slug). The ADR **number** (023) and content are agreed; the slug
  is locked. The S1 implementer should still **re-verify 023 is next-free-after-022** at authoring time
  and, on a collision, take the next free integer and update every reference in one pass.
- All other artifacts (spec/plan/data-model/ux/contracts/tasks/quickstart) agree on: 4 slices, no schema,
  WCAG 2.2 AA critical/serious hard-fail, reuse `voltaire-demo`, never-build, ADR committed on S1.

## Risk notes for the implementation runs

- **S1 is the load-bearing, ADR-bearing slice.** It must stand up the fixture (auth once per role, cached
  git-ignored storageState), the first journey that **guards the promise** (fails if the alert is
  unexplained or has no CTA — not just a 200), the first authenticated a11y scan, and ADR-023. Sentinel/
  Drift gate: **no committed session token, no build in the test path** (AC-8).
- **Re-runnability (FR-8)** is the subtle correctness key for S2/S3 (mutating journeys): unique run-stamped
  text + assert-on-post-state, so the suite is green on consecutive runs without a reseed.
- **S4 scope discipline:** representative page **per portal**, critical/serious only blocks; remediation is
  what the sweep surfaces, not a blanket re-theme. The PR shows assertions **and** fixes together.
- **No wall widening:** journeys use legitimately-entitled demo accounts and **assert** the walls; a test
  that needs access must never relax ABAC to pass (hard non-goal / AC-9).

## What landed this run (S1 — implementation)

- **Fixture spine (FR-1 / AC-1):** `apps/web/tests/e2e/fixtures/users.ts` (env-overridable, demo-seed-backed
  `PortalUser` table), `apps/web/tests/e2e/auth.setup.ts` (the **setup project** — logs in once per role via
  the real `/{portal}/login` form; **asserts** landing + `expectedRole`; transport-only skip-when-down),
  `apps/web/tests/e2e/fixtures/portal-fixtures.ts` (the one-line `adminPage`/`teacherPage`/`parentPage`/
  `studentPage` fixtures, each opening its role's cached `.auth/{role}.json` context, skip-if-missing).
- **Journey #1 (FR-2 / AC-2):** `apps/web/tests/e2e/journeys/grade-to-alert.spec.ts` (`@journey`) — signed
  in as the demo parent on `/parent/recommendations`, FAILS unless the first alert carries rule (CODE_LABEL
  pill) + subject/title + **non-empty body** (threshold/trend, structural not copy-coupled — PM-4) + the E1
  "Que puis-je faire ?" next-step CTA. Read-only against the seed; `test.skip`s gracefully on an empty seed
  (PM-5 non-vacuous).
- **Authenticated a11y smoke (FR-3 / AC-3):** `apps/web/tests/e2e/a11y/authenticated.a11y.spec.ts` (`@a11y`)
  — WCAG-2.2-AA scan (`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, incl. SC 2.5.8) of `/parent/dashboard`,
  zero critical/serious, **plus a sanity-injection** test proving the gate bites (no false green).
- **Config + scripts (FR-7 / FR-9):** `playwright.config.ts` adds the `setup` project + a `setup`-dependent
  authenticated project running ONLY `journeys/**` + `a11y/**`, while the unauthenticated `chromium` project
  IGNORES those dirs (keeps `smoke.spec.ts` only — PM-7 isolation, no session leak). `package.json` adds
  `test:e2e:a11y` + `test:e2e:journey`; `test:e2e:smoke` unchanged.
- **Security + never-build (AC-8):** `.gitignore` now ignores `apps/web/tests/e2e/.auth/` (live session
  token, never committed). `webServer` stays `pnpm dev` (next dev); no `next build`/`docker`/`infra` in any
  new script or config.
- **ADR (AC-9):** `docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` (Accepted) — re-verified 023 is
  next-free after ADR-022. `quickstart.md` updated with the run + one-line-journey recipe + the
  env-overridable parent-credential note.
- **No schema / endpoint / permission / NotificationKind / queue. No WCAG remediation was needed in this
  slice's authored markup** (the parent dashboard was already built to the bar; if the live scan surfaces a
  critical/serious on the operator's stack, the remediation lands reuse-first per FR-6 — recorded for the
  S1 run against a booted stack).

## Next action

**Implement E10-S2** (`epic-slice`): the parent child-claim → admin approval cross-portal journey
(`tests/e2e/journeys/child-claim-approval.spec.ts`), reusing the S1 fixture (`parentPage` + `adminPage` in
one spec). No schema, no new fixture, no endpoint. Run against the already-running `:3100` stack — never
build.
