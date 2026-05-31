/**
 * Shared types for /parent/grades. Pages, filters and cards all consume them so
 * shape changes ripple to one place.
 */

export interface SubjectOption {
  id: string;
  name: string;
  color: string | null;
}

export interface TermOption {
  id: string;
  name: string;
}

export type GradesPeriod = 'all' | 'month' | 'term';

export type GradesPerformance = 'excellent' | 'satisfaisant' | 'insuffisant' | 'absent';

/**
 * Human labels for assessment kinds. Single source of truth shared by the grade
 * cards ({@link ./GradeRow}) and the CSV export ({@link ./GradesExport}) so the
 * wording stays consistent across the page.
 */
export const KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle écrit',
  oral_test: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  practical: 'Travaux pratiques',
  participation: 'Participation',
};

/** Resolve an assessment kind to its French label, falling back to the raw code. */
export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export interface GradeRow {
  id: string;
  value: string | null;
  isAbsent: boolean;
  status: 'draft' | 'published' | 'revised';
  comment: string | null;
  publishedAt: string | null;
  assessment: {
    id: string;
    title: string;
    kind: string;
    scheduledAt: string | null;
    maxScore: string;
    coefficientOverride: string | null;
    isPublished: boolean;
    teachingAssignment: {
      subject: { id: string; name: string; color: string | null };
    };
    term: { id: string; name: string } | null;
  };
}
