import { ImportType, Prisma, ReconciliationClass } from '@prisma/client';

export { ReconciliationClass };

/**
 * E11-S2 — one entry of a `conflict` row's source-vs-current diff, recorded in
 * `ImportRow.conflictFields`. An allow-list of identity fields only (never
 * notes/free-text/medical); `current` is the value already on the existing
 * entity, `source` is the value the import row proposes. Rendered side-by-side
 * by the "Bilan d'import & synchronisation" panel — never silently resolved.
 */
export interface ConflictField {
  field: string;
  current: string | null;
  source: string | null;
}

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
  /**
   * E11 polish (#5 follow-on iii) — the `<academicYearId>:<name>` keys that map
   * to MORE THAN ONE grade level's class (a class name is unique only PER
   * `(academicYearId, gradeLevelId)`, not per year). An enrollments row carries
   * only `className` (no grade level), so for an ambiguous name the
   * `classSectionsByName` entry is an arbitrary last-write-wins pick and MUST NOT
   * be trusted — the handler surfaces a clear French 4xx instead of silently
   * enrolling the student into the wrong grade level's class. Empty for the
   * common unambiguous case (byte-identical behaviour).
   */
  classSectionsByNameAmbiguous: Set<string>; // "<academicYearId>:<name>" present in >1 grade level
  subjectsByCode: Map<string, { id: string; name: string }>;
  studentExternalRefs: Map<string, string>; // externalRef → student.id
  /**
   * E11-S2 — the EXISTING student's reconcilable fields keyed by externalRef, so
   * the students handler can classify a matched re-import as unchanged/updated/
   * conflict (FR3) without an extra per-row query (no N+1). Protected fields
   * (firstName/lastName/birthDate) drive `conflict`; email/notes drive `updated`.
   * Built once per batch from the same `student.findMany` that builds
   * `studentExternalRefs`.
   */
  studentsByExternalRef: Map<
    string,
    {
      id: string;
      firstName: string;
      lastName: string;
      birthDate: Date | null;
      email: string | null;
      notes: string | null;
    }
  >;
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
  /**
   * E11-S2 — which reconciliation class this apply took (ADR-024 §reconciliation).
   * ADDITIVE + optional: a handler that returns the old `{ id, type }` shape is
   * treated by the engine as `created` (byte-parity — the 4 always-create handlers
   * compile unchanged and default to `created`). The students handler (FR3) reports
   * `updated`/`unchanged`, and `guardians` reports created/updated/unchanged from
   * its existing upsert.
   */
  reconciliation?: ReconciliationClass;
  /**
   * E11-S2 — a `conflict` row's protected-field disagreement (FR4). When a handler
   * returns `reconciliation: 'conflict'`, it writes NO entity (id is a sentinel/the
   * existing id) and the engine keeps the row OUT of the `applied` set, records
   * `conflictFields`, and counts it under `byClass.conflict`. No silent overwrite.
   */
  conflictFields?: ConflictField[];
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

  /**
   * E11-S4 — resolve a `conflict` row the admin arbitrated in the panel
   * (keep-current / take-source). Called inside a transaction with the row's
   * NORMALISED payload (the source values) and the admin's decision; the handler
   * re-resolves the matched entity (tenant-scoped, by its idempotency anchor),
   * applies the choice, and returns the post-resolution class + the matched
   * entity id so the engine/service can flip the row to `applied` with the right
   * `createdEntityId` (a PRE-EXISTING entity — so the S2 rollback-safety invariant
   * keeps it out of the delete set). OPTIONAL: only handlers that emit `conflict`
   * (students in v1) implement it; the service rejects a resolve on a type whose
   * handler omits it. NEVER a silent overwrite — the only path that writes a
   * protected field is an explicit `take_source` decision, audited by the caller.
   */
  resolveConflict?(
    payload: Record<string, unknown>,
    decision: ConflictDecision,
    ctx: ApplyContext,
  ): Promise<ConflictResolution>;
}

/** The admin's arbitration choice on a `conflict` row (E11-S4). */
export type ConflictDecision = 'keep_current' | 'take_source';

/** The outcome of resolving a `conflict` row (E11-S4). */
export interface ConflictResolution {
  /** The matched, pre-existing entity id (used as `createdEntityId` for bookkeeping). */
  entityId: string;
  type: string;
  /**
   * Post-resolution class: `keep_current` → `unchanged` (nothing written);
   * `take_source` → `updated` (the source values were written). Never `created`
   * (a conflict always matched an existing entity) and never `conflict` (the
   * arbitration is the terminal decision).
   */
  reconciliation: 'unchanged' | 'updated';
}
