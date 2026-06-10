# E10 — axe-core WCAG 2.2 AA scan contract (R9)

> The contract for E10's accessibility gate. Extends the **existing** unauthenticated a11y spot-check
> (`apps/web/tests/e2e/smoke.spec.ts` `@a11y` block, already using `@axe-core/playwright`) to the
> **authenticated** surface and to the full **WCAG 2.2 AA** tag set. **No new dependency** (`@axe-core/
> playwright` ^4.11 is already a devDep), **no schema, no product endpoint.**

## 1. The shared scan helper (single source of the AA baseline)

```ts
// apps/web/tests/e2e/a11y/axe.ts
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';

/** The locked WCAG 2.2 AA tag set — every scan uses this exact list. */
export const WCAG_22_AA_TAGS = [
  'wcag2a', 'wcag2aa',     // 2.0 A + AA
  'wcag21a', 'wcag21aa',   // 2.1 A + AA
  'wcag22aa',              // 2.2 AA (adds 2.4.11 Focus Not Obscured, 2.5.7 Dragging, 2.5.8 Target Size)
] as const;

export async function expectNoSeriousA11yViolations(page: Page, opts?: { disableRules?: string[] }) {
  let builder = new AxeBuilder({ page }).withTags([...WCAG_22_AA_TAGS]);
  if (opts?.disableRules?.length) builder = builder.disableRules(opts.disableRules);
  const results = await builder.analyze();
  const blocking = results.violations.filter(v => v.impact === 'critical' || v.impact === 'serious');
  // Attach the full violation list to the report for triage even when green.
  expect(blocking, formatViolations(blocking)).toEqual([]);
}
```

- **Tag set is fixed here** and imported everywhere — no scan invents its own tags (prevents drift,
  the data-model's only "schema-like" knob).
- **Severity gate = `critical` + `serious`** (matches the existing smoke threshold). `moderate` /
  `minor` violations are **reported but non-blocking** in the first sweep slice; a later slice MAY
  tighten to `moderate` once the surface is clean (recorded as a future option, not a slice-1 gate).
- **`disableRules` escape hatch** is allowed **only** with an inline justification comment naming the
  rule + the tracking note (e.g. a known third-party widget); a reviewer treats an undocumented
  `disableRules` as a finding.

## 2. Scope by slice

| Slice | Pages scanned (authenticated unless noted) | Gate |
|---|---|---|
| **S1 (smoke a11y)** | the 3 login pages (already covered, unauthenticated) **+** one authenticated landing per available portal: `/admin/dashboard`, `/teacher/dashboard`, `/parent/dashboard` | zero `critical`/`serious` |
| **Later (full cross-portal sweep)** | an enumerated route list per portal — dashboards, parent recommendations/alerts, parent & teacher messages, settings, admin analytics, admin child-claims queue, (student dashboard when activated) | zero `critical`/`serious`; remediate in `apps/web`/`packages/ui` until green |

The enumerated route list lives in `apps/web/tests/e2e/a11y/routes.ts` (per-portal arrays), scanned in
a `for...of` parametrised test (the existing smoke pattern, extended). Each authenticated route uses
the matching portal `storageState` (see `auth-fixture.contract.md`).

## 3. WCAG 2.2-specific criteria explicitly in scope

Beyond what axe covers automatically, the remediation slice MUST verify (axe + manual where axe can't):
- **2.4.11 Focus Not Obscured (Minimum)** — sticky headers/drawers must not hide the focused control
  (relevant to the E3-S3 hardened `Drawer` focus-trap; assert focused element is in-viewport).
- **2.5.8 Target Size (Minimum) 24×24** — interactive targets ≥ 24×24 CSS px (the project already
  aims ≥44px for radiogroups per E5-S3; assert no shrinkage regressions).
- **2.5.7 Dragging Movements** — any drag interaction has a single-pointer alternative (currently none
  expected; assert/document if a future drag UI lands).

## 4. Output / artifacts

- **Pass/fail** per page via `expect(...).toEqual([])`.
- The **full violation list** is attached to the Playwright HTML report (`reporter: ['html']` in CI)
  for triage — the report dir is **gitignored** (added in S1: `playwright-report/`, `test-results/`).
- No persisted DB data; reports contain only `voltaire-demo` content.

## 5. Relationship to the routine (who runs it)

The a11y sweep runs in the **same CI/operator E2E stage** as the journeys (ADR-023) — **not** in the
hourly routine (project-context §4). The lightweight A11y *reviewer* lens (agents.md #13) still reads
diffs for AA gaps every UI slice; the **automated** axe gate is the CI-side regression net this epic
builds. When the stack is down, the authenticated a11y scans **skip** (the login-page scans can still
run against a fresh dev server).
