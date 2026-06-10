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
