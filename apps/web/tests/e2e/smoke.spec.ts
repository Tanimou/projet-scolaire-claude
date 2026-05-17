import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

/**
 * Smoke tests — Phase R0 baseline + R9 a11y spot check.
 * Goal: verify the 3 portal login pages render server-side without crashing
 * AND have zero critical axe-core violations.
 * Real auth-required flows will be covered in Phase R10.
 */

test.describe('Smoke @smoke', () => {
  test('admin login page renders', async ({ page }) => {
    await page.goto('/admin/login');
    await expect(page).toHaveTitle(/Connexion administrateur/i);
    await expect(page.getByRole('heading', { name: /Portail Administrateur/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
    await expect(page.getByRole('button', { name: /Se connecter$/i })).toBeVisible();
  });

  test('teacher login page renders', async ({ page }) => {
    await page.goto('/teacher/login');
    await expect(page).toHaveTitle(/Connexion (enseignant|professeur)/i);
    await expect(page.getByRole('heading', { name: /Portail (Enseignant|Professeur)/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Mot de passe')).toBeVisible();
  });

  test('parent login page renders', async ({ page }) => {
    await page.goto('/parent/login');
    await expect(page).toHaveTitle(/Connexion (parent|famille)/i);
    await expect(page.getByRole('heading', { name: /Portail (Parent|Famille)/i })).toBeVisible();
    await expect(page.getByLabel('Email')).toBeVisible();
  });

  test('landing page redirects or renders', async ({ page }) => {
    const response = await page.goto('/');
    // Accept either a redirect to a portal or a landing page render
    expect(response?.status() ?? 0).toBeLessThan(500);
  });
});

test.describe('A11y @a11y', () => {
  for (const path of ['/admin/login', '/teacher/login', '/parent/login']) {
    test(`no critical axe violations on ${path}`, async ({ page }) => {
      await page.goto(path);
      const results = await new AxeBuilder({ page })
        .withTags(['wcag2a', 'wcag2aa'])
        .analyze();
      const critical = results.violations.filter(
        (v) => v.impact === 'critical' || v.impact === 'serious',
      );
      expect(critical).toEqual([]);
    });
  }
});
