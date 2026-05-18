export type CommentTier = 'positive' | 'neutral' | 'concern';

export type TierFilter = '' | CommentTier;

export type TermFilter = '' | string;

export type SubjectFilter = '' | string;

export interface CommentRow {
  id: string;
  comment: string | null;
  publishedAt: string;
  gradeValue: number | null;
  gradeMax: number;
  gradeOn20: number | null;
  assessmentTitle: string;
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  classSectionName: string;
  termName: string | null;
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}

export interface TermOption {
  /** Stable key: either the term name or the literal `__none__` for un-binned. */
  key: string;
  /** Display label (term name or "Hors trimestre"). */
  label: string;
}
