/** Événements de domaine — publiés via outbox + BullMQ */

export const DOMAIN_EVENTS = {
  USER_CREATED: 'identity.UserCreated',
  ROLE_ASSIGNED: 'identity.RoleAssigned',

  CLASS_CREATED: 'school.ClassCreated',
  SUBJECT_CONFIGURED: 'school.SubjectConfigured',

  STUDENT_LINKED: 'enrollment.StudentLinked',
  GUARDIANSHIP_APPROVED: 'enrollment.GuardianshipApproved',
  ENROLLMENT_APPROVED: 'enrollment.EnrollmentApproved',

  TEACHER_ASSIGNED: 'teaching.TeacherAssigned',

  ASSESSMENT_PLANNED: 'assessment.AssessmentPlanned',

  GRADE_DRAFTED: 'gradebook.GradeDrafted',
  GRADE_PUBLISHED: 'gradebook.GradePublished',
  GRADE_REVISED: 'gradebook.GradeRevised',

  SNAPSHOT_RECOMPUTED: 'analytics.SnapshotRecomputed',

  ALERT_RAISED: 'alerting.AlertRaised',
  ALERT_RESOLVED: 'alerting.AlertResolved',

  NOTIFICATION_QUEUED: 'notification.NotificationQueued',
  NOTIFICATION_SENT: 'notification.NotificationSent',

  REPORT_GENERATED: 'audit.ReportGenerated',
  AUDIT_LOGGED: 'audit.AuditLogged',
} as const;

export type DomainEventType = (typeof DOMAIN_EVENTS)[keyof typeof DOMAIN_EVENTS];
