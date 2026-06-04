export type AlertCode =
  | 'LOW_SUBJECT_AVG'
  | 'NEGATIVE_TREND'
  | 'REPEATED_FAILURE'
  | 'MISSING_ASSESSMENT'
  | 'HIGH_ABSENCE'
  | 'TEACHER_COMMENT_FLAG'
  | 'BEHAVIOR_ALERT';

export type AlertSeverity = 'low' | 'medium' | 'high';

export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export type SeverityFilter = '' | AlertSeverity;

export type AlertCodeFilter = '' | AlertCode;

export type AcknowledgedFilter = '' | 'open' | 'acknowledged';

export type AlertLifecycleAction = 'ack' | 'resolve' | 'dismiss';

export interface AlertItem {
  id: string;
  code: AlertCode;
  severity: AlertSeverity;
  status: AlertStatus;
  title: string;
  body: string;
  recommendation: string | null;
  subjectId: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  detectedAt: string;
  acknowledgedAt: string | null;
  /**
   * E1-S2: ISO timestamp of the parent's existing "request a meeting" intent
   * for this alert, if any. Optional — when the aggregate endpoint surfaces it,
   * the "Que puis-je faire ?" panel renders the confirmation instead of the CTA
   * (prevents re-offering after a refresh). Absent ⇒ treated as not requested.
   */
  meetingRequestedAt?: string | null;
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}
