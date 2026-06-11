# ADR-023 — Authenticated E2E + WCAG 2.2 AA layer (Playwright runner, storage-state session fixture, run-against-running-stack)

- **Status:** Accepted
- **Date:** 2026-06-11
- **Epic / Slice:** E10 — Quality bar: authenticated E2E + WCAG 2.2 AA · S1 (auth-session fixture +
  grade→alert journey + first authenticated a11y smoke + this ADR)
- **Deciders:** Winston (Architect), Sally (UX), Critic (Pre-mortem), Murat (Test-Architect)
- **Supersedes / relates:** ADR-002 (multi-tenancy — the suite never opens a raw DB connection; all four
  fixture users belong to `voltaire-demo`, and the journeys *assert* the application-level tenant/ABAC
  walls rather than bypassing them), ADR-003 (three+1 portals via route prefixes — the fixture is
  portal-aware: one cached session per `admin`/`teacher`/`parent`/`student`), ADR-004 (1 realm / OIDC
  clients — the login fixture drives the genuine NextAuth Credentials → Keycloak ROPC path, no mock),
  ADR-015 (RBAC+ABAC — the setup asserts each session carries its portal's realm role; journeys assert the
  ABAC walls hold), ADR-021 (student self-ABAC — the `student` fixture is wired and fixture-ready).

## Context

Pilotage has been built **nine epics deep** (E1–E9 shipped). Its defining promise — "turn information into
action": a grade is published, an explainable alert fires, a parent is led to a concrete next step — spans
four portals, a NestJS aggregate layer, a BullMQ worker, and an ABAC wall around a **minor's** dossier.
Until E10, every regression was caught only by a unit test (one layer) or a human clicking through after
the squash-merge. There was **no automated proof that the core promise still works end-to-end when a real
parent logs in**, and **no axe-core sweep of any authenticated page** (the public-login smoke spec only
scans the three logged-out login pages — 95% of the product and 95% of the a11y risk live behind auth).

The unauthenticated half of the harness already exists and is conventional: `@playwright/test` ^1.60 +
`@axe-core/playwright` ^4.11 (devDeps), `apps/web/playwright.config.ts` (testDir `./tests/e2e`, port 3100,
`fr-FR`, chromium, `webServer: pnpm dev`, `PLAYWRIGHT_SKIP_SERVER`), the `test:e2e*` scripts, and
`smoke.spec.ts` (the `@smoke`/`@a11y` + `AxeBuilder().withTags()` idiom). E10 **extends** this harness; it
does not invent a new one.

What is genuinely net-new — and per project-context §3 a **new cross-cutting architectural layer** that
must land **with** an ADR — is: an **authenticated**, CI-runnable browser-driver suite that logs in as a
real audience against the running stack, caches the session, drives data-bearing surfaces, and grades them
with an axe-core WCAG-2.2-AA oracle. This ADR records that layer.

## Decision

1. **Playwright is the E2E runner** (already adopted for the public smoke). We do not add a second runner.
   Chromium-only (the existing project); cross-browser matrix, visual-diff, and perf/load are explicit
   non-goals (recorded as future options).

2. **The session fixture is a Playwright `setup` project → cached per-role `storageState`.** A
   `tests/e2e/auth.setup.ts` logs in **once per role** through the PRODUCT's real `/{portal}/login` flow
   (the NextAuth Credentials provider → Keycloak ROPC — `apps/web/src/auth.ts:directGrantLogin`; **no
   mock**, so the fixture *is* the login regression test) and writes a Playwright `storageState` to
   `apps/web/tests/e2e/.auth/{role}.json`. Authenticated projects depend on `setup`; test-facing per-role
   fixtures (`adminPage`/`teacherPage`/`parentPage`/`studentPage`, in `tests/e2e/fixtures/portal-fixtures.ts`)
   yield an already-signed-in page in **one line**. Authentication runs in exactly one place; no test ever
   re-types a login form. **Rejected alternative:** seeding a JWT/cookie by hand or hitting a test-only
   login endpoint — both bypass the real login path and would not catch an auth regression.

3. **Test data is the existing `voltaire-demo` seed + the documented demo logins.** No new test users, no
   new seed, **no real children's data**. Credentials resolve env-first
   (`E2E_<PORTAL>_EMAIL`/`_PASSWORD`) → documented demo default, so an operator can pin whichever demo
   account actually authenticates through a given portal and carries the needed graph **without a code
   change** (the parent rich-data account that carries the J1 alert graph is env-overridable for exactly
   this reason).

