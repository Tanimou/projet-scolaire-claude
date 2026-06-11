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
 *  1. Claim `→ applying` via the shared single-winner `claim()` helper
 *     (ADR-024 §4 / FR6). A `queued` batch is claimed by the status flip; an
 *     `applying` batch is **lease-gated** (`decideClaim`) — reclaimed ONLY when
 *     its typed `claimedAt` lease instant is older than `IMPORTS_APPLY_STALE_MIN`,
 *     via a single-winner **compare-and-swap on `claimedAt`**. So a dead worker's
 *     batch self-heals after the lease, but a re-delivery can NOT double-admit a
 *     batch a still-alive worker is actively applying (mirrors the
 *     analytics-snapshots / E7-S5 `processedAt`-keyed reclaim). The claim AND its
 *     `claimedAt` stamp are written in ONE atomic `updateMany` — no TOCTOU window —
 *     and the lease is heartbeated on the `claimedAt` column during a long apply.
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

  /**
   * Lease-gated, single-winner claim of a batch `→ applying`, shared by the apply
   * and rollback paths so their admission semantics cannot drift (ADR-024 §4 / FR6).
   *
   * Reads the current status + typed `claimedAt` lease instant, asks the pure
   * `decideClaim`, then fires the matching single-winner `updateMany` — the claim
   * AND the `claimedAt` stamp land in that ONE statement, so there is no
   * read-to-stamp TOCTOU a re-delivery could slip through:
   *  - `fresh`   → guarded on `status='queued'` → `applying` (the status flip
   *               elects exactly one winner; the loser matches 0 rows).
   *  - `reclaim` → compare-and-swap on the OBSERVED `claimedAt` (elects exactly one
   *               winner even though status stays `applying`: once the winner
   *               re-leases, the loser's stale `claimedAt` no longer matches).
   *
   * Returns `true` when THIS worker won the claim, `false` to skip (not found,
   * terminal, lease-held by a live worker, or lost the race to a concurrent claim).
   */
  private async claim(batchId: string, tenantId: string, label: 'apply' | 'rollback'): Promise<boolean> {
    const now = new Date();
    const current = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      select: { status: true, claimedAt: true },
    });
    if (!current) {
      this.logger.warn(`[imports.${label}] ${batchId} — not found (tenant ${tenantId}), skipping`);
      return false;
    }
    const decision = decideClaim(current.status, current.claimedAt, now);
    if (!decision.claimable) {
      this.logger.warn(`[imports.${label}] ${batchId} — not claimable (${decision.reason}), skipping`);
      return false;
    }
    const claimed =
      decision.kind === 'fresh'
        ? await this.prisma.importBatch.updateMany({
            where: { id: batchId, tenantId, status: ImportStatus.queued },
            data: { status: ImportStatus.applying, claimedAt: now },
          })
        : await this.prisma.importBatch.updateMany({
            where: {
              id: batchId,
              tenantId,
              status: ImportStatus.applying,
              // CAS guard: the observed lease instant (a `Date` or `null` = IS NULL).
              claimedAt: decision.observedClaimedAt,
            },
            data: { claimedAt: now },
          });
    if (claimed.count === 0) {
      this.logger.warn(`[imports.${label}] ${batchId} — lost claim race, skipping`);
      return false;
    }
    return true;
  }

  /** Apply path — claim, resume, run the engine, mark terminal. */
  private async processApply(
    payload: ImportJobPayload,
    mode: ImportMode,
  ): Promise<{ batchId: string; outcome: string }> {
    const { batchId, tenantId, schoolId, actorId } = payload;

    // (1) Lease-gated, single-winner claim → applying (atomic claim+stamp; a live
    // worker's lease is never stolen — see `claim`).
    if (!(await this.claim(batchId, tenantId, 'apply'))) {
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

    // Reset live progress (the claim instant already lives on the `claimedAt`
    // column, stamped atomically by `claim()` — no longer in `summary`).
    const baseSummary = (batch.summary as Record<string, unknown>) ?? {};
    const totalToApply = batch.rows.filter(
      (r) => r.status === 'valid' || (r.status === 'applied' && r.createdEntityId),
    ).length;
    await this.prisma.importBatch.update({
      where: { id: batch.id },
      data: {
        summary: {
          ...baseSummary,
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
    // accurate without hammering the DB on a 5000-row batch (FR7). It ALSO
    // heartbeats the `claimedAt` lease so a legitimately long apply keeps its
    // lease fresh and a re-delivery mid-run correctly reads `lease-held` → skips.
    let lastFlush = 0;
    const flushProgress = async (counts: { applied: number; skipped: number; processedRows: number }) => {
      const now = Date.now();
      if (counts.processedRows < totalToApply && now - lastFlush < 250) return;
      lastFlush = now;
      await this.prisma.importBatch.update({
        where: { id: batch.id },
        data: {
          claimedAt: new Date(),
          summary: { ...baseSummary, totalToApply, mode, ...counts },
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

    // Lease-gated, single-winner claim → applying (reusing `applying` as the
    // in-flight state for the rollback too). The same `claim()` helper as apply:
    // the claim's `claimedAt` stamp keys the lease on THIS rollback (atomic,
    // no stale apply-timestamp), so a re-delivered rollback can't double-admit a
    // batch a live worker is mid-rollback on.
    if (!(await this.claim(batchId, tenantId, 'rollback'))) {
      return { batchId, outcome: 'skipped' };
    }

    const batch = await this.prisma.importBatch.findFirst({
      where: { id: batchId, tenantId },
      include: { rows: { orderBy: { rowIndex: 'asc' } } },
    });
    if (!batch) return { batchId, outcome: 'missing' };

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
