import { ImportStatus } from '@prisma/client';
import type { Job } from 'bullmq';

import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { ImportJobPayload } from '@pilotage/imports-core';

import { ImportsProcessor } from './imports.processor';

/**
 * E11-S5 (ADR-024 §4 / FR6) — the LOAD-BEARING processor-level invariant Murat
 * gated on: a re-delivered BullMQ job may NOT double-admit a batch a still-alive
 * worker is mid-apply/rollback on, and even two simultaneously-STALE re-deliveries
 * elect EXACTLY ONE winner (the engine runs once, never twice).
 *
 * `decideClaim` is unit-tested in `import-claim.spec.ts`; here we exercise the
 * `ImportsProcessor` claim WIRING against a `PrismaService` mock whose
 * `importBatch.updateMany` models the real DB guard:
 *   - a fresh claim (`WHERE status='queued'`) wins by the status flip;
 *   - a stale reclaim (`WHERE status='applying' AND claimedAt=<observed>`) wins by
 *     a compare-and-swap on the lease instant — the loser's stale `claimedAt` no
 *     longer matches once the winner re-leases.
 * The two concurrent re-deliveries are modelled as both READING the pre-write
 * snapshot before EITHER writes (the TOCTOU window), with `updateMany` enforcing
 * the authoritative single-winner CAS.
 *
 * `@pilotage/imports-core` is mocked so the engine calls are observable jest.fns —
 * the assertion is purely "how many times did the engine run".
 */

const engine = {
  applyBatchRows: jest.fn(),
  rollbackBatchRows: jest.fn(),
  buildImportCaches: jest.fn(),
  getHandler: jest.fn(),
};

jest.mock('@pilotage/imports-core', () => ({
  applyBatchRows: (...a: unknown[]) => engine.applyBatchRows(...a),
  rollbackBatchRows: (...a: unknown[]) => engine.rollbackBatchRows(...a),
  buildImportCaches: (...a: unknown[]) => engine.buildImportCaches(...a),
  getHandler: (...a: unknown[]) => engine.getHandler(...a),
}));

const BATCH_ID = 'batch-1';
const TENANT_ID = 'tenant-1';
const SCHOOL_ID = 'school-1';
const ACTOR_ID = 'actor-1';

// Relative to the REAL clock — the processor's `claim()` calls `new Date()`, so
// the lease window is measured against wall-clock now, not a fixed instant.
const REAL_NOW = Date.now();
const STALE = new Date(REAL_NOW - 20 * 60 * 1000); // 20 min ago — past the 15-min lease
const FRESH = new Date(REAL_NOW - 2 * 60 * 1000); // 2 min ago — a live worker holds it

interface DbRow {
  status: ImportStatus;
  claimedAt: Date | null;
}

/**
 * A PrismaService mock whose `updateMany` is the authoritative single-winner
 * guard. `claimSnapshots` are the rows the CLAIM read (`findFirst({select})`)
 * returns, in order — supplying the SAME stale snapshot to two callers models the
 * concurrent pre-write read. `state` is the authoritative row the `updateMany`
 * CAS mutates.
 */
function makePrisma(initial: DbRow, claimSnapshots: DbRow[]) {
  const state: DbRow = { ...initial };
  let claimReads = 0;

  const datesEqual = (a: Date | null | undefined, b: Date | null) =>
    (a == null && b == null) || (a instanceof Date && b instanceof Date && a.getTime() === b.getTime());

  const importBatch = {
    findFirst: jest.fn(async (args: { select?: unknown; include?: unknown }) => {
      if (args.select) {
        // The claim read — hand back the queued pre-write snapshot for each caller.
        const snap = claimSnapshots[claimReads] ?? { status: state.status, claimedAt: state.claimedAt };
        claimReads += 1;
        return snap;
      }
      // The batch load (include rows) — an empty, already-applied-nothing batch.
      return { id: BATCH_ID, type: 'students', schoolId: SCHOOL_ID, summary: {}, rows: [] };
    }),
    updateMany: jest.fn(async (args: { where: { status?: ImportStatus; claimedAt?: Date | null }; data: DbRow }) => {
      const w = args.where;
      if (w.status !== undefined && w.status !== state.status) return { count: 0 };
      if ('claimedAt' in w && !datesEqual(w.claimedAt, state.claimedAt)) return { count: 0 };
      // Winner: apply the claim mutation.
      if (args.data.status !== undefined) state.status = args.data.status;
      if ('claimedAt' in args.data) state.claimedAt = args.data.claimedAt;
      return { count: 1 };
    }),
    update: jest.fn(async () => ({})),
  };

  const prisma = {
    importBatch,
    $transaction: jest.fn(async (fn: (tx: unknown) => unknown) => fn({})),
  } as unknown as PrismaService;

  return { prisma, importBatch, state };
}

function applyJob(): Job<ImportJobPayload> {
  return {
    data: {
      batchId: BATCH_ID,
      kind: 'apply',
      mode: 'skip_invalid',
      tenantId: TENANT_ID,
      schoolId: SCHOOL_ID,
      actorId: ACTOR_ID,
    },
  } as Job<ImportJobPayload>;
}

