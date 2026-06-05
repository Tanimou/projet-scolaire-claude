/** Enums partagés client/serveur — alignés avec docs/spec/data-model.md */

export const PORTALS = ['admin', 'teacher', 'parent'] as const;
export type Portal = (typeof PORTALS)[number];

export const REALM_ROLES = ['super_admin', 'school_admin', 'teacher', 'parent'] as const;
export type RealmRole = (typeof REALM_ROLES)[number];

export const TENANT_STATUS = ['active', 'suspended', 'archived'] as const;
export const SCHOOL_STATUS = ['active', 'closed'] as const;
export const YEAR_STATUS = ['active', 'closed', 'archived'] as const;
export const CLASS_STATUS = ['active', 'closed'] as const;
export const USER_STATUS = ['active', 'suspended', 'deleted'] as const;
export const STUDENT_STATUS = ['active', 'transferred', 'graduated'] as const;

export const GUARDIANSHIP_RELATIONSHIP = ['mother', 'father', 'legal_guardian', 'other'] as const;
export const GUARDIANSHIP_STATUS = ['pending', 'approved', 'rejected', 'revoked'] as const;

export const ENROLLMENT_STATUS = ['pending', 'active', 'transferred', 'cancelled'] as const;

export const ASSIGNMENT_ROLES = ['principal', 'assistant', 'subject_teacher'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSESSMENT_TYPE = ['homework', 'quiz', 'test', 'exam', 'composition'] as const;
export const ASSESSMENT_VISIBILITY = ['hidden', 'parent_visible'] as const;

export const RESULT_STATUS = [
  'draft',
  'published',
  'revised',
  'cancelled',
  'absent',
  'exempt',
  'missing',
] as const;

export const TREND = ['up', 'stable', 'down'] as const;
export const RISK_LEVEL = ['low', 'medium', 'high'] as const;
export const ALERT_SEVERITY = ['low', 'medium', 'high'] as const;
export const ALERT_STATUS = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;

export const ALERT_RULE_CODE = [
  'LOW_SUBJECT_AVG',
  'NEGATIVE_TREND',
  'REPEATED_FAILURE',
  'MISSING_ASSESSMENT',
  'HIGH_ABSENCE',
  'TEACHER_COMMENT_FLAG',
  'BEHAVIOR_ALERT',
  'IMPROVEMENT',
] as const;

export const ATTENDANCE_STATUS = ['present', 'absent', 'late', 'excused', 'exempt'] as const;

export const NOTIFICATION_CHANNEL = ['email', 'push', 'sms', 'in_app'] as const;
export const NOTIFICATION_FREQUENCY = ['instant', 'daily', 'weekly', 'never'] as const;

export const IMPORT_TYPE = ['students', 'teachers', 'classes', 'grades', 'attendance', 'parents'] as const;
export const IMPORT_STATUS = [
  'uploaded',
  'validated',
  'previewed',
  'applying',
  'applied',
  'failed',
  'rolled_back',
] as const;
export const IMPORT_MODE = ['all_or_nothing', 'skip_invalid'] as const;
