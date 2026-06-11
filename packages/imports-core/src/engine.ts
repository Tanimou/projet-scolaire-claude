import { ImportMode, ImportRowStatus, Prisma, ReconciliationClass } from '@prisma/client';

import { type ConflictField, type ImportCaches, type ImportHandler } from './handler.types';

/**
 * The ONE apply/rollback engine — relocated verbatim from
 * `apps/api/src/modules/imports/imports.service.ts` so the API (validate path,
 * historically) and the worker (async apply path, E11-S1) share a single
 * implementation. No forked apply loop exists (architect ADR-024 R4).
 *
 * These functions are framework-agnostic: they take a Prisma transaction client
 * and pure data, run the SAME per-row `handler.applyRow`/`rollbackRow`, write the
 * SAME `import.apply`/`import.rollback` audit row, and return the SAME counts.
 *
 * The byte-parity invariant (AC-1/AC-6): for identical input, the worker apply
 * produces byte-equivalent created/skipped counts, per-row `createdEntityId`/
 * `createdEntityType`, and the same audit row as the original in-request apply.
 */

/** A loaded import row — the subset the engine needs. */
export interface EngineRow {
  id: string;
  rowIndex: number;
  status: ImportRowStatus;
  payload: unknown;
  createdEntityId: string | null;
  /**
   * E11-S2 — the reconciliation class already stored on this row (if any). On a
   * RESUME (a redelivered/re-claimed job) an already-`applied` row carries its
   * class so the `byClass` roll-up is re-derived faithfully instead of being
   * lost (FM-2/FM-10). Null on a fresh row.
   */
  reconciliation?: ReconciliationClass | null;
}

/**
 * E11-S2 — the per-class tally rolled into the batch `summary.byClass` and the
 * `import.apply` audit `after` JSON (FR5/FR9). Additive — the original
 * `{ applied, skipped }` contract is preserved byte-identically.
 */
export interface ReconciliationTally {
  created: number;
  updated: number;
  unchanged: number;
  conflict: number;
  skipped: number;
  /**
   * Index signature so the tally is structurally a Prisma JSON object — it is
   * written verbatim into the `summary`/audit `after` Json columns (worker +
   * engine) and plain `number` values are valid JSON. Without it the interface
   * is not assignable to `Prisma.InputJsonObject` (no index signature) and every
   * write site would need an `as unknown as InputJsonValue` cast.
   */
  [key: string]: number;
}

function emptyTally(): ReconciliationTally {
  return { created: 0, updated: 0, unchanged: 0, conflict: 0, skipped: 0 };
}

export interface ApplyActor {
  id: string;
  tenantId: string;
}

export interface ApplyEngineArgs {
  tx: Prisma.TransactionClient;
  handler: ImportHandler;
  rows: EngineRow[];
  caches: ImportCaches;
  schoolId: string;
  actor: ApplyActor;
  mode: ImportMode;
  batch: { id: string; type: string };
  /**
   * Optional per-row progress callback (E11-S1 FR7). Called after each row is
   * persisted (applied OR skipped) so the worker can flush incremental
   * `summary` progress. Best-effort — a throw here aborts the transaction.
   */
  onRowProcessed?: (counts: { applied: number; skipped: number; processedRows: number }) => Promise<void> | void;
}

export interface ApplyEngineResult {
  applied: number;
  skipped: number;
  /** E11-S2 — the per-class reconciliation roll-up (additive). */
  byClass: ReconciliationTally;
}

/**
 * Apply the valid rows of a batch inside the caller-supplied transaction.
 *
 * Per-row RESUME (E11-S1 FR5, ADR-024 core): a row already `applied` with a
 * non-null `createdEntityId` is SKIPPED (never re-applied) — so a redelivered /
 * re-claimed job converges to `applied|failed` exactly once with no duplicate
 * entity created. The original in-request path passes only freshly-`valid` rows,
 * so this guard is a no-op there (byte-parity preserved); the worker path may
 * re-load rows after a crash, where the guard makes resume safe.
 *
 * The audit row + per-row status writes happen in the SAME transaction as the
 * entity inserts (AC-7 — append-only, tenant-scoped, atomic).
 */
