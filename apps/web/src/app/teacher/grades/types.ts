export type GradeStatus = 'draft' | 'published' | 'revised';

export type GradeStatusFilter = '' | GradeStatus | 'absent';

export interface GradeRow {
  id: string;
  value: string | null;
  isAbsent: boolean;
  comment: string | null;
  status: GradeStatus;
  enteredAt: string;
  publishedAt: string | null;
  student: { id: string; firstName: string; lastName: string };
  assessment: {
    id: string;
    title: string;
    maxScore: string;
    coefficientOverride: string | null;
    isPublished: boolean;
    teachingAssignment: {
      classSection: { id: string; name: string };
      subject: { id: string; code: string; name: string; color: string | null };
    };
    term: { id: string; name: string } | null;
  };
}

export interface ClassOption {
  id: string;
  name: string;
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
  color: string | null;
}

export interface TermOption {
  id: string;
  name: string;
}
