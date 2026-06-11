# E10-S1 — Auth-session fixture + grade→alert journey + authenticated a11y smoke + ADR-023

> **Self-contained story spec (BMAD / John the PM).** A developer must be able to implement this slice
> from THIS file alone. It is **one shippable vertical slice** of E10 — *not* the whole epic. Parent
> spec: [`../spec.md`](../spec.md) · slice backlog: [`../tasks.md`](../tasks.md) · fixture contract:
> [`../contracts/auth-fixture.contract.md`](../contracts/auth-fixture.contract.md). On land, tick S1 in
> [`../PROGRESS.md`](../PROGRESS.md) + [`../tasks.md`](../tasks.md).

- **Epic:** E10 — Quality bar: authenticated E2E + WCAG 2.2 AA (Tier 4, Foundation/quality)
- **Slice:** S1 (the load-bearing, ADR-bearing slice; the spine of the epic)
- **Tags:** `[test][a11y][e2e]` · **Risk tier:** P2 · **Size:** ~M
- **touchesUi:** true (WCAG remediation of existing markup only — no new screen/feature)
- **touchesBackend:** false · **touchesWorker:** false
- **Portal:** parent (the journey + a11y target ride the parent session; the fixture serves all portals)

---

## 1. Intent (one compressed, contradiction-free sentence)

Stand up the reusable **portal-aware authenticated-session fixture** (a Playwright `setup` project that
logs in once per role against the `voltaire-demo` demo accounts and caches a git-ignored
`storageState` per role), ship the first **`@journey` test** that opens already-signed-in as the demo
parent and **fails unless the explainable alert carries rule + subject + threshold/trend AND the E1
next-step CTA**, add the first **authenticated `@a11y` axe WCAG-2.2-AA smoke** on the parent dashboard
asserting zero critical/serious (remediating in place), wire `test:e2e:a11y` / `test:e2e:journey`
scripts, git-ignore `.auth/`, and author **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** —
**`apps/web` tests/config + small WCAG fixes ONLY**, run against the already-running `:3100` stack,
**never build**.

## 2. Why now (context the dev needs)

E1–E9 are all shipped. The *unauthenticated* half of R10 already exists on disk (verified):
`apps/web` has `@playwright/test` ^1.60 + `@axe-core/playwright` ^4.11 as devDeps, a working
`apps/web/playwright.config.ts` (testDir `./tests/e2e`, port 3100, `fr-FR`, chromium, `webServer: pnpm
dev`, `PLAYWRIGHT_SKIP_SERVER`), `test:e2e` / `test:e2e:smoke` / `test:e2e:install` scripts, and **one**
spec (`apps/web/tests/e2e/smoke.spec.ts`) that asserts the 3 public login pages render + a `@a11y` axe
scan of those **public** pages. What is genuinely unbuilt: any test that **logs in**, any **reusable
auth-session fixture**, any axe sweep of an **authenticated** page (where 95% of the product and 95% of
the a11y risk live), and the **ADR** for this net-new cross-cutting test+a11y layer. S1 builds exactly
that minimum spine.

## 3. Scope — files to create / change (the whole slice)

**All under `apps/web` except the ADR. No schema, no API endpoint, no permission, no second queue, no
`@pilotage/ui` change unless a surfaced a11y violation genuinely needs a shared-primitive fix.**

### 3.1 The fixture (the spine — FR-1 / AC-1)
- **`apps/web/tests/e2e/fixtures/users.ts`** — the `Portal` type (`'admin'|'teacher'|'parent'|'student'`)
  + `PortalUser { portal; email; password; expectedRole; landing }` + a resolver returning the demo
  user per portal. **Credential resolution order (locked):**
  1. `process.env.E2E_<PORTAL>_EMAIL` / `E2E_<PORTAL>_PASSWORD` (CI/operator override), else
  2. the simple per-portal set `<portal>@pilotage.local` / `Changeme123!`, else
  3. for the rich `voltaire-demo` graph the parent journey needs, `mme.dupont@voltaire.fr` /
     `Demo!2024Pilotage` (admin) — used only where the simple set lacks data.
  `landing` mirrors `apps/web/src/middleware.ts` `PORTAL_LANDING`
  (`admin → /admin/dashboard`, `teacher → /teacher/dashboard`, `parent → /parent/dashboard`,
  `student → /student/dashboard`). `expectedRole`: `school_admin` | `teacher` | `parent` | `student`.
