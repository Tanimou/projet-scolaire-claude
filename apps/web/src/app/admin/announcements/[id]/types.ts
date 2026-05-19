export type AnnouncementScope =
  | 'school_wide'
  | 'cycle_scope'
  | 'grade_level_scope'
  | 'class_section_scope'
  | 'individual_student'
  | 'individual_user';

export type AnnouncementPriority = 'normal' | 'high' | 'urgent';

export type AnnouncementStatus = 'published' | 'expired' | 'draft';

export interface AnnouncementAttachment {
  name?: string;
  url?: string;
  size?: number;
  type?: string;
}

export interface RecipientProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  roles: string[];
  roleLabels: string[];
}

export interface AnnouncementRecipient {
  id: string;
  userProfileId: string;
  readAt: string | null;
  createdAt: string;
  userProfile: RecipientProfile | null;
}

export interface AnnouncementDetail {
  id: string;
  title: string;
  body: string;
  scope: AnnouncementScope;
  priority: AnnouncementPriority;
  publishedAt: string | null;
  expiresAt: string | null;
  pinned: boolean;
  authorId: string;
  authorRoleHint: string | null;
  attachments: AnnouncementAttachment[];
  createdAt: string;
  updatedAt: string;
  cycle?: { name: string } | null;
  gradeLevel?: { name: string } | null;
  classSection?: { name: string } | null;
  student?: { id: string; firstName: string; lastName: string } | null;
  author: { id: string; firstName: string; lastName: string } | null;
  stats: {
    total: number;
    read: number;
    unread: number;
    readRate: number;
    firstReadAt: string | null;
    lastReadAt: string | null;
    medianMinutesToRead: number | null;
  };
  recipients: AnnouncementRecipient[];
}

export type RecipientReadFilter = '' | 'read' | 'unread';
export type RecipientRoleFilter = string;
