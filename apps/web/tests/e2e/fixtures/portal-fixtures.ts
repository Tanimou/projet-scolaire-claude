import { existsSync } from 'node:fs';

import { test as base, type Page } from '@playwright/test';

import { storageStatePath, type Portal } from './users';

/**
 * E10-S1 — the test-facing one-line fixture API.
 *
 * `import { test } from '../fixtures/portal-fixtures'` then
 * `test('…', async ({ parentPage }) => { … })` yields a page ALREADY signed in
 * as that role — the AC-1 "one line to an authenticated page" promise. The
 * session comes from the cached `storageState` the `setup` project wrote
 * (`tests/e2e/.auth/{role}.json`); no login form is ever typed in a test body.
 *
 * Each `*Page` fixture opens its own browser context seeded from the role's
 * storage-state, so a single spec can drive MORE THAN ONE role in the same test
 * (the cross-portal journeys in S2/S3 need parent + admin / parent + teacher
 * side by side — a project-level `storageState` alone can't do that). For a
 * single-role spec the project-level `storageState` (config) is equivalent; both
 * paths are supported.
 *
 * If a role's storage-state is missing (setup skipped because the stack was
 * down), the fixture `test.skip`s the consuming test — never a false red.
 */

type PortalFixtures = {
  adminPage: Page;
  teacherPage: Page;
  parentPage: Page;
  studentPage: Page;
};

function rolePageFixture(portal: Portal) {
  return async (
    { browser }: { browser: import('@playwright/test').Browser },
    use: (page: Page) => Promise<void>,
    testInfo: import('@playwright/test').TestInfo,
  ) => {
    const statePath = storageStatePath(portal);
    if (!existsSync(statePath)) {
      testInfo.skip(true, `No cached session for ${portal} (setup skipped — stack down?)`);
      return;
    }
    const context = await browser.newContext({ storageState: statePath });
    const page = await context.newPage();
    try {
      await use(page);
    } finally {
      await context.close();
    }
  };
}

export const test = base.extend<PortalFixtures>({
  adminPage: rolePageFixture('admin'),
  teacherPage: rolePageFixture('teacher'),
  parentPage: rolePageFixture('parent'),
  studentPage: rolePageFixture('student'),
});

export { expect } from '@playwright/test';
export { portalUser, type Portal, type PortalUser } from './users';
