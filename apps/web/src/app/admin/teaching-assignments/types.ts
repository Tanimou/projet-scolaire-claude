import { pageEnvelope, requiredKey, unvalidatedItem } from '@pilotage/contracts';
import { z } from 'zod';

/**
 * Shared types for the Teaching-Assignments UI.
 * Imported by both the legacy `/admin/teaching-assignments` route and the new
 * `/admin/assignments` page (spec §5 EN-aligned). Keeping the types here ensures
 * the `AssignmentsManager` component stays a single source of truth.
 */

export interface TeacherOption {
  id: string;
  active: boolean;
  specialty: string | null;
  userProfile: { id: string; firstName: string; lastName: string; email: string };
}

export interface ClassOption {
  id: string;
  name: string;
  status: string;
  gradeLevel: { name: string; cycle: { name: string; color: string | null } };
  academicYear: { id: string; name: string; status: string };
}

export interface SubjectOption {
  id: string;
  name: string;
  code: string;
  color: string | null;
}

/** Rôle d'un enseignant sur une affectation (cf. enum Prisma AssignmentRole). */
export type AssignmentRole = 'principal' | 'assistant' | 'subject_teacher';

export interface Assignment {
  id: string;
  isMainTeacher: boolean;
  /** principal = PP (couronne), assistant = badge bleu, subject_teacher = neutre. */
  role: AssignmentRole;
  weeklyHours: string | null;
  teacherProfile: {
    id: string;
    userProfile: { firstName: string; lastName: string; email: string };
  };
  classSection: {
    id: string;
    name: string;
    gradeLevel: { name: string; cycle: { name: string; color: string | null } };
  };
  subject: { id: string; name: string; code: string; color: string | null };
  academicYear: { id: string; name: string; status: string };
}

/**
 * S-E03-9 (PF-50) — les agrégats **serveur** de `GET /api/v1/teaching-assignments`.
 *
 * Depuis que l'endpoint est borné (`limit`/`offset`, défaut 100, max 500), le
 * tableau `data` est **une page**, plus « tout ». Aucun chiffre affiché ne peut
 * donc être `data.length` ni `new Set(data…)` : ce serait la taille de la page
 * portant le libellé d'un total (DNC-01, exactement PF-20 puis PF-40).
 *
 * Ces deux blocs sont calculés côté API sur le **même `where`** que le
 * `findMany`, scopés `tenantId`. Ils sont la seule source autorisée pour les
 * quatre KPI et pour le panneau de couverture.
 *
 * Les noms sont ceux d'`ADR-080 §D4`, qui est la décision d'architecture
 * enregistrée pour cet endpoint. Le bloc `contract` de l'histoire proposait
 * `summary: { total, distinctTeachers, distinctClasses }` ; les deux moitiés du
 * slice ont suivi chacune un artefact différent, et la page lisait donc une clé
 * que l'API n'émettait pas. Un seul nom, celui de l'ADR, des deux côtés.
 */
export interface AssignmentsTotals {
  /** `count(where)` — « AFFECTATIONS ACTIVES ». */
  assignments: number;
  /** `groupBy(teacherProfileId).length` — « ENSEIGNANTS AFFECTÉS ». */
  teachers: number;
  /** `groupBy(classSectionId).length` — « CLASSES COUVERTES ». */
  classes: number;
  /**
   * « MATIÈRES SANS ENSEIGNANT », **calculé côté serveur** en une lecture
   * (`subject.count({ teachingAssignments: { none: where } })`).
   *
   * Ce chiffre n'est PAS différencié côté client : `GET /subjects` est un autre
   * endpoint, avec sa propre fenêtre, et différencier deux lectures bornées
   * indépendamment produirait un nombre monotonement faux dans le sens alarmant
   * (ADR-080 §D4 — une page de 100 sur 290 accuserait presque chaque matière).
   */
  subjectsWithoutTeacher: number;
}

/**
 * Couverture pédagogique, dérivée serveur. Le panneau d'alertes affirme un fait
 * sur **tout l'établissement** (« Toutes les classes actives ont un professeur
 * principal ») : le dériver d'un tableau borné inventerait des alertes pour des
 * classes qui ont bel et bien un PP, simplement absentes de la page.
 */
export interface AssignmentsCoverage {
  /**
   * La portée NOMMÉE de ce bloc, pour que l'interface ne puisse pas
   * l'étiqueter à tort. Les trois listes ci-dessous portent toutes dessus.
   */
  scope: 'establishment';
  /** Ids des classes ayant au moins une affectation `role = 'principal'`. */
  classSectionIdsWithPrincipal: string[];
  /** Ids des classes ayant au moins une affectation `role = 'assistant'`. */
  classSectionIdsWithAssistant: string[];
  /**
   * Ids des matières ayant **au moins une** affectation dans l'établissement.
   * Liste d'ids de portée globale (quelques dizaines), jamais une page : le
   * panneau NOMME les matières découvertes, ce qu'un scalaire ne peut pas
   * faire. Elle vit ici, et non dans `totals`, parce qu'elle a la portée de
   * `coverage` (établissement) et non celle des filtres courants.
   */
  subjectIdsWithTeacher: string[];
}

/**
 * Réponse de `GET /api/v1/teaching-assignments` — S-E03-9, puis S-E03-11.
 *
 * ⚠⚠ C'EST L'ENVELOPPE QUI A PRESQUE CASSÉ EN PRODUCTION AU RUN 94. L'API
 * émettait `totals` et `/admin/assignments` lisait `summary` ; les DEUX
 * moitiés ont typé VERT, parce qu'`api<T>()` AFFIRMAIT `T` au lieu de le
 * vérifier. Les quatre KPI seraient partis en tirets cadratins et le panneau
 * de couverture serait resté « indisponible ». Un humain l'a attrapé ; aucun
 * test ne l'a fait.
 *
 * Elle est maintenant DÉRIVÉE du cadre canonique et ANALYSÉE. Les clés
 * DÉCLARÉES sont OBLIGATOIRES : le même renommage produit désormais une
 * `ResponseShapeError` nommant `totals`, au lieu d'un `undefined` silencieux.
 *
 * ⚠ `requiredKey<T>()` porte un `.refine` rejetant `undefined`, et ce n'est pas
 * cosmétique : `z.unknown()` nu est FACULTATIF pour zod, donc une enveloppe à
 * laquelle il manque `totals` serait passée VERTE et le défaut du run 94
 * aurait survécu au contrat censé l'attraper.
 */
export const teachingAssignmentsEnvelope = pageEnvelope(unvalidatedItem<Assignment>()).extend({
  /** La fenêtre effectivement servie (ADR-080 §D4). */
  limit: z.number().int().nonnegative(),
  offset: z.number().int().nonnegative(),
  totals: requiredKey<AssignmentsTotals>(),
  coverage: requiredKey<AssignmentsCoverage>(),
});

export type TeachingAssignmentsResponse = z.infer<typeof teachingAssignmentsEnvelope>;
