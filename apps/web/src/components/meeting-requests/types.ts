/**
 * Web-side mirror of the `@pilotage/contracts` MeetingRequestDto (E1-S3).
 *
 * Kept as a local type (not a runtime import) to match the established
 * recommendations/alerts page convention — the shape is validated against the
 * contract DTO, and the two-portal list/row components read this type.
 */

export type AlertCode =
  | 'LOW_SUBJECT_AVG'
  | 'NEGATIVE_TREND'
  | 'REPEATED_FAILURE'
  | 'MISSING_ASSESSMENT'
  | 'HIGH_ABSENCE'
  | 'TEACHER_COMMENT_FLAG'
  | 'IMPROVEMENT'
  | 'BEHAVIOR_ALERT';

export type AlertSeverity = 'low' | 'medium' | 'high';

export type MeetingRequestStatus = 'open' | 'resolved' | 'cancelled';

export interface MeetingRequest {
  id: string;
  status: MeetingRequestStatus;
  alertId: string;
  alertCode: AlertCode;
  alertSeverity: AlertSeverity;
  alertTitle: string;
  studentId: string;
  studentName: string;
  classSectionName: string | null;
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
  requestedByName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  requestedAt: string;
  resolvedAt: string | null;
}

export type MeetingRequestPortal = 'teacher' | 'admin';

export const ALERT_CODE_LABEL: Record<AlertCode, string> = {
  LOW_SUBJECT_AVG: 'Moyenne basse',
  NEGATIVE_TREND: 'Tendance négative',
  REPEATED_FAILURE: 'Échecs répétés',
  MISSING_ASSESSMENT: 'Évaluation manquante',
  HIGH_ABSENCE: 'Absences élevées',
  TEACHER_COMMENT_FLAG: 'Signalement enseignant',
  IMPROVEMENT: 'Progrès',
  BEHAVIOR_ALERT: 'Comportement',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  low: 'Faible',
  medium: 'Modérée',
  high: 'Critique',
};
