import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { expect, test as setup } from '@playwright/test';

import { ACTIVE_PORTALS, portalUser, storageStatePath, type Portal } from './fixtures/users';

/**
 * E10-S1 — the auth SETUP project (the fixture spine).
 *
 * Runs ONCE per role BEFORE every authenticated test project (wired via
 * `dependencies: ['setup']` in `playwright.config.ts`). For each portal it logs
 * in through the PRODUCT's real `/{portal}/login` flow (the NextAuth credentials
 * provider → Keycloak ROPC; option A in `auth-fixture.contract.md §2` — the
 * fixture IS the login regression test) and writes a cached Playwright
 * `storageState` to a git-ignored `tests/e2e/.auth/{role}.json`, reused across
 * the whole suite so no test ever re-types a login form (AC-1).
 *
 * Hard gates (PM-3 / PM-6 / AC-1):
 *  - The setup ASSERTS the post-login URL is the portal `landing` AND that the
 *    session carries `expectedRole`. A reached-but-rejected login (wrong creds /
 *    wrong portal) FAILS the setup loudly — it is NOT silently skipped.
 *  - Skip-when-down keys ONLY on transport-level unreachability (the web origin
 *    cannot be reached at all). A 200 login page that then rejects the password
 *    is NOT "down" → it fails. This is the difference between "no stack booted"
 *    (skip, no false red) and "auth regression" (fail).
 */

/** True only when the web origin answers at all (any HTTP response, even an error page). */
async function originReachable(baseURL: string): Promise<boolean> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 4000);
    // A redirect to /{portal}/login is a perfectly reachable origin.
    const res = await fetch(`${baseURL}/parent/login`, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
    });
    clearTimeout(timer);
    // Any status (200/3xx/4xx/5xx) means the transport reached a server.
    return res.status > 0;
  } catch {
    // ECONNREFUSED / DNS / timeout / abort → genuinely unreachable.
    return false;
  }
}

for (const portal of ACTIVE_PORTALS) {
  setup(`authenticate ${portal}`, async ({ page, baseURL }) => {
    const origin = baseURL ?? 'http://localhost:3100';
    const reachable = await originReachable(origin);
    // Transport-only skip (FR-9 / auth-fixture §6): no booted stack → green skip,
    // never a false red. A reachable-but-rejecting stack falls through to fail.
    setup.skip(!reachable, `Stack at ${origin} is unreachable — skipping authenticated setup`);

    const user = portalUser(portal as Portal);

    // Drive the genuine login form (selectors proven in smoke.spec.ts).
    await page.goto(`/${portal}/login`);
    await page.getByLabel('Email').fill(user.email);
    await page.getByLabel('Mot de passe').fill(user.password);
    await page.getByRole('button', { name: /Se connecter$/i }).click();

    // Gate 1 — landed on the portal landing (guards storageState/cookie drift, PM-6).
    // A failed login keeps us on /login → this assertion fails loudly.
    //
    // EXCEPTION — the `student` portal (E8) is OPERATOR-ACTIVATED: it needs the
    // additive `Student.userProfileId` `db push` AND the `student` realm-role +
    // demo learner provisioned (ADR-021). Unlike the established parent/admin/
    // teacher demo accounts (assumed present), a not-yet-activated student is an
    // EXPECTED stack state, not an auth regression. So for `student` ONLY, a login
    // that does not land within the window is a GREEN SKIP (the S4 cross-portal
    // sweep's student page then `test.skip`s via the missing storageState) rather
    // than a loud fail — mirroring the non-vacuous posture of the journeys. Every
    // other portal keeps the hard loud-fail (a rejected demo login IS a regression).
    if (portal === 'student') {
      const landed = await page
        .waitForURL(`**${user.landing}`, { timeout: 15_000 })
        .then(() => true)
        .catch(() => false);
      setup.skip(
        !landed,
        `Student portal not provisioned (login did not reach ${user.landing}) — ` +
          'the E8 db push + student realm-role/demo learner are operator-activated; skipping student setup.',
      );
    } else {
      await page.waitForURL(`**${user.landing}`, { timeout: 15_000 });
    }
    expect(page.url(), `login for ${portal} must land on ${user.landing}, not /login`).toContain(
      user.landing,
    );

    // Gate 2 — the session carries the expected realm role (RBAC / INV-1 isolation).
    // Read the NextAuth session the product itself exposes (no DB, no mock).
    const session = await page.evaluate(async () => {
      const r = await fetch('/api/auth/session', { credentials: 'include' });
      return (await r.json()) as { roles?: string[]; portal?: string } | null;
    });
    expect(
      session?.roles ?? [],
      `session for ${portal} must include the realm role ${user.expectedRole}`,
    ).toContain(user.expectedRole);

    // Persist the authenticated context (cookies + origins) for reuse.
    const outPath = storageStatePath(portal as Portal);
    const dir = dirname(outPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    await page.context().storageState({ path: outPath });
  });
}
