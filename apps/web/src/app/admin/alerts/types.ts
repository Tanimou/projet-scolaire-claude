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

// ────────────────────────────────────────────────────────────────────────────
// E3-S3 — Admin rule-config editor: per-code typed parameter descriptors.
//
// FE-local source of truth (single-workspace, no contracts rebuild). The shapes
// mirror RULE_DEFAULTS in apps/api/.../alerts.types.ts EXACTLY — the editor must
// emit the COMPLETE parameter object for a code (PATCH replaces the JSONB
// wholesale, no server-side deep-merge), or sibling keys are silently dropped.
//
// `min`/`max`/`step` encode the SAME bounds the evaluators defensively clamp to,
// so the client guard never lets an admin save a value the engine would ignore.
// This is a UX guard only — the server still accepts/clamps (not a security
// boundary).
// ────────────────────────────────────────────────────────────────────────────

export interface RuleParamField {
  /** Canonical key written into `parameters` (must match RULE_DEFAULTS). */
  key: string;
  /** Visible field label. */
  label: string;
  /** Short decorative unit suffix (e.g. "/20", "pts", "jours"). */
  unit: string;
  min: number;
  max: number;
  step: number;
  /** Integer-only (rejects decimals) when true. */
  integer?: boolean;
  /** One-line helper under the field. */
  hint: string;
}

/**
 * Per-code field descriptors. Codes absent here (TEACHER_COMMENT_FLAG) have no
 * numeric parameters — only enabled/severity are editable. BEHAVIOR_ALERT is
 * reserved-but-unwired and is never offered for configuration.
 */
export const RULE_PARAM_FIELDS: Partial<Record<AlertRuleCode, RuleParamField[]>> = {
  LOW_SUBJECT_AVG: [
    { key: 'threshold', label: 'Seuil de moyenne', unit: '/20', min: 0, max: 20, step: 0.5, hint: 'Alerte sous cette moyenne.' },
  ],
  NEGATIVE_TREND: [
    { key: 'delta', label: 'Baisse minimale', unit: 'pts', min: 0.5, max: 10, step: 0.5, hint: 'Écart de baisse déclencheur.' },
    { key: 'windowAssessments', label: 'Sur les N dernières évals', unit: 'évals', min: 2, max: 10, step: 1, integer: true, hint: 'Fenêtre d’évaluations analysée.' },
  ],
  IMPROVEMENT: [
    { key: 'delta', label: 'Progression minimale', unit: 'pts', min: 0.5, max: 10, step: 0.5, hint: 'Écart de hausse à célébrer.' },
    { key: 'windowAssessments', label: 'Sur les N dernières évals', unit: 'évals', min: 2, max: 10, step: 1, integer: true, hint: 'Fenêtre d’évaluations analysée.' },
  ],
  REPEATED_FAILURE: [
    { key: 'threshold', label: 'Note d’échec sous', unit: '/20', min: 0, max: 20, step: 0.5, hint: 'Une note sous ce seuil = échec.' },
    { key: 'consecutive', label: 'Échecs consécutifs', unit: 'notes', min: 2, max: 10, step: 1, integer: true, hint: 'Nombre d’échecs d’affilée.' },
  ],
  HIGH_ABSENCE: [
    { key: 'count', label: 'Nombre d’absences', unit: 'abs.', min: 1, max: 50, step: 1, integer: true, hint: 'Seuil d’absences déclencheur.' },
    { key: 'windowDays', label: 'Sur une fenêtre de', unit: 'jours', min: 1, max: 180, step: 1, integer: true, hint: 'Période d’observation.' },
  ],
  MISSING_ASSESSMENT: [
    { key: 'count', label: 'Évaluations manquées', unit: 'éval.', min: 1, max: 50, step: 1, integer: true, hint: 'Seuil d’évaluations manquées.' },
    { key: 'windowDays', label: 'Sur une fenêtre de', unit: 'jours', min: 1, max: 180, step: 1, integer: true, hint: 'Période d’observation.' },
  ],
  TEACHER_COMMENT_FLAG: [],
};

/**
 * Severity options selectable in the editor, paired with a tone so the UI can
 * render a colored dot beside the text label (color is never the only signal).
 */
export const SEVERITY_OPTIONS: AlertSeverity[] = ['low', 'medium', 'high'];

/** Positive rule — severity is locked to `low` so a celebration never enters
 *  the danger/priority lane (keeps the non-stigmatising contract intact). */
export const POSITIVE_RULE_CODES: ReadonlyArray<AlertRuleCode> = ['IMPROVEMENT'];
