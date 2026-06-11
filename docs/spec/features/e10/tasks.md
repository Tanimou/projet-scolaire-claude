# E10 — Slice backlog (tasks)

> Shippable vertical slices for **E10 — Quality bar: authenticated E2E + WCAG 2.2 AA**.
> Each slice = one PR + one build, demoable end-to-end (a journey/scan you can *run* and watch pass).
> Ship **in order** (S1 → S4). The acceptance criteria + FRs live in [`spec.md`](./spec.md); the
> architecture posture in [`plan.md`](./plan.md); the screens + a11y targets in [`ux.md`](./ux.md).

**Status legend:** `[ ]` not started · `[~]` in progress · `[x]` shipped.

> **Slice arc (4 slices).** **S1** is the load-bearing, ADR-bearing slice — it stands up the **reusable
> portal-aware auth-session fixture** (the whole epic's spine), the **first critical journey** (grade
> publish → parent explainable alert), the **first authenticated a11y scan**, and **ADR-023**. After S1
> the regression net *exists* and a future epic can already append a one-line journey. **S2** adds the
> **E9 child-claim → admin approval** journey (cross-portal parent↔admin). **S3** adds the **E2 parent ↔
> teacher messaging** journey (cross-portal parent↔teacher). **S4** is the **cross-portal WCAG 2.2 AA
> sweep + remediation** — the R9 payoff across every portal. **All four are `apps/web`-only (tests +
> WCAG remediation); shared-UI a11y fixes land in `packages/ui`. No schema, no endpoint, no permission.**
>
> **ADR posture (Winston — authoritative):** **`ADR-023` IS authored on S1 (committed, not conditional).**
> An authenticated, CI-runnable E2E + a11y layer (a browser driver against the running stack, cached
> storage-state sessions seeded from the demo tenant, an axe-core WCAG-2.2-AA oracle) is a **net-new
> cross-cutting architectural layer** the project has not formally adopted — project-context §3 requires it
> land **with** a new ADR → `docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` (re-verify the number is
> next-free after ADR-022 on the S1 run; ADR-022 is the last on disk this run).

---

## [x] S1 — Auth-session fixture + grade→alert journey + a11y smoke + ADR-023 · `[test][a11y][e2e]` · P2 · ~M · **SHIPPED**

**Goal:** the spine. A reusable portal-aware authenticated-session fixture seeded from `voltaire-demo`,
the first critical end-to-end journey (grade publish → parent **explainable** alert → next step), the
first **authenticated** axe WCAG-2.2-AA scan, and **ADR-023**. Demoable by running the parent journey
(opens already-signed-in, asserts the explainable+actionable alert) and the authenticated a11y scan, both
green, against the running `:3100` stack.

**Scope (`apps/web` tests + config + small WCAG remediation):**
- **Fixture (the spine):** a Playwright **setup project** in `playwright.config.ts` that logs in once per
  role via the real `/{portal}/login` flow against the `voltaire-demo` demo accounts and writes a cached
  `storageState` per role to a **git-ignored** `apps/web/tests/e2e/.auth/{role}.json`; a
  `tests/e2e/fixtures/auth.ts` exposing per-role fixtures (`adminPage`/`teacherPage`/`parentPage`/
  `studentPage`) and/or a `loginAs(role)` helper so a test is already-signed-in in **one line** (FR-1).
  Add `apps/web/tests/e2e/.auth/` to `.gitignore`.
- **Journey #1 (`tests/e2e/journeys/grade-to-alert.spec.ts`, `@journey`):** signed in as the demo parent,
  open the explainable-alert surface (`/parent/recommendations` / dashboard alert), assert an alert shows
  **rule + subject + threshold/trend** AND a **next-step CTA** (the E1 "What should I do?" actions) — the
  information→action promise as a runnable assertion (FR-2/AC-2). Read-only against the seed.
- **Authenticated a11y smoke (`tests/e2e/a11y/authenticated.a11y.spec.ts`, `@a11y`):** riding the parent
  session, `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])` on the
  **authenticated parent dashboard**, assert zero `critical`/`serious` (FR-3/AC-3). Remediate any violation
  surfaced on that one page in `apps/web`/`@pilotage/ui` (small).
- **Scripts:** add `test:e2e:a11y` (grep `@a11y`) and (optional) `test:e2e:journey` (grep `@journey`) to
  `apps/web/package.json`; keep `test:e2e:smoke` (public) unchanged.
- **ADR (COMMITTED):** author `docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` (Winston gate) —
  Playwright runner, storage-state session-fixture pattern, demo-tenant-seeded data posture, axe-core +
  the WCAG-2.2-AA tag set, run-against-running-stack (never-build, project-context §4). Re-verify the
  number on the run.
