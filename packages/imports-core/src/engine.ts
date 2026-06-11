import { ImportMode, ImportRowStatus, Prisma } from '@prisma/client';

import { type ImportCaches, type ImportHandler } from './handler.types';

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

  const apCtx = {
    tenantId: actor.tenantId,
    schoolId,
    caches,
    tx,
  };

  for (const row of rows) {
    // RESUME: a row already applied with a created entity is never re-applied.
    if (row.status === ImportRowStatus.applied && row.createdEntityId) {
      applied++;
      processedRows++;
      if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
      continue;
    }
    if (row.status === ImportRowStatus.invalid) {
      await tx.importRow.update({ where: { id: row.id }, data: { status: ImportRowStatus.skipped } });
      skipped++;
      processedRows++;
      if (onRowProcessed) await onRowProcessed({ applied, skipped, processedRows });
      continue;
    }
    if (row.status !== ImportRowStatus.valid) continue;
    try {
      const result = await handler.applyRow(row.payload as Record<string, unknown>, apCtx);
      await tx.importRow.update({
        where: { id: row.id },
        data: {
          status: ImportRowStatus.applied,
          createdEntityId: result.id,
          createdEntityType: result.type,
        },
      });
      applied++;
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
      after: { type: batch.type, applied, skipped, mode } as Prisma.InputJsonValue,
    },
  });

  return { applied, skipped };
}

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
 */
export async function rollbackBatchRows(args: RollbackEngineArgs): Promise<RollbackEngineResult> {
  const { tx, handler, rows, actor, batch } = args;
  const appliedRows = rows
    .filter((r) => r.status === ImportRowStatus.applied && r.createdEntityId)
    .sort((a, b) => b.rowIndex - a.rowIndex);

  let undone = 0;
  for (const row of appliedRows) {
    await handler.rollbackRow(row.createdEntityId!, { tx, tenantId: actor.tenantId });
    await tx.importRow.update({
      where: { id: row.id },
      data: { status: ImportRowStatus.rolled_back },
    });
    undone++;
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
