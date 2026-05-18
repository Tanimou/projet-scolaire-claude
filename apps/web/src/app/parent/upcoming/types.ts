export type UpcomingHorizon = 'this-week' | 'next-week' | 'later';

export type HorizonFilter = '' | UpcomingHorizon;

export type SubjectFilter = '' | string;

export type KindFilter = '' | string;

export type TermFilter = '' | string;

export interface UpcomingItem {
  id: string;
  title: string;
  description: string | null;
  scheduledAt: string;
  kind: string;
  maxScore: number;
  coefficient: number;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  classSectionName: string;
  termId: string | null;
  termName: string | null;
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}

export interface KindOption {
  value: string;
  label: string;
}

export interface TermOption {
  /** Stable key: term id or the literal `__none__` for un-binned. */
  key: string;
  /** Display label. */
  label: string;
}
