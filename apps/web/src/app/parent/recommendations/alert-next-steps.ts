import type { AlertCode } from './types';

/**
 * E1-S2 — "What should I do?" panel: pure, unit-testable derivation of the
 * concrete next-step controls offered under each parent alert.
 *
 * This is intentionally a plain function (no React, no I/O) so the per-code
 * mapping, the subject-null fallback and the <=3 cap can be proven in unit
 * tests (Murat gate). The UI component (`AlertNextSteps.tsx`) renders whatever
 * this returns and adds the always-present "talk to the teacher" CTA.
 *
 * Design rules (from the WINSTON/SALLY/Critic rulings):
 *  - Steps are derived from STRUCTURED fields (`code`, `subjectCode`,
 *    `subjectName`), never by string-parsing the free-text recommendation
 *    (FM-3).
 *  - A "Renforcer {subject}" deep-link is only emitted when `subjectCode` is
 *    non-null, falling back to the per-subject overview so we NEVER produce a
 *    broken `subject=null`/`subject=undefined` href (FM-3, AC-2).
 *  - Steps are capped at 3 and ordered most-actionable first; the teacher CTA
 *    is appended by the component, so this helper returns at most 2 navigation
 *    steps to leave room for it within the cap.
 */

export interface AlertNextStepInput {
  code: AlertCode;
  studentId: string;
  /** Subject UUID — the param `/parent/grades` actually filters on. */
  subjectId: string | null;
  subjectCode: string | null;
  subjectName: string | null;
}

export type NextStepKind = 'reinforce-subject' | 'attendance' | 'subjects' | 'child-profile';

export interface AlertNextStep {
  kind: NextStepKind;
  /** Self-describing French label (WCAG 2.4.4 — no "cliquez ici"). */
  label: string;
  /** One-line, kind, non-stigmatising helper. */
  helper: string;
  /** Verified-existing parent route; always carries studentId. */
  href: string;
  /** lucide icon name for the row chip (resolved in the component). */
  icon: 'BookOpenCheck' | 'CalendarClock' | 'LayoutGrid' | 'UserRound';
}

/** Alert codes whose alert is scoped to a single subject. */
const SUBJECT_SCOPED: ReadonlyArray<AlertCode> = [
  'LOW_SUBJECT_AVG',
  'NEGATIVE_TREND',
  'REPEATED_FAILURE',
  'MISSING_ASSESSMENT',
];

/** Max navigation steps returned (the teacher CTA is added on top, cap = 3). */
export const MAX_NAV_STEPS = 2;

function reinforceSubjectStep(input: AlertNextStepInput): AlertNextStep {
  // Subject-scoped + a known subject *id* → deep-link to the filtered grades
  // view. `/parent/grades` filters on `subjectId` (the UUID), NOT a subject
  // code — so we key the deep-link on `subjectId` to match the working
  // `subjects → grades` convention (subjects/page.tsx). No subjectId → graceful
  // fallback to the per-subject overview (never a broken/ignored query).
  if (input.subjectId) {
    const subjectLabel = input.subjectName ?? input.subjectCode ?? 'cette matière';
    return {
      kind: 'reinforce-subject',
      label: `Renforcer ${subjectLabel}`,
      helper: 'Revoir les notes de cette matière et cibler les chapitres à retravailler.',
      href: `/parent/grades?studentId=${encodeURIComponent(
        input.studentId,
      )}&subjectId=${encodeURIComponent(input.subjectId)}`,
      icon: 'BookOpenCheck',
    };
  }
  return subjectsOverviewStep(input);
}

function subjectsOverviewStep(input: AlertNextStepInput): AlertNextStep {
  return {
    kind: 'subjects',
    label: 'Voir le suivi par matière',
    helper: 'Parcourir les moyennes et tendances de toutes les matières.',
    href: `/parent/subjects?studentId=${encodeURIComponent(input.studentId)}`,
    icon: 'LayoutGrid',
  };
}

