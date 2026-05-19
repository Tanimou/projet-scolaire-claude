export type PerfBand = 'excellent' | 'bon' | 'correct' | 'risque' | 'unknown';

export type BandFilter = '' | PerfBand;

export type SignalFilter =
  | ''
  | 'at-risk'
  | 'low-pass-rate'
  | 'declining'
  | 'improving'
  | 'no-data';

export type SortKey =
  | 'name-asc'
  | 'avg-desc'
  | 'avg-asc'
  | 'pass-asc'
  | 'pass-desc'
  | 'students-desc'
  | 'trend-desc'
  | 'trend-asc';

export interface ClassReportRowData {
  assignmentId: string;
  classSectionId: string;
  classSectionName: string;
  gradeLevelName: string | null;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  studentCount: number;
  average: number | null;
  publishedAssessments: number;
  perTerm: Array<{ termId: string; termName: string; average: number | null }>;
  sparkline: Array<{ x: string; y: number }>;
  passRate: number | null;
  distribution: { low: number; mid: number; high: number };
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}

export interface GradeLevelOption {
  name: string;
  count: number;
}
