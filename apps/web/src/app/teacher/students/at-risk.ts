/**
 * Shared "at-risk" thresholds & helpers for the teacher Students view.
 *
 * Kept in a pure module (no server imports) so both the server page and the
 * `'use client'` filters can import the SAME source of truth — the KPI count,
 * the activity filter, and the dropdown label can never drift apart.
 */

/** Élève « à risque » : moyenne < 50 % (≈ < 10/20). */
export const AT_RISK_PCT = 50;

/** Convertit un pourcentage (0–100) en note /20, arrondie à 0,1. */
export function pctToGrade20(pct: number): number {
  return Math.round((pct / 100) * 20 * 10) / 10;
}

/** Seuil « à risque » exprimé en /20, dérivé de {@link AT_RISK_PCT}. */
export const AT_RISK_GRADE_20 = pctToGrade20(AT_RISK_PCT);

/**
 * Un élève est « à risque » uniquement s'il a une moyenne RENSEIGNÉE
 * strictement inférieure au seuil. Une moyenne absente n'est PAS « à risque ».
 */
export function isAtRisk(avgPct: number | null): boolean {
  return avgPct != null && avgPct < AT_RISK_PCT;
}
