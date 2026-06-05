import { IsEnum, IsObject, IsOptional, IsUUID } from 'class-validator';

/** Mirrors Prisma `ExportKind` — kept in sync manually. */
export type ExportKindCode =
  | 'grades_xlsx'
  | 'attendance_xlsx'
  | 'enrollment_xlsx'
  | 'report_card_pdf'
  | 'audit_csv';

export const EXPORT_KINDS: ReadonlyArray<ExportKindCode> = [
  'grades_xlsx',
  'attendance_xlsx',
  'enrollment_xlsx',
  'report_card_pdf',
  'audit_csv',
];

/** Default human-readable file-name prefix per kind. */
export const EXPORT_DEFAULT_FILENAME: Record<ExportKindCode, string> = {
  grades_xlsx: 'Notes',
  attendance_xlsx: 'Presences',
  enrollment_xlsx: 'Inscriptions',
  report_card_pdf: 'Bulletins',
  audit_csv: 'Audit',
};

/** Mirrors Prisma `ExportStatus`. */
export type ExportStatusCode = 'pending' | 'running' | 'succeeded' | 'failed';

export class CreateExportDto {
  @IsEnum([
    'grades_xlsx',
    'attendance_xlsx',
    'enrollment_xlsx',
    'report_card_pdf',
    'audit_csv',
  ] as const)
  kind!: ExportKindCode;

  /**
   * Optional scope for the export. Each kind reads what it needs:
   *  - grades_xlsx:       { classSectionId?, academicYearId?, termId? }
   *  - attendance_xlsx:   { classSectionId?, from?, to? }
   *  - enrollment_xlsx:   { academicYearId? }
   *  - report_card_pdf:   { classSectionId, termId }   (mandatory for now)
   *  - audit_csv:         { from?, to? }
   */
  @IsOptional()
  @IsObject()
  parameters?: Record<string, unknown>;

  /** Optional school scope (defaults to the primary school of the requester). */
  @IsOptional()
  @IsUUID()
  schoolId?: string;
}

export interface ExportJobDto {
  id: string;
  kind: ExportKindCode;
  status: ExportStatusCode;
  fileName: string;
  fileUrl: string | null;
  fileSizeBytes: number | null;
  errorMessage: string | null;
  requesterId: string;
  requesterName: string | null;
  parameters: Record<string, unknown>;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/**
 * Parent-scoped export-job view (E4-S2). A deliberately NARROW projection of the
 * generic `ExportJobDto`: the parent never sees another requester's jobs, the raw
 * `errorMessage` is omitted (kind, non-technical copy is rendered client-side),
 * and — critically — `termId`/`studentId` are HOISTED to top-level from the job
 * `parameters` so the response matches `@pilotage/contracts` `ParentExportJobSchema`
 * (the consumer reads them top-level for term-row mapping + status polling).
 */
export interface ParentExportJobDto {
  id: string;
  kind: 'report_card_pdf';
  status: ExportStatusCode;
  fileName: string;
  fileSizeBytes: number | null;
  termId: string | null;
  studentId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/**
 * Teacher-scoped export-job view (E4-S3). A deliberately NARROW projection of the
 * generic `ExportJobDto` for the teacher class grade-grid surface: the teacher
 * only ever sees their OWN `grades_xlsx` jobs (re-scoped to `requestedBy = me`),
 * the raw `errorMessage`/`fileUrl`/requester identity are omitted, and
 * `classSectionId`/`termId` are HOISTED to top-level from the job `parameters` so
 * the gradebook UI can map each job to its (class × term) row + poll status
 * without reaching into the JSONB blob — matching `@pilotage/contracts`
 * `TeacherExportJobSchema`.
 */
export interface TeacherExportJobDto {
  id: string;
  kind: 'grades_xlsx';
  status: ExportStatusCode;
  fileName: string;
  fileSizeBytes: number | null;
  classSectionId: string | null;
  termId: string | null;
  createdAt: string;
  finishedAt: string | null;
}

/** BullMQ job payload — the API enqueues, the worker consumes. */
export interface ExportJobPayload {
  exportJobId: string;
  tenantId: string;
  schoolId: string | null;
  kind: ExportKindCode;
  parameters: Record<string, unknown>;
  requestedBy: string;
}
