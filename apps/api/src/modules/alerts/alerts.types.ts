import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

import type { AlertRuleCode, AlertSeverity, AlertStatus } from '@prisma/client';

export const RULE_CODES: ReadonlyArray<AlertRuleCode> = [
  'LOW_SUBJECT_AVG',
  'NEGATIVE_TREND',
  'REPEATED_FAILURE',
  'MISSING_ASSESSMENT',
  'HIGH_ABSENCE',
  'TEACHER_COMMENT_FLAG',
  'BEHAVIOR_ALERT',
];

/** Default labels + thresholds, mirrored on the front for the rule list UI. */
export const RULE_DEFAULTS: Record<
  AlertRuleCode,
  {
    label: string;
    description: string;
    severity: AlertSeverity;
    parameters: Record<string, unknown>;
  }
> = {
  LOW_SUBJECT_AVG: {
    label: 'Moyenne faible matière',
    description: "Moyenne d'un élève dans une matière sous le seuil",
    severity: 'high',
    parameters: { threshold: 10 },
  },
  NEGATIVE_TREND: {
    label: 'Tendance négative',
    description: 'Baisse de >= 1.5 pts sur 3 évaluations consécutives',
    severity: 'medium',
    parameters: { delta: 1.5, windowAssessments: 3 },
  },
  REPEATED_FAILURE: {
    label: 'Échecs répétés',
    description: '>= 3 notes < 10 d\'affilée sur une même matière',
    severity: 'high',
    parameters: { threshold: 10, consecutive: 3 },
  },
  MISSING_ASSESSMENT: {
    label: 'Évaluation manquante',
    description: 'Élève absent·e sur >= 1 évaluation publiée (rattrapage à prévoir)',
    severity: 'medium',
    parameters: { count: 1, windowDays: 30 },
  },
  HIGH_ABSENCE: {
    label: 'Absences répétées',
    description: '>= 5 absences non justifiées sur 30 jours',
    severity: 'medium',
    parameters: { count: 5, windowDays: 30 },
  },
  TEACHER_COMMENT_FLAG: {
    label: 'Commentaire enseignant à signaler',
    description: "Flag explicite par l'enseignant",
    severity: 'medium',
    parameters: {},
  },
  BEHAVIOR_ALERT: {
    label: 'Comportement à surveiller',
    description: '>= 3 remarques disciplinaires sur 14 jours',
    severity: 'high',
    parameters: { count: 3, windowDays: 14 },
  },
};

export class UpdateAlertRuleDto {
  @IsOptional()
  enabled?: boolean;

  @IsOptional()
  @IsEnum(['low', 'medium', 'high'] as const)
  severity?: AlertSeverity;

  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;
}

export class EvaluateAlertsDto {
  @IsOptional()
  @IsUUID()
  schoolId?: string;
}

export interface AlertRuleDto {
  id: string | null;
  code: AlertRuleCode;
  label: string;
  description: string;
  enabled: boolean;
  severity: AlertSeverity;
  parameters: Record<string, unknown>;
  /** Number of currently-open instances for this rule (UX hint) */
  openInstances?: number;
}

export interface AlertInstanceDto {
  id: string;
  code: AlertRuleCode;
  severity: AlertSeverity;
  status: AlertStatus;
  studentId: string;
  studentName: string;
  subjectId: string | null;
  subjectName: string | null;
  subjectCode: string | null;
  classSectionId: string | null;
  classSectionName: string | null;
  title: string;
  body: string;
  recommendation: string | null;
  detectedAt: string;
  acknowledgedAt: string | null;
  resolvedAt: string | null;
}
