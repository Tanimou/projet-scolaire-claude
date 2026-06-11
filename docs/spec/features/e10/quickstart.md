# E10 — Quickstart (run the suites · add a one-line journey)

> How to run the authenticated E2E + WCAG-2.2-AA suites against the **already-running** local stack, and —
> the standing payoff — how a **future epic** adds a one-line authenticated journey test using the fixture.
> Companion to [`spec.md`](./spec.md) / [`tasks.md`](./tasks.md). **Never build to run these** (project-
> context §4): the suite targets `http://localhost:3100` or lets Playwright start `next dev`.

## 0. Prereqs (once)

```bash
# the local stack is already running (web :3100 + api :4000 + worker + Postgres/Redis):
#   the operator's usual scripts/dev.sh / infra up — NOT a build.
# install the chromium browser Playwright needs (one-time, not a build):
pnpm --filter @pilotage/web test:e2e:install
```

The `voltaire-demo` seed + demo logins must be present (project-context §6). The auth fixture writes cached
sessions to `apps/web/tests/e2e/.auth/{role}.json` — **git-ignored** (a live session token; never commit).

## 1. Run the suites

```bash
# fast public pre-flight (login pages render + public a11y) — the existing smoke spec, unchanged:
pnpm --filter @pilotage/web test:e2e:smoke

# the WCAG 2.2 AA a11y gate (public + authenticated + cross-portal) — the STANDING a11y gate:
pnpm --filter @pilotage/web test:e2e:a11y           # (grep @a11y)
#   covers, in one selection:
#     • public login pages              (smoke.spec.ts          — @a11y)
#     • authenticated parent dashboard  (authenticated.a11y.spec.ts — @a11y, S1)
#     • a representative authenticated page PER PORTAL (cross-portal.a11y.spec.ts — @a11y, S4):
#         parent: /parent/dashboard + /parent/recommendations
#         teacher: /teacher/grades  + /teacher/conversations
#         admin:   /admin/analytics + /admin/child-claims
#         student: /student/dashboard
#   each scanned under its own role session; critical/serious = hard fail (WCAG 2.2 AA, incl. SC 2.5.8).

# the authenticated critical journeys (grade→alert · claim→approve · messaging):
pnpm --filter @pilotage/web test:e2e:journey        # (optional; grep @journey)

# everything:
pnpm --filter @pilotage/web test:e2e

# reuse an already-running dev server (don't let Playwright start one):
PLAYWRIGHT_SKIP_SERVER=1 pnpm --filter @pilotage/web test:e2e

# point at a non-default host:
PLAYWRIGHT_BASE_URL=http://localhost:3100 pnpm --filter @pilotage/web test:e2e
```

> **Resource note (project-context §4):** none of the above runs `next build` / `docker build` / `infra
> rebuild`. Playwright's `webServer` starts `next dev` (not a build); `PLAYWRIGHT_SKIP_SERVER=1` reuses the
> running server. The single per-sprint `pnpm build` is the orchestrator's, unrelated to the E2E suite.

### `test:e2e:a11y` — the standing WCAG 2.2 AA gate (public + authenticated + cross-portal)

After **S4**, the `@a11y` selection is the project's **standing accessibility gate**. It is a single grep
that now spans three layers — and grows with the product:

| Layer | Spec | Surfaces |
|---|---|---|
| Public | `tests/e2e/smoke.spec.ts` | the 3 portal **login** pages |
| Authenticated (S1) | `tests/e2e/a11y/authenticated.a11y.spec.ts` | the authenticated **parent dashboard** (+ a sanity-injection that proves the gate bites) |
| **Cross-portal (S4)** | `tests/e2e/a11y/cross-portal.a11y.spec.ts` | one representative authenticated page **per portal** — parent (`/parent/dashboard`, `/parent/recommendations`), teacher (`/teacher/grades`, `/teacher/conversations`), admin (`/admin/analytics`, `/admin/child-claims`), student (`/student/dashboard`) — each under its own role session |

All of them assert **zero `critical`/`serious`** WCAG **2.2 AA** violations (tag set `wcag2a wcag2aa wcag21a
wcag21aa wcag22aa`, incl. **SC 2.5.8 Target Size**); moderate/minor are an opportunistic punch-list, not a
blocker (R5). A surfaced critical/serious is **fixed reuse-first** in `apps/web` (a genuinely shared fix
lands in `packages/ui`, the E3-S3 hardened-`Drawer` precedent), not silenced — the PR shows the assertion
and the fix together. **Adding a portal page to the gate is one row** in `SWEEP_TARGETS` (the data-driven
table in `cross-portal.a11y.spec.ts`): `{ portal, path, label, heading }`.

