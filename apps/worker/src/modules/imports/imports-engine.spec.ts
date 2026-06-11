import { ImportRowStatus, type ImportMode } from '@prisma/client';
import {
  applyBatchRows,
  rollbackBatchRows,
  type EngineRow,
  type ImportHandler,
} from '@pilotage/imports-core';

/**
 * E11-S1 / ADR-024 engine guards. The ONE apply/rollback engine
 * (`@pilotage/imports-core`) is the shared implementation the worker
 * `ImportsProcessor` calls. These tests pin the load-bearing invariants:
 *
 *  - Murat P0 "no double-apply on redelivery": a row already `applied` with a
 *    `createdEntityId` is SKIPPED, never re-applied (AC-3) — so a re-claimed job
 *    converges to the same created set, exactly once.
 *  - byte-parity counts: applied/skipped match the original in-request loop.
 *  - the `import.apply` / `import.rollback` audit row is written, tenant-scoped.
 */

type AuditRow = { data: Record<string, unknown> };

/** A minimal fake Prisma.TransactionClient capturing writes + counting applyRow calls. */
function makeFakeTx() {
  const rowUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
  const audits: AuditRow[] = [];
  const tx = {
    importRow: {
      update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        rowUpdates.push({ id: where.id, data });
        return { id: where.id, ...data };
      }),
    },
    auditLog: {
      create: jest.fn(async (args: AuditRow) => {
        audits.push(args);
        return args.data;
      }),
    },
  };
  return { tx, rowUpdates, audits };
}

/** A handler whose applyRow returns a deterministic id and counts its calls. */
function makeCountingHandler() {
  let applyCalls = 0;
  let rollbackCalls = 0;
  const handler: ImportHandler = {
    type: 'students',
    label: 'x',
    description: 'x',
    icon: 'x',
    requiredPermission: 'students.write',
    template: { headers: [], sample: [] },
    parseRow: (r) => r,
    validateRow: () => ({ ok: true, errors: [] }),
    applyRow: async () => {
      applyCalls++;
      return { id: `entity-${applyCalls}`, type: 'student' };
    },
    rollbackRow: async () => {
      rollbackCalls++;
    },
  };
  return {
    handler,
    getApplyCalls: () => applyCalls,
    getRollbackCalls: () => rollbackCalls,
  };
}

const ACTOR = { id: 'actor-1', tenantId: 'tenant-1' };
const BATCH = { id: 'batch-1', type: 'students' };
const MODE: ImportMode = 'skip_invalid';

describe('imports-core engine — applyBatchRows', () => {
  it('applies valid rows, skips invalid, writes one audit row (byte-parity counts)', async () => {
    const { tx, audits } = makeFakeTx();
    const { handler, getApplyCalls } = makeCountingHandler();
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.valid, payload: {}, createdEntityId: null },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.invalid, payload: {}, createdEntityId: null },
      { id: 'r3', rowIndex: 3, status: ImportRowStatus.valid, payload: {}, createdEntityId: null },
    ];

    const result = await applyBatchRows({
      tx: tx as never,
      handler,
      rows,
      caches: {} as never,
      schoolId: 'school-1',
      actor: ACTOR,
      mode: MODE,
      batch: BATCH,
    });

    expect(result).toEqual({ applied: 2, skipped: 1 });
    expect(getApplyCalls()).toBe(2);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data.action).toBe('import.apply');
    expect(audits[0]!.data.tenantId).toBe('tenant-1');
    expect((audits[0]!.data.after as Record<string, unknown>)).toMatchObject({
      applied: 2,
      skipped: 1,
      mode: MODE,
    });
  });

  it('RESUME: does NOT re-apply a row already applied with a createdEntityId (AC-3, no double-apply)', async () => {
    const { tx } = makeFakeTx();
    const { handler, getApplyCalls } = makeCountingHandler();
    // Simulate a redelivered job: r1 was already applied before the crash.
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'entity-existing' },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.valid, payload: {}, createdEntityId: null },
    ];

    const result = await applyBatchRows({
      tx: tx as never,
      handler,
      rows,
      caches: {} as never,
      schoolId: 'school-1',
      actor: ACTOR,
      mode: MODE,
      batch: BATCH,
    });

    // r1 is counted as already-applied but applyRow is NOT called again → no dup.
    expect(getApplyCalls()).toBe(1);
    expect(result).toEqual({ applied: 2, skipped: 0 });
  });

  it('reports incremental progress via onRowProcessed', async () => {
    const { tx } = makeFakeTx();
    const { handler } = makeCountingHandler();
    const seen: number[] = [];
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.valid, payload: {}, createdEntityId: null },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.valid, payload: {}, createdEntityId: null },
    ];

    await applyBatchRows({
      tx: tx as never,
      handler,
      rows,
      caches: {} as never,
      schoolId: 'school-1',
      actor: ACTOR,
      mode: MODE,
      batch: BATCH,
      onRowProcessed: (c) => {
        seen.push(c.processedRows);
      },
    });

    expect(seen).toEqual([1, 2]);
  });
});

describe('imports-core engine — rollbackBatchRows', () => {
  it('compensates applied rows in reverse order, flips them rolled_back, writes one audit row', async () => {
    const { tx, rowUpdates, audits } = makeFakeTx();
    const { handler, getRollbackCalls } = makeCountingHandler();
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'e1' },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.skipped, payload: {}, createdEntityId: null },
      { id: 'r3', rowIndex: 3, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'e3' },
    ];

    const result = await rollbackBatchRows({
      tx: tx as never,
      handler,
      rows,
      actor: ACTOR,
      batch: BATCH,
    });

    expect(result).toEqual({ undone: 2 });
    expect(getRollbackCalls()).toBe(2);
    // reverse order: r3 (index 3) before r1 (index 1).
    expect(rowUpdates.map((u) => u.id)).toEqual(['r3', 'r1']);
    expect(rowUpdates.every((u) => u.data.status === ImportRowStatus.rolled_back)).toBe(true);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data.action).toBe('import.rollback');
    expect((audits[0]!.data.after as Record<string, unknown>).undone).toBe(2);
  });
});