- **Docs:** `quickstart.md` "run the suites" + "add a one-line journey" recipe.
- **Never-build gate (Sentinel/Drift):** confirm no script/config path triggers `next build`/`docker
  build`/`infra rebuild`; the suite targets `:3100` (or `next dev` via `webServer`); `.auth/` is
  git-ignored (no committed session token) (AC-8).

**Acceptance:** AC-1, AC-2, AC-3, AC-7, AC-8, AC-9 (spec.md — the fixture + first journey + first
authenticated a11y scan + ADR + never-build + no-regression).

**Targeted tests (Murat P0):**
- The fixture logs in once per role and reuses the cached `storageState` (a journey opens already-signed-in
  with no login form typed in the test body).
- The grade→alert journey **fails** if the alert is missing / unexplained / has no CTA (it guards the
  promise, not a 200).
- The authenticated a11y scan flags a real injected violation (sanity) and passes clean after remediation.
- Re-running S1 twice is green (read-only journey is idempotent).

---

## [x] S2 — Journey #2: parent child-claim → admin approval (E9) · `[test][e2e]` · P2 · ~S-M · **SHIPPED**

**Goal:** the cross-portal parent↔admin journey proving E9's **atomic approve = access** end-to-end.
Demoable by running the journey: parent claims a demo child → pending → admin approves in the queue →
parent's child dashboard resolves. **No schema, no new fixture (reuse S1's), no endpoint.**

**Scope (`apps/web` tests + small WCAG remediation as surfaced):**
- **Journey (`tests/e2e/journeys/child-claim-approval.spec.ts`, `@journey`):** parent session submits a
  child-claim (E9-S1 `ChildClaimDrawer` on `/parent/children`) for a claimable demo child → assert pending
  status strip + **no access** to that child yet; admin session opens `/admin/child-claims`, **approves**;
  parent session re-loads → the child's dashboard now resolves (FR-4/AC-4). Assert the parent-facing copy
  is **non-stigmatising** (and that the reject + re-submit path copy is present on a rejected fixture row
  where cheap).
- **Re-runnability (FR-8):** use a demo child that is claimable each run, or assert on the post-approval
  state tolerantly (claim already approved → still resolves), so the journey is idempotent without a
  reseed. Document the chosen approach inline.
- **A11y (opportunistic):** if the journey passes through a surface not yet swept, an inline `@a11y`
  WCAG-2.2-AA assertion may be added (full per-portal sweep is S4).

**Acceptance:** AC-4, AC-7, AC-8, AC-9 (spec.md).

**Targeted tests (Murat P0):**
- Before approval: the parent's child dashboard does **not** resolve the claimed child (pending ≠ active).
- After approval: it does — the atomic-approve-=-access invariant, through the real ABAC wall.
- The journey is green on a second consecutive run (idempotent).

---

## [ ] S3 — Journey #3: parent ↔ teacher messaging (E2) · `[test][e2e]` · P2 · ~S-M

**Goal:** the cross-portal parent↔teacher journey proving E2's **dual-wall ABAC** (guardianship ∩
teaching-assignment) end-to-end. Demoable by running the journey: parent messages a teacher who teaches
their child → teacher replies → parent sees the reply. **No schema, reuse S1's fixture, no endpoint.**

**Scope (`apps/web` tests + small WCAG remediation as surfaced):**
- **Journey (`tests/e2e/journeys/parent-teacher-messaging.spec.ts`, `@journey`):** parent session opens a
  thread with a teacher **currently teaching their child** (E2 `/parent/messages` → `/new`) and sends a
  message with **unique run-stamped text**; teacher session opens `/teacher/conversations`, sees the
  thread, **replies**, marks-read; parent session sees the reply (FR-5/AC-5).
- **Wall assertion (where cheap):** assert a parent **cannot** open a thread with a teacher **not** teaching
  their child (the dual-wall denies) — proving the wall, not just the happy path.
- **Re-runnability (FR-8):** unique message text per run + assert on presence (not absence), so re-runs are
  green without a reseed.
- **A11y (opportunistic):** inline `@a11y` WCAG-2.2-AA assertion on the messaging surfaces if not yet swept
  (full sweep is S4).

**Acceptance:** AC-5, AC-7, AC-8, AC-9 (spec.md).

