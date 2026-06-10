# E10 — Quality bar: authenticated E2E + WCAG 2.2 AA

> **Status:** in-progress (spec run) · **Size:** ~M · **Tier:** 4 (Foundation, quality & interop)
> **Why now:** E1–E9 are all shipped (E9-S1+S2 landed `241d107`/`710d5d4`; E7-S1→S6 + E8-S1→S3 + the
> E1–E6 tiers all shipped). There is **no in-progress epic with an unstarted slice** and **no unspecced
> in-progress epic**. Per Victor's promotion rule the highest `proposed` epic is promoted: the roadmap's
> E9-completion pointer explicitly names **E10 — Quality bar** as the next Tier-4 filler, ahead of E11
> (interop) and the parked E12. No `docs/spec/features/e10/` exists yet, so per the mode rules this is an
> **epic-spec** run (the spec-kit only — **no code, no schema change, no build**). E10 maps to the
> foundation backlog's **R9 (Accessibility, WCAG 2.2 AA)** + **R10 (E2E, Playwright)**.
>
> **Audit (verified on disk this run):** the *unauthenticated* half of R10 already exists — `apps/web`
> ships `@playwright/test` ^1.60 + `@axe-core/playwright` ^4.11 (devDeps), `playwright.config.ts` (testDir
> `./tests/e2e`, port 3100, `fr-FR` locale, chromium project, `webServer: pnpm dev`), the
> `test:e2e` / `test:e2e:smoke` / `test:e2e:install` scripts, and **one** spec
> (`apps/web/tests/e2e/smoke.spec.ts`) that asserts the 3 **login pages** render + a `@a11y` axe scan of
> those 3 **public** pages. **What is genuinely unbuilt:** any test that **logs in** and exercises a real
> authenticated journey, any **portal-aware reusable auth-session fixture**, any axe sweep of an
> **authenticated** page (where 95% of the product — and 95% of the a11y risk — actually lives), and any
> recorded **ADR for the test-runner + CI E2E layer** (a net-new cross-cutting architectural surface).
> The smoke spec's own comments say it: *"Real auth-required flows will be covered in Phase R10."* /
> *"Full E2E tests will be added in phase R10."* **E10 is Phase R10 (+R9).**

## Vision

Pilotage Scolaire's defining promise is **"turn information into action"**: a grade is published, an
explainable alert fires, and a parent is led to a concrete next step. That promise spans **four portals**,
a NestJS aggregate layer, a BullMQ worker, and an ABAC wall around a **minor's** dossier. It has been
built **nine epics deep** — and every regression today is caught only by a unit test (one layer) or a
human clicking through after the fact. There is **no automated proof that the core promise still works
end-to-end when a real parent logs in.**

E10 builds that proof, and makes accessibility a measured gate rather than an aspiration. It delivers two
intertwined quality bars:

- **R10 — Authenticated E2E.** A **reusable, portal-aware authenticated-session fixture**
  (admin / teacher / parent / student) seeded from the **demo tenant**, so any test — now and in every
  future epic — can start *already logged in as the right audience* in one line. On top of that fixture,
  E10 ships the **critical end-to-end journeys** that encode the cahier's core loop: grade publish → the
  parent's **explainable alert → next step**; the **parent child-claim → admin approval** loop (E9); and
  **parent ↔ teacher messaging** (E2). Each journey is a living, executable specification of a shipped
  promise — a **permanent regression net**, not a one-off QA pass.

- **R9 — WCAG 2.2 AA.** An **axe-core sweep of the authenticated pages** (the dashboards, the gradebook,
  the recommendations surface, the messaging inbox, the admin queues) — the surfaces the public login-page
  smoke scan never reaches — graded against **WCAG 2.2 AA**, with the **violations it surfaces remediated**
  in `apps/web` / `@pilotage/ui`. The cahier and project-context already mandate "premium, colorful,
  responsive, animated, **accessible**" UI and the agent roster carries a dedicated **A11y reviewer**; E10
  turns that review lens into an **executable, regression-proof gate** so a11y can't silently rot.

