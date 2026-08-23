/** Enums partagés client/serveur — alignés avec docs/spec/data-model.md */

export const PORTALS = ['admin', 'teacher', 'parent'] as const;
export type Portal = (typeof PORTALS)[number];

export const REALM_ROLES = ['super_admin', 'school_admin', 'teacher', 'parent'] as const;
export type RealmRole = (typeof REALM_ROLES)[number];

export const TENANT_STATUS = ['active', 'suspended', 'archived'] as const;
export const SCHOOL_STATUS = ['active', 'closed'] as const;
export const YEAR_STATUS = ['active', 'closed', 'archived'] as const;
export const CLASS_STATUS = ['active', 'closed'] as const;
export const USER_STATUS = ['active', 'suspended', 'deleted'] as const;
export const STUDENT_STATUS = ['active', 'transferred', 'graduated'] as const;

export const GUARDIANSHIP_RELATIONSHIP = ['mother', 'father', 'legal_guardian', 'other'] as const;
export const GUARDIANSHIP_STATUS = ['pending', 'approved', 'rejected', 'revoked'] as const;

export const ENROLLMENT_STATUS = ['pending', 'active', 'transferred', 'cancelled'] as const;

export const ASSIGNMENT_ROLES = ['principal', 'assistant', 'subject_teacher'] as const;
export type AssignmentRole = (typeof ASSIGNMENT_ROLES)[number];

export const ASSESSMENT_TYPE = ['homework', 'quiz', 'test', 'exam', 'composition'] as const;
export const ASSESSMENT_VISIBILITY = ['hidden', 'parent_visible'] as const;

export const RESULT_STATUS = [
  'draft',
  'published',
  'revised',
  'cancelled',
  'absent',
  'exempt',
  'missing',
] as const;

export const TREND = ['up', 'stable', 'down'] as const;
export const RISK_LEVEL = ['low', 'medium', 'high'] as const;
export const ALERT_SEVERITY = ['low', 'medium', 'high'] as const;
export const ALERT_STATUS = ['open', 'acknowledged', 'resolved', 'dismissed'] as const;

export const ALERT_RULE_CODE = [
  'LOW_SUBJECT_AVG',
  'NEGATIVE_TREND',
  'REPEATED_FAILURE',
  'MISSING_ASSESSMENT',
  'HIGH_ABSENCE',
  'TEACHER_COMMENT_FLAG',
  'BEHAVIOR_ALERT',
  'IMPROVEMENT',
] as const;

export const ATTENDANCE_STATUS = ['present', 'absent', 'late', 'excused', 'exempt'] as const;

export const NOTIFICATION_CHANNEL = ['email', 'push', 'sms', 'in_app'] as const;
export const NOTIFICATION_FREQUENCY = ['instant', 'daily', 'weekly', 'never'] as const;

// E5-S2 — per-(user, kind) email cadence on NotificationPreference. Composes with
// the channel booleans: `instant` = today's per-event email (default), `daily_digest`
// = suppress the per-event email & bundle into one grouped email/day (the
// notifications-digest cron), `off` = mute this kind's email entirely. Mirrors the
// Prisma `NotificationCadence` enum 1:1 so client + server share one source of truth.
export const NOTIFICATION_CADENCE = ['instant', 'daily_digest', 'off'] as const;
export type NotificationCadence = (typeof NOTIFICATION_CADENCE)[number];

