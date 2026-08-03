/**
 * `next lint` is deprecated in Next 15 and removed in Next 16, and it was the
 * only reason this app appeared to lint at all: it silently forced eslintrc
 * mode, so `apps/web` was the single package whose lint stage exited 0 while
 * every other package exited 2 (PF-70). Running the ESLint CLI directly puts
 * web on the same flat config as the rest of the workspace.
 *
 * `FlatCompat` is the migration path Next documents for `next/core-web-vitals`,
 * which is still published in eslintrc format.
 */
const { FlatCompat } = require('@eslint/eslintrc');

const react = require('@pilotage/eslint-config/react');

const compat = new FlatCompat({ baseDirectory: __dirname });

module.exports = [
  ...react,
  ...compat.extends('next/core-web-vitals'),
  {
    rules: {
      // The App Router's own <Link> is used throughout; this rule targets the
      // legacy pages/ convention and fires on external anchors.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },
  {
    ignores: ['.next/**', 'next-env.d.ts', 'playwright-report/**', 'test-results/**'],
  },
];
