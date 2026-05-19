export type AnnouncementScope =
  | 'school_wide'
  | 'cycle_scope'
  | 'grade_level_scope'
  | 'class_section_scope'
  | 'individual_student'
  | 'individual_user';

export type AnnouncementPriority = 'normal' | 'high' | 'urgent';

export type AnnouncementStatus = 'published' | 'expired' | 'draft';

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  priority: AnnouncementPriority;
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  authorRoleHint: string | null;
  classSection?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  cycle?: { name: string } | null;
  student?: { id: string; firstName: string; lastName: string } | null;
  _count: { recipients: number };
}

export type ScopeFilter = '' | AnnouncementScope;
export type PriorityFilter = '' | AnnouncementPriority;
export type StatusFilter = '' | AnnouncementStatus;
export type PinnedFilter = '' | 'pinned';
