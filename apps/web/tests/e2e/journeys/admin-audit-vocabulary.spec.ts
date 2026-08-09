import { expect, test } from '../fixtures/portal-fixtures';

/**
 * `PF-135` / `S-E04-4` — the acceptance claims of the audit-vocabulary slice,
 * **executed** instead of asserted against component source.
 *
 * Why this file exists, in one sentence: every other piece of web evidence for
 * `S-E04-4` is a pure-function call or a string match on a `.tsx` file, and the
 * route it describes is the one route in this product that has already returned
 * **HTTP 500 for every authenticated admin** (`PF-14` / `S-E04-2`, measured
 * 2026-08-08, digest `2236692779`). "It typechecks and should render" is
 * precisely the claim that incident falsified, so the vocabulary slice may not
 * rest on it a second time.
 *
 * Two patterns land here that the page had never used before, and neither is
 * visible to `tsc`:
 *
 *  1. a **React element** passed as `SelectOption.label` from a server
 *     component across the RSC boundary into a `'use client'` filter, and
 *  2. a KPI value whose type is `number | string`, so that a card can state a
 *     non-measurement («—» + «Indisponible») instead of a fabricated `0`.
 *
 * Both are legal. Whether they *render* is a different question, and it is the
 * only one this file asks.
 *
 * Scope discipline: this asserts the vocabulary claims plus the KPI-scope claims
 * `S-E04-5` added. It still does not assert tone or icon: `auditActionTone()` is
 * a pure function of the declared vocabulary and is proven where that can be
 * measured — the contracts gate, naming `coefficient.upsert` and `grade.unflag`
 * as the negative controls that used to render `neutral`.
 */
test.describe('@journey /admin/audit renders the declared vocabulary', () => {
  test('the page renders for an authenticated admin at all (the PF-14 tripwire)', async ({
    adminPage,
  }) => {
    const response = await adminPage.goto('/admin/audit');

    // Status first and on its own: a 500 here is the regression this whole file
    // exists to catch, and it must not be reported as "some text was missing".
    expect(response?.status(), 'GET /admin/audit as school_admin').toBe(200);

    // `/admin/error.tsx` is where the PF-14 crash surfaced — the route returned
    // a 200-shaped error boundary in dev. Assert we are on the real page.
    await expect(adminPage.getByRole('heading', { name: /journal d'audit/i })).toBeVisible();
  });

  /**
   * Re-pointed by `S-E04-5`, not deleted (DNC-08).
   *
   * The old assertion pinned « Non instrumenté » on the « Connexions admin »
   * card. That card is **gone** — the honest thing a card could say about an
   * unwritten action is nothing at all — so the string is no longer expected on
   * this page. What survives the removal is the invariant the assertion was
   * really guarding: *no card states a number it did not measure*. That is now
   * checked from the other side — every card carries a rendered scope, and the
   * removal is stated in-product rather than left to be discovered.
   */
  test('AC-3 / AC-4 / DNC-09 — every KPI card renders its scope, and the removed card says why', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/audit');

    // Four cards, four scopes. A scope is not optional decoration: a number on a
    // governance surface without the population it counted is a false sentence.
    await expect(adminPage.getByText(/Portée :/)).toHaveCount(4);

    // « Acteurs distincts » replaces « Connexions admin ».
    await expect(adminPage.getByText(/acteurs distincts/i).first()).toBeVisible();

    // The removal is a governance statement and is permanent on the page.
    await expect(adminPage.getByText(/V3-E05/)).toBeVisible();

    // And the old sentinel is no longer reachable from any card: it described a
    // card that no longer exists, and leaving it would be an orphan claim.
    await expect(adminPage.getByText('Non instrumenté')).toHaveCount(0);
  });

  test('AC-4 / DNC-08 — a legacy French row is marked, not relabelled or hidden', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/audit');

    // The seeded legacy rows carry French display strings in the structural
    // columns. They must stay VISIBLE and carry an explicit marker — the value
    // is never rewritten, and never dropped for being unclassifiable.
    await expect(adminPage.getByText(/format hérité/i).first()).toBeVisible();
  });

  test('AC-2 — the resource facet opens and its options read as French labels', async ({
    adminPage,
  }) => {
    await adminPage.goto('/admin/audit');

    // This is the RSC-boundary case, and it is the reason this test exists: the
    // options are built in a SERVER component and each `label` is now a React
    // ELEMENT rather than a string, handed across the boundary into a
    // `'use client'` filter. `tsc` cannot tell you whether that renders.
    await adminPage.getByRole('button', { name: /toutes les ressources/i }).click();

    const listbox = adminPage.getByRole('listbox');
    await expect(listbox).toBeVisible();

    // What this asserts, and what it deliberately does NOT. Two earlier drafts
    // of this assertion were red, and BOTH times the test was wrong rather than
    // the page — worth writing down, because each failure names a real property.
    //
    //  1. Looking for `calendar_event`'s label here was wrong: `page.tsx`
    //     derives the facet from OBSERVED rows on purpose — «on n'y ajoute pas
    //     un portail que personne n'écrit» — so a declared code with no row
    //     cannot appear, and enumerating the declared vocabulary would offer
    //     permanently-empty filters. That every written code HAS a label is
    //     AC-2's real claim, and it is proven where it belongs: the
    //     bidirectional contracts gate, against the AST-extracted written set.
    //  2. Looking for `subject_coefficient`'s label was wrong for a better
    //     reason: those rows exist, but in ANOTHER TENANT (run 31's probe
    //     tenant). The facet is tenant-scoped, so it correctly does not offer
    //     them. The red was G-TENANT working.
    //
    // What is left is the claim only a browser can settle: the option labels are
    // React ELEMENTS built server-side, and they render — French text plus the
    // legacy marker, inside a single option, with the raw value never standing
    // in as the label.
    const legacyOption = listbox.getByRole('option', { name: /Format hérité/ }).first();
    await expect(legacyOption).toBeVisible();

    // No option is labelled with a raw snake_case machine code.
    await expect(listbox.getByRole('option', { name: /^[a-z][a-z_]*[a-z]$/ })).toHaveCount(0);
  });
});
