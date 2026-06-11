import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ImportRowStatus, ImportStatus, ReconciliationClass } from '@prisma/client';

import { ImportsService } from './imports.service';

/**
 * E11-S4 (Murat P0) — the admin conflict-resolution arbitration on the imports
 * service. These pin the AC-4/AC-5/AC-6 wall that the worker engine spec cannot
 * cover (the engine spec proves the handler write; this proves the SERVICE: the
 * tenant scope, the row/state guards, the byClass adjust, and the append-only
 * `import.conflict.resolve` audit):
 *
 *  AC-4 keep_current — leaves the matched student UNTOUCHED, flips the row out of
 *    the unresolved-conflict set (→ applied/unchanged), writes ONE audit row.
 *  AC-5 take_source — writes the source identity onto the matched student
 *    (tenant-scoped), flips the row reconciliation→updated/status→applied with
 *    createdEntityId = the PRE-EXISTING student id (so the S2 rollback-safety
 *    invariant excludes it), writes the audit row.
 *  AC-6 tenant/state wall — a cross-tenant batch → Forbidden; a non-conflict row
 *    → 400; a missing row → 404; a non-applied batch → 400.
 */

const TENANT = 'tenant-1';
const OTHER_TENANT = 'tenant-2';
const SCHOOL = 'school-1';
const ACTOR = { id: 'admin-1', tenantId: TENANT };

function conflictRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'row-1',
    batchId: 'batch-1',
    rowIndex: 1,
    status: ImportRowStatus.valid,
    payload: { externalRef: 'EL-1', firstName: 'Léa', lastName: 'Bernard', birthDate: '2012-03-15' },
    reconciliation: ReconciliationClass.conflict,
    conflictFields: [{ field: 'lastName', current: 'Martin', source: 'Bernard' }],
    createdEntityId: null,
    createdEntityType: null,
    ...overrides,
  };
}

function batchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'batch-1',
    tenantId: TENANT,
    schoolId: SCHOOL,
    type: 'students',
    status: ImportStatus.applied,
    summary: { byClass: { created: 0, updated: 0, unchanged: 0, conflict: 1, skipped: 0 } },
    rows: [conflictRow()],
    ...overrides,
  };
}

/**
 * Build a service with a fake Prisma whose `$transaction(cb)` invokes `cb(tx)`
 * with a tx client that captures the student write + the row flip + the audit.
 */
function makeService(opts: {
  batch?: Record<string, unknown> | null;
  existingStudent?: { id: string } | null;
  rowFlipCount?: number;
} = {}) {
  const batch = opts.batch === undefined ? batchRow() : opts.batch;
  const studentUpdates: Record<string, unknown>[] = [];
  const rowFlips: Array<{ where: Record<string, unknown>; data: Record<string, unknown> }> = [];
  const audits: Record<string, unknown>[] = [];
  const batchSummaryUpdates: Record<string, unknown>[] = [];

  const tx = {
    student: {
      findFirst: jest.fn().mockResolvedValue(
        opts.existingStudent === undefined ? { id: 'stu-existing-1' } : opts.existingStudent,
      ),
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        studentUpdates.push(data);
        return Promise.resolve({ id: 'stu-existing-1' });
      }),
    },
    importRow: {
      updateMany: jest.fn().mockImplementation((args: { where: Record<string, unknown>; data: Record<string, unknown> }) => {
        rowFlips.push(args);
        return Promise.resolve({ count: opts.rowFlipCount ?? 1 });
      }),
    },
    importBatch: {
      update: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        batchSummaryUpdates.push(data);
        return Promise.resolve({});
      }),
    },
    auditLog: {
      create: jest.fn().mockImplementation(({ data }: { data: Record<string, unknown> }) => {
        audits.push(data);
        return Promise.resolve(data);
      }),
    },
  };

  const prisma = {
    importBatch: {
      findUnique: jest.fn().mockResolvedValue(batch),
    },
    // buildImportCaches reads (all empty — the handler re-resolves via tx).
    gradeLevel: { findMany: jest.fn().mockResolvedValue([]) },
    subject: { findMany: jest.fn().mockResolvedValue([]) },
    classSection: { findMany: jest.fn().mockResolvedValue([]) },
    student: { findMany: jest.fn().mockResolvedValue([]) },
    guardian: { findMany: jest.fn().mockResolvedValue([]) },
    academicYear: { findFirst: jest.fn().mockResolvedValue(null) },
    $transaction: jest.fn().mockImplementation(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
  };

  const ctx = { forTenant: jest.fn().mockResolvedValue({ tenantId: TENANT, schoolId: SCHOOL }) };
  const queue = { add: jest.fn() };
  const service = new ImportsService(prisma as never, ctx as never, queue as never);

  return { service, prisma, tx, studentUpdates, rowFlips, audits, batchSummaryUpdates };
}