export async function applyBatchRows(args: ApplyEngineArgs): Promise<ApplyEngineResult> {
  const { tx, handler, rows, caches, schoolId, actor, mode, batch, onRowProcessed } = args;
  let applied = 0;
  let skipped = 0;
  let processedRows = 0;
  const byClass = emptyTally();

  const apCtx = {
    tenantId: actor.tenantId,
    schoolId,
    caches,
    tx,
  };

  for (const row of rows) {
    // RESUME: a row already applied with a created entity is never re-applied.
    // Re-tally its stored reconciliation class (default `created` — the byte-parity
    // legacy class) so the `byClass` roll-up survives a redelivery (FM-2/FM-10).
    if (row.status === ImportRowStatus.applied && row.createdEntityId) {
      applied++;
      byClass[resumeClass(row.reconciliation)]++;
      processedRows++;
      if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
      continue;
    }
    if (row.status === ImportRowStatus.invalid) {
      await tx.importRow.update({
        where: { id: row.id },
        data: { status: ImportRowStatus.skipped, reconciliation: ReconciliationClass.skipped },
      });
      skipped++;
      byClass.skipped++;
      processedRows++;
      if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
      continue;
    }
    if (row.status !== ImportRowStatus.valid) continue;
    try {
      const result = await handler.applyRow(row.payload as Record<string, unknown>, apCtx);
      // A handler that returns the legacy `{ id, type }` shape defaults to
      // `created` — the 4 always-create handlers stay byte-parity (FR10/FM-3).
      const recon = result.reconciliation ?? ReconciliationClass.created;

      if (recon === ReconciliationClass.conflict) {
        // FR4 — a protected-field disagreement is recorded but NEVER written:
        // the row stays `valid` (not `applied`), no createdEntityId, with the
        // side-by-side diff in conflictFields. Surfaced by S2, resolved in S4.
        await tx.importRow.update({
          where: { id: row.id },
          data: {
            reconciliation: ReconciliationClass.conflict,
            conflictFields: (result.conflictFields ?? []) as unknown as Prisma.InputJsonValue,
          },
        });
        byClass.conflict++;
        processedRows++;
        if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
        continue;
      }

      await tx.importRow.update({
        where: { id: row.id },
        data: {
          status: ImportRowStatus.applied,
          createdEntityId: result.id,
          createdEntityType: result.type,
          reconciliation: recon,
        },
      });
      applied++;
      // An applied row is created/updated/unchanged. Any other value from a
      // handler (defensive) is normalised to `created` so `applied` and the
      // `byClass` roll-up can never disagree.
      const appliedClass =
        recon === ReconciliationClass.updated
          ? 'updated'
          : recon === ReconciliationClass.unchanged
            ? 'unchanged'
            : 'created';
      byClass[appliedClass]++;
    } catch (err) {
      throw new Error(`Ligne ${row.rowIndex} : ${(err as Error).message}`);
    }
    processedRows++;
    if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
  }

  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.id,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'import.apply',
      resourceType: 'import_batch',
      resourceId: batch.id,
      // FR9 — the existing single audit row gains the byClass counts in `after`
      // (append-only, no new audit action). `applied`/`skipped`/`type`/`mode`
      // stay byte-identical to before S2.
      after: { type: batch.type, applied, skipped, mode, byClass } as Prisma.InputJsonValue,
    },
  });

  return { applied, skipped, byClass };
}

/** Map a stored reconciliation class onto the resume tally bucket (legacy → created). */
function resumeClass(
  recon: ReconciliationClass | null | undefined,
): 'created' | 'updated' | 'unchanged' {
  if (recon === ReconciliationClass.updated) return 'updated';
  if (recon === ReconciliationClass.unchanged) return 'unchanged';
  return 'created';
}

export type { ConflictField };

export interface RollbackEngineArgs {
  tx: Prisma.TransactionClient;
  handler: ImportHandler;
  rows: EngineRow[];
  actor: ApplyActor;
  batch: { id: string; type: string };
}

export interface RollbackEngineResult {
  undone: number;
}

/**
 * Reverse-order compensation of an applied batch inside the caller-supplied
 * transaction. Calls `handler.rollbackRow` per applied row (idempotent), flips
 * each row to `rolled_back`, and writes ONE append-only `import.rollback` audit
 * row. RESUME-safe: a row already `rolled_back` carries no `createdEntityId` in
 * the filtered set, so a redelivered rollback never double-compensates.
 *
 * E11-S2 SAFETY INVARIANT (the load-bearing fix): rollback may ONLY undo rows
 * the import actually CREATED. Before S2, an externalRef match was a hard
 * `invalid` reject, so every `applied` row with a `createdEntityId` was a row
 * THIS import created — deleting it was correct. S2 broke that: an `updated` or
 * `unchanged` row is now `applied` with `createdEntityId = existing.id`, where
 * `existing` is a PRE-EXISTING student matched by externalRef. Deleting it would
 * cascade-wipe a real child's enrollments/grades/guardianships/attendance/alerts
 * (all `onDelete: Cascade` on Student) — irreversible RGPD-significant data loss
 * triggered by the panel's advertised "safe" 24h rollback after an idempotent
 * re-import or an email/notes update. So we EXCLUDE matched rows: only
 * `created` (or legacy/byte-parity `null` = pre-S2 always-create) rows are
 * compensated. `updated`/`unchanged` rows are flipped to `rolled_back` for
 * bookkeeping WITHOUT touching the pre-existing entity (we never created it,
 * and S2 does not capture the prior email/notes value to revert — a non-goal
 * here; the safe behaviour is to leave the matched entity intact). `conflict`
 * rows never reach this set (no `createdEntityId`).
 */
export async function rollbackBatchRows(args: RollbackEngineArgs): Promise<RollbackEngineResult> {
  const { tx, handler, rows, actor, batch } = args;
  const appliedRows = rows
    .filter((r) => r.status === ImportRowStatus.applied && r.createdEntityId)
    .sort((a, b) => b.rowIndex - a.rowIndex);

  let undone = 0;
  for (const row of appliedRows) {
    // Only undo entities THIS import created. `null` = legacy/byte-parity
    // created (pre-S2 rows + the 4 always-create handlers, which omit the field).
    const created =
      row.reconciliation == null || row.reconciliation === ReconciliationClass.created;
    if (created) {
      await handler.rollbackRow(row.createdEntityId!, { tx, tenantId: actor.tenantId });
      undone++;
    }
    // A matched (`updated`/`unchanged`) row points at a pre-existing entity we
    // did NOT create — never delete it. Flip the row to `rolled_back` for
    // status consistency, leaving the entity untouched.
    await tx.importRow.update({
      where: { id: row.id },
      data: { status: ImportRowStatus.rolled_back },
    });
  }

  await tx.auditLog.create({
    data: {
      tenantId: actor.tenantId,
      actorId: actor.id,
      actorRole: 'school_admin',
      portal: 'admin',
      action: 'import.rollback',
      resourceType: 'import_batch',
      resourceId: batch.id,
      after: { type: batch.type, undone } as Prisma.InputJsonValue,
    },
  });

  return { undone };
}
