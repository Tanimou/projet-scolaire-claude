import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { ImportStatus, type ImportMode } from '@prisma/client';
import {
  applyBatchRows,
  buildImportCaches,
  getHandler,
  rollbackBatchRows,
  type EngineRow,
  type ImportJobPayload,
} from '@pilotage/imports-core';
import type { Job } from 'bullmq';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_IMPORTS } from '../../shared/queue/queue.module';
import { decideClaim } from './import-claim';

/**
 * Drains the third `imports` BullMQ queue (E11-S1, ADR-024). The structural
 * sibling of `ExportsProcessor`, but for a **mutating, transactional,
 * rollback-able** job — so it is crash-safe + idempotent:
 *
 *  1. Claim `queued → applying` via a from-status-guarded `updateMany`
 *     keyed on the **observed** status — `count === 0` ⇒ lost-race, return
 *     without applying (AC-4 single-winner). The `applying → applying` re-admit
 *     is **lease-gated** (`decideClaim`, ADR-024 §4 / FR6): a re-delivered job
 *     reclaims an `applying` batch ONLY when its stamped `claimedAt` is older
 *     than `IMPORTS_APPLY_STALE_MIN` — so a dead worker's batch self-heals after
 *     the lease, but a re-delivery can NOT double-admit a batch a still-alive
 *     worker is actively applying (mirrors the analytics-snapshots / E7-S5
 *     `processedAt`-keyed reclaim).
 *  2. Per-row RESUME — a row already `applied` with a `createdEntityId` is
 *     SKIPPED by the shared engine, never re-applied (AC-3 no double-apply).
 *  3. The SAME relocated engine (`@pilotage/imports-core`) runs the SAME
 *     `prisma.$transaction` + per-row `applyRow`/`rollbackRow` + `import.apply`/
 *     `import.rollback` audit as the original in-request apply (AC-1/AC-6).
 *
 * Every query is tenant-scoped from the job payload (the worker has no
 * request-RLS context — ADR-002 defence-in-depth, AC-7).
 */
