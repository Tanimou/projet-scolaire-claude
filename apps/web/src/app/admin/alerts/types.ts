import type { AlertRuleCode } from './actions';

export type AlertSeverity = 'low' | 'medium' | 'high';
export type AlertStatus = 'open' | 'acknowledged' | 'resolved' | 'dismissed';

export interface AlertInstance {
  id: string;
  code: AlertRuleCode;
  severity: AlertSeverity;
  status: AlertStatus;
  studentId: string;
  studentName: string;
  subjectId: string | null;
  subjectName: string | null;
  classSectionId: string | null;
  classSectionName: string | null;
  title: string;
  body: string;
  recommendation: string | null;
  detectedAt: string;
}

export interface AlertRule {
  id: string | null;
  code: AlertRuleCode;
  label: string;
  description: string;
  enabled: boolean;
  severity: AlertSeverity;
  parameters: Record<string, unknown>;
  openInstances: number;
}

export const RULE_LABEL: Record<AlertRuleCode, string> = {
  LOW_SUBJECT_AVG: 'Moyenne basse',
  NEGATIVE_TREND: 'Tendance négative',
  REPEATED_FAILURE: 'Échecs répétés',
  MISSING_ASSESSMENT: 'Évaluation manquante',
  HIGH_ABSENCE: 'Absence élevée',
  TEACHER_COMMENT_FLAG: 'Commentaire signalé',
  IMPROVEMENT: 'Progrès / amélioration',
  BEHAVIOR_ALERT: 'Comportement',
};

export const SEVERITY_LABEL: Record<AlertSeverity, string> = {
  low: 'Faible',
  medium: 'Moyenne',
  high: 'Élevée',
};

export const SEVERITY_TONE: Record<AlertSeverity, 'sky' | 'warning' | 'danger'> = {
  low: 'sky',
  medium: 'warning',
  high: 'danger',
};

export const SEVERITY_ORDER: AlertSeverity[] = ['high', 'medium', 'low'];

export const STATUS_LABEL: Record<AlertStatus, string> = {
  open: 'À traiter',
  acknowledged: 'Vue',
  resolved: 'Résolue',
  dismissed: 'Ignorée',
};

export const STATUS_TONE: Record<AlertStatus, 'danger' | 'warning' | 'success' | 'neutral'> = {
  open: 'danger',
  acknowledged: 'warning',
  resolved: 'success',
  dismissed: 'neutral',
};

export type AlertsTabKey = 'rules' | 'active' | 'history';

export const TAB_KEYS: AlertsTabKey[] = ['rules', 'active', 'history'];

export function parseTab(raw: string | undefined): AlertsTabKey {
  if (raw === 'active' || raw === 'history' || raw === 'rules') return raw;
  return 'rules';
}
