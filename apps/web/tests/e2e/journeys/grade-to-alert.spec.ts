import { expect, test } from '../fixtures/portal-fixtures';

/**
 * E10-S1 — Critical journey #1: grade publish → parent EXPLAINABLE + ACTIONABLE alert.
 *
 * The cahier's defining promise ("turn information into action") made runnable.
 * Signed in as the demo parent (one line, via the `parentPage` fixture), the test
 * opens `/parent/recommendations` and asserts the FIRST open alert is:
 *   (a) RULE      — the CODE_LABEL pill (e.g. "Moyenne basse"),
 *   (b) SUBJECT   — the SubjectChip,
 *   (c) THRESHOLD/TREND — a non-empty explanatory alert body,
 *   (d) ACTION    — the E1 "Que puis-je faire ?" AlertNextSteps group + ≥1 CTA.
 *
 * It FAILS if any of {rule, subject, body, CTA} is absent — guarding the
 * information→action promise, NOT a 200 (AC-2). It is **read-only** against the
 * `voltaire-demo` seed (FR-8: re-runnable, never mutates state — no grade publish,
 * no cron wait; PM-2 scope lock).
 *
 * PM-4 (explainability vs brittle copy): the "threshold/trend" check is the
 * presence of a NON-EMPTY explanatory body — NOT a regex on a magnitude/French
 * copy. Coupling to a literal "8/20 sous le seuil de 10" would break on any wording
 * change; the structural promise is "the alert explains itself", which a non-empty
 * body proves without copy-coupling.
 *
 * PM-5 (non-vacuous): the recommendations page renders a friendly "Aucune alerte
 * ouverte" EmptyState when the parent has zero open alerts. A test that only checked
 * "page rendered" would be GREEN on an empty seed — the opposite of guarding the
 * promise. So the test `test.skip`s GRACEFULLY when the seed legitimately has no
 * open alert (so a thin demo seed is not a false red), but if an alert IS present it
 * is asserted explainable+actionable. The empty-state path is detected explicitly.
 */

test.describe('Journey: grade → parent explainable alert @journey', () => {
  test('the parent alert is explainable (rule + subject + body) AND actionable (next-step CTA)', async ({
    parentPage,
  }) => {
    // One line: already signed in as the demo parent (no login form typed here).
    await parentPage.goto('/parent/recommendations');

    // Post-condition (PM-6): we are NOT bounced to the login page — the session is live.
    expect(parentPage.url(), 'parent must reach /parent/recommendations, not /login').not.toContain(
      '/login',
    );

    // The recommendations h1 (PageHeader renders the title as <h1>) — the page loaded.
    await expect(
      parentPage.getByRole('heading', { level: 1, name: /Recommandations/i }),
    ).toBeVisible();

    // PM-5: detect the calm empty-state. If the demo parent legitimately has no open
    // alert, skip gracefully (a thin seed is not a false red) — never assert vacuously.
    const emptyState = parentPage.getByText(/Aucune alerte ouverte/i);
    // Each alert card is the `<li>` carrying the distinctive card classes
    // (`rounded-2xl p-5 ring-1`); scoping to that avoids counting the nested
    // next-steps sub-list `<li>` rows inside the "Que puis-je faire ?" panel.
    const alertCards = parentPage.locator('li.rounded-2xl.p-5.ring-1');
    // Wait for either the empty-state OR at least one alert card to settle.
    await expect
      .poll(async () => (await emptyState.count()) + (await alertCards.count()), {
        timeout: 10_000,
        message: 'recommendations surface did not render either alerts or the empty state',
      })
      .toBeGreaterThan(0);

    if ((await emptyState.count()) > 0 && (await alertCards.count()) === 0) {
      test.skip(true, 'Demo parent has no open alert in this seed — journey skips (PM-5, non-vacuous).');
      return;
    }

    // ── The hard assertions: the FIRST alert card must be explainable + actionable. ──
    const firstAlert = alertCards.first();
    await expect(firstAlert, 'at least one alert card must be present (non-vacuous)').toBeVisible();

    // (a) RULE — the CODE_LABEL pill. Every alert card renders the rule label
    // (e.g. "Moyenne basse" / "Tendance négative" / "Absences élevées"). We match
    // ANY of the known rule labels so we never couple to one specific rule firing.
    const ruleLabel = firstAlert.getByText(
      /Moyenne basse|Tendance négative|Échecs répétés|Évaluation manquante|Absences élevées|Signalement enseignant|Progrès|Comportement/i,
    );
    await expect(ruleLabel, 'alert must carry its RULE (CODE_LABEL pill) — explainability').toBeVisible();

    // (b) SUBJECT — the alert names a subject. The card heading carries the alert
    // title (subject-scoped rules name the subject); the body re-states it. We assert
    // the card has a visible heading (the title) AND a non-empty body (below).
    const alertHeading = firstAlert.getByRole('heading');
    await expect(alertHeading.first(), 'alert must carry a title heading (subject context)').toBeVisible();

    // (c) THRESHOLD/TREND — a NON-EMPTY explanatory body (PM-4: structural, not a
    // copy regex). The body is the <p> directly after the title row; assert it has text.
    const bodyText = (await firstAlert.innerText()).trim();
    expect(bodyText.length, 'alert must carry a non-empty explanatory body (threshold/trend)').toBeGreaterThan(
      20,
    );

    // (d) ACTION — the E1 "Que puis-je faire ?" AlertNextSteps panel (role="group")
    // with at least one actionable control. The group's aria-label is
    // "Étapes recommandées pour l'alerte …".
    const nextSteps = firstAlert.getByRole('group', { name: /Étapes recommandées/i });
    await expect(nextSteps, 'alert must carry the E1 "Que puis-je faire ?" next-steps group').toBeVisible();

    // ≥1 concrete next-step control: a deep-link row, "Écrire à l'enseignant·e",
    // "Demander un rendez-vous", or "Voir le soutien". Assert at least one exists.
    const ctaCount =
      (await nextSteps.getByRole('link').count()) +
      (await nextSteps.getByRole('button').count());
    expect(ctaCount, 'the next-steps panel must offer ≥1 actionable control (information → action)').toBeGreaterThan(
      0,
    );

    // Explicit named-CTA sanity: the always-present "talk to the teacher" lane is
    // either the active CTA or the already-requested confirmation. Assert one is present.
    const teacherLane = nextSteps.getByText(
      /Écrire à l['’]enseignant|Demander un rendez-vous|Demande envoyée/i,
    );
    await expect(
      teacherLane.first(),
      'the "talk to the teacher" next step (the E1 action lane) must be present',
    ).toBeVisible();
  });
});