4. **The setup ASSERTS the login worked; skip-when-down keys ONLY on transport unreachability.** Each
   setup gate asserts the post-login URL is the portal `landing` AND the session carries `expectedRole`
   (RBAC / INV-1 isolation, and a guard against storage-state cookie-name/domain drift). A reachable stack
   that *rejects* the credentials **fails the setup loudly** — it is never silently skipped. The setup
   only `test.skip`s when the web origin is genuinely unreachable (connection refused / timeout), so a PR
   run on a machine without a booted stack stays green (E2E is a CI/operator gate, not the hourly routine)
   **without** masking a real auth regression as a green run.

5. **axe-core is the a11y oracle; the bar is WCAG 2.2 AA; critical/serious is a hard fail.** The
   authenticated scans use the tag set `wcag2a wcag2aa wcag21a wcag21aa wcag22aa` — extending the public
   smoke's `wcag2a/wcag2aa` to **2.2**, picking up SC 2.5.8 (Target Size), SC 2.4.11 (Focus Not Obscured)
   and SC 3.3.8 (Accessible Authentication). The gate fails on `critical`/`serious` violations (matching
   the smoke spec); `moderate`/`minor` are an opportunistic punch-list, not a blocker. A **sanity-injection**
   test proves the gate bites (a deliberately-introduced violation must be caught), so a green run can
   never be a false green.

6. **The suite runs against the already-running stack and NEVER builds.** It targets
   `http://localhost:3100` (config default / `PLAYWRIGHT_BASE_URL`) against the operator's running web (+
   api + worker), or Playwright's `webServer` starts `next dev` (port 3100) — **never `next build`,
   `docker build`, or `infra rebuild`** (project-context §4). `PLAYWRIGHT_SKIP_SERVER=1` reuses an
   already-running dev server.

7. **`.auth/` is git-ignored; no session token is ever committed.** The storage-state carries a live
   next-auth session cookie; `apps/web/tests/e2e/.auth/` is added to `.gitignore` in the same change as the
   fixture. The directory is regenerated every run.

8. **Tag-able, selectable suites.** Journeys carry `@journey`, a11y tests `@a11y` (the existing convention);
   `test:e2e:smoke` (public, fast — **unchanged**), `test:e2e:a11y` (grep `@a11y`), and `test:e2e:journey`
   (grep `@journey`) are independently runnable. Project isolation keeps the public smoke spec in its own
   unauthenticated project (no session leak) and the authenticated specs in the `setup`-dependent project.

## Consequences

- **Positive — a standing regression net.** From E10 onward, every epic can close its slice with a
  one-line authenticated journey (`async ({ parentPage }) => { … }`) and a one-line authenticated a11y
  assertion. The "vertical slice = demoable end-to-end" rule (project-context §5) gains a literal,
  automated meaning. The A11y reviewer (agent roster row 13) and Murat's gate (row 15) gain an *executable*
  WCAG-2.2-AA oracle and a *runnable* journey suite.
- **Positive — the walls become executable assertions.** The journeys exercise the real ABAC/tenant/portal
  walls of E1–E9 (a parent reaches only their own child's alert; cross-portal routing is denied) — turning
  prose invariants into runnable checks. The journeys **assert** the walls; they never widen them.
- **Cost — the suite needs a booted stack.** Unlike a unit test, an authenticated journey needs web + api +
  worker + Postgres/Redis + Keycloak up. The transport-only skip keeps that from being a false red, and the
  suite is an operator/CI gate, not part of the hourly routine.
- **Cost — demo-seed coupling.** Journeys read the `voltaire-demo` seed; a thin/empty seed makes a journey
  `test.skip` (non-vacuous guard) rather than fail. Env-overridable credentials and post-state assertions
  (rather than virgin-pre-state) keep the suite re-runnable without a reseed.
- **Bounded scope (this epic).** E10 adds **no schema change, no new endpoint, no new permission, no new
  `NotificationKind`, no second BullMQ queue, no CI-provider pipeline** (CI-runnable + recorded here; a
  specific GitHub Actions workflow is a recorded follow-on). The only behaviour-changing code across the
  epic is **WCAG remediation of existing UI** (reuse `@pilotage/ui` first; shared fixes in `packages/ui`).

## Alternatives considered (rejected)

- **Hand-seeded JWT / test-only login endpoint** — bypasses the real login path; would not catch an auth
  regression and adds a non-product surface. Rejected in favour of driving the genuine `/{portal}/login`.
- **A new dedicated E2E seed of fixture children** — introduces real-looking minors' data and a maintenance
  burden; reuse `voltaire-demo` (Non-goals).
- **Failing (not skipping) when the stack is down** — would make the suite a constant false red on machines
  without a booted stack. Rejected; we skip on transport-unreachability ONLY, and fail on a rejected login.
- **Standing up a CI provider workflow now** — out of scope for E10; the layer is made CI-runnable and the
  decision recorded here, with the concrete workflow a recorded follow-on.
- **Adding a second test runner / cross-browser matrix / visual-diff** — out of scope; chromium-only,
  WCAG-AA correctness, functional journeys (recorded as future options).
