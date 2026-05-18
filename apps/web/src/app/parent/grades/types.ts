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
