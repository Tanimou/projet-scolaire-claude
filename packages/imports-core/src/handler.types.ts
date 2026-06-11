import { ImportType, Prisma } from '@prisma/client';

/**
 * Context passed to every handler step. Pre-loaded lookups make validation O(1).
 */
export interface ImportContext {
  tenantId: string;
  schoolId: string;
  caches: ImportCaches;
}

export interface ApplyContext extends ImportContext {
  tx: Prisma.TransactionClient;
}

export interface RollbackContext {
  tx: Prisma.TransactionClient;
  tenantId: string;
}

/** Cached lookups built once per batch — avoids N+1 queries during validation. */
export interface ImportCaches {
  gradeLevelsByCode: Map<string, { id: string; name: string }>;
  gradeLevelsByName: Map<string, { id: string; name: string; code: string }>;
  classNamesPerYearLevel: Set<string>; // "<academicYearId>:<gradeLevelId>:<name>"
  classSectionsByName: Map<string, { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }>;
  subjectsByCode: Map<string, { id: string; name: string }>;
  studentExternalRefs: Map<string, string>; // externalRef → student.id
  guardiansByEmail: Map<string, { id: string; firstName: string; lastName: string }>;
  activeAcademicYearId: string | null;
}

export interface RowError {
  field?: string;
  message: string;
  hint?: string;
}

export interface ValidationResult {
  ok: boolean;
  errors: RowError[];
  /** Normalised, ready-to-apply payload (post-trim, lookup IDs resolved, etc). */
  normalized?: Record<string, unknown>;
}

export interface AppliedEntity {
  id: string;
  type: string;
}

export interface ImportTemplate {
  headers: string[];
  /** Example rows — used in the downloadable template + UI preview. */
  sample: string[][];
  notes?: string[];
}

export interface ImportHandler {
  type: ImportType;
  label: string;
  description: string;
  /** Lucide icon name (rendered in the UI). */
  icon: string;
  /** Permission required to run this import. */
  requiredPermission: string;
  template: ImportTemplate;

  /**
   * Map a raw CSV row (strings, headers trimmed/lowered) → typed input.
   * No DB lookups here — just structural normalisation.
   */
  parseRow(row: Record<string, string>): Record<string, unknown>;

  /**
   * Validate the parsed row against schema + business rules + foreign-key lookups via ctx.caches.
   * Pure (no writes). Returns the normalized payload to apply later.
   */
  validateRow(parsed: Record<string, unknown>, ctx: ImportContext): ValidationResult;

  /**
   * Persist the row. Called inside a transaction. Must return the new entity id + type.
   * Mutates ctx.caches so duplicate detection across rows of the same batch works.
   */
  applyRow(normalized: Record<string, unknown>, ctx: ApplyContext): Promise<AppliedEntity>;

  /** Compensate the apply — called by rollback. Must be idempotent. */
  rollbackRow(entityId: string, ctx: RollbackContext): Promise<void>;
}
