/**
 * E6-S1 — the ONE pure snapshot aggregation formula (byte-parity with the live
 * `AnalyticsService.parentDashboard`).
 *
 * Every helper here is a faithful, side-effect-free duplicate of the exact
 * arithmetic in `apps/api/.../analytics.service.ts` (a cross-app share is
 * impractical — the worker does not depend on `apps/api`), pinned by
 * `snapshot-recompute.spec.ts` against the live output on a seeded fixture. The
 * golden rules lifted verbatim from the live path:
 *
 *  - normalise to /20:  `onTwenty = (value / maxScore) * 20`
 *  - coefficient:       assessment override → SubjectCoefficient(gradeLevel×subject)
 *                       → Subject.defaultCoefficient
 *  - per-subject avg:   simple mean of a student's onTwenty grades for (subject, term)
 *  - global avg:        coefficient-WEIGHTED mean of the per-subject averages
 *                       (`weightedSum / totalCoef`)  ← the student's hero number
 *  - class rank:        competition rank over the UNWEIGHTED mean-of-per-subject-means
 *                       per classmate (PM-7: live uses a DIFFERENT aggregation for the
 *                       rank denominator than for the hero average — we reproduce BOTH)
 *  - distribution:      [0,10) / [10,14) / [14,20] histogram, passRate = onTwenty ≥ 10
 *  - trend delta:       lastTerm.avg − previousTerm.avg (by term order)
 *
 * All money/score numbers are JS f64 here; the recompute service rounds to the
 * snapshot's Decimal(5,2) at the write boundary (PM-6) — the parity test compares
 * at that same boundary.
 */

/** Normalise a raw grade value to /20 against its assessment max score. */
export function onTwenty(value: number, maxScore: number): number {
  return (value / maxScore) * 20;
}

/**
 * Resolve the coefficient for a subject, mirroring the live `resolveCoef`:
 * assessment `coefficientOverride` wins, else the (gradeLevel × subject)
 * `SubjectCoefficient`, else the subject's `defaultCoefficient`.
 */
export function resolveCoef(
  override: number | null | undefined,
  subjectCoefficient: number | undefined,
  defaultCoefficient: number,
): number {
  if (override !== null && override !== undefined) return override;
  if (subjectCoefficient !== undefined) return subjectCoefficient;
  return defaultCoefficient;
}

/** Simple mean of a list; null on empty (matches the live per-subject `avg`). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/**
 * Coefficient-weighted global average across per-subject averages — the live
 * `weightedSum / totalCoef`. Only subjects with a non-null average contribute to
 * the denominator (matches `s.studentAverage != null ? s.coefficient : 0`).
 */
export function weightedGlobal(
  perSubject: Array<{ average: number | null; coefficient: number }>,
): number | null {
  let weightedSum = 0;
  let totalCoef = 0;
  for (const s of perSubject) {
    if (s.average != null) {
      weightedSum += s.average * s.coefficient;
      totalCoef += s.coefficient;
    }
  }
  return totalCoef === 0 ? null : weightedSum / totalCoef;
}

/**
 * Competition rank of `myValue` among `allValues` (1 = best; ex-æquo share a
 * rank): `rank = (# strictly greater) + 1`. Returns null when `myValue` is null.
 * Matches the live `higher + 1` ranking block (both per-subject and global).
 */
export function competitionRank(myValue: number | null, allValues: number[]): number | null {
  if (myValue == null) return null;
  let higher = 0;
  for (const v of allValues) if (v > myValue) higher += 1;
  return higher + 1;
}

/** Signed delta between the last two term averages (last − previous); null if <2. */
export function trendDelta(termAveragesByOrder: Array<{ order: number; average: number }>): number | null {
  if (termAveragesByOrder.length < 2) return null;
  const sorted = [...termAveragesByOrder].sort((a, b) => a.order - b.order);
  const last = sorted[sorted.length - 1]!.average;
  const prev = sorted[sorted.length - 2]!.average;
  return last - prev;
}

export interface DistributionResult {
  average: number | null;
  median: number | null;
  minScore: number | null;
  maxScore: number | null;
  countLow: number;
  countMid: number;
  countHigh: number;
  passRate: number | null;
  gradeCount: number;
}

/**
 * Histogram + class average over a list of onTwenty grades — buckets
 * [0,10) / [10,14) / [14,20], passRate = share ≥ 10/20 (×100). Empty → all-null/zero.
 */
export function distribution(onTwentyValues: number[]): DistributionResult {
  const n = onTwentyValues.length;
  if (n === 0) {
    return {
      average: null,
      median: null,
      minScore: null,
      maxScore: null,
      countLow: 0,
      countMid: 0,
      countHigh: 0,
      passRate: null,
      gradeCount: 0,
    };
  }
  let countLow = 0;
  let countMid = 0;
  let countHigh = 0;
  let pass = 0;
  let sum = 0;
  let min = onTwentyValues[0]!;
  let max = onTwentyValues[0]!;
  for (const v of onTwentyValues) {
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
    if (v < 10) countLow += 1;
    else if (v < 14) countMid += 1;
    else countHigh += 1;
    if (v >= 10) pass += 1;
  }
  const sorted = [...onTwentyValues].sort((a, b) => a - b);
  const mid = Math.floor(n / 2);
  const median = n % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
  return {
    average: sum / n,
    median,
    minScore: min,
    maxScore: max,
    countLow,
    countMid,
    countHigh,
    passRate: (pass / n) * 100,
    gradeCount: n,
  };
}

/** Round to 2 decimals for the Decimal(5,2) snapshot columns (PM-6 boundary). */
export function round2(value: number | null): number | null {
  if (value == null) return null;
  return Math.round(value * 100) / 100;
}