**Targeted tests (Murat P0):**
- Round-trip both directions (parent→teacher visible to teacher; teacher→parent visible to parent).
- The illegitimate pair is walled (parent can't reach a non-teaching teacher) — where cheap to seed.
- Green on a second consecutive run (unique text).

---

## [ ] S4 — Cross-portal WCAG 2.2 AA sweep + remediation (R9 payoff) · `[a11y][test][ui]` · P2 · ~M

**Goal:** the R9 payoff — hold **every portal's** authenticated surface to WCAG 2.2 AA and **fix** the
violations. Demoable by running `test:e2e:a11y` across the per-portal pages, watching it surface real
violations, then watching it pass after the remediations land in the same PR.

**Scope (`apps/web` tests + WCAG remediation in `apps/web`/`packages/ui`):**
- **Sweep (`tests/e2e/a11y/cross-portal.a11y.spec.ts`, `@a11y`):** a data-driven axe-core WCAG-2.2-AA scan
  over a representative authenticated page **per portal** — parent: `/parent/dashboard` + `/parent/
  recommendations`; teacher: gradebook + `/teacher/conversations`; admin: `/admin/analytics` + one queue
  (e.g. `/admin/child-claims`); student: `/student/dashboard` — each riding its role session, asserting
  zero `critical`/`serious` (FR-6/AC-6).
- **Remediation (the work):** fix the violations the sweep surfaces — colour-contrast ≥ AA, visible
  `:focus-visible`, accessible names/labels (`aria-label`/`<label>`/`alt`), **target size ≥ 24×24 CSS px
  (WCAG 2.2 SC 2.5.8)**, keyboard reachability, valid `aria-*`/roles, heading order. **Reuse `@pilotage/ui`
  first**; a genuinely shared fix lands in `packages/ui` (the E3-S3 hardened-`Drawer` precedent). The PR
  diff shows **both** the assertions and the fixes.
- **Lock the gate in:** `test:e2e:a11y` now covers public + authenticated + cross-portal; document it in
  `quickstart.md` as the standing a11y gate.

**Acceptance:** AC-6, AC-7, AC-8, AC-9 (spec.md). **On land → `E10` is `shipped`.**

**Targeted tests (Murat P0):**
- The sweep enumerates one representative page per portal and runs under the correct role session each.
- After remediation, each swept page returns zero `critical`/`serious`.
- A deliberately-reverted fix re-fails the sweep (the gate actually guards).

---

## Cross-artifact reconciliation ledger (PM rulings — read before implementing)

| # | Divergence | PM ruling (authoritative) | Fix where |
|---|---|---|---|
| R1 | New seed for E2E vs reuse `voltaire-demo` | **Reuse `voltaire-demo`** + the project-context §6 demo logins; **no new seed, no real children** (FR-1/FR-8) | done (`spec.md`, `plan.md`) |
| R2 | Fixture shape: `loginAs()` helper vs per-role `storageState`/fixtures | **Both/either** — the canonical spine is a **setup project → cached per-role `storageState`** (auth once per role); the `loginAs(role)`/`parentPage` ergonomics sit on top (FR-1) | S1 |
| R3 | Stand up a CI provider workflow this epic? | **No** — make the suite **CI-runnable** + record the layer in ADR-023; a specific CI workflow (GH Actions) is a **recorded follow-on** (Non-goals) | done (`spec.md` Non-goals) |
| R4 | a11y bar: WCAG 2.1 AA vs **2.2 AA** | **WCAG 2.2 AA** (the epic title + R9) — tag set `wcag2a wcag2aa wcag21a wcag21aa wcag22aa`; **include SC 2.5.8 target-size** (a 2.2 addition) (FR-3/FR-6) | done |
| R5 | a11y fail threshold: all violations vs critical/serious | **critical/serious = hard fail** (matches the existing smoke spec); minor/moderate are remediated opportunistically but don't block (FR-3/FR-6) | done (`spec.md`) |
| R6 | ADR-023 committed vs conditional | **ADR-023 IS authored on S1 (committed)** — a net-new cross-cutting test+a11y layer (project-context §3). Re-verify the number on the run | S1 |
| R7 | Cross-browser matrix / visual-diff / perf | **Out of scope** — chromium-only (existing project), WCAG-AA correctness, functional journeys; recorded as future | done (`spec.md` Non-goals) |
| R8 | Slice count: 4 (this file) vs other counts | **4 slices** (S1 spine+journey1+a11y-smoke+ADR · S2 E9 journey · S3 E2 journey · S4 cross-portal sweep); `spec.md`/`PROGRESS.md` agree | done |

## Out of scope (recorded — see `spec.md` Non-goals)

- No new product capability / endpoint / schema / permission / `NotificationKind` / second queue.
- No CI-provider pipeline standup (recorded follow-on); no build/rebuild ever in the E2E path.
- No new seed / no real children's data; reuse `voltaire-demo`.
- No exhaustive coverage; critical journeys + representative per-portal a11y only (breadth grows
  one-line-per-epic afterward).
- No visual-regression/screenshot-diff, no perf/load, no cross-browser matrix, no AAA, no manual-AT-audit
  deliverable.
- No widening of any ABAC/tenant/portal wall (the journeys assert the walls; they never relax them).
