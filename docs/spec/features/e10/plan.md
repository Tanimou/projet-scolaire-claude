# E10 — Architecture & delivery plan (Winston)

> Companion to [`spec.md`](./spec.md) + [`tasks.md`](./tasks.md). Architecture posture for the
> authenticated E2E + WCAG-2.2-AA quality bar. **PASS** with one committed ADR (ADR-023). Authored on the
> epic-spec run; the S1 implementer re-verifies the ADR number and the on-disk config facts.

## 1. Verdict

**PASS (with ADR-023 committed on S1).** E10 introduces **one new cross-cutting architectural layer** — an
authenticated, CI-runnable end-to-end + a11y test layer — which per project-context §3 lands **with** a new
ADR. Everything else is **reuse**: the harness (`@playwright/test` + `@axe-core/playwright` + the existing
`playwright.config.ts` + the `tests/e2e` dir + the `test:e2e*` scripts) is already on disk; the data is the
existing `voltaire-demo` seed; the surfaces under test are shipped E1/E2/E9 features. **No schema, no API
endpoint, no permission, no `NotificationKind`, no second queue.** The only behaviour-changing code is
**WCAG remediation of existing UI**, which reuses `@pilotage/ui` (shared fixes in `packages/ui`).

## 2. Where the new layer sits (and where it does not)

```
 ┌─────────────────────────────────────────────────────────────────────┐
 │ NEW (E10): authenticated E2E + a11y layer  →  ADR-023                │
 │  apps/web/tests/e2e/                                                 │
 │    auth.setup.ts  ── logs in once per role (real /{portal}/login)    │
 │                     → cached storageState in .auth/{role}.json (git-ignored) │
 │    fixtures/auth.ts ── adminPage/teacherPage/parentPage/studentPage  │
 │    journeys/*.spec.ts (@journey) ── grade→alert · claim→approve · msg │
 │    a11y/*.a11y.spec.ts (@a11y) ── axe-core WCAG 2.2 AA, auth pages    │
 │    smoke.spec.ts (@smoke,@a11y) ── EXISTING public-login (unchanged)  │
 └───────────────┬─────────────────────────────────────────────────────┘
                 │ drives a real browser against the ALREADY-RUNNING stack
                 ▼
 http://localhost:3100  (next dev)  ──►  /api/v1/*  ──►  worker / Postgres / Redis
   the shipped apps/web + apps/api + apps/worker — UNCHANGED by E10
   (except WCAG-AA remediation of existing apps/web + packages/ui markup)
```

The layer is **outside** the runtime apps: it is a Playwright project under `apps/web/tests/e2e`. It does
not add a module, a route, a DI provider, a queue, a table, or a permission. It **observes and asserts**
the running system; the only thing it *changes* is existing UI markup, to satisfy WCAG-AA.

## 3. The auth-session fixture (the spine)

- **Auth once per role.** A Playwright **`setup` project** (`auth.setup.ts`) runs before the test projects.
  For each of `admin`/`teacher`/`parent`/`student` it drives the **real** `/{portal}/login` form with the
  `voltaire-demo` demo credentials (project-context §6), waits for the post-login landing
  (`PORTAL_LANDING[role]`), and persists `context.storageState()` to
  `apps/web/tests/e2e/.auth/{role}.json`. This exercises the login flow in exactly one place and makes
  every downstream test fast (no per-test login).
- **Reuse via `storageState`.** Test projects depend on `setup` and set
  `use: { storageState: '.auth/{role}.json' }` per project, **or** `fixtures/auth.ts` exports
  `parentPage`/`teacherPage`/`adminPage`/`studentPage` fixtures (a context created from the cached state)
  plus a `loginAs(role)` escape hatch. A journey is then **one line** to be already-signed-in.
- **Secret hygiene.** `apps/web/tests/e2e/.auth/` is added to `.gitignore` — the storage state is a **live
  session token** and must never be committed (AC-8). Credentials come from env (defaulting to the
  documented demo logins), never hard-coded secrets beyond the public demo password.
- **next-auth note (implementer).** The portal uses `next-auth` 5 (beta). The setup logs in through the UI
  form so it captures whatever cookie/session the running stack issues (Keycloak/credentials) without the
  test needing to know the auth internals — the storage-state pattern is auth-mechanism-agnostic.

## 4. Data posture (no schema change)

