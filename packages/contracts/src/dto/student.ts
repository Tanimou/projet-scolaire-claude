import { z } from 'zod';

import { UuidSchema } from './common';

/**
 * Student Portal — E8 (the fourth, read-only learner audience).
 *
 * These shapes back the `/api/v1/student/*` aggregate endpoints. Every student
 * read is server-resolved to the caller's OWN dossier (`Student.userProfileId ===
 * me.id`); there is no `:studentId` path param to tamper with, and the
 * student-self ABAC denies any peer.
 *
 * RGPD / non-stigmatising wall — the peer-comparison wall lives in the PAYLOAD
 * SHAPE, not just the UI (the E4 `ParentExportJobDto` narrowing precedent). These
 * DTOs **structurally lack** every peer-relative field — no `studentRank`,
 * `classAverage`, `classRankTotal`, `classSize` — and expose a strict SUBSET of
 * what the parent sees of that child: no `medicalNotes`, no discipline, no draft
 * grades, no guardian-private field can ever appear here. See
 * docs/adr/ADR-021-student-role-and-self-abac.md.
 */

/**
 * The learner's own identity header (S1). Deliberately minimal — first/last name
 * + the current class section label for the header chip ("Mes notes · 4ᵉ B").
 * No birthDate/email/address/medicalNotes/guardian field. `classSectionName` is
 * null when the student has no active enrollment.
 */
export const StudentHeaderSchema = z.object({
  id: UuidSchema,
  firstName: z.string(),
  lastName: z.string(),
  classSectionName: z.string().nullable(),
});
export type StudentHeader = z.infer<typeof StudentHeaderSchema>;

/**
 * `GET /student/me` — the activation gate + header identity (S1).
 *
 * `activated` is `false` when the caller's account has no linked `Student` (the
 * kind "compte non rattaché" empty state, scenario 7) — `student` is then null.
 * Never a 500, never another student's data.
 */
export const StudentMeResponseSchema = z.object({
  student: StudentHeaderSchema.nullable(),
  activated: z.boolean(),
});
export type StudentMeResponse = z.infer<typeof StudentMeResponseSchema>;

/**
 * One published grade row in "Mes notes" (S1) — the learner's own grade for one
 * assessment, framed first-person/kind. Only `published`/`revised` grades reach
 * the student (no draft). `value` is null for an absence. The teacher's comment
 * is shown verbatim. NO peer-relative field, NO subjectRank, NO classAverage.
 */
export const StudentGradeRowSchema = z.object({
  id: UuidSchema,
  subjectId: UuidSchema,
  subjectName: z.string(),
  subjectColor: z.string().nullable(),
  assessmentId: UuidSchema,
  assessmentTitle: z.string(),
  /**
   * The assessment kind code (e.g. `written_test`, `homework`) — the learner's
   * OWN assessment type, rendered as a French label in the UI. A flat scalar,
   * NOT peer-relative, so it does not breach the non-stigmatising wall.
   */
  kind: z.string(),
  /**
   * Publication status of THIS grade. Only `published`/`revised` ever reach the
   * learner (never a draft); `revised` lets the UI flag a corrected note. The
   * learner's own datum — no peer figure.
   */
  status: z.enum(['published', 'revised']),
  /** The grade value (over `maxScore`), null when the learner was absent. */
  value: z.number().nullable(),
  maxScore: z.number(),
  isAbsent: z.boolean(),
  /** Effective coefficient for this assessment (assessment override → subject default). */
  coefficient: z.number().nullable(),
  /** The teacher's comment, verbatim and optional (kind framing, never a verdict). */
  comment: z.string().nullable(),
  termId: UuidSchema.nullable(),
  termName: z.string().nullable(),
  scheduledAt: z.string().nullable(),
});
export type StudentGradeRow = z.infer<typeof StudentGradeRowSchema>;

/**
 * `GET /student/grades` — "Mes notes" (S1). The caller's own published grades,
 * one flat list (the UI groups by subject). Structurally lacks every peer figure.
 */
export const StudentGradesResponseSchema = z.object({
  data: z.array(StudentGradeRowSchema),
});
export type StudentGradesResponse = z.infer<typeof StudentGradesResponseSchema>;

/**
 * One upcoming assessment in "À venir" (S2) — an assessment scheduled for the
 * learner's own class section in the coming weeks, framed forward/kind. Produced
 * by `AnalyticsService.parentUpcoming` re-scoped to the self-resolved studentId.
 * A flat scalar shape: NO classAverage, NO rank, NO peer field.
 */
export const StudentUpcomingRowSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  description: z.string().nullable(),
  /** ISO datetime — the producer always returns a date (scheduledAt ?? createdAt). */
  scheduledAt: z.string(),
  /** The assessment kind code (e.g. `written_test`) → a French label in the UI. */
  kind: z.string(),
  maxScore: z.number(),
  coefficient: z.number(),
  subjectId: UuidSchema,
  subjectCode: z.string().nullable(),
  subjectName: z.string(),
  subjectColor: z.string().nullable(),
  termId: UuidSchema.nullable(),
  termName: z.string().nullable(),
});
export type StudentUpcomingRow = z.infer<typeof StudentUpcomingRowSchema>;

/**
 * `GET /student/upcoming` — "Mes prochaines évaluations" (S2). The caller's own
 * upcoming assessments, soonest-first. `classSectionName`/`gradeLevelName` label
 * the learner's own class; `data` is empty for an unlinked / un-enrolled caller.
 */
export const StudentUpcomingResponseSchema = z.object({
  classSectionName: z.string().nullable(),
  gradeLevelName: z.string().nullable(),
  data: z.array(StudentUpcomingRowSchema),
});
export type StudentUpcomingResponse = z.infer<typeof StudentUpcomingResponseSchema>;

/**
 * One of the learner's own attendance records in "Mon assiduité" (S2). A strict
 * SUBSET of what staff/parents see: status + the learner's own justification +
 * the session date + subject/class label. Deliberately carries NO actor metadata
 * (`recordedBy`/`justifiedBy`/staff comment) — RGPD minimisation (the data
 * subject reads only the factual record, never who flagged it).
 */
export const StudentAttendanceRecordSchema = z.object({
  id: UuidSchema,
  /** present | absent | absent_excused | late | left_early. */
  status: z.string(),
  justification: z.string().nullable(),
  /** ISO date of the class session. */
  date: z.string(),
  subjectName: z.string().nullable(),
  subjectColor: z.string().nullable(),
  classSectionName: z.string().nullable(),
});
export type StudentAttendanceRecord = z.infer<typeof StudentAttendanceRecordSchema>;

/**
 * Factual attendance counts for "Mon assiduité" (S2) — stated, never a verdict,
 * never a peer comparison. All zero for an unlinked caller.
 */
export const StudentAttendanceSummarySchema = z.object({
  total: z.number(),
  present: z.number(),
  absent: z.number(),
  absentExcused: z.number(),
  late: z.number(),
  leftEarly: z.number(),
});
export type StudentAttendanceSummary = z.infer<typeof StudentAttendanceSummarySchema>;

/**
 * `GET /student/attendance` — "Mon assiduité" (S2). The caller's own attendance
 * summary + recent records (bounded). Structurally lacks every peer-relative and
 * actor-metadata field.
 */
export const StudentAttendanceResponseSchema = z.object({
  summary: StudentAttendanceSummarySchema,
  records: z.array(StudentAttendanceRecordSchema),
});
export type StudentAttendanceResponse = z.infer<typeof StudentAttendanceResponseSchema>;
