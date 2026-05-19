/**
 * Performance band buckets used to group the subject list on the parent
 * `/parent/subjects` workspace. Mirrors `gradeVerdict` but bucketed for
 * coarser visual grouping (4 sections instead of 6 verbal levels).
 */
export type PerfBand = 'excellent' | 'bon' | 'correct' | 'risque' | 'unknown';

export type BandFilter = '' | PerfBand;

/** Status filter — orthogonal to the band, captures movement / class delta. */
export type StatusFilter =
  | ''
  | 'above-class'
  | 'below-class'
  | 'improving'
  | 'declining'
  | 'no-data';

/** Sort order for the visible cards within each band group. */
export type SortKey =
  | 'name-asc'
  | 'grade-desc'
  | 'grade-asc'
  | 'coef-desc'
  | 'delta-desc'
  | 'delta-asc';

export interface SubjectPerfItem {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  studentAverage: number | null;
  classAverage: number | null;
  coefficient: number;
  studentRank: number | null;
  classSize: number;
  trend: number | null;
  badge: string | null;
}
