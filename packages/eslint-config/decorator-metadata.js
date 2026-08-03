/**
 * ESLint layer for packages compiled with `emitDecoratorMetadata: true`.
 *
 * WHY THIS LAYER EXISTS
 * ---------------------
 * `@typescript-eslint/consistent-type-imports` and `emitDecoratorMetadata` are
 * mutually incompatible, and the incompatibility is silent in both gates this
 * repo owns.
 *
 * NestJS resolves a provider's constructor dependencies from the
 * `design:paramtypes` metadata TypeScript emits for a decorated class. That
 * emit only happens when the parameter's type is a *value* import. Rewriting it
 * to `import type` — which is exactly what this rule's autofix does — erases the
 * runtime `require()`, and TypeScript then emits `Object` in its place.
 *
 * MEASURED, NOT ASSUMED (2026-08-03, S-E02-8)
 * -------------------------------------------
 * `apps/api/src/modules/analytics/analytics.service.ts` was compiled before and
 * after a single `eslint --fix`, with `--emitDecoratorMetadata`:
 *
 *   before  __metadata("design:paramtypes", [PrismaService, GradesService,
 *                                            RemediationService])   3 requires
 *   after   __metadata("design:paramtypes", [Object, Object, Object])
 *                                                                   0 requires
 *
 * Nest would fail to resolve `AnalyticsService` at boot. `tsc --noEmit -p
 * tsconfig.json` returned **exit 0** on the broken file, `nest build` succeeds,
 * and the module-wiring guards read module *source* rather than a booted route
 * table (PF-67) — so nothing in this repository detects the breakage.
 *
 * 243 warnings across `apps/api` (218) and `apps/worker` (25) were of this
 * shape. They are not "nearly free autofixes" (as PF-71 recorded); they are a
 * production outage that every gate reports as green.
 *
 * DISABLING VS. LEAVING IT ON
 * ---------------------------
 * The rule is `warn`, so it never gated anything — turning it off weakens no
 * gate. Leaving it on is the actively dangerous option: it advertises 243
 * "fixable" findings whose obvious remedy (`eslint --fix`) breaks boot
 * invisibly. Removing a rule that cannot be satisfied is not silencing a
 * signal; it is deleting a false one.
 *
 * The condition is `emitDecoratorMetadata`, NOT "is a Nest package" — the two do
 * not coincide here. `packages/imports-core` consumes the `node` preset but
 * extends `@pilotage/tsconfig/base.json`, has no decorator metadata, and its
 * type imports are fixed normally. `apps/api` and `apps/worker` extend
 * `@pilotage/tsconfig/node.json`, which is the only shared tsconfig that sets
 * the flag.
 *
 * `lint-ratchet.spec.ts` asserts that correspondence in both directions, so a
 * package that starts emitting decorator metadata cannot quietly keep the rule.
 */
module.exports = [
  {
    files: ['**/*.ts', '**/*.tsx', '**/*.mts', '**/*.cts'],
    rules: {
      // See the file header. Do not re-enable without reading it: the autofix
      // silently erases NestJS dependency-injection metadata.
      '@typescript-eslint/consistent-type-imports': 'off',
    },
  },
];
