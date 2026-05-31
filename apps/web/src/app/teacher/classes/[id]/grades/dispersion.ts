/**
 * Pure dispersion statistics for a cohort of grades expressed on /20.
 *
 * Kept free of React/JSX so the maths and the homogeneity classification can be
 * unit-tested and reused (e.g. teacher reports, parent grade overview)
 * independently of how `GradebookInsights` renders them.
 */

/** Tonal palette shared by the dispersion chip and the stat tiles. */
export type StatTone = 'emerald' | 'blue' | 'amber' | 'rose' | 'violet' | 'slate';

export interface DispersionStats {
  /** Number of students that actually have an average. */
  count: number;
  minAvg: number | null;
  maxAvg: number | null;
  meanAvg: number | null;
  medianAvg: number | null;
  /** maxAvg − minAvg. */
  rangeAvg: number | null;
  /** Population standard deviation (points /20). */
  stdDev: number | null;
}

/**
 * Compute median / range / standard deviation from a set of students, reading
 * the *spread* of the class and not just its centre — a 12/20 average can hide
 * a class split between very strong and struggling students.
 */
export function computeDispersionStats(
  students: ReadonlyArray<{ average: number | null }>,
): DispersionStats {
  const sorted = students
    .map((s) => s.average)
    .filter((v): v is number => v != null)
    .sort((a, b) => a - b);

  const n = sorted.length;
  if (n === 0) {
    return {
      count: 0,
      minAvg: null,
      maxAvg: null,
      meanAvg: null,
      medianAvg: null,
      rangeAvg: null,
      stdDev: null,
    };
  }

  const mean = sorted.reduce((s, v) => s + v, 0) / n;
  const median =
    n % 2 === 1
      ? sorted[(n - 1) / 2]!
      : (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const variance = sorted.reduce((s, v) => s + (v - mean) ** 2, 0) / n;

  return {
    count: n,
    minAvg: min,
    maxAvg: max,
    meanAvg: mean,
    medianAvg: median,
    rangeAvg: max - min,
    stdDev: Math.sqrt(variance),
  };
}

export interface HomogeneityInfo {
  label: string;
  hint: string;
  tone: StatTone;
}

/**
 * Ordered standard-deviation buckets (points /20), tightest first. The final
 * bucket uses `Infinity` so a non-null `stdDev` always resolves to a reading.
 */
export const HOMOGENEITY_BUCKETS: ReadonlyArray<{ max: number; info: HomogeneityInfo }> = [
  { max: 1.5, info: { label: 'Très homogène', hint: 'Niveaux resserrés', tone: 'emerald' } },
  { max: 3, info: { label: 'Homogène', hint: 'Écarts modérés', tone: 'blue' } },
  { max: 4.5, info: { label: 'Contrastée', hint: 'Niveaux variés', tone: 'amber' } },
  { max: Infinity, info: { label: 'Très dispersée', hint: 'Forte hétérogénéité', tone: 'rose' } },
];

/** Map a standard deviation to its homogeneity reading (null when no SD). */
export function getHomogeneity(stdDev: number | null): HomogeneityInfo | null {
  if (stdDev == null) return null;
  return HOMOGENEITY_BUCKETS.find((b) => stdDev < b.max)!.info;
}
