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
}

export interface SubjectOption {
  id: string;
  code: string;
  name: string;
}