**The visionary spine — the auth-session fixture as a permanent regression net.** The load-bearing,
reused asset is a **portal-aware authenticated-session fixture** (`loginAs('admin'|'teacher'|'parent'
|'student')`) seeded from the existing **`voltaire-demo`** tenant. Authentication is performed **once per
role** and the storage state cached, so every journey test — and every future epic's "ship a one-line
end-to-end journey test" — starts already inside the right portal, against real seeded data, in a fraction
of a second. This turns E10 from a finite QA task into the platform's **standing safety net for the
alert→action core promise**: from E10 onward, *every* epic can (and should) close with a one-line
authenticated journey assertion.

**The new architectural decision.** A test-runner + a CI-runnable, authenticated E2E layer (a browser
driver hitting the *running* web+api+worker stack, with cached storage-state sessions seeded from the demo
tenant, and an axe-core a11y gate) is a **net-new cross-cutting layer** the project has not formally
adopted. Per project-context §3 it lands **with a new ADR → `docs/adr/ADR-023`** (the next free number
after ADR-022, re-verified on the S1 run). ADR-023 records: Playwright as the runner; the storage-state
session-fixture pattern; the demo-tenant-seeded test data posture; axe-core as the a11y oracle and the
WCAG 2.2 AA tag set; and that E2E runs against the **already-running local stack** (never a build/rebuild
— project-context §4).

**The parent value, in one sentence.** Every future change to Pilotage ships behind an automated proof
that **a real parent can still log in, see their child's explainable alert, act on it, claim their child,
and message the teacher** — on a page that **passes WCAG 2.2 AA** — so the promise the family depends on
cannot silently break.

## Users & why

E10's *direct* users are the **engineering routine and the human operator**; its *beneficiaries* are every
real portal user, because the quality bar protects the surfaces they depend on.

- **The Daily-Improvement routine (the primary consumer).** Today the routine's only end-to-end signal is
  the public-login smoke spec + the per-sprint typecheck. E10 gives it an **authenticated journey net**:
  the A11y reviewer (agent roster row 13) and Murat's gate (row 15) gain an *executable* WCAG-AA oracle and
  a *runnable* journey suite, and **every future epic can append a one-line journey test** to the fixture
  it already provides. The routine's "vertical slice = demoable end-to-end" rule (project-context §5) gets
  a literal, automated meaning.
- **The human operator / reviewer.** Auto-merge lands every green PR (project-context §6); E10 makes
  "green" *mean more* for any UI/flow change — a journey or a11y regression is caught by the suite, not by
  the operator clicking through after the squash-merge. The operator runs the suite against the
  already-running local stack (`http://localhost:3100`) on demand.
- **The parent (beneficiary).** The cahier's core audience. The S1 + later journeys assert *the parent's*
  loop — alert → next step, child-claim → access, message the teacher — stays working, and the a11y sweep
  protects *the parent's* mobile-first <2 s dashboard for keyboard, screen-reader, contrast and target-size
  users. The parent dashboard's accessibility is a cahier guardrail, not a nice-to-have.
- **The teacher, admin, student (beneficiaries).** The fixture covers all four audiences; the journeys and
  a11y sweep extend to the teacher gradebook/messaging, the admin approval queues, and (fixture-ready,
  journeys later) the student portal. No portal's regression protection is privileged over another's.
- **The platform itself (RGPD posture).** E2E exercises a **minor's** dossier behind real auth. E10's test
  data is the **existing `voltaire-demo` seed** (no new fixtures of real children), sessions are scoped to
  demo accounts, and the suite **asserts the ABAC walls hold** (a parent journey can only reach its own
  child; cross-portal routing is denied) — turning the security invariants of E1–E9 into executable
  assertions rather than prose.

## Concrete scenarios

1. **The reusable auth-session fixture (the headline, S1).** A test file declares
   `test.use({ storageState: parentSession })` (or calls `loginAs('parent')`) and the test body opens
   **already signed in as the demo parent**, on `/parent/dashboard`, against real `voltaire-demo` data —
   **no login form typed in the test**. The same fixture serves `admin` / `teacher` / `parent` / `student`;
   authentication happens **once per role** (a setup project) and the storage state is cached and reused
   across the whole suite, so the suite is fast and the login flow is exercised in exactly one place.