describe('ImportsService.resolveConflict — keep_current (AC-4)', () => {
  it('leaves the matched student UNTOUCHED, flips the row, writes one append-only audit', async () => {
    const { service, tx, studentUpdates, rowFlips, audits } = makeService();

    await service.resolveConflict('batch-1', 'row-1', 'keep_current', ACTOR);

    // The child's identity is preserved — NO student write on keep_current.
    expect(tx.student.update).not.toHaveBeenCalled();
    expect(studentUpdates).toHaveLength(0);

    // The row is flipped out of the unresolved-conflict set: applied + unchanged,
    // guarded on the row STILL being a conflict (concurrent double-resolve safe).
    expect(rowFlips).toHaveLength(1);
    expect(rowFlips[0]!.where).toMatchObject({ reconciliation: ReconciliationClass.conflict });
    expect(rowFlips[0]!.data).toMatchObject({
      status: ImportRowStatus.applied,
      reconciliation: ReconciliationClass.unchanged,
      createdEntityId: 'stu-existing-1',
    });

    // One append-only audit row records the choice + the arbitrated fields.
    expect(audits).toHaveLength(1);
    expect(audits[0]!.action).toBe('import.conflict.resolve');
    expect(audits[0]!.tenantId).toBe(TENANT);
    expect((audits[0]!.after as Record<string, unknown>).decision).toBe('keep_current');
  });
});

describe('ImportsService.resolveConflict — take_source (AC-5)', () => {
  it('writes the source identity onto the matched student + flips reconciliation→updated, audited', async () => {
    const { service, tx, studentUpdates, rowFlips, audits } = makeService();

    await service.resolveConflict('batch-1', 'row-1', 'take_source', ACTOR);

    // take_source is the ONLY write path — the source identity is applied.
    expect(tx.student.update).toHaveBeenCalledTimes(1);
    expect(studentUpdates[0]).toMatchObject({ firstName: 'Léa', lastName: 'Bernard' });

    // Row → applied/updated, createdEntityId = the PRE-EXISTING student (rollback excludes it).
    expect(rowFlips[0]!.data).toMatchObject({
      status: ImportRowStatus.applied,
      reconciliation: ReconciliationClass.updated,
      createdEntityId: 'stu-existing-1',
    });

    expect(audits[0]!.action).toBe('import.conflict.resolve');
    expect((audits[0]!.after as Record<string, unknown>).decision).toBe('take_source');
    expect((audits[0]!.after as Record<string, unknown>).reconciliation).toBe(ReconciliationClass.updated);
  });

  it('adjusts the batch byClass roll-up (conflict-1, updated+1) so the panel stays truthful', async () => {
    const { service, batchSummaryUpdates } = makeService();

    await service.resolveConflict('batch-1', 'row-1', 'take_source', ACTOR);

    const summaryWrite = batchSummaryUpdates.find((d) => (d.summary as Record<string, unknown>)?.byClass);
    const byClass = (summaryWrite!.summary as Record<string, Record<string, number>>).byClass!;
    expect(byClass.conflict).toBe(0); // 1 → 0
    expect(byClass.updated).toBe(1); // 0 → 1
  });
});

describe('ImportsService.resolveConflict — tenant + state wall (AC-6)', () => {
  it('a cross-tenant batch is rejected (never leaks the row)', async () => {
    const { service } = makeService({ batch: batchRow({ tenantId: OTHER_TENANT }) });
    await expect(
      service.resolveConflict('batch-1', 'row-1', 'keep_current', ACTOR),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('a missing batch → 404', async () => {
    const { service } = makeService({ batch: null });
    await expect(
      service.resolveConflict('nope', 'row-1', 'keep_current', ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a non-applied batch → 400 (arbitration only on an applied batch)', async () => {
    const { service } = makeService({ batch: batchRow({ status: ImportStatus.validated }) });
    await expect(
      service.resolveConflict('batch-1', 'row-1', 'keep_current', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a missing row → 404', async () => {
    const { service } = makeService({ batch: batchRow({ rows: [] }) });
    await expect(
      service.resolveConflict('batch-1', 'row-1', 'keep_current', ACTOR),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a non-conflict row → 400 (already arbitrated / no disagreement)', async () => {
    const { service } = makeService({
      batch: batchRow({ rows: [conflictRow({ reconciliation: ReconciliationClass.updated })] }),
    });
    await expect(
      service.resolveConflict('batch-1', 'row-1', 'take_source', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a concurrent double-resolve (row already flipped) → 400, never a second overwrite', async () => {
    const { service, tx } = makeService({ rowFlipCount: 0 });
    await expect(
      service.resolveConflict('batch-1', 'row-1', 'take_source', ACTOR),
    ).rejects.toBeInstanceOf(BadRequestException);
    // The write happened in the tx, but the guarded flip lost the race → the tx
    // throws and rolls back (the student write is reverted with it).
    expect(tx.importRow.updateMany).toHaveBeenCalled();
  });
});
