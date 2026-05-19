export interface Lesson {
  id: string;
  date: string;
  title: string;
  content: string;
  homework: string | null;
  homeworkDueAt: string | null;
  status: 'draft' | 'published';
}

export type StatusFilter = '' | 'published' | 'draft';
export type HomeworkFilter = '' | 'with' | 'without' | 'due-soon' | 'overdue';
export type PeriodFilter = '' | '7d' | '30d' | '90d' | 'term';
export type SortKey = 'date-desc' | 'date-asc' | 'title-asc';
