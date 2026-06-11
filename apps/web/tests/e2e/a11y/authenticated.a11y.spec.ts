import AxeBuilder from '@axe-core/playwright';

import { expect, test } from '../fixtures/portal-fixtures';

/**
 * E10-S1 — the FIRST authenticated axe-core WCAG 2.2 AA smoke scan.
 *
 * Riding the parent session (one line, via `parentPage`), an axe scan of the
 * authenticated `/parent/dashboard` — the data-bearing surface 95% of the product
 * and 95% of the a11y risk actually live on — asserts ZERO critical/serious
 * violations (FR-3 / AC-3). The public-login `@a11y` smoke scan stays unchanged and
 * green (smoke.spec.ts).
 *
 * Tag set (R4 ruling): the full WCAG 2.2 AA set — the existing smoke spec uses only
 * `wcag2a`/`wcag2aa`; this slice EXTENDS to 2.2, picking up SC 2.5.8 (Target Size),
 * SC 2.4.11 (Focus Not Obscured), SC 3.3.8 (Accessible Authentication).
 *
 * Gate (R5): critical/serious = HARD FAIL; moderate/minor are a punch-list, not a
 * blocker (matches the smoke spec). Any critical/serious surfaced at S1 start is
 * remediated within S1 (reuse `@pilotage/ui` first; shared fixes in `packages/ui`).
 */

const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

test.describe('A11y (authenticated) @a11y', () => {
  test('parent dashboard has zero critical/serious WCAG 2.2 AA violations', async ({
    parentPage,
  }) => {
    await parentPage.goto('/parent/dashboard');

    // Not bounced to login — the authenticated surface is what axe sees (PM-6).
    expect(parentPage.url(), 'parent dashboard must not redirect to /login').not.toContain('/login');

    // Wait for the data-bearing surface, not a skeleton: the "Performance globale"
    // heading is a stable data marker on the loaded dashboard (Sally §4). If the
    // parent has no child (empty seed), the dashboard renders the child-claim shell
    // instead — still a valid authenticated surface to scan; we wait for whichever
    // primary heading appears, then scan.
    await parentPage.waitForLoadState('networkidle').catch(() => {
      /* networkidle is best-effort on a busy dashboard; the scan still runs. */
    });
    await expect(
      parentPage.getByRole('heading', { name: /Performance globale|Ajoutez votre enfant/i }).first(),
    ).toBeVisible({ timeout: 10_000 });

    const results = await new AxeBuilder({ page: parentPage })
      .withTags([...WCAG_22_AA_TAGS])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );

    // Surface a readable failure: which rule(s) on which node(s).
    expect(
      blocking,
      `WCAG 2.2 AA critical/serious on /parent/dashboard:\n${blocking
        .map((v) => `  • ${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes.map((n) => n.target.join(' ')).join('\n    ')}`)
        .join('\n')}`,
    ).toEqual([]);
  });

  /**
   * Sanity-injection (Murat P0): prove the gate BITES — a known violation must be
   * caught, so a green run can never be a false green. We inject an unlabelled,
   * inaccessible control into the live authenticated DOM and assert the SAME tag
   * set + filter flags it. This guards against an axe misconfiguration silently
   * passing everything.
   */
  test('the axe gate catches a deliberately-injected violation (no false green)', async ({
    parentPage,
  }) => {
    await parentPage.goto('/parent/dashboard');
    expect(parentPage.url()).not.toContain('/login');

    // Inject an image with no alt + an empty-label button — classic critical/serious hits.
    await parentPage.evaluate(() => {
      const wrap = document.createElement('div');
      wrap.id = 'e2e-a11y-sanity-probe';
      // <img> with no alt attribute → axe `image-alt` (critical/serious).
      const img = document.createElement('img');
      img.src =
        'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
      wrap.appendChild(img);
      document.body.appendChild(wrap);
    });

    const results = await new AxeBuilder({ page: parentPage })
      .withTags([...WCAG_22_AA_TAGS])
      .include('#e2e-a11y-sanity-probe')
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'critical' || v.impact === 'serious',
    );
    expect(
      blocking.length,
      'the axe gate must CATCH the injected unlabelled image (proves the gate is not a no-op)',
    ).toBeGreaterThan(0);

    // Clean up so no probe leaks into another test sharing the context.
    await parentPage.evaluate(() => {
      document.getElementById('e2e-a11y-sanity-probe')?.remove();
    });
  });
});
