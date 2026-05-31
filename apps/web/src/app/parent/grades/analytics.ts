/**
 * Pure analytics helpers for /parent/grades.
 *
 * Both the page KPIs and the "Vue d'ensemble" panel derive from the same
 * normalised grade value, so the maths lives in one place and stays testable.
 */
import type { GradeRow } from './types';

/** Normalise a grade to a /20 scale, or `null` when it cannot count (absent / empty). */
export function gradeValueOn20(g: GradeRow): number | null {
  if (g.isAbsent || g.value == null) return null;
  const v = Number(g.value);
  const max = Number(g.assessment.maxScore);
  if (!Number.isFinite(v) || !(max > 0)) return null;
  return (v / max) * 20;
}

/** Reference date used to place a grade on the timeline. */
function refDate(g: GradeRow): Date | null {
  const ref = g.assessment.scheduledAt ?? g.publishedAt;
  if (!ref) return null;
  const d = new Date(ref);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Object-literal `type` (not `interface`) so it satisfies the
// `LineChart<T extends Record<string, unknown>>` generic constraint.
export type MonthlyPoint = {
  /** `YYYY-MM` sort key */
  key: string;
  /** Short French month label, e.g. « mars » */
  label: string;
  /** Average on /20 for the month */
  avg: number;
  /** Number of grades that fed the average */
  count: number;
};

export interface GradeDistribution {
  excellent: number;
  satisfaisant: number;
  insuffisant: number;
  absent: number;
}

export interface GradesAnalytics {
  monthly: MonthlyPoint[];
  distribution: GradeDistribution;
  /** Total graded values feeding the monthly/distribution numbers. */
  gradedCount: number;
  /** Delta (pts) between the first and last plotted month, or `null`. */
  trendDelta: number | null;
}

const MONTH_FMT = new Intl.DateTimeFormat('fr-FR', { month: 'short' });

function monthLabel(d: Date): string {
  const raw = MONTH_FMT.format(d).replace('.', '');
  return raw.charAt(0).toUpperCase() + raw.slice(1);
}

/**
 * Build the data backing the grades overview panel.
 *
 * @param grades  full (unfiltered) grade set for the active child
 * @param months  how many trailing months to keep on the trend line (default 6)
 */
export function buildGradesAnalytics(
  grades: GradeRow[],
  { months = 6 }: { months?: number } = {},
): GradesAnalytics {
  const distribution: GradeDistribution = {
    excellent: 0,
    satisfaisant: 0,
    insuffisant: 0,
    absent: 0,
  };

  // Accumulate per-month sums to average at the end.
  const buckets = new Map<string, { label: string; sum: number; count: number }>();
  let gradedCount = 0;

  for (const g of grades) {
    if (g.isAbsent) {
      distribution.absent += 1;
      continue;
    }
    const v = gradeValueOn20(g);
    if (v == null) continue;

    gradedCount += 1;
    if (v >= 16) distribution.excellent += 1;
    else if (v >= 10) distribution.satisfaisant += 1;
    else distribution.insuffisant += 1;

    const d = refDate(g);
    if (!d) continue;
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const entry = buckets.get(key);
    if (entry) {
      entry.sum += v;
      entry.count += 1;
    } else {
      buckets.set(key, { label: monthLabel(d), sum: v, count: 1 });
    }
  }

  const monthly: MonthlyPoint[] = Array.from(buckets.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-months)
    .map(([key, b]) => ({
      key,
      label: b.label,
      avg: Math.round((b.sum / b.count) * 10) / 10,
      count: b.count,
    }));

  const trendDelta =
    monthly.length >= 2
      ? Math.round((monthly[monthly.length - 1]!.avg - monthly[0]!.avg) * 10) / 10
      : null;

  return { monthly, distribution, gradedCount, trendDelta };
}
