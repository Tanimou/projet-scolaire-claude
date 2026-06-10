# E10 — Authenticated-session fixture contract (the reusable spine)

> The load-bearing contract of E10's visionary idea: a **portal-aware authenticated-session fixture**
> (`admin` / `teacher` / `parent` / `student`) seeded from the demo tenant, so every future epic ships
> a one-line end-to-end journey test. This file is the **interface** the dev agent implements in
> `apps/web/tests/e2e/fixtures/`. Verified against `apps/web/src/auth.ts` (the real auth stack) and
> `apps/web/playwright.config.ts` (the runner). **No new product endpoint, no schema.**

## 1. Inputs — `PortalUser` (env-overridable, demo-seed-backed)

```ts
// apps/web/tests/e2e/fixtures/users.ts
export type Portal = 'admin' | 'teacher' | 'parent' | 'student';

export interface PortalUser {
  portal: Portal;
  email: string;
  password: string;
  /** realm role expected after login (asserted by the setup; INV-1 portal isolation). */
  expectedRole: string;
  /** landing path after login (mirrors PORTAL_LANDING in middleware.ts). */
  landing: string;
}
```

Resolution order (locked in `data-model.md` §1.1):
1. `process.env.E2E_<PORTAL>_EMAIL` / `E2E_<PORTAL>_PASSWORD` (CI / operator override),
2. else the simple per-portal set `<portal>@pilotage.local` / `Changeme123!`,
3. else (for the rich `voltaire-demo` graph J1 needs) `mme.dupont@voltaire.fr` / `Demo!2024Pilotage`.

`landing` mirrors `PORTAL_LANDING` from `apps/web/src/middleware.ts`
(`admin → /admin/dashboard`, `teacher → /teacher/dashboard`, `parent → /parent/dashboard`,
`student → /student/dashboard`). `expectedRole`: `school_admin` | `teacher` | `parent` | `student`.

## 2. The login call — the PRODUCT's real flow (no mock)

The setup logs in through the **same path a human uses**: the NextAuth Credentials provider, which
performs a Keycloak ROPC direct-grant (`apps/api`-adjacent; `apps/web/src/auth.ts:directGrantLogin`).
Two acceptable implementations, in preference order:

- **(A, preferred) UI login** — navigate to `/{portal}/login`, fill `getByLabel('Email')` /
  `getByLabel('Mot de passe')`, click `Se connecter`, `await page.waitForURL(landing)`. This exercises
  the genuine login form + the credentials provider end-to-end (the fixture *is* the login regression
  test). Locators already verified in `tests/e2e/smoke.spec.ts`.
- **(B, fallback) programmatic credentials POST** — POST to the NextAuth credentials callback with
  `{ email, password, portal, csrfToken }` (csrf fetched from `/api/auth/csrf`), then persist the
  context cookies. Use only if (A) is flaky in CI; it still hits the real Keycloak ROPC, so it is not
  a mock.

Either way the result is a context whose cookie jar holds the next-auth session token
(`authjs.session-token` / `next-auth.session-token`, host-dependent).

## 3. Output — `storageState` per portal (gitignored runtime artifact)

```
apps/web/tests/e2e/.auth/admin.json
apps/web/tests/e2e/.auth/teacher.json
apps/web/tests/e2e/.auth/parent.json
apps/web/tests/e2e/.auth/student.json   # only when the student role is activated
```

Each is a Playwright `storageState` JSON (cookies + origins). **Contract guarantees:**
- written by the **`setup` project** (`auth.setup.ts`) which Playwright runs **before** all test
  projects via `dependencies: ['setup']`;
- **regenerated every run** (never committed — it carries a live session token and expires);
- the setup **asserts** `expectedRole` is present and the post-login URL is `landing` — a wrong-portal
  or failed login fails the setup loudly (so a broken auth stack is caught at the gate, not mid-journey).

`playwright.config.ts` additions (illustrative):

```ts
projects: [
  { name: 'setup', testMatch: /.*\.setup\.ts/ },
  { name: 'chromium-admin',   use: { ...devices['Desktop Chrome'], storageState: '.auth/admin.json' },   dependencies: ['setup'] },
  { name: 'chromium-teacher', use: { ...devices['Desktop Chrome'], storageState: '.auth/teacher.json' }, dependencies: ['setup'] },
  { name: 'chromium-parent',  use: { ...devices['Desktop Chrome'], storageState: '.auth/parent.json' },  dependencies: ['setup'] },
  // existing unauthenticated `chromium` project stays for smoke.spec.ts
]
```

## 4. The test-facing fixture API (one line to an authenticated page)

```ts
// apps/web/tests/e2e/fixtures/portal-fixtures.ts
import { test as base } from '@playwright/test';

type PortalFixtures = {
  adminPage: Page; teacherPage: Page; parentPage: Page; studentPage: Page;
};

export const test = base.extend<PortalFixtures>({ /* each yields a page in the portal's context */ });
```

Journey usage — the "one-line" promise:

```ts
import { test } from '../fixtures/portal-fixtures';
test('parent sees the explainable alert', async ({ parentPage }) => {
  await parentPage.goto('/parent/dashboard');         // already authenticated as parent
  await expect(parentPage.getByText(/alerte|recommandation/i)).toBeVisible();
});
```

## 5. RBAC / ABAC / tenant posture

- **RBAC** — each fixture carries exactly its portal's realm role (asserted in §3); a fixture can never
  reach another portal (NextAuth `middleware.ts` deny-by-default + INV-1 disjoint role sets). E10 may
  add a **negative** assertion (e.g. `parentPage.goto('/admin')` → redirected/forbidden) as a bonus
  isolation regression.
- **ABAC** — every read/write the journey makes is scoped by the product's own
  `StudentAccessService` / teaching-assignment / tenant RLS. The fixture **never** bypasses these; J1
  asserts the parent sees **only their own** child's alert.
- **Tenant** — all four users belong to `voltaire-demo`; no test crosses a tenant or opens a raw DB
  connection.
- **Secrets** — `storageState` is gitignored; credentials come from env or the documented demo set;
  no token is logged or committed.

## 6. Skip-when-down (never a false red)

`auth.setup.ts` first probes stack reachability (`GET {baseURL}` and the api health route, short
timeout). If the stack is unreachable, the setup **skips** the authenticated projects
(`test.skip(!reachable, ...)`) instead of failing — so a PR run on a machine without the booted stack
stays green (project-context §4: E2E is a CI/operator gate, not the hourly routine). The
unauthenticated `smoke.spec.ts` is unaffected (it can run against a freshly-started dev server via the
existing `webServer` config).