2. **Grade publish → parent explainable alert (the critical journey, S1).** A single E2E test, signed in
   across the relevant portals, proves the cahier's core loop end-to-end: a teacher (or the seeded state)
   has a published low grade for a child; the **parent** opens `/parent/recommendations` (or the dashboard
   alert surface) and sees the **explainable alert** — the rule, the subject, the threshold/trend, and a
   **concrete next step** (the E1 "What should I do?" panel: reinforce the subject / message the teacher /
   find tutoring). The test asserts the alert is *explainable and actionable* — the literal "information →
   action" promise, now a runnable assertion.

3. **A smoke a11y scan of the first authenticated page (S1).** Riding the parent session, the suite runs
   an **axe-core WCAG 2.2 AA** scan of the **authenticated parent dashboard** (not just the public login
   page) and asserts **zero critical/serious** violations — the first time an authenticated, data-bearing
   surface is held to the a11y bar in CI. Any violation it surfaces on that one page is remediated within
   S1 (small, in `apps/web`/`@pilotage/ui`).

4. **The parent child-claim → admin approval journey (E9, S2).** Signed in as the demo parent, the test
   submits a **child-claim** (E9-S1) for a known demo child and sees *"Demande envoyée — en attente de
   validation"*; signed in as the demo admin, it works the **"Demandes de rattachement"** queue (E9-S2) and
   **approves**; back as the parent, the child's dashboard now resolves — the **atomic approve = access**
   invariant, proven through the real ABAC wall end-to-end. The same journey asserts the non-stigmatising
   reject + re-submit copy is present.

5. **The parent ↔ teacher messaging journey (E2, S3).** Signed in as the demo parent, the test opens a
   conversation with a teacher **currently teaching their child** (the E2 dual-wall) and sends a message;
   signed in as the demo teacher, it sees the conversation in `/teacher/conversations`, replies, and
   marks-read; back as the parent, the reply is visible. The journey proves the dual-wall ABAC
   (guardianship ∩ teaching-assignment) holds for a legitimate pair end-to-end.

6. **The cross-portal axe-core WCAG 2.2 AA sweep (S4).** The suite runs an axe-core WCAG 2.2 AA scan
   across **a representative authenticated page per portal** — parent dashboard + recommendations, teacher
   gradebook + conversations, admin analytics + a queue, student dashboard — asserting **zero
   critical/serious** violations, and the violations it surfaces across those surfaces are **remediated**
   (contrast, focus-visible, names/labels, target size, keyboard reachability) in `apps/web` /
   `@pilotage/ui`. This is the R9 payoff: the whole shipped surface, not one page, held to WCAG 2.2 AA.

7. **A future epic ships a one-line journey test (the standing payoff).** After E10, an epic that adds, say,
   a new parent surface closes its slice with `test('new surface', async ({ parentPage }) => { … })` — one
   line to be already-logged-in, a few to assert the new capability. The regression net grows with the
   product instead of decaying behind it.

8. **The suite never builds or rebuilds (the resource invariant).** The E2E suite runs against the
   **already-running** local stack at `http://localhost:3100` (+ the api/worker the operator already has
   up), or Playwright's `webServer` starts `next dev` (not `next build`). **No `next build`, no
   `docker build`, no `infra rebuild`** is ever part of running E10's tests — project-context §4 holds.

## Functional requirements

**FR-1 — Portal-aware authenticated-session fixture (the spine).** A reusable fixture exposes, per portal
audience, an **authenticated** browser context: `admin` / `teacher` / `parent` / `student`. A test obtains
an already-signed-in page for a role in **one line** (a Playwright `storageState` per role and/or a
`loginAs(role)` helper / per-role fixtures `adminPage`/`teacherPage`/`parentPage`/`studentPage`).
Authentication is performed **once per role** (a Playwright **setup project** that logs in via the real
`/{portal}/login` flow and writes a cached `storageState` file under a git-ignored
`apps/web/tests/e2e/.auth/`), then **reused** across the suite. Sessions are seeded from the existing
**`voltaire-demo`** tenant accounts (the demo logins in project-context §6) — **no new test users, no new
seed of real children**.