- **`apps/web/tests/e2e/auth.setup.ts`** — the **setup project** body. For each role that S1 needs
  (at minimum **parent**; admin/teacher/student wired but tolerant of an inactive student): probe stack
  reachability first (short-timeout `GET {baseURL}`); if unreachable, `test.skip(...)` (see §6). Else log
  in via the **real UI flow** (preferred): `page.goto('/{portal}/login')`, fill `getByLabel('Email')` /
  `getByLabel('Mot de passe')`, click the `Se connecter` button, `await page.waitForURL(landing)`, then
  `page.context().storageState({ path: '.auth/{role}.json' })`. (Locators verified in `smoke.spec.ts`.)
- **`apps/web/tests/e2e/fixtures/portal-fixtures.ts`** — `test = base.extend<{ adminPage; teacherPage;
  parentPage; studentPage }>` exposing a per-role already-authenticated `Page` in one line; optionally a
  `loginAs(role)` helper on top. (Per-role pages are obtained via the project `storageState`, see §3.4.)

### 3.2 Config wiring (FR-1 / FR-9 / AC-8)
- **`apps/web/playwright.config.ts`** — add a `setup` project (`testMatch: /.*\.setup\.ts/`) and per-role
  authenticated projects that depend on it and carry the cached `storageState`:
  ```ts
  projects: [
    { name: 'setup', testMatch: /.*\.setup\.ts/ },
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } }, // UNCHANGED — runs smoke.spec.ts (public)
    { name: 'chromium-parent',  use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/parent.json' },  dependencies: ['setup'] },
    { name: 'chromium-admin',   use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/admin.json' },   dependencies: ['setup'] },
    { name: 'chromium-teacher', use: { ...devices['Desktop Chrome'], storageState: 'tests/e2e/.auth/teacher.json' }, dependencies: ['setup'] },
  ]
  ```
  Keep `webServer` exactly as-is (`pnpm dev` / `PLAYWRIGHT_SKIP_SERVER` honoured — never `next build`).
  The existing unauthenticated `chromium` project + `smoke.spec.ts` stay **unchanged and green**.

### 3.3 Journey #1 — grade publish → parent explainable alert (FR-2 / AC-2)
- **`apps/web/tests/e2e/journeys/grade-to-alert.spec.ts`** (`@journey`, runs under the parent session
  project). Read-only against the seed. The test:
  1. opens **already signed in** as the demo parent (no login form typed in the test body) and navigates
     to the explainable-alert surface — **`/parent/recommendations`** (the E1 alert+next-step surface;
     verified on disk: alert cards render `a.title`/`a.body`, the `CODE_LABEL` rule chip, the
     `SubjectChip`, and the `AlertNextSteps` "Que puis-je faire ?" panel).
  2. asserts an alert is present with its **rule** (the `CODE_LABEL` chip / type, e.g. "Moyenne basse",
     "Tendance négative", "Signalement enseignant"), its **subject** (the `SubjectChip` label), and its
     **threshold/trend explanation** (the alert `body` text), AND a **concrete next-step CTA** — the
     `AlertNextSteps` panel headed **"Que puis-je faire ?"** with at least one actionable element
     ("Écrire à l’enseignant·e" link / "Demander un rendez-vous" / a "reinforce subject" deep-link /
     "Voir le soutien"). The assertion **fails** if the alert is missing, unexplained (no rule or no
     subject or no body), or has no CTA — it guards the information→action promise, **not** a 200.
  3. (cheap ABAC bonus, optional) asserts the parent reaches **only their own** child's data (e.g. the
     `ChildSelector` shows the parent's children, not a roster).
  > **Seed dependency / graceful skip:** the journey needs at least one open alert for the demo parent's
  > child. If the simple `parent@pilotage.local` account has no alert-bearing child, prefer the
  > `voltaire-demo` rich graph (resolution order step 3) OR `test.skip` with a clear message when the
  > surface legitimately shows the "Aucune alerte ouverte" empty state — **never assert a false red on a
  > seed that has no alert.** Document the chosen account inline.

