import AxeBuilder from '@axe-core/playwright';
import type { Page } from '@playwright/test';

import { expect, test } from '../fixtures/portal-fixtures';
import type { Portal } from '../fixtures/users';

/**
 * E10-S4 — the cross-portal WCAG 2.2 AA sweep (the R9 payoff).
 *
 * A data-driven axe-core scan over ONE representative authenticated page per
 * portal — parent (`/parent/dashboard` + `/parent/recommendations`), teacher
 * (gradebook `/teacher/grades` + `/teacher/conversations`), admin
 * (`/admin/analytics` + `/admin/child-claims`), student (`/student/dashboard`)
 * — each riding its S1 role-session fixture, asserting ZERO critical/serious
 * WCAG 2.2 AA violations (FR-6 / AC-6). On land → E10 is shipped.
 *
 * This EXTENDS the S1 authenticated a11y smoke (which scanned only the parent
 * dashboard) to every portal's authenticated surface — the whole shipped
 * product held to the bar, not one page. The violations this sweep surfaces are
 * remediated reuse-first in `apps/web` / `packages/ui` in the SAME PR.
 *
 * Tag set (R4 ruling): the full WCAG 2.2 AA set — `wcag2a wcag2aa wcag21a
 * wcag21aa wcag22aa` — which picks up the 2.2 additions incl. SC 2.5.8
 * (Target Size), SC 2.4.11 (Focus Not Obscured), SC 3.3.8 (Accessible
 * Authentication). Mirrors `authenticated.a11y.spec.ts` exactly.
 *
 * Gate (R5): critical/serious = HARD FAIL; moderate/minor are an opportunistic
 * punch-list, never a blocker (matches the smoke spec + the S1 authenticated
 * scan). The scan asserts on the live authenticated DOM under the correct role
 * session — no markup is modified to make a test pass; surfaced
 * critical/serious are FIXED in the app/design-system (the PR shows both the
 * assertions and the remediations together).
 *
 * Non-vacuous (PM, mirrors S1/S2/S3): each page first asserts it did NOT bounce
 * to `/login` (a scanned login page would be a false green — that surface is
 * already covered by the public smoke spec) and waits for a stable data marker
 * (the `PageHeader` heading every `PortalShell` page renders) before scanning,
 * so axe sees the loaded surface, not a skeleton. A missing role session
 * (stack down → setup skipped) `test.skip`s via the portal fixture — never a
 * false red.
 */

const WCAG_22_AA_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] as const;

/**
 * One representative authenticated page per portal (FR-6). `heading` is the
 * stable `PageHeader`/section heading the `PortalShell` page renders once
 * loaded (incl. the empty-state heading when the seed is sparse) — used as the
 * "loaded, not a skeleton, not bounced to login" marker before the scan.
 */
interface SweepTarget {
  portal: Portal;
  path: string;
  /** Human label for the test title. */
  label: string;
  /** Stable heading regex — matches the loaded surface OR its calm empty-state. */
  heading: RegExp;
}

const SWEEP_TARGETS: ReadonlyArray<SweepTarget> = [
  // Parent — the cahier's core audience: the <2 s dashboard + the explainable-alert surface.
  {
    portal: 'parent',
    path: '/parent/dashboard',
    label: 'parent dashboard',
    heading: /Tableau de bord|Ajoutez votre enfant/i,
  },
  {
    portal: 'parent',
    path: '/parent/recommendations',
    label: 'parent recommendations',
    heading: /Recommandations|Aucun enfant rattaché/i,
  },
  // Teacher — the gradebook (data-dense table) + the parent conversations inbox.
  {
    portal: 'teacher',
    path: '/teacher/grades',
    label: 'teacher gradebook',
    heading: /^Notes$/i,
  },
  {
    portal: 'teacher',
    path: '/teacher/conversations',
    label: 'teacher conversations',
    heading: /Conversations parents/i,
  },
  // Admin — the analytics explorer + the child-claim approval queue (one queue).
  {
    portal: 'admin',
    path: '/admin/analytics',
    label: 'admin analytics',
    heading: /Analytique des performances/i,
  },
  {
    portal: 'admin',
    path: '/admin/child-claims',
    label: 'admin child-claims queue',
    heading: /Demandes de rattachement/i,
  },
  // Student — the read-only "Mon objectif" dashboard (E8), incl. the activation gate.
  {
    portal: 'student',
    path: '/student/dashboard',
    label: 'student dashboard',
    heading: /Mon objectif|Ton espace élève/i,
  },
];