> The cross-portal sweep's **student** page rides the E8 demo learner, which is **operator-activated**
> (additive `db push` + `student` realm-role + demo learner, ADR-021). On a stack where the student is not
> yet provisioned, the `student` setup **skips** (not fails) and the student sweep `test.skip`s — never a
> false red. Every other portal's demo account is assumed present (a rejected login is a real regression).

## 2. How the auth-session fixture works (the spine)

- A Playwright **`setup` project** (`tests/e2e/auth.setup.ts`) logs in **once per role** via the real
  `/{portal}/login` form with the demo credentials, then saves `storageState` to `.auth/{role}.json`.
  It **asserts** the login landed on the portal landing AND the session carries the expected realm role —
  a rejected login **fails** the setup; only a genuinely unreachable stack **skips** it (no false red).
  The **`student`** portal is the one exception (operator-activated, E8/ADR-021): a not-yet-provisioned
  student login **skips** that role's setup rather than failing, so the cross-portal sweep's student page
  skips cleanly until the operator activates the learner.
- Test projects depend on `setup` and import the per-role fixtures
  (`adminPage`/`teacherPage`/`parentPage`/`studentPage`) from `tests/e2e/fixtures/portal-fixtures.ts`.
  Each fixture opens its role's own context from the cached `storageState` (so one spec can drive two
  roles, e.g. the S2/S3 cross-portal journeys), and `test.skip`s gracefully if the session is missing.
- Net effect: a test starts **already signed in as the right audience** with no login typed in its body,
  and login is exercised in exactly one place.

### Credentials (env-overridable; demo-seed-backed)

Per portal: `E2E_<PORTAL>_EMAIL` / `E2E_<PORTAL>_PASSWORD` (operator/CI override) → else the documented
demo default. The **parent** default targets the rich `voltaire-demo` graph the grade→alert journey needs;
if your local seed places that graph under a different parent account, pin it:

```bash
E2E_PARENT_EMAIL=parent.demo@voltaire.fr E2E_PARENT_PASSWORD='Demo!2024Pilotage' \
  PLAYWRIGHT_SKIP_SERVER=1 pnpm --filter @pilotage/web test:e2e:journey
```

> Prerequisite for the grade→alert journey: the demo parent (e.g. `apps/api/prisma/seed-demo-parent.ts`)
> must be present with at least one open alert. If the seed legitimately has no open alert, the journey
> **skips** (non-vacuous guard) rather than passing on an empty page.

## 3. Add a one-line authenticated journey (the standing payoff)

A future epic closes its slice with a journey like this — already-signed-in in one line:

```ts
// apps/web/tests/e2e/journeys/my-new-surface.spec.ts
import { expect, test } from '../fixtures/portal-fixtures';   // per-role fixtures

test('parent sees the new surface @journey', async ({ parentPage }) => {
  await parentPage.goto('/parent/my-new-surface');
  // assert the capability, not just a 200:
  await expect(parentPage.getByRole('heading', { name: /Ma nouvelle surface/i })).toBeVisible();
  await expect(parentPage.getByRole('button', { name: /Agir/i })).toBeVisible();
});
```

The S1 grade→alert journey (`tests/e2e/journeys/grade-to-alert.spec.ts`) is the worked example: it opens
`/parent/recommendations` already-signed-in and FAILS unless the first alert carries its **rule** (the
CODE_LABEL pill), a **subject/title**, a **non-empty explanatory body** (threshold/trend) AND the E1
**"Que puis-je faire ?"** next-step CTA — guarding information→action, not a 200.

And a one-line a11y assertion on the same surface:

```ts
import AxeBuilder from '@axe-core/playwright';
test('new surface has no critical a11y violations @a11y', async ({ parentPage }) => {
  await parentPage.goto('/parent/my-new-surface');
  const r = await new AxeBuilder({ page: parentPage })
    .withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa','wcag22aa']).analyze();
  expect(r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious')).toEqual([]);
});
```

**Guideline:** assert the **promise** (the alert is explainable + actionable; the claim grants access; the
message round-trips), not merely that a page returned 200. Use role-stable selectors (`getByRole` /
`getByLabel`) and unique run-stamped text for any mutating step so the journey is **re-runnable** without a
reseed (FR-8).

## 4. Reading the results (the human-facing artifact)

- `--reporter=list` in dev; the `html` reporter on CI (already configured) — open `playwright-report/` for
  the failing step, trace, screenshot and video (the config keeps trace `on-first-retry`, screenshot/video
  `…-on-failure`).
- An a11y failure prints the axe rule id + the offending node — fix it in `apps/web` (or `packages/ui` for
  a shared primitive), re-run the `@a11y` selection.