### 3.4 Authenticated a11y smoke (FR-3 / AC-3)
- **`apps/web/tests/e2e/a11y/authenticated.a11y.spec.ts`** (`@a11y`, parent session). Riding the parent
  session, run `new AxeBuilder({ page }).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa'])`
  on the **authenticated `/parent/dashboard`** (the public-login scan never reaches it), filter to
  `impact === 'critical' || impact === 'serious'`, assert `[]` (mirrors the existing smoke spec's
  threshold). **Remediate in `apps/web` (reuse `@pilotage/ui` first; a genuinely shared fix lands in
  `packages/ui`) any critical/serious violation surfaced on that one page** — small scope, S1 only.
  The WCAG 2.2 tag set **must include `wcag22aa`** (covers SC 2.5.8 target size — a 2.2 addition).

### 3.5 Scripts (FR-7 / AC-7)
- **`apps/web/package.json`** — add:
  - `"test:e2e:a11y": "playwright test --grep @a11y"`
  - `"test:e2e:journey": "playwright test --grep @journey"`
  - keep `test:e2e` / `test:e2e:smoke` (`--grep @smoke`) / `test:e2e:install` **unchanged**.

### 3.6 Git-ignore the session store (FR-9 / AC-8)
- Add **`apps/web/tests/e2e/.auth/`** to the repo `.gitignore` (the root `.gitignore` at
  `C:/Users/HP/Downloads/pilotage-scolaire-claude/.gitignore`; there is **no** `apps/web/.gitignore`).
  The `.auth/*.json` files carry a **live session token** — they must **never** be committed.

### 3.7 ADR-023 (the new architectural decision — COMMITTED, FR-10 / AC-9)
- **`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md`** — author it. **Re-verify** at authoring time
  that `023` is the next-free number: the last ADR on disk is
  `docs/adr/ADR-022-enrollment-self-service-child-claim.md` (verified this run → `023` is free). On a
  collision, take the next free integer and update every reference in one pass. The ADR records:
  Playwright as the E2E runner; the **storage-state session-fixture** pattern (auth once per role →
  cached git-ignored `.auth/{role}.json`); the **demo-tenant-seeded** test-data posture (reuse
  `voltaire-demo`, no new seed / no real children); **axe-core** as the a11y oracle + the **WCAG 2.2 AA**
  tag set (`wcag2a wcag2aa wcag21a wcag21aa wcag22aa`, incl. SC 2.5.8) with **critical/serious = hard
  fail**; and the **run-against-the-already-running-stack, never-build** rule (project-context §4).
  Rejected alternatives to record: a CI-provider workflow as an E10 deliverable (deferred — recorded
  follow-on); a mock auth layer (rejected — the fixture logs in through the real flow); a new test-only
  seed (rejected — reuse `voltaire-demo`).

### 3.8 Docs (FR-11)
- **`docs/spec/features/e10/quickstart.md`** — ensure it documents (a) how to run each suite against the
  local `:3100` stack (`test:e2e:smoke` public-fast, `test:e2e:a11y`, `test:e2e:journey`, full
  `test:e2e`); (b) the **copy-pasteable "add a one-line journey" recipe** using `parentPage` etc. (If the
  file already carries these from the spec run, reconcile rather than duplicate.)

## 4. Constraints & guardrails (hard — do not violate)

- **Never build.** No `next build`, no `docker build`, no `infra/pilotage.sh update|rebuild|reset`. The
  suite targets the **already-running `:3100` stack** (the operator has web + api + worker up), or
  Playwright's `webServer` starts `next dev`. Honour `PLAYWRIGHT_SKIP_SERVER=1` to reuse a running server.
- **No schema / no endpoint / no permission / no `NotificationKind` / no second BullMQ queue.** S1 is a
  **test + a11y-remediation** slice. The only behaviour-changing code is **WCAG remediation of existing
  UI**.
- **Reuse `@pilotage/ui` first** for any remediation; a genuinely-shared a11y fix lands in `packages/ui`
  (the E3-S3 hardened-`Drawer` focus-trap precedent). Do **not** re-theme broadly — fix only what the
  scan surfaces.
- **No committed session token.** `apps/web/tests/e2e/.auth/` is git-ignored before any run that writes
  it; never log a token; credentials come from env or the documented demo set.
- **No wall widening.** The journey **asserts** the ABAC/tenant/portal walls (parent sees only their own
  child); it must never relax ABAC to pass. Use the legitimately-entitled demo account.