/**
 * Run the WCAG-2.2-AA scan on the currently-open authenticated page and assert
 * zero critical/serious. Shared by every target so the gate is byte-identical
 * across portals.
 */
async function scanForCriticalSerious(page: Page, label: string): Promise<void> {
  const results = await new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]).analyze();

  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );

  expect(
    blocking,
    `WCAG 2.2 AA critical/serious on ${label}:\n${blocking
      .map(
        (v) =>
          `  • ${v.id} (${v.impact}) — ${v.help}\n    ${v.nodes
            .map((n) => n.target.join(' '))
            .join('\n    ')}`,
      )
      .join('\n')}`,
  ).toEqual([]);
}

/**
 * Navigate the already-signed-in `page` to `target`, assert it loaded the
 * authenticated surface (not bounced to login, header visible), and scan it.
 * Shared body so each portal's test is byte-identical.
 */
async function sweepPage(page: Page, target: SweepTarget): Promise<void> {
  await page.goto(target.path);

  // Not bounced to login — a scanned login page would be a false green (the
  // public smoke spec already covers login pages). PM non-vacuous guard.
  expect(page.url(), `${target.label} must not redirect to /login`).not.toContain('/login');

  // Wait for the data-bearing surface (the PortalShell PageHeader heading or its
  // calm empty-state), not a skeleton, so axe scans the loaded DOM.
  await page.waitForLoadState('networkidle').catch(() => {
    /* networkidle is best-effort on a busy authenticated surface; the scan still runs. */
  });
  await expect(
    page.getByRole('heading', { name: target.heading }).first(),
    `${target.label} did not render its expected heading before the scan`,
  ).toBeVisible({ timeout: 15_000 });

  await scanForCriticalSerious(page, target.label);
}

/** Group the data-driven targets by portal so each test depends on ONE session. */
function targetsFor(portal: Portal): SweepTarget[] {
  return SWEEP_TARGETS.filter((t) => t.portal === portal);
}

/**
 * One `test.describe` per portal so a test requests ONLY its own role fixture.
 * Requesting all four fixtures in a single test would couple every page's pass
 * to every session being present — a missing teacher session would then skip
 * the parent scan too. Per-portal grouping keeps each scan independent: a portal
 * whose session is missing (e.g. the operator hasn't activated the E8 student)
 * skips ONLY its own pages, never another portal's (the fixture `test.skip`s
 * before the body runs — never a false red).
 */
test.describe('A11y (cross-portal authenticated sweep) @a11y', () => {
  for (const target of targetsFor('parent')) {
    test(`${target.label} (${target.path}) has zero critical/serious WCAG 2.2 AA violations`, async ({
      parentPage,
    }) => {
      await sweepPage(parentPage, target);
    });
  }

  for (const target of targetsFor('teacher')) {
    test(`${target.label} (${target.path}) has zero critical/serious WCAG 2.2 AA violations`, async ({
      teacherPage,
    }) => {
      await sweepPage(teacherPage, target);
    });
  }

  for (const target of targetsFor('admin')) {
    test(`${target.label} (${target.path}) has zero critical/serious WCAG 2.2 AA violations`, async ({
      adminPage,
    }) => {
      await sweepPage(adminPage, target);
    });
  }

  for (const target of targetsFor('student')) {
    test(`${target.label} (${target.path}) has zero critical/serious WCAG 2.2 AA violations`, async ({
      studentPage,
    }) => {
      await sweepPage(studentPage, target);
    });
  }
});
