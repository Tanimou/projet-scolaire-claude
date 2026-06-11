import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PLAYWRIGHT_PORT ?? 3100);
const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:${PORT}`;

/**
 * Playwright config for Pilotage Scolaire web app.
 * - The unauthenticated `chromium` project runs the PUBLIC smoke spec
 *   (login-page render + public `@a11y` scan) against a Next dev server on 3100.
 * - E10-S1 adds the `setup` project (auth once per role → cached git-ignored
 *   storageState) + per-role authenticated projects that run the `@journey` /
 *   authenticated-`@a11y` specs already-signed-in. The suite NEVER builds — it
 *   targets the already-running :3100 stack or starts `next dev` via webServer
 *   (project-context §4 / AC-8).
 *
 * Project isolation (PM-7): the unauthenticated `chromium` project IGNORES the
 * `journeys/` and `a11y/` dirs (it keeps only `smoke.spec.ts`), and each
 * authenticated project MATCHES only those dirs — so a session never leaks into
 * the public scan and the smoke spec runs exactly once, unauthenticated.
 */
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
    locale: 'fr-FR',
  },
  projects: [
    // Auth setup — logs in once per role, writes the cached storageState. Runs
    // before every authenticated project via `dependencies: ['setup']`.
    {
      name: 'setup',
      testMatch: /.*\.setup\.ts/,
    },
    // Public, unauthenticated: ONLY the smoke spec (login pages + public a11y).
    // Explicitly ignores the authenticated dirs so no session leaks in.
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: [/.*\.setup\.ts/, /journeys\/.*/, /a11y\/.*/],
    },
    // Authenticated: the `@journey` + authenticated-`@a11y` specs. Each spec opens
    // its role's context via the portal-fixtures (`parentPage`/`adminPage`/…),
    // which load the cached `.auth/{role}.json` per-test and `test.skip` gracefully
    // when it is missing (stack down) — so the PROJECT-level storageState is left
    // UNSET here on purpose: a project-level storageState pointing at a not-yet-
    // written file would hard-error at context creation when the setup skipped.
    // Single-role specs (S1) get their session from the fixture, not the project.
    {
      name: 'chromium-authenticated',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testMatch: [/journeys\/.*\.spec\.ts/, /a11y\/.*\.spec\.ts/],
    },
  ],
  webServer: process.env.PLAYWRIGHT_SKIP_SERVER
    ? undefined
    : {
        command: 'pnpm dev',
        url: BASE_URL,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
        stdout: 'pipe',
        stderr: 'pipe',
      },
});
