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

/**
 * S-E03-3 / `ADR-072 §3` — les TROIS états que le serveur peut poser sur cette
 * ligne, mirrorés localement comme le reste de ce fichier.
 *
 * Trois, pas quatre : le quatrième état du design-system (`unavailable`, la
 * lecture ÉCHOUÉE) n'est pas franchissable ici — le champ arrive toujours
 * renseigné avec la ligne elle-même. L'élargir ferait croire à un chemin qui
 * n'existe pas, ce qui est `DNC-06`.
 */
export type EnrollmentActivityState = 'active' | 'out_of_scope' | 'none';

export interface MeetingRequest {
  id: string;
  status: MeetingRequestStatus;
  alertId: string;
  alertCode: AlertCode;
  alertSeverity: AlertSeverity;
  alertTitle: string;
  studentId: string;
  studentName: string;
  /**
   * S-E03-3 / `PF-12` / `ADR-072` — **la classe EN COURS, ou `null`.**
   *
   * Non-`null` **si et seulement si** `enrollmentActivityState === 'active'` :
   * le serveur ne replie plus sur la dernière inscription connue
   * (`meeting-requests.service.ts` `toDto`). Une pastille de classe sur cette
   * ligne est donc toujours une inscription de l'année canonique, jamais une
   * classe de l'an dernier rendue comme si elle était actuelle.
   */
  classSectionName: string | null;
  /**
   * Le verdict canonique d'activité, décidé **côté serveur** par
   * `selectActiveEnrollment` (`ADR-072 §3`). Le portail ne re-dérive rien : il
   * n'a d'ailleurs aucune ligne d'inscription à sa disposition ici.
   */
  enrollmentActivityState: EnrollmentActivityState;
  /**
   * `ADR-041 §D3` / `ADR-072 §5` — la phrase de portée qui dit de QUELLE année
   * le verdict ci-dessus parle. Rendue dans le DOM à côté du nom de l'enfant dès
   * que l'état n'est pas `active`, c'est-à-dire exactement quand la pastille de
   * classe est absente et qu'un lecteur se demanderait pourquoi.
   */
  enrollmentScopeLabel: string;
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
