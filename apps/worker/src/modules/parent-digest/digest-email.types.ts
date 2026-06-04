/**
 * Worker-local digest payload types (E1-S4). Mirrors the lightweight,
 * hand-maintained shape convention of `notification-email.types.ts`. Nothing in
 * the API or web consumes these — the digest is computed and rendered entirely
 * worker-side via the worker's own PrismaService — so no `packages/contracts`
 * type is added (see ADR-001 / the story spec's "no contract" decision).
 */

/** Direction of the week-over-week global-average movement, for the trend pill. */
export type DigestTrend = 'improving' | 'stable' | 'declining' | 'unknown';

/** One upcoming assessment in the next 7 days for the child's active class. */
export interface DigestUpcomingAssessment {
  /** ISO date string of the scheduled date (worker-side, UTC). */
  scheduledAt: string;
  subjectName: string;
  /** e.g. "Contrôle", "Devoir maison" — already humanised. */
  kindLabel: string;
  title: string;
}

/** Per-child one-screen summary block rendered inside the composite digest. */
export interface ChildDigest {
  studentId: string;
  firstName: string;
  lastName: string;
  /** Active class section name (e.g. "6eA"), or null if not enrolled. */
  className: string | null;
  /** Weighted /20 global average over published grades; null if no grades. */
  globalAverage: number | null;
  /**
   * Signed week-over-week delta on the /20 average (this child's own prior week,
   * never a named-peer comparison). Null if either week lacks grades.
   */
  trendDelta: number | null;
  trend: DigestTrend;
  /** Count of alerts detected in the last 7 days (open/acknowledged). */
  newAlertsCount: number;
  /** Up to 3 titles of those new alerts. */
  newAlertTitles: string[];
  /** Up to 3 upcoming assessments in (now, now+7d]. */
  upcoming: DigestUpcomingAssessment[];
  /** Exactly one recommended action line (most-severe open alert, else positive). */
  recommendation: string;
  /** Deep link target for the child's recommended action CTA. */
  recommendationLink: string;
}

/** Render input for the composite weekly digest email (one guardian, N children). */
export interface DigestRenderInput {
  recipientName: string;
  /** Human week range label, e.g. "26 mai – 1 juin". */
  weekLabel: string;
  children: ChildDigest[];
}