@Processor(QUEUE_IMPORTS)
export class ImportsProcessor extends WorkerHost {
  private readonly logger = new Logger(ImportsProcessor.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<{ batchId: string; outcome: string }> {
    const { batchId, kind, mode, tenantId } = job.data;
    this.logger.log(`[imports.${kind}] ${batchId} — start (tenant ${tenantId})`);

    if (kind === 'rollback') {
      return this.processRollback(job.data);
    }
    return this.processApply(job.data, mode);
  }

  /** Apply path — claim, resume, run the engine, mark terminal. */
  private async processApply(
    payload: ImportJobPayload,
    mode: ImportMode,
  ): Promise<{ batchId: string; outcome: string }> {
    const { batchId, tenantId, schoolId, actorId } = payload;

    // (1) Lease-gated from-status-guarded claim → applying. Read the current
    // status + stamped `claimedAt` (in `summary`) first, then decide: `queued`
    // is always claimable; an `applying` batch is reclaimable ONLY when its
    // claim is stale (dead-worker self-heal, per-row resume makes it safe) —
    // never when a live worker holds the lease (ADR-024 §4 / FR6, the
    // double-admit a re-delivered job would otherwise cause).
    const current = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      select: { status: true, summary: true },
    });
    if (!current) {
      this.logger.warn(`[imports.apply] ${batchId} — not found (tenant ${tenantId}), skipping`);
      return { batchId, outcome: 'skipped' };
    }
    const decision = decideClaim(current.status, current.summary);
    if (!decision.claimable) {
      this.logger.warn(`[imports.apply] ${batchId} — not claimable (${decision.reason}), skipping`);
      return { batchId, outcome: 'skipped' };
    }
    // From-status-guarded on the OBSERVED status so a concurrent claim still
    // races to exactly one winner (`count === 0` loser no-ops).
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id: batchId, tenantId, status: decision.fromStatus },
      data: { status: ImportStatus.applying },
    });
    if (claimed.count === 0) {
      this.logger.warn(`[imports.apply] ${batchId} — lost claim race, skipping`);
      return { batchId, outcome: 'skipped' };
    }

    // (2) Load the batch + rows (tenant-scoped).
    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
    });
    if (!batch) {
      this.logger.error(`[imports.apply] ${batchId} — batch vanished after claim`);
      return { batchId, outcome: 'missing' };
    }

    const handler = getHandler(batch.type);
    if (!handler) {
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.failed, errorMessage: `Type d'import « ${batch.type} » non supporté.` },
      });
      return { batchId, outcome: 'failed' };
    }

    // Stamp the claim instant for observability (FR6) + reset live progress.
    const baseSummary = (batch.summary as Record<string, unknown>) ?? {};
    const totalToApply = batch.rows.filter(
      (r) => r.status === 'valid' || (r.status === 'applied' && r.createdEntityId),
    ).length;
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        summary: {
          ...baseSummary,
          claimedAt: new Date().toISOString(),
          processedRows: 0,
          totalToApply,
          applied: 0,
          skipped: 0,
          mode,
        },
      },
    });

    const caches = await buildImportCaches(this.prisma, batch.schoolId);
    const engineRows: EngineRow[] = batch.rows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      status: r.status,
      payload: r.payload,
      createdEntityId: r.createdEntityId,
      // E11-S2 — carry the stored class so a RESUME re-tallies `byClass` faithfully.
      reconciliation: r.reconciliation,
    }));

    // Periodic progress flush — write at most every ~250ms so a mid-run poll is
    // accurate without hammering the DB on a 5000-row batch (FR7).
    let lastFlush = 0;
    const flushProgress = async (counts: { applied: number; skipped: number; processedRows: number }) => {
      const now = Date.now();
      if (counts.processedRows < totalToApply && now - lastFlush < 250) return;
      lastFlush = now;
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          summary: { ...baseSummary, claimedAt: new Date().toISOString(), totalToApply, mode, ...counts },
        },
      });
    };

    try {
      const result = await this.prisma.$transaction(
        async (tx) =>
          applyBatchRows({
            tx,
            handler,
            rows: engineRows,
            caches,
            schoolId,
            actor: { id: actorId, tenantId },
            mode,
            batch: { id: batch.id, type: batch.type },
            onRowProcessed: flushProgress,
          }),
        { timeout: 60_000 },
      );

      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          status: ImportStatus.applied,
          appliedAt: new Date(),
          errorMessage: null,
          // ONE authoritative terminal summary write (FM-9): the reconciliation
          // roll-up rides the existing `summary` Json (E11-S2 FR5) alongside the
          // existing counters — no new column, no second query. `byClass` comes
          // from the engine's returned tally so it can never drift from the
          // per-row `ImportRow.reconciliation` written inside the same tx.
          summary: {
            ...baseSummary,
            processedRows: result.applied + result.skipped,
            totalToApply,
            applied: result.applied,
            skipped: result.skipped,
            byClass: result.byClass,
            mode,
          },
        },
      });
      this.logger.log(
        `[imports.apply] ${batchId} — applied (${result.applied} applied, ${result.skipped} skipped)`,
      );
      return { batchId, outcome: 'applied' };
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(`[imports.apply] ${batchId} — failed: ${message}`);
      // Terminal failure: the whole transaction rolled back (atomic, no partial
      // writes), so the batch is `failed` with no half-applied rows. Mark failed
      // and re-throw so BullMQ records the failure (matches ExportsProcessor).
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.failed, errorMessage: message.slice(0, 500) },
      });
      throw err;
    }
  }

  /** Rollback path — claim, reverse-order compensation via the engine. */
  private async processRollback(payload: ImportJobPayload): Promise<{ batchId: string; outcome: string }> {
    const { batchId, tenantId, actorId } = payload;

    // Lease-gated claim → applying (reusing `applying` as the in-flight state for
    // the rollback too). Same lease gate as apply: an `applying` batch is
    // reclaimed only when its stamped `claimedAt` is stale, so a re-delivered
    // rollback can't double-admit a batch a live worker is mid-rollback on.
    const current = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      select: { status: true, summary: true },
    });
    if (!current) {
      this.logger.warn(`[imports.rollback] ${batchId} — not found (tenant ${tenantId}), skipping`);
      return { batchId, outcome: 'skipped' };
    }
    const decision = decideClaim(current.status, current.summary);
    if (!decision.claimable) {
      this.logger.warn(`[imports.rollback] ${batchId} — not claimable (${decision.reason}), skipping`);
      return { batchId, outcome: 'skipped' };
    }
    const claimed = await this.prisma.importBatch.updateMany({
      where: { id: batchId, tenantId, status: decision.fromStatus },
      data: { status: ImportStatus.applying },
    });
    if (claimed.count === 0) {
      this.logger.warn(`[imports.rollback] ${batchId} — lost claim race, skipping`);
      return { batchId, outcome: 'skipped' };
    }

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
    });
    if (!batch) return { batchId, outcome: 'missing' };

    // Stamp THIS rollback's claim instant so the lease keys on the rollback claim,
    // not a stale `claimedAt` left over from the prior apply (else a re-delivered
    // rollback would see an old timestamp and wrongly re-admit a live rollback).
    const baseSummary = (batch.summary as Record<string, unknown>) ?? {};
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: { summary: { ...baseSummary, claimedAt: new Date().toISOString() } },
    });

    const handler = getHandler(batch.type);
    if (!handler) {
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.failed, errorMessage: `Type d'import « ${batch.type} » non supporté.` },
      });
      return { batchId, outcome: 'failed' };
    }

    const engineRows: EngineRow[] = batch.rows.map((r) => ({
      id: r.id,
      rowIndex: r.rowIndex,
      status: r.status,
      payload: r.payload,
      createdEntityId: r.createdEntityId,
      // E11-S2 SAFETY — carry the stored reconciliation class so rollback only
      // undoes rows THIS import CREATED. Without it, a `updated`/`unchanged` row
      // (createdEntityId = a pre-existing matched student) would be hard-deleted
      // with cascade — irreversible loss of a real child's academic record.
      reconciliation: r.reconciliation,
    }));

    try {
      const result = await this.prisma.$transaction(
        async (tx) =>
          rollbackBatchRows({
            tx,
            handler,
            rows: engineRows,
            actor: { id: actorId, tenantId },
            batch: { id: batch.id, type: batch.type },
          }),
        { timeout: 60_000 },
      );

      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.rolled_back, rolledBackAt: new Date(), errorMessage: null },
      });
      this.logger.log(`[imports.rollback] ${batchId} — rolled_back (${result.undone} undone)`);
      return { batchId, outcome: 'rolled_back' };
    } catch (err) {
      const message = (err as Error).message ?? 'unknown error';
      this.logger.error(`[imports.rollback] ${batchId} — failed: ${message}`);
      // Restore to `applied` so the admin can retry the rollback (the apply is
      // still intact — the rollback tx rolled back atomically).
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: { status: ImportStatus.applied, errorMessage: message.slice(0, 500) },
      });
      throw err;
    }
  }
}
