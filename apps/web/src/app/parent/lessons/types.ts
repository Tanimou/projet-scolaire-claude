export type LessonsPeriod = 'week' | 'month' | 'all' | 'homework';

export interface SubjectOption {
  id: string;
  name: string;
  color: string | null;
}

export interface LessonRow {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  teachingAssignment: {
    subject: { id: string; name: string; color: string | null };
    classSection: { id: string; name: string };
  };
  teacherProfile: { userProfile: { firstName: string; lastName: string } };
}
