export type SourceFilter = '' | 'admin' | 'teacher';
export type StatusFilter = '' | 'unread' | 'read';
export type PeriodFilter = '' | '7d' | '30d' | '90d';

export interface CommunicationItem {
  id: string;
  title: string;
  body: string;
  scope: string;
  priority: 'normal' | 'high' | 'urgent';
  publishedAt: string | null;
  pinned: boolean;
  authorRoleHint: 'admin' | 'teacher' | null;
  classSection?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  cycle?: { name: string } | null;
  student?: { id: string; firstName: string; lastName: string } | null;
  readAt?: string | null;
  author?: { id: string; firstName: string; lastName: string } | null;
}

export interface InterlocutorCard {
  /** Stable key: authorId when known, otherwise `unknown-${authorRoleHint}` */
  key: string;
  authorId: string | null;
  firstName: string;
  lastName: string;
  roleHint: 'admin' | 'teacher' | null;
  total: number;
  unread: number;
  urgent: number;
  lastMessageAt: string | null;
}