**FR-2 — Critical journey #1: grade publish → parent explainable alert (S1).** An authenticated E2E test
asserts the cahier's core loop end-to-end against seeded demo data: the **parent** session reaches the
**explainable alert** surface and sees, for a struggling subject, an alert carrying its **rule + subject +
threshold/trend** *and* a **concrete next-step CTA** (the E1 "What should I do?" actions). The assertion
proves the alert is **explainable and actionable** — not merely that a page rendered.

**FR-3 — Authenticated a11y smoke scan (S1).** Riding the FR-1 parent session, an axe-core scan with the
**WCAG 2.2 AA** tag set (`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`) runs against **at least the
authenticated parent dashboard** and asserts **zero `critical`/`serious` violations**. Violations surfaced
on that page in S1 are remediated in S1 (small scope).

**FR-4 — Critical journey #2: parent child-claim → admin approval (E9, S2).** An authenticated journey
spans the parent and admin sessions: parent submits a child-claim (E9-S1) → sees the pending state; admin
works the approval queue (E9-S2) → approves; parent's child dashboard now resolves. The test asserts the
**atomic approve = access** invariant (no access before approval, access after) and that the parent-facing
copy is **non-stigmatising**.

**FR-5 — Critical journey #3: parent ↔ teacher messaging (E2, S3).** An authenticated journey spans the
parent and teacher sessions: parent opens a thread with a teacher **currently teaching their child** and
sends a message; teacher sees it in `/teacher/conversations`, replies, marks-read; parent sees the reply.
The test asserts the **dual-wall ABAC** resolves for a legitimate pair end-to-end (and, where cheap, that
an illegitimate pair is walled).

**FR-6 — Cross-portal WCAG 2.2 AA sweep + remediation (S4).** An axe-core **WCAG 2.2 AA** scan runs across
**a representative authenticated page per portal** (parent: dashboard + recommendations; teacher: gradebook
+ conversations; admin: analytics + one queue; student: dashboard) and asserts **zero `critical`/`serious`
violations**. The violations the sweep surfaces are **remediated** in `apps/web` / `@pilotage/ui`
(contrast ≥ AA, visible focus, accessible names/labels, target size ≥ 24×24 CSS px per WCAG 2.2 SC 2.5.8,
keyboard reachability, `aria-*` correctness). Remediation reuses `@pilotage/ui` primitives; any shared-UI
fix lands in `packages/ui`.