- **Reuse `voltaire-demo`.** All journeys read the existing seed and demo accounts. **No new seed, no new
  test users, no real children's data** (FR-1/FR-8). E10 adds **zero** Prisma model/enum/column — see
  [`data-model.md`](./data-model.md) (deliberately a "no schema change" record).
- **Re-runnability over reseed.** Mutating journeys (claim, message, approve) are written **idempotent /
  tolerant of prior runs** (unique run-stamped text; assert on post-state; use a child that's claimable
  each run) so the suite never requires a reseed between runs (FR-8). This is a test-design rule, not a
  data change.

## 5. WCAG-2.2-AA remediation posture

- **Oracle:** `@axe-core/playwright` `AxeBuilder().withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa',
  'wcag22aa'])`; **hard-fail** on `critical`/`serious` (matches the existing smoke spec). The 2.2 tag set
  pulls in **SC 2.5.8 Target Size (Minimum) 24×24** and the other 2.2 additions.
- **Fix location:** **reuse `@pilotage/ui` first**; a fix that belongs to a shared primitive lands in
  `packages/ui` (the E3-S3 hardened-`Drawer` focus-trap precedent), an app-specific fix in `apps/web`. The
  S4 PR shows assertions **and** remediations together.
- **Scope discipline:** remediate what the sweep **surfaces** on the **representative** pages — not a
  blanket re-theme. Breadth grows via the standing gate, not a big-bang.

## 6. Run + resource posture (project-context §4 — hard)

- **Never builds.** Running any E10 suite invokes **no** `next build` / `docker build` / `infra rebuild`.
  It targets the **already-running** `:3100` stack; Playwright's `webServer` (if used) starts **`next dev`**,
  not a build. `PLAYWRIGHT_SKIP_SERVER=1` reuses a running dev server (AC-8/FR-9).
- **CI-runnable, not CI-wired.** The config is already `CI`-aware (retries/reporters/workers). E10 makes the
  suite runnable in CI and records the layer in ADR-023; **standing up a specific CI provider workflow is a
  recorded follow-on** (spec.md Non-goals, ledger R3).
- **One build per run is the orchestrator's, not the suite's.** Per project-context §4b the single
  `pnpm build` belongs to the lock-holder *after* the Workflow — it is unrelated to running the E2E suite.

## 7. ADR-023 (committed on S1)

`docs/adr/ADR-023-authenticated-e2e-and-a11y-layer.md` records the new layer:
- **Runner:** Playwright (`@playwright/test`, already a devDep) — chromium project (no cross-browser
  matrix, ledger R7).
- **Session fixture:** the setup-project → cached per-role `storageState` pattern; auth once per role.
- **Test data:** the existing `voltaire-demo` seed + demo logins; no new seed, no real minors' data.
- **a11y oracle:** `@axe-core/playwright`, WCAG 2.2 AA tag set, critical/serious hard-fail.
- **Run posture:** against the running stack; **never build** (project-context §4); CI-runnable, CI-wiring
  deferred.
- **Rejected alternatives (record):** Cypress / WebdriverIO (Playwright is already installed + configured);
  a new dedicated E2E seed (reuse `voltaire-demo`); per-test login (auth-once-per-role is faster + exercises
  login in one place); committing storage-state (it's a live token → git-ignore); a manual a11y audit as
  the gate (automated axe is the regression-proof oracle, the manual audit is a future option).

Re-verify the number is next-free after **ADR-022** (the last on disk this run) at authoring time — the
E6/E7/E8/E9 precedent.

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Flaky auth/session in CI | auth once per role + cached storageState; generous `webServer` timeout (already 120s); `retries:2` on CI (already set) |
| Journey brittleness vs seed drift | role-stable selectors (`getByRole`/`getByLabel`, the smoke-spec idiom); idempotent/tolerant assertions (FR-8); read-only where possible |
| a11y sweep too broad → unbounded remediation | representative page **per portal**, not every page; critical/serious only blocks; breadth grows via the standing gate |
| Committing a session token | `.auth/` git-ignored (AC-8); Sentinel/Drift gate on S1 |
| Accidental build in the test path | FR-9/AC-8 explicit; the never-build gate on S1; `webServer` is `next dev` not `next build` |
| ABAC wall relaxed to make a test pass | hard non-goal; journeys use legitimately-entitled demo accounts and *assert* the walls |