- **Keep the existing public `smoke.spec.ts` unchanged and green** (it is the fast pre-flight, and the
  existing unauthenticated `chromium` project still runs it).
- **Work ONLY inside the repo.** Do **not** run `pnpm typecheck` (Murat's gate owns that). Do not touch
  unrelated areas or remove working features.

## 5. Acceptance criteria (this slice)

- **AC-1 (fixture).** A test obtains an **already-signed-in** page for a portal (at minimum `parentPage`)
  in **one line**; authentication runs **once per role** (the `setup` project → cached `storageState`),
  reused across the suite; sessions are the `voltaire-demo` demo accounts; `apps/web/tests/e2e/.auth/` is
  git-ignored. Running the parent journey twice in a row does **not** re-type a login form per test.
- **AC-2 (grade→alert journey).** The `@journey` test, signed in as the demo parent on
  `/parent/recommendations`, asserts an alert with its **rule + subject + threshold/trend** **and** a
  **next-step CTA**; the test **fails** if the alert is missing, unexplained, or has no action.
- **AC-3 (authenticated a11y smoke).** The `@a11y` axe **WCAG 2.2 AA** scan of the authenticated
  `/parent/dashboard` returns **zero `critical`/`serious`** violations; any present at S1 start is
  **remediated within S1**. The public-login `@a11y` scan stays green.
- **AC-7 (selectable suites).** `test:e2e:smoke` (public/fast), `test:e2e:a11y`, and `test:e2e:journey`
  are independently runnable; the existing public smoke spec is **unchanged and green**.
- **AC-8 (never builds / running stack / no secret committed).** Running any E10 suite invokes **no**
  build/rebuild; it targets the running `:3100` stack (or `next dev` via `webServer`); the `.auth/`
  storage-state is **git-ignored** and never committed.
- **AC-9 (ADR + reuse + no regression).** `docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` is
  authored on S1; S1 adds **no** schema / endpoint / permission / `NotificationKind` / second queue; any
  UI remediation **reuses `@pilotage/ui`** first; no portal capability or ABAC wall is loosened.

## 6. Edge cases & pre-mortem (failure modes → guards)

- **Stack down → false red.** `auth.setup.ts` probes reachability first; if the stack is unreachable it
  **skips** the authenticated projects (`test.skip(!reachable, ...)`) rather than failing — a PR run on a
  machine without the booted stack stays green (the unauthenticated `smoke.spec.ts` is unaffected).
- **Demo account has no open alert.** The journey prefers the alert-bearing `voltaire-demo` graph; if the
  surface legitimately shows "Aucune alerte ouverte", `test.skip` with a clear message — never assert a
  false red against an empty seed.
- **Session-token cookie name varies.** It may be `authjs.session-token` **or**
  `next-auth.session-token` (host-dependent). Persist the whole context `storageState` (cookies +
  origins) — do **not** hard-code one cookie name.
- **Re-runnability.** The journey is **read-only** against the seed (no mutation) → idempotent across
  consecutive runs by construction.
- **Wrong-portal login silently passes.** The setup **asserts** `expectedRole` is present and the
  post-login URL equals `landing`; a wrong-portal/failed login fails the setup **loudly** at the gate
  (not mid-journey).
- **Remediation scope creep.** Fix only the critical/serious violations the dashboard scan surfaces;
  resist a blanket re-theme (that is S4's representative sweep, not S1).

## 7. Targeted tests (Murat P0 — what proves the slice)

- The fixture logs in **once per role** and reuses the cached `storageState` (a journey opens
  already-signed-in with **no** login form typed in the test body).
- The grade→alert journey **fails** if the alert is missing / unexplained / has no CTA (it guards the
  promise, not a 200).
- The authenticated a11y scan flags a real (e.g. deliberately injected) violation as a sanity check, and
  passes clean after remediation.
- Re-running S1 twice consecutively is green (the read-only journey is idempotent).

## 8. Out of scope (this slice — later or never)

- The E9 child-claim→approval journey (**S2**), the E2 messaging journey (**S3**), the cross-portal WCAG
  sweep + broad remediation (**S4**).
- Any CI-provider workflow standup (recorded follow-on in ADR-023, not an E10 deliverable).
- Any new seed / real children's data; any cross-browser matrix / visual-diff / perf; AAA; manual-AT
  audit. (See `../spec.md` Non-goals.)