function attendanceStep(input: AlertNextStepInput): AlertNextStep {
  return {
    kind: 'attendance',
    label: 'Examiner les absences',
    helper: 'Consulter le détail de l’assiduité et les absences récentes.',
    href: `/parent/attendance?studentId=${encodeURIComponent(input.studentId)}`,
    icon: 'CalendarClock',
  };
}

function childProfileStep(input: AlertNextStepInput): AlertNextStep {
  return {
    kind: 'child-profile',
    label: 'Consulter le profil de l’enfant',
    helper: 'Voir une vue d’ensemble de la scolarité de votre enfant.',
    href: `/parent/children/${encodeURIComponent(input.studentId)}`,
    icon: 'UserRound',
  };
}

/**
 * E7-S1 — the "Trouver un soutien en {matière}" remediation action.
 *
 * A separately-testable, pure derivation (keeps the tested `deriveAlertActions`
 * untouched). The remediation CTA is offered ONLY for a subject-scoped alert code
 * WITH a known subject id — it promotes the alert into a `RemediationPlan` and
 * navigates to the plan page + the filtered catalogue, so without a subject there
 * is nothing to remediate (omitted → no broken/dead-end link). The kind, non-
 * stigmatising label frames it as support being organised, never a deficit.
 */
export interface RemediationAction {
  /** Self-describing French label (WCAG 2.4.4 — names the subject). */
  label: string;
  /** One-line, kind helper. */
  helper: string;
  /** The diagnosed subject id forwarded for the catalogue filter. */
  subjectId: string;
  /** Display label for the subject (name → code → generic fallback). */
  subjectLabel: string;
}

/**
 * Returns the remediation action for an alert, or `null` when it must be omitted
 * (a non-subject-scoped code, or a null subject id — never a dead-end link).
 */
export function deriveRemediationAction(input: AlertNextStepInput): RemediationAction | null {
  if (!SUBJECT_SCOPED.includes(input.code)) return null;
  if (!input.subjectId) return null;
  const subjectLabel = input.subjectName ?? input.subjectCode ?? 'cette matière';
  return {
    label: `Trouver un soutien en ${subjectLabel}`,
    helper:
      'Découvrir le soutien proposé par l’école pour cette matière et suivre les progrès.',
    subjectId: input.subjectId,
    subjectLabel,
  };
}

/**
 * Map an alert to its 1–2 navigation next-steps (most-actionable first),
 * capped at {@link MAX_NAV_STEPS}. The "talk to the teacher" CTA is NOT
 * included here — the component always appends it so the panel never renders
 * empty (FM-8). Guarantees a non-broken, studentId-scoped href for every step.
 */
export function deriveAlertActions(input: AlertNextStepInput): AlertNextStep[] {
  const steps: AlertNextStep[] = [];

  if (SUBJECT_SCOPED.includes(input.code)) {
    // Subject alerts → reinforce the subject (or fall back to the overview).
    steps.push(reinforceSubjectStep(input));
  } else if (input.code === 'HIGH_ABSENCE') {
    // Attendance alerts → look at the absences, not a (null) subject.
    steps.push(attendanceStep(input));
  } else {
    // TEACHER_COMMENT_FLAG / BEHAVIOR_ALERT (and any future non-scoped code):
    // a subject deep-link if we happen to have one, else the child profile.
    steps.push(input.subjectId ? reinforceSubjectStep(input) : childProfileStep(input));
  }

  // Always offer a second, broader navigation step so the panel feels complete
  // — but never duplicate the first step's destination.
  const secondary = input.code === 'HIGH_ABSENCE'
    ? childProfileStep(input)
    : subjectsOverviewStep(input);
  if (!steps.some((s) => s.kind === secondary.kind)) {
    steps.push(secondary);
  }

  return steps.slice(0, MAX_NAV_STEPS);
}