**FR-7 — Tag-able, selectable suites.** Journey tests carry a `@journey` tag and a11y tests a `@a11y` tag
(the existing smoke spec's `@smoke`/`@a11y` convention), so `test:e2e:smoke` (public, fast),
`test:e2e:a11y`, and the full `test:e2e` are independently runnable. The existing public smoke spec stays
green and unchanged (it is the fast pre-flight).

**FR-8 — Deterministic against seeded demo data, no test-data mutation drift.** Journeys read the stable
`voltaire-demo` seed; any journey that **mutates** state (claim, message, approve) is written to be
**idempotent / self-cleaning or tolerant of prior runs** (e.g. uses an already-claimable demo child,
unique message text, or asserts on the post-state rather than a virgin pre-state) so the suite is
**re-runnable** without a reseed. No journey depends on running exactly once.

**FR-9 — Runs against the running stack; never builds.** The suite targets `http://localhost:3100` (config
default / `PLAYWRIGHT_BASE_URL`) against the **already-running** web (+ api + worker) stack, or lets
Playwright's `webServer` start `next dev`. **No `next build` / `docker build` / `infra rebuild`** is part
of the E2E path (project-context §4). `PLAYWRIGHT_SKIP_SERVER=1` reuses an already-running dev server. The
auth-storage-state directory is **git-ignored** (never commit a session token).

**FR-10 — ADR-023 (the new architectural layer).** The test-runner + authenticated CI-E2E layer is
recorded in **`docs/adr/ADR-023`** on the **S1** run: Playwright as the runner, the storage-state
session-fixture pattern, the demo-tenant-seeded data posture, axe-core + the WCAG 2.2 AA tag set as the
a11y oracle, and the run-against-running-stack (never-build) rule. Re-verify the number is the next free
after ADR-022 at authoring time (the E6/E7/E8/E9 precedent).

**FR-11 — Documentation: how to run + how to add a journey.** `quickstart.md` documents how to run each
suite against the local stack and — the standing payoff — **how a future epic adds a one-line authenticated
journey test** using the fixture. The pattern is copy-pasteable.

## Acceptance criteria

- **AC-1 (auth-session fixture, S1).** A test can obtain an **already-signed-in** page for any of
  `admin`/`teacher`/`parent`/`student` in one line; authentication runs **once per role** (setup project
  → cached `storageState`), reused across the suite; sessions are the `voltaire-demo` demo accounts; the
  `.auth/` storage dir is git-ignored. Running the parent journey twice in a row does **not** re-type a
  login form per test.
- **AC-2 (grade→alert journey, S1).** The S1 journey, signed in as the demo parent, asserts the explainable
  alert surface shows an alert with its **rule + subject + threshold/trend** **and** a **next-step CTA**;
  the test **fails** if the alert is missing, unexplained, or has no action (i.e. it guards the
  information→action promise, not just a 200).
- **AC-3 (authenticated a11y smoke, S1).** An axe-core **WCAG 2.2 AA** scan of the **authenticated parent
  dashboard** returns **zero `critical`/`serious` violations**; any violation present on that page at S1
  start is **remediated within S1**. (The public-login `@a11y` scan stays green.)
- **AC-4 (child-claim → approval journey, S2).** The S2 journey proves: parent submits a claim → pending;
  before approval the parent has **no** access to the child; admin approves via the queue; **after**
  approval the parent's child dashboard resolves — the atomic-approve-=-access invariant, end-to-end. The
  journey is **re-runnable** (FR-8).
- **AC-5 (messaging journey, S3).** The S3 journey proves a parent and a teacher **currently teaching the
  child** can exchange a message both directions (parent sends → teacher sees + replies → parent sees);
  the journey is re-runnable (unique message text). Where cheap, an illegitimate pair is asserted walled.
- **AC-6 (cross-portal WCAG 2.2 AA sweep + remediation, S4).** The S4 sweep runs axe-core WCAG 2.2 AA
  across the representative authenticated page **per portal** and asserts **zero `critical`/`serious`
  violations**; the violations the sweep surfaced are **fixed** in `apps/web`/`@pilotage/ui` (the PR's diff
  shows both the assertions and the remediations). The sweep is part of `test:e2e:a11y`.
- **AC-7 (selectable suites, every slice).** `pnpm --filter @pilotage/web test:e2e:smoke` (public, fast),
  the `@a11y` selection, and the `@journey` selection are independently runnable; the **existing public
  smoke spec is unchanged and green**.
- **AC-8 (never builds; runs on the running stack; no secret committed).** Running any E10 suite invokes
  **no** `next build` / `docker build` / `infra rebuild`; it targets the running `:3100` stack (or
  `next dev` via `webServer`); the `.auth/` storage-state (a live session) is **git-ignored** and never
  committed.
- **AC-9 (ADR + reuse + no regression).** **`docs/adr/ADR-023`** is authored on S1; E10 adds **no schema
  change, no new API endpoint, no new permission, no new `NotificationKind`, no second BullMQ queue** (it
  is a test + a11y-remediation epic); any UI remediation **reuses `@pilotage/ui`** first (shared fixes in
  `packages/ui`); no portal capability or ABAC wall is loosened (the journeys *assert* the walls, they do
  not widen them).

## Non-goals (explicit)

- **No new product capability.** E10 ships **no** new endpoint, no new screen-as-feature, no schema
  change, no new permission, no new `NotificationKind`, no second queue. It is a **quality-bar** epic:
  tests + a11y remediation of **already-shipped** surfaces. (The only code that changes behaviour is
  WCAG remediation of existing UI.)
- **No CI provider / pipeline standup as a deliverable.** E10 makes the suite **CI-runnable** and records
  the layer in ADR-023, but **wiring a specific CI provider** (GitHub Actions workflow, runners, secrets
  vault) is **out of scope** — the routine runs against the local running stack (project-context §4) and a
  CI workflow is a recorded follow-on. (The config already sets `CI`-aware retries/reporters; that is
  enough.)
- **No build / rebuild, ever.** Running E2E never triggers `next build` / `docker build` / `infra
  rebuild` (project-context §4). Playwright may start `next dev`; it never builds.
- **No new seed / no real children's data.** E10 reuses the **existing `voltaire-demo`** seed and demo
  logins. It does **not** author a new test-data seed, and it never introduces real minors' data into
  fixtures.
- **No exhaustive coverage.** E10 ships the **critical** journeys (the core promise + E9 + E2) and a
  **representative** per-portal a11y sweep — **not** a test for every page or every branch. Breadth grows
  one-line-per-epic afterward (the fixture is the enabler), it is not front-loaded here.
- **No visual-regression / screenshot-diff suite, no performance/load testing, no cross-browser matrix.**
  Chromium only (the existing project), WCAG-AA correctness (not pixel-diff), functional journeys (not
  load). Recorded as future options.
- **No widening of any wall.** The journeys **assert** ABAC/tenant/portal walls; they never relax them to
  make a test pass. A journey that needs access uses a legitimately-entitled demo account.
- **No AAA, no manual-audit deliverable.** The bar is **WCAG 2.2 AA** via the automated axe-core oracle
  (+ the routine's A11y reviewer lens). A full manual/AT audit and AAA conformance are out of scope.

## Dependencies & reuse

- **`apps/web/playwright.config.ts` + `@playwright/test` ^1.60 + `@axe-core/playwright` ^4.11** — already
  installed and configured (testDir `./tests/e2e`, port 3100, `fr-FR`, chromium, `webServer: pnpm dev`,
  `PLAYWRIGHT_SKIP_SERVER`). E10 **extends** this config (adds a `setup` project + a per-role
  `storageState`), it does not invent the harness. **Verified on disk.**
- **`apps/web/tests/e2e/smoke.spec.ts`** — the existing public-login smoke + `@a11y` scan and the
  `@smoke`/`@a11y` tag convention. E10 reuses the tag pattern and the `AxeBuilder().withTags([...])`
  idiom; the smoke spec stays unchanged (the fast pre-flight).
- **`test:e2e` / `test:e2e:smoke` / `test:e2e:install` scripts** (`apps/web/package.json`) — reused; E10
  adds `test:e2e:a11y` and (optionally) `test:e2e:journey` grep selections.
- **The `voltaire-demo` seed + demo logins** (project-context §6): admin `mme.dupont@voltaire.fr` /
  `Demo!2024Pilotage`; the simple per-portal `admin|teacher|parent@pilotage.local` / `Changeme123!`; the
  E8 `student` demo (operator-activated). The fixture authenticates **these**, no new accounts.
- **The shipped surfaces under test** — E1 explainable alert + "What should I do?" panel
  (`/parent/recommendations`), E9 child-claim (`/parent/children`) + admin queue (`/admin/child-claims`),
  E2 messaging (`/parent/messages`, `/teacher/conversations`). E10 **asserts** them; it does not modify
  them (except WCAG remediation).
- **`@pilotage/ui` + `packages/ui`** — WCAG remediation reuses the design system primitives first (the
  E3-S3 hardened `Drawer` focus-trap precedent); a genuinely-shared fix lands in `packages/ui`.
- **ADR-003 (route groups) / ADR-004 (1 realm, OIDC clients) / ADR-015 (RBAC+ABAC) / ADR-021 (student
  self-ABAC) / ADR-002 (tenant + RLS)** — the walls the journeys exercise and assert; **unchanged**. E10's
  own decision (the authenticated E2E + a11y layer) is **ADR-023**.
- **The agent-roster A11y reviewer (row 13) + Murat's gate (row 15)** — E10 turns their review lenses into
  executable gates; the suite is the artifact those lenses now run.

> **Authoritative slice backlog → [`tasks.md`](./tasks.md)** (the `[S1]`–`[S4]` arc). Architecture/data
> posture → [`plan.md`](./plan.md) + [`data-model.md`](./data-model.md) (Winston: **no schema change**).
> Screens/a11y targets → [`ux.md`](./ux.md) (Sally). API surface touched (read-only, no new endpoint) →
> [`contracts/openapi.yaml`](./contracts/openapi.yaml). How to run + add a journey →
> [`quickstart.md`](./quickstart.md). Run status → [`PROGRESS.md`](./PROGRESS.md).