function rollbackJob(): Job<ImportJobPayload> {
  return {
    data: { ...applyJob().data, kind: 'rollback' },
  } as Job<ImportJobPayload>;
}

beforeEach(() => {
  engine.applyBatchRows.mockReset().mockResolvedValue({ applied: 0, skipped: 0, byClass: {} });
  engine.rollbackBatchRows.mockReset().mockResolvedValue({ undone: 0 });
  engine.buildImportCaches.mockReset().mockResolvedValue({});
  engine.getHandler.mockReset().mockReturnValue({}); // any truthy handler
});

describe('ImportsProcessor — lease-gated single-winner claim (apply)', () => {
  it('two concurrent STALE re-deliveries apply EXACTLY ONCE (CAS elects one winner)', async () => {
    // Both workers read the same stale `applying` snapshot before either writes.
    const { prisma, importBatch } = makePrisma(
      { status: ImportStatus.applying, claimedAt: STALE },
      [
        { status: ImportStatus.applying, claimedAt: STALE },
        { status: ImportStatus.applying, claimedAt: STALE },
      ],
    );
    const processor = new ImportsProcessor(prisma);

    const [a, b] = await Promise.all([processor.process(applyJob()), processor.process(applyJob())]);

    // Engine ran for the winner and ONLY the winner.
    expect(engine.applyBatchRows).toHaveBeenCalledTimes(1);
    // Exactly one of the two re-deliveries skipped (lost the CAS race).
    const outcomes = [a.outcome, b.outcome].sort();
    expect(outcomes).toEqual(['applied', 'skipped']);
    // Two claim CAS attempts fired; exactly one returned count===1.
    expect(importBatch.updateMany).toHaveBeenCalledTimes(2);
  });

  it('a FRESH-lease `applying` re-delivery is left alone — never claims, never applies', async () => {
    const { prisma, importBatch } = makePrisma({ status: ImportStatus.applying, claimedAt: FRESH }, [
      { status: ImportStatus.applying, claimedAt: FRESH },
    ]);
    const processor = new ImportsProcessor(prisma);

    const res = await processor.process(applyJob());

    expect(res.outcome).toBe('skipped');
    expect(engine.applyBatchRows).not.toHaveBeenCalled();
    // Lease-held is decided BEFORE any write — no claim CAS is attempted.
    expect(importBatch.updateMany).not.toHaveBeenCalled();
  });

  it('a single STALE re-delivery (dead worker) self-heals and applies once', async () => {
    const { prisma } = makePrisma({ status: ImportStatus.applying, claimedAt: STALE }, [
      { status: ImportStatus.applying, claimedAt: STALE },
    ]);
    const processor = new ImportsProcessor(prisma);

    const res = await processor.process(applyJob());

    expect(res.outcome).toBe('applied');
    expect(engine.applyBatchRows).toHaveBeenCalledTimes(1);
  });

  it('a normal first delivery (queued) claims via the status flip and applies', async () => {
    const { prisma } = makePrisma({ status: ImportStatus.queued, claimedAt: null }, [
      { status: ImportStatus.queued, claimedAt: null },
    ]);
    const processor = new ImportsProcessor(prisma);

    const res = await processor.process(applyJob());

    expect(res.outcome).toBe('applied');
    expect(engine.applyBatchRows).toHaveBeenCalledTimes(1);
  });

  it('a terminal (already applied) re-delivery skips without applying', async () => {
    const { prisma, importBatch } = makePrisma({ status: ImportStatus.applied, claimedAt: STALE }, [
      { status: ImportStatus.applied, claimedAt: STALE },
    ]);
    const processor = new ImportsProcessor(prisma);

    const res = await processor.process(applyJob());

    expect(res.outcome).toBe('skipped');
    expect(engine.applyBatchRows).not.toHaveBeenCalled();
    expect(importBatch.updateMany).not.toHaveBeenCalled();
  });
});

describe('ImportsProcessor — lease-gated single-winner claim (rollback)', () => {
  it('two concurrent STALE re-deliveries roll back EXACTLY ONCE', async () => {
    const { prisma } = makePrisma(
      { status: ImportStatus.applying, claimedAt: STALE },
      [
        { status: ImportStatus.applying, claimedAt: STALE },
        { status: ImportStatus.applying, claimedAt: STALE },
      ],
    );
    const processor = new ImportsProcessor(prisma);

    const [a, b] = await Promise.all([processor.process(rollbackJob()), processor.process(rollbackJob())]);

    expect(engine.rollbackBatchRows).toHaveBeenCalledTimes(1);
    expect([a.outcome, b.outcome].sort()).toEqual(['rolled_back', 'skipped']);
  });

  it('a FRESH-lease `applying` rollback re-delivery is left alone', async () => {
    const { prisma, importBatch } = makePrisma({ status: ImportStatus.applying, claimedAt: FRESH }, [
      { status: ImportStatus.applying, claimedAt: FRESH },
    ]);
    const processor = new ImportsProcessor(prisma);

    const res = await processor.process(rollbackJob());

    expect(res.outcome).toBe('skipped');
    expect(engine.rollbackBatchRows).not.toHaveBeenCalled();
    expect(importBatch.updateMany).not.toHaveBeenCalled();
  });
});
