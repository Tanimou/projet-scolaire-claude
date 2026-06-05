import { z } from 'zod';

import { UuidSchema } from './common';

/**
 * Parent self-service exports — E4-S2.
 *
 * A guardian one-clicks "download my child's term bulletin". The parent-scoped
 * surface (POST /api/v1/parent/exports/bulletin, GET /api/v1/parent/exports,
 * GET /api/v1/parent/exports/:id[/download-url]) enqueues the EXISTING
 * `report_card_pdf` worker generator scoped to a single, guardianship-checked
 * `{ studentId, termId }` — never the admin-only `exports.execute` surface.
 *
 * The input is intentionally minimal: the server derives `classSectionId` and
 * `academicYearId` from the student's active enrollment (never trusted from the
 * client) to prevent IDOR / class-roster leakage. See the E4-S2 architect ruling.
 *
 * These shapes mirror the API's `ExportsService.toDto` output and the existing
 * `ExportKindCode` / status model already shipped for the admin exports surface
 * (apps/api/src/modules/exports/exports.types.ts) — no schema change.
 */
export const CreateParentBulletinInputSchema = z.object({
  studentId: UuidSchema,
  termId: UuidSchema,
});
export type CreateParentBulletinInput = z.infer<typeof CreateParentBulletinInputSchema>;

/** Mirrors the admin export status model (BullMQ job lifecycle). */
export const PARENT_EXPORT_STATUS = ['pending', 'running', 'succeeded', 'failed'] as const;
export type ParentExportStatus = (typeof PARENT_EXPORT_STATUS)[number];

/**
 * A parent-visible export-job view (the caller's own `report_card_pdf` jobs).
 * Mirrors `ExportsService.toDto` but is deliberately narrow: a parent never sees
 * another requester's jobs, and the raw `errorMessage` is omitted from the
 * parent surface (kind, non-technical failure copy is rendered client-side).
 */
export const ParentExportJobSchema = z.object({
  id: UuidSchema,
  kind: z.literal('report_card_pdf'),
  status: z.enum(PARENT_EXPORT_STATUS),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nullable(),
  /** The term this bulletin was generated for (echoed from the job parameters). */
  termId: UuidSchema.nullable(),
  studentId: UuidSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type ParentExportJob = z.infer<typeof ParentExportJobSchema>;

/**
 * Teacher self-service class grade-grid exports — E4-S3.
 *
 * A teacher one-clicks "Exporter la grille" from their gradebook. The
 * teacher-scoped surface (POST /api/v1/teacher/exports/grade-grid,
 * GET /api/v1/teacher/exports, GET /api/v1/teacher/exports/:id[/download-url])
 * enqueues the EXISTING `grades_xlsx` worker generator scoped to a single,
 * teaching-assignment-checked `{ classSectionId, termId? }` — never the
 * admin-only `exports.execute` nor the parent `exports.execute.parent` surface.
 *
 * The input is intentionally minimal: the server derives `classSectionId` from
 * the teaching assignment the caller is verified to OWN (never trusted from the
 * client) to prevent IDOR / foreign-class export. See the E4-S3 architect ruling.
 *
 * These shapes mirror the API's narrow `ExportsService.toTeacherDto` output and
 * the existing status model already shipped for the admin/parent surfaces — no
 * schema change.
 */
export const CreateTeacherGradeGridInputSchema = z.object({
  teachingAssignmentId: UuidSchema,
  termId: UuidSchema.optional(),
});
export type CreateTeacherGradeGridInput = z.infer<
  typeof CreateTeacherGradeGridInputSchema
>;

/**
 * A teacher-visible export-job view (the caller's own `grades_xlsx` jobs).
 * Mirrors the parent narrow shape but for an XLSX class grid: `classSectionId`
 * and `termId` are hoisted top-level (echoed from the job parameters), and the
 * raw `errorMessage`/`fileUrl`/requester identity are omitted from the surface.
 */
export const TeacherExportJobSchema = z.object({
  id: UuidSchema,
  kind: z.literal('grades_xlsx'),
  status: z.enum(PARENT_EXPORT_STATUS),
  fileName: z.string(),
  fileSizeBytes: z.number().int().nullable(),
  /** The class section this grid was generated for (echoed from the job parameters). */
  classSectionId: UuidSchema.nullable(),
  /** The term scope when one was selected, else null = whole-year grid. */
  termId: UuidSchema.nullable(),
  createdAt: z.string(),
  finishedAt: z.string().nullable(),
});
export type TeacherExportJob = z.infer<typeof TeacherExportJobSchema>;
