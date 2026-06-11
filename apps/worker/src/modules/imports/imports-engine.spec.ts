import { ImportRowStatus, ReconciliationClass, type ImportMode } from '@prisma/client';
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

    // E11-S2 — additive `byClass`; applied/skipped stay byte-identical (FR10/FM-3).
    expect(result).toMatchObject({ applied: 2, skipped: 1 });
    expect(result.byClass).toEqual({ created: 2, updated: 0, unchanged: 0, conflict: 0, skipped: 1 });
    expect(getApplyCalls()).toBe(2);
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data.action).toBe('import.apply');
    expect(audits[0]!.data.tenantId).toBe('tenant-1');
    expect((audits[0]!.data.after as Record<string, unknown>)).toMatchObject({
      applied: 2,
      skipped: 1,
      mode: MODE,
      byClass: { created: 2, updated: 0, unchanged: 0, conflict: 0, skipped: 1 },
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
    expect(result).toMatchObject({ applied: 2, skipped: 0 });
    // RESUME re-tally: r1 had no stored class → legacy `created`; r2 fresh `created`.
    expect(result.byClass.created).toBe(2);
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

describe('imports-core engine — reconciliation classification (E11-S2)', () => {
  /** A handler that echoes a reconciliation class keyed off the row payload. */
  function makeClassifyingHandler(): ImportHandler {
    return {
      type: 'students',
      label: 'x',
      description: 'x',
      icon: 'x',
      requiredPermission: 'students.write',
      template: { headers: [], sample: [] },
      parseRow: (r) => r,
      validateRow: () => ({ ok: true, errors: [] }),
      applyRow: async (normalized) => {
        const p = normalized as { class: string; id?: string };
        if (p.class === 'conflict') {
          return {
            id: p.id ?? 'existing-1',
            type: 'student',
            reconciliation: ReconciliationClass.conflict,
            conflictFields: [{ field: 'lastName', current: 'Martin', source: 'Bernard' }],
          };
        }
        return {
          id: p.id ?? 'entity-x',
          type: 'student',
          reconciliation: p.class as ReconciliationClass,
        };
      },
      rollbackRow: async () => {},
    };
  }

  it('classifies created/updated/unchanged, rolls them into byClass + applied', async () => {
    const { tx, rowUpdates } = makeFakeTx();
    const handler = makeClassifyingHandler();
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.valid, payload: { class: 'created' }, createdEntityId: null },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.valid, payload: { class: 'updated' }, createdEntityId: null },
      { id: 'r3', rowIndex: 3, status: ImportRowStatus.valid, payload: { class: 'unchanged' }, createdEntityId: null },
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

    expect(result.applied).toBe(3); // created + updated + unchanged all count as applied
    expect(result.skipped).toBe(0);
    expect(result.byClass).toEqual({ created: 1, updated: 1, unchanged: 1, conflict: 0, skipped: 0 });
    // each applied row gets its reconciliation written in the SAME importRow.update
    expect(rowUpdates.map((u) => u.data.reconciliation)).toEqual([
      ReconciliationClass.created,
      ReconciliationClass.updated,
      ReconciliationClass.unchanged,
    ]);
    expect(rowUpdates.every((u) => u.data.status === ImportRowStatus.applied)).toBe(true);
  });

  it('a conflict row is recorded (reconciliation+conflictFields) but NOT applied — no silent overwrite (AC FR4)', async () => {
    const { tx, rowUpdates } = makeFakeTx();
    const handler = makeClassifyingHandler();
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.valid, payload: { class: 'created' }, createdEntityId: null },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.valid, payload: { class: 'conflict' }, createdEntityId: null },
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

    // conflict is NOT counted as applied nor skipped — it stays `valid` for S4 resolution.
    expect(result.applied).toBe(1);
    expect(result.skipped).toBe(0);
    expect(result.byClass.conflict).toBe(1);

    const conflictUpdate = rowUpdates.find((u) => u.id === 'r2')!;
    expect(conflictUpdate.data.reconciliation).toBe(ReconciliationClass.conflict);
    expect(conflictUpdate.data.status).toBeUndefined(); // NOT flipped to applied
    expect(conflictUpdate.data.createdEntityId).toBeUndefined(); // NO entity written
    expect(conflictUpdate.data.conflictFields).toEqual([
      { field: 'lastName', current: 'Martin', source: 'Bernard' },
    ]);
  });

  it('an invalid row is skipped with reconciliation=skipped', async () => {
    const { tx, rowUpdates } = makeFakeTx();
    const handler = makeClassifyingHandler();
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.invalid, payload: {}, createdEntityId: null },
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

    expect(result.skipped).toBe(1);
    expect(result.byClass.skipped).toBe(1);
    expect(rowUpdates[0]!.data.status).toBe(ImportRowStatus.skipped);
    expect(rowUpdates[0]!.data.reconciliation).toBe(ReconciliationClass.skipped);
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

  it('SAFETY (RGPD, the load-bearing E11-S2 invariant): rollback compensates ONLY rows this import CREATED — matched updated/unchanged rows are flipped rolled_back WITHOUT deleting the pre-existing entity', async () => {
    const { tx, rowUpdates } = makeFakeTx();
    const base = makeCountingHandler().handler;
    const deleted: string[] = [];
    const handler: ImportHandler = {
      ...base,
      rollbackRow: async (entityId: string) => {
        deleted.push(entityId);
      },
    };
    // A re-import after externalRef matching produced a MIX of classes, all `applied`:
    //  r1 created a NEW student            → reconciliation=created  → MUST be deleted
    //  r2 matched & updated email/notes    → createdEntityId=existing → MUST NOT be deleted
    //  r3 matched & identical (unchanged)  → createdEntityId=existing → MUST NOT be deleted
    //  r4 legacy/byte-parity (null class)  → pre-S2 / always-create   → MUST be deleted
    const rows: EngineRow[] = [
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'new-1', reconciliation: ReconciliationClass.created },
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'existing-2', reconciliation: ReconciliationClass.updated },
      { id: 'r3', rowIndex: 3, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'existing-3', reconciliation: ReconciliationClass.unchanged },
      { id: 'r4', rowIndex: 4, status: ImportRowStatus.applied, payload: {}, createdEntityId: 'legacy-4', reconciliation: null },
    ];

    const result = await rollbackBatchRows({
      tx: tx as never,
      handler,
      rows,
      actor: ACTOR,
      batch: BATCH,
    });

    // Only the two CREATED rows (r1 + legacy-null r4) are physically compensated.
    expect(result).toEqual({ undone: 2 });
    // Reverse order, and CRUCIALLY the pre-existing matched entities are NEVER passed to rollbackRow.
    expect(deleted).toEqual(['legacy-4', 'new-1']);
    expect(deleted).not.toContain('existing-2');
    expect(deleted).not.toContain('existing-3');
    // ALL four applied rows are flipped rolled_back for status bookkeeping (reverse order).
    expect(rowUpdates.map((u) => u.id)).toEqual(['r4', 'r3', 'r2', 'r1']);
    expect(rowUpdates.every((u) => u.data.status === ImportRowStatus.rolled_back)).toBe(true);
  });
});