// S-E05-17 / ADR-067 §D1 — LE SEUL DE CE FICHIER QUI N'EST **PAS** UN MIROIR 1:1.
//
// ATTENTION, LIRE AVANT D'AJOUTER UNE VALEUR ICI. Tous ses voisins mirroitent
// leur enum Prisma à l'identique ; celui-ci est délibérément un SOUS-ENSEMBLE :
// 8 des 9 valeurs de l'enum Prisma `NotificationKind`. La 9e, `remediation`, est
// RETENUE — `NotificationPreferencesService.listForUser` ne rend que cette
// liste, donc `GET /api/v1/notifications/preferences` ne renvoie JAMAIS
// `remediation` : accepter un PATCH dessus ecrit une ligne que l'utilisateur ne
// peut ni voir ni annuler (PF-314, mesure en 200 sur la pile locale).
//
// Ajouter `remediation` ici pour « faire coller a Prisma » ROUVRE PF-314. La
// bonne correction, le jour ou le canal soutien scolaire merite un reglage, est
// d'exposer AUSSI la ligne dans l'UI de preferences — pas d'elargir cette liste
// seule. Le cote API reprouve le sous-ensemble a la compilation via
// `NOTIFICATION_KINDS: ReadonlyArray<NotificationKind>`, et
// `WITHHELD_NOTIFICATION_KINDS` (derive de la carte de libelles, exhaustive sur
// l'enum) force une decision explicite des qu'une valeur Prisma s'ajoute.
//
// ORDRE SIGNIFIANT — c'est l'ordre de rendu de la page Reglages (`listForUser`
// mappe sur cette liste), pas un ensemble :
//   - E2-S1 — messagerie parent <-> enseignant : un kind PAR EVENEMENT (nouveau
//     message dans un fil), donc il se range avec les autres kinds par
//     evenement, AVANT le digest.
//   - E1-S4 — `weekly_digest` reste EN DERNIER pour que le digest se lise comme
//     un concept « recapitulatif » distinct, apres les kinds par evenement.
//     Opt-in email uniquement (`emailEnabled` par defaut `false`).
export const NOTIFICATION_KIND = [
  'announcement',
  'alert',
  'grade_published',
  'enrollment_status',
  'lesson_published',
  'system',
  'message',
  'weekly_digest',
] as const;
// Nomme `NotificationKindCode` et NON `NotificationKind` : les deux sites qui le
// consomment importent deja le type Prisma `NotificationKind`, et ce nom est
// celui que la copie web emploie deja (PF-316), pour que la deduplication future
// soit un simple echange d'import.
export type NotificationKindCode = (typeof NOTIFICATION_KIND)[number];

// E6 — Analytics Snapshots & pre-computation. Mirrors the Prisma
// `SnapshotTriggerReason` / `SnapshotTriggerStatus` enums 1:1 (same pattern as
// NOTIFICATION_CADENCE above) so client + server share one source of truth for the
// snapshot-recompute dirty-queue. `SNAPSHOT_SOURCE` is the freshness-signal source
// surfaced on the (later-slice) `freshness` block: 'snapshot' = served from the
// materialised cache, 'live' = fall-through to the live AnalyticsService computation.
export const SNAPSHOT_TRIGGER_REASON = [
  'grade_published',
  'grade_revised',
  'coefficient_changed',
  'manual_rebuild',
  'backfill',
] as const;
export type SnapshotTriggerReason = (typeof SNAPSHOT_TRIGGER_REASON)[number];

export const SNAPSHOT_TRIGGER_STATUS = ['pending', 'processing', 'done', 'failed'] as const;
export type SnapshotTriggerStatus = (typeof SNAPSHOT_TRIGGER_STATUS)[number];

export const SNAPSHOT_SOURCE = ['snapshot', 'live'] as const;
export type SnapshotSource = (typeof SNAPSHOT_SOURCE)[number];

// E7 — Remediation & Tutoring loop. Each mirrors the Prisma enum 1:1 (same
// pattern as NOTIFICATION_CADENCE / SNAPSHOT_* above) so client + server share one
// source of truth for the catalogue + plan + booking surfaces.
//  - TUTOR_TYPE       : a teacher tutor / external named partner / peer programme.
//  - TUTOR_COST_KIND  : a DISPLAY LABEL only — NEVER a price (ADR-018 finance isolation).
//  - AVAILABILITY_KIND: a repeating weekday slot vs a single dated one-off.
//  - REMEDIATION_PLAN_STATUS / BOOKING_STATUS: the two small append-only state machines.
export const TUTOR_TYPE = ['teacher', 'external', 'peer'] as const;
export type TutorType = (typeof TUTOR_TYPE)[number];

export const TUTOR_COST_KIND = ['free', 'volunteer', 'paid_offline'] as const;
export type TutorCostKind = (typeof TUTOR_COST_KIND)[number];

export const AVAILABILITY_KIND = ['recurring_weekly', 'one_off'] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KIND)[number];

export const REMEDIATION_PLAN_STATUS = ['open', 'met', 'closed'] as const;
export type RemediationPlanStatus = (typeof REMEDIATION_PLAN_STATUS)[number];

export const BOOKING_STATUS = [
  'requested',
  'confirmed',
  'completed',
  'cancelled',
  'declined',
  'proposed_alternative',
] as const;
export type BookingStatus = (typeof BOOKING_STATUS)[number];

export const IMPORT_TYPE = ['students', 'teachers', 'classes', 'grades', 'attendance', 'parents'] as const;
export const IMPORT_STATUS = [
  'uploaded',
  'validated',
  'previewed',
  'applying',
  'applied',
  'failed',
  'rolled_back',
] as const;
export const IMPORT_MODE = ['all_or_nothing', 'skip_invalid'] as const;
