import { type ImportMode } from '@prisma/client';

/**
 * The BullMQ `imports` queue producer/consumer contract (E11-S1).
 * Defined ONCE here and imported on BOTH sides — the API producer
 * (`ImportsService`) and the worker consumer (`ImportsProcessor`) — the
 * `ExportJobPayload` mirror precedent, but shared (no fork).
 *
 * `tenantId`/`schoolId`/`actorId` travel in the payload because the worker has
 * no request-scoped JWT/RLS context; every worker query re-scopes on
 * `tenantId` (ADR-002 defence-in-depth, ADR-024 §AC-7).
 */
export interface ImportJobPayload {
  batchId: string;
  kind: 'apply' | 'rollback';
  mode: ImportMode;
  tenantId: string;
  schoolId: string;
  actorId: string;
}
