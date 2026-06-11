import { ImportRowStatus, ReconciliationClass, type ImportMode } from '@prisma/client';
import {
  applyBatchRows,
  enrollmentsHandler,
  resolveRowConflict,
  rollbackBatchRows,
  studentsHandler,
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

describe('imports-core engine — conflict resolution (E11-S4)', () => {
  it('rejects a resolve on a handler that does not support arbitration', async () => {
    const base = makeCountingHandler().handler; // no resolveConflict
    await expect(
      resolveRowConflict({
        tx: {} as never,
        handler: base,
        payload: {},
        decision: 'keep_current',
        caches: {} as never,
        schoolId: 'school-1',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/ne supporte pas/);
  });

  it('keep_current → unchanged, writes NOTHING to the matched student (child identity preserved)', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const tx = {
      student: {
        findFirst: jest.fn(async () => ({ id: 'existing-1' })),
        update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          updates.push(data);
          return { id: 'existing-1' };
        }),
      },
    };

    const res = await resolveRowConflict({
      tx: tx as never,
      handler: studentsHandler,
      payload: { externalRef: 'EL-1', firstName: 'Léa', lastName: 'Bernard' },
      decision: 'keep_current',
      caches: {} as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });

    expect(res).toEqual({ entityId: 'existing-1', type: 'student', reconciliation: ReconciliationClass.unchanged });
    expect(tx.student.update).not.toHaveBeenCalled(); // NO write — the only safe default
  });

  it('take_source → updated, writes the source identity onto the EXISTING student (audited overwrite, not silent)', async () => {
    const updates: Array<Record<string, unknown>> = [];
    const tx = {
      student: {
        findFirst: jest.fn(async () => ({ id: 'existing-1' })),
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push({ where, ...data });
          return { id: where.id };
        }),
      },
    };

    const res = await resolveRowConflict({
      tx: tx as never,
      handler: studentsHandler,
      payload: { externalRef: 'EL-1', firstName: 'Léa', lastName: 'Bernard', birthDate: '2012-03-15' },
      decision: 'take_source',
      caches: {} as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });

    expect(res).toEqual({ entityId: 'existing-1', type: 'student', reconciliation: ReconciliationClass.updated });
    expect(tx.student.update).toHaveBeenCalledTimes(1);
    expect(updates[0]).toMatchObject({ firstName: 'Léa', lastName: 'Bernard' });
    // The matched entity id is the PRE-EXISTING one → rollback keeps it out of the delete set.
    expect(res.entityId).toBe('existing-1');
  });

  it('throws (never a 500) when the matched student vanished before arbitration', async () => {
    const tx = { student: { findFirst: jest.fn(async () => null), update: jest.fn() } };
    await expect(
      resolveRowConflict({
        tx: tx as never,
        handler: studentsHandler,
        payload: { externalRef: 'EL-gone', firstName: 'Léa', lastName: 'Bernard' },
        decision: 'take_source',
        caches: {} as never,
        schoolId: 'school-1',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/introuvable/);
  });

  // -------------------------------------------------------------------------
  // Enrollments class-move arbitration — the FULL composite @@unique
  // ([studentId, classSectionId, academicYearId]) spans NON-active rows, so a
  // student with a HISTORICAL (e.g. transferred_out) row for the SOURCE class
  // this year must NOT crash take_source with a raw Prisma P2002 → HTTP 500.
  // -------------------------------------------------------------------------
  const EN_AY = 'ay-1';
  function enrollmentCaches(): never {
    return {
      gradeLevelsByCode: new Map(),
      gradeLevelsByName: new Map(),
      classNamesPerYearLevel: new Set<string>(),
      classSectionsByName: new Map([
        [`${EN_AY}:6eb`, { id: 'cls-6eB', gradeLevelId: 'gl-1', academicYearId: EN_AY, maxStudents: 30, currentSize: 0 }],
      ]),
      subjectsByCode: new Map(),
      studentExternalRefs: new Map([['EL-1', 'stu-1']]),
      studentsByExternalRef: new Map(),
      guardiansByEmail: new Map(),
      activeAcademicYearId: EN_AY,
    } as never;
  }

  it('take_source → clean French 4xx (never a 500) when a HISTORICAL row already holds the source class this year', async () => {
    // The child is active in 6eA but has a prior transferred_out row in 6eB this
    // same year; the source proposes 6eB. The pre-existing-row probe must trip
    // BEFORE the update and surface a kind 4xx instead of letting the composite
    // @@unique fire a P2002 → 500.
    const update = jest.fn();
    const tx = {
      enrollment: {
        findFirst: jest
          .fn()
          // 1st call = active-enrollment probe (active in 6eA)
          .mockResolvedValueOnce({ id: 'enr-active', classSectionId: 'cls-6eA' })
          // 2nd call = composite-collision probe (the historical 6eB row)
          .mockResolvedValueOnce({ id: 'enr-hist-6eB', classSectionId: 'cls-6eB' }),
        update,
      },
    };

    await expect(
      resolveRowConflict({
        tx: tx as never,
        handler: enrollmentsHandler,
        payload: { studentExternalRef: 'EL-1', className: '6eB' },
        decision: 'take_source',
        caches: enrollmentCaches(),
        schoolId: 'school-1',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/déjà une inscription.*déplacement impossible/);
    expect(update).not.toHaveBeenCalled(); // never reached the colliding write
  });

  it('take_source → updated when NO historical row collides (the AC-3 happy path still moves the child)', async () => {
    const update = jest.fn(async () => ({ id: 'enr-active' }));
    const tx = {
      enrollment: {
        findFirst: jest
          .fn()
          .mockResolvedValueOnce({ id: 'enr-active', classSectionId: 'cls-6eA' }) // active probe
          .mockResolvedValueOnce(null), // collision probe → clear
        update,
      },
    };

    const res = await resolveRowConflict({
      tx: tx as never,
      handler: enrollmentsHandler,
      payload: { studentExternalRef: 'EL-1', className: '6eB' },
      decision: 'take_source',
      caches: enrollmentCaches(),
      schoolId: 'school-1',
      actor: ACTOR,
    });

    expect(res).toEqual({ entityId: 'enr-active', type: 'enrollment', reconciliation: ReconciliationClass.updated });
    expect(update).toHaveBeenCalledTimes(1);
  });
});

describe('imports-core engine — enrollments conflict arbitration (E11 polish, hardening #6)', () => {
  const AY = 'ay-1';

  /** Caches whose anchors re-resolve the durable natural keys to REAL ids (mirrors applyRow). */
  function arbitrationCaches(opts: {
    studentRef?: [ref: string, id: string];
    className?: [name: string, id: string];
  }) {
    const studentExternalRefs = new Map<string, string>();
    if (opts.studentRef) studentExternalRefs.set(opts.studentRef[0], opts.studentRef[1]);
    const classSectionsByName = new Map<
      string,
      { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }
    >();
    if (opts.className) {
      classSectionsByName.set(`${AY}:${opts.className[0].toLowerCase()}`, {
        id: opts.className[1],
        gradeLevelId: 'gl-1',
        academicYearId: AY,
        maxStudents: 30,
        currentSize: 0,
      });
    }
    return {
      gradeLevelsByCode: new Map(),
      gradeLevelsByName: new Map(),
      classNamesPerYearLevel: new Set<string>(),
      classSectionsByName,
      subjectsByCode: new Map(),
      studentExternalRefs,
      studentsByExternalRef: new Map(),
      guardiansByEmail: new Map(),
      activeAcademicYearId: AY,
    };
  }

  /**
   * A tx answering BOTH enrollment.findFirst probes the handler issues:
   *  - the active-enrollment probe (`where.status === 'active'`, no `id`) → returns `active`;
   *  - the composite-unique collision probe (`where.id.not`, the historical-row guard) →
   *    returns `collision` (default `null` = no pre-existing row in the source class).
   * It also captures enrollment.update calls.
   */
  function makeTx(
    active: { id: string; classSectionId: string } | null,
    collision: { id: string } | null = null,
  ) {
    const updates: Array<{ where: { id: string }; data: Record<string, unknown> }> = [];
    const tx = {
      enrollment: {
        findFirst: jest.fn(async (args?: { where?: { id?: unknown } }) =>
          args?.where?.id !== undefined ? collision : active,
        ),
        update: jest.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
          updates.push(args);
          return { id: args.where.id, ...args.data };
        }),
        create: jest.fn(),
        deleteMany: jest.fn(),
      },
    };
    return { tx, updates };
  }

  it('(d) — resolveRowConflict dispatches to enrollmentsHandler (no longer "ne supporte pas")', async () => {
    const { tx } = makeTx({ id: 'enr-x', classSectionId: 'cls-old' });
    const res = await resolveRowConflict({
      tx: tx as never,
      handler: enrollmentsHandler,
      payload: { studentExternalRef: 'EL-1', className: '6eA' },
      decision: 'keep_current',
      caches: arbitrationCaches({ studentRef: ['EL-1', 'stu-1'], className: ['6eA', 'cls-new'] }) as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });
    expect(res.type).toBe('enrollment');
  });

  it('(a) — keep_current → unchanged, NO enrollment.update, entityId = pre-existing active.id', async () => {
    const { tx, updates } = makeTx({ id: 'enr-x', classSectionId: 'cls-old' });
    const res = await resolveRowConflict({
      tx: tx as never,
      handler: enrollmentsHandler,
      payload: { studentExternalRef: 'EL-1', className: '6eA' },
      decision: 'keep_current',
      caches: arbitrationCaches({ studentRef: ['EL-1', 'stu-1'], className: ['6eA', 'cls-new'] }) as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });

    expect(res).toEqual({ entityId: 'enr-x', type: 'enrollment', reconciliation: ReconciliationClass.unchanged });
    expect(tx.enrollment.update).not.toHaveBeenCalled(); // child stays put — no write
    expect(updates).toHaveLength(0);
  });

  it('(b) — take_source → updated, EXACTLY one enrollment.update sets the re-resolved class, ZERO create, entityId = active.id', async () => {
    const { tx, updates } = makeTx({ id: 'enr-x', classSectionId: 'cls-old' });
    const res = await resolveRowConflict({
      tx: tx as never,
      handler: enrollmentsHandler,
      payload: { studentExternalRef: 'EL-1', className: '6eA' },
      decision: 'take_source',
      // The cache re-resolves the SOURCE class to 'cls-new' (NOT a stale baked id).
      caches: arbitrationCaches({ studentRef: ['EL-1', 'stu-1'], className: ['6eA', 'cls-new'] }) as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });

    expect(res).toEqual({ entityId: 'enr-x', type: 'enrollment', reconciliation: ReconciliationClass.updated });
    expect(tx.enrollment.update).toHaveBeenCalledTimes(1);
    expect(tx.enrollment.create).not.toHaveBeenCalled(); // in-place move, no duplicate seat
    expect(updates[0]!.where).toEqual({ id: 'enr-x' }); // the PRE-EXISTING active row
    expect(updates[0]!.data).toEqual({ classSectionId: 'cls-new' }); // moved to the re-resolved source class
  });

  it('(c) — a vanished active enrollment at arbitration time throws /introuvable/ (a 4xx, never a 500), no write', async () => {
    const { tx } = makeTx(null); // active enrollment gone between conflict record and arbitration
    await expect(
      resolveRowConflict({
        tx: tx as never,
        handler: enrollmentsHandler,
        payload: { studentExternalRef: 'EL-1', className: '6eA' },
        decision: 'take_source',
        caches: arbitrationCaches({ studentRef: ['EL-1', 'stu-1'], className: ['6eA', 'cls-new'] }) as never,
        schoolId: 'school-1',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/introuvable/i);
    expect(tx.enrollment.update).not.toHaveBeenCalled();
    expect(tx.enrollment.create).not.toHaveBeenCalled();
  });

  it('re-resolution is authoritative — a stale baked `_classSectionId` never wins over the cache-resolved source class', async () => {
    const { tx, updates } = makeTx({ id: 'enr-x', classSectionId: 'cls-old' });
    await resolveRowConflict({
      tx: tx as never,
      handler: enrollmentsHandler,
      payload: { studentExternalRef: 'EL-1', className: '6eA', _classSectionId: 'cls-STALE', _studentId: 'stu-STALE' },
      decision: 'take_source',
      caches: arbitrationCaches({ studentRef: ['EL-1', 'stu-1'], className: ['6eA', 'cls-new'] }) as never,
      schoolId: 'school-1',
      actor: ACTOR,
    });
    expect(updates[0]!.data).toEqual({ classSectionId: 'cls-new' }); // cache wins, not 'cls-STALE'
  });

  it('a vanished student/class anchor at arbitration throws /introuvable/, never a 500', async () => {
    const { tx } = makeTx({ id: 'enr-x', classSectionId: 'cls-old' });
    await expect(
      resolveRowConflict({
        tx: tx as never,
        handler: enrollmentsHandler,
        payload: { studentExternalRef: 'EL-GONE', className: 'FANTÔME' },
        decision: 'take_source',
        caches: arbitrationCaches({}) as never, // nothing re-resolves, nothing stored
        schoolId: 'school-1',
        actor: ACTOR,
      }),
    ).rejects.toThrow(/introuvable/i);
  });
});

describe('imports-core students handler — re-run convergence (E11-S4 AC-4)', () => {
  /** Build the minimal caches the students handler reads, seeded with one existing student. */
  function cachesWithExisting(existing: {
    id: string;
    firstName: string;
    lastName: string;
    birthDate: Date | null;
    email: string | null;
    notes: string | null;
    externalRef: string;
  }) {
    return {
      gradeLevelsByCode: new Map(),
      gradeLevelsByName: new Map(),
      classNamesPerYearLevel: new Set<string>(),
      classSectionsByName: new Map(),
      subjectsByCode: new Map(),
      studentExternalRefs: new Map([[existing.externalRef, existing.id]]),
      studentsByExternalRef: new Map([
        [
          existing.externalRef,
          {
            id: existing.id,
            firstName: existing.firstName,
            lastName: existing.lastName,
            birthDate: existing.birthDate,
            email: existing.email,
            notes: existing.notes,
          },
        ],
      ]),
      guardiansByEmail: new Map(),
      activeAcademicYearId: null,
    };
  }

  it('a 2nd sync of an UNCHANGED roster row converges to `unchanged` with 0 created — no duplicate student', async () => {
    const caches = cachesWithExisting({
      id: 'stu-1',
      firstName: 'Léa',
      lastName: 'Martin',
      birthDate: new Date('2012-03-15'),
      email: 'lea@example.local',
      notes: null,
      externalRef: 'EL-1',
    });
    const created: unknown[] = [];
    const tx = {
      student: {
        create: jest.fn(async (args: unknown) => {
          created.push(args);
          return { id: 'should-not-happen' };
        }),
        update: jest.fn(),
      },
    };

    // The SAME row the first sync already applied (matched by externalRef).
    const normalized = {
      firstName: 'Léa',
      lastName: 'Martin',
      birthDate: '2012-03-15',
      externalRef: 'EL-1',
      email: 'lea@example.local',
      notes: undefined,
      _matchedStudentId: 'stu-1',
    };

    const res = await studentsHandler.applyRow(normalized as never, {
      tenantId: 'tenant-1',
      schoolId: 'school-1',
      caches: caches as never,
      tx: tx as never,
    });

    expect(res.reconciliation).toBe(ReconciliationClass.unchanged);
    expect(res.id).toBe('stu-1'); // points at the EXISTING student, not a new one
    expect(tx.student.create).not.toHaveBeenCalled(); // 0 created on the re-run (AC-4)
    expect(tx.student.update).not.toHaveBeenCalled(); // nothing changed → no write
  });

  it('a protected-field divergence on a matched row → `conflict` (recorded, never written) — not an auto-overwrite of a child', async () => {
    const caches = cachesWithExisting({
      id: 'stu-1',
      firstName: 'Léa',
      lastName: 'Martin',
      birthDate: new Date('2012-03-15'),
      email: null,
      notes: null,
      externalRef: 'EL-1',
    });
    const tx = { student: { create: jest.fn(), update: jest.fn() } };

    const res = await studentsHandler.applyRow(
      {
        firstName: 'Léa',
        lastName: 'Bernard', // diverges from the stored 'Martin'
        birthDate: '2012-03-15',
        externalRef: 'EL-1',
        _matchedStudentId: 'stu-1',
      } as never,
      { tenantId: 'tenant-1', schoolId: 'school-1', caches: caches as never, tx: tx as never },
    );

    expect(res.reconciliation).toBe(ReconciliationClass.conflict);
    expect(res.conflictFields).toEqual([{ field: 'lastName', current: 'Martin', source: 'Bernard' }]);
    expect(tx.student.update).not.toHaveBeenCalled(); // no silent overwrite (AC-6)
    expect(tx.student.create).not.toHaveBeenCalled();
  });
});

describe('imports-core enrollments handler — apply-time re-resolution (E11-S3 follow-up d)', () => {
  const AY = 'ay-1';

  /** Build caches whose anchor maps point at the given real student/class ids. */
  function caches(opts: {
    studentRef?: [ref: string, id: string];
    className?: [name: string, id: string, maxStudents?: number, currentSize?: number];
    activeYear?: string | null;
  }) {
    const studentExternalRefs = new Map<string, string>();
    if (opts.studentRef) studentExternalRefs.set(opts.studentRef[0], opts.studentRef[1]);
    const classSectionsByName = new Map<
      string,
      { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }
    >();
    const ay = opts.activeYear === undefined ? AY : opts.activeYear;
    if (opts.className && ay) {
      classSectionsByName.set(`${ay}:${opts.className[0].toLowerCase()}`, {
        id: opts.className[1],
        gradeLevelId: 'gl-1',
        academicYearId: ay,
        maxStudents: opts.className[2] ?? 30,
        currentSize: opts.className[3] ?? 0,
      });
    }
    return {
      gradeLevelsByCode: new Map(),
      gradeLevelsByName: new Map(),
      classNamesPerYearLevel: new Set<string>(),
      classSectionsByName,
      subjectsByCode: new Map(),
      studentExternalRefs,
      studentsByExternalRef: new Map(),
      guardiansByEmail: new Map(),
      activeAcademicYearId: ay,
    };
  }

  /**
   * A tx that captures enrollment.create + answers the active-enrollment probe.
   * `existingActive` controls whether the student is already actively enrolled,
   * and in which class (`activeClassId`, default `cls-old`).
   */
  function makeEnrollmentTx(existingActive = false, activeClassId = 'cls-old') {
    const creates: Array<Record<string, unknown>> = [];
    const tx = {
      enrollment: {
        findFirst: jest.fn(async () => (existingActive ? { id: 'enr-x', classSectionId: activeClassId } : null)),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return { id: `enr-${creates.length}` };
        }),
        deleteMany: jest.fn(),
      },
    };
    return { tx, creates };
  }

  it('AC-3 — resolves studentId/classSectionId from the apply-time caches (NOT a payload-baked id)', async () => {
    // The persisted payload carries ONLY the durable natural keys (the OneRoster
    // path strips the `_`-ids). The apply-time caches point the anchors at REAL
    // ids that differ from any value the payload could have baked — the created
    // Enrollment MUST use the cache-resolved ids.
    const { tx, creates } = makeEnrollmentTx();
    const res = await enrollmentsHandler.applyRow(
      { studentExternalRef: 'EL-1', className: '6eA' } as never,
      {
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        caches: caches({ studentRef: ['EL-1', 'stu-real-1'], className: ['6eA', 'cls-real-1'] }) as never,
        tx: tx as never,
      },
    );

    expect(creates).toHaveLength(1);
    expect(creates[0]!.studentId).toBe('stu-real-1');
    expect(creates[0]!.classSectionId).toBe('cls-real-1');
    expect(creates[0]!.academicYearId).toBe(AY);
    expect(res.type).toBe('enrollment');
  });

  it('AC-4 — a CSV-shaped row with a stored real `_studentId`/`_classSectionId` and NO anchor falls back byte-identically', async () => {
    // CSV path: the anchor refs are absent from the apply-time caches (e.g. a
    // mid-batch cache built before this student/class), but the stored ids are the
    // real DB ids captured at validate → the apply must fall back to them.
    const { tx, creates } = makeEnrollmentTx();
    await enrollmentsHandler.applyRow(
      {
        studentExternalRef: 'EL-NOPE',
        className: 'INCONNUE',
        _studentId: 'stu-stored',
        _classSectionId: 'cls-stored',
        _academicYearId: 'ay-stored',
      } as never,
      {
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        caches: caches({}) as never, // anchors resolve to nothing
        tx: tx as never,
      },
    );

    expect(creates).toHaveLength(1);
    expect(creates[0]!.studentId).toBe('stu-stored');
    expect(creates[0]!.classSectionId).toBe('cls-stored');
    expect(creates[0]!.academicYearId).toBe('ay-stored');
  });

  it('AC-3 — the cache-resolved id WINS over any stored `_studentId` (re-resolution is authoritative)', async () => {
    const { tx, creates } = makeEnrollmentTx();
    await enrollmentsHandler.applyRow(
      {
        studentExternalRef: 'EL-1',
        className: '6eA',
        _studentId: 'stu-STALE-placeholder',
        _classSectionId: 'cls-STALE-placeholder',
      } as never,
      {
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        caches: caches({ studentRef: ['EL-1', 'stu-real-1'], className: ['6eA', 'cls-real-1'] }) as never,
        tx: tx as never,
      },
    );
    expect(creates[0]!.studentId).toBe('stu-real-1'); // cache wins, not the stale baked id
    expect(creates[0]!.classSectionId).toBe('cls-real-1');
  });

  it('AC-5 — an unresolvable anchor (no cache hit, no usable stored id) throws a clear French error, never a phantom FK', async () => {
    const { tx, creates } = makeEnrollmentTx();
    await expect(
      enrollmentsHandler.applyRow(
        { studentExternalRef: 'EL-GHOST', className: 'FANTÔME' } as never,
        {
          tenantId: 'tenant-1',
          schoolId: 'school-1',
          caches: caches({}) as never, // nothing resolves, nothing stored
          tx: tx as never,
        },
      ),
    ).rejects.toThrow(/introuvable/i);
    expect(creates).toHaveLength(0); // never created against a non-existent id
  });

  it('FR5 — a re-sync of an already-active SAME-class enrollment converges to `unchanged` (0 created, no throw, no duplicate)', async () => {
    // The student is already actively enrolled in the SAME class the row targets
    // (cls-real-1). A 2nd pull must SKIP it cleanly (unchanged), never throw — so
    // the batch finalizes `applied` not `failed`, and no duplicate enrollment is
    // created. This is the FR5/AC-4 "0 created convergence" the throwing guard
    // previously broke (the engine re-throws → whole-batch abort).
    const { tx, creates } = makeEnrollmentTx(true, 'cls-real-1');
    const res = await enrollmentsHandler.applyRow(
      { studentExternalRef: 'EL-1', className: '6eA' } as never,
      {
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        caches: caches({ studentRef: ['EL-1', 'stu-real-1'], className: ['6eA', 'cls-real-1'] }) as never,
        tx: tx as never,
      },
    );

    expect(res.reconciliation).toBe(ReconciliationClass.unchanged);
    expect(res.id).toBe('enr-x'); // points at the PRE-EXISTING enrollment (rollback-safe)
    expect(res.type).toBe('enrollment');
    expect(creates).toHaveLength(0); // 0 created on the re-run — no duplicate enrollment
  });

  it('FR5 — an already-active student presented for a DIFFERENT class this year → `conflict` (recorded, never written, no silent class move)', async () => {
    // The student is actively enrolled in `cls-old` but the row targets `6eA`
    // (cls-real-1). This is NOT an idempotent re-run — it is a real divergence
    // (the SIS moved the child, or a bad mapping). It must be recorded as a
    // `conflict` for admin arbitration, NEVER a silent re-enrollment/move.
    const { tx, creates } = makeEnrollmentTx(true, 'cls-old');
    const res = await enrollmentsHandler.applyRow(
      { studentExternalRef: 'EL-1', className: '6eA' } as never,
      {
        tenantId: 'tenant-1',
        schoolId: 'school-1',
        caches: caches({ studentRef: ['EL-1', 'stu-real-1'], className: ['6eA', 'cls-real-1'] }) as never,
        tx: tx as never,
      },
    );

    expect(res.reconciliation).toBe(ReconciliationClass.conflict);
    expect(res.conflictFields).toEqual([
      { field: 'classSectionId', current: 'cls-old', source: 'cls-real-1' },
    ]);
    expect(creates).toHaveLength(0); // no silent re-enrollment / no class move
  });
});

describe('imports-core enrollments handler — mixed re-run batch (E11-S4 FR5/AC-4)', () => {
  const AY = 'ay-1';

  function makeEnrollmentCaches() {
    const classSectionsByName = new Map<
      string,
      { id: string; gradeLevelId: string; academicYearId: string; maxStudents: number; currentSize: number }
    >();
    classSectionsByName.set(`${AY}:6ea`, {
      id: 'cls-6ea',
      gradeLevelId: 'gl-1',
      academicYearId: AY,
      maxStudents: 30,
      currentSize: 1,
    });
    return {
      gradeLevelsByCode: new Map(),
      gradeLevelsByName: new Map(),
      classNamesPerYearLevel: new Set<string>(),
      classSectionsByName,
      subjectsByCode: new Map(),
      studentExternalRefs: new Map<string, string>([
        ['EL-already', 'stu-already'],
        ['EL-new', 'stu-new'],
      ]),
      studentsByExternalRef: new Map(),
      guardiansByEmail: new Map(),
      activeAcademicYearId: AY,
    };
  }

  it('a re-run batch with an already-enrolled row + a genuinely new row finalizes APPLIED (not failed) with 0 created for the unchanged row', async () => {
    // The fake tx: the already-enrolled student returns an active enrollment in
    // the SAME class; the new student returns none. The whole batch must NOT abort.
    const rowUpdates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const audits: Array<{ data: Record<string, unknown> }> = [];
    const creates: Array<Record<string, unknown>> = [];
    const tx = {
      enrollment: {
        findFirst: jest.fn(async ({ where }: { where: { studentId: string } }) =>
          where.studentId === 'stu-already'
            ? { id: 'enr-already', classSectionId: 'cls-6ea' }
            : null,
        ),
        create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
          creates.push(data);
          return { id: `enr-new-${creates.length}` };
        }),
        deleteMany: jest.fn(),
      },
      importRow: {
        update: jest.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
          rowUpdates.push({ id: where.id, data });
          return { id: where.id, ...data };
        }),
      },
      auditLog: {
        create: jest.fn(async (args: { data: Record<string, unknown> }) => {
          audits.push(args);
          return args.data;
        }),
      },
    };

    const rows: EngineRow[] = [
      // already actively enrolled in the SAME class → must skip cleanly (unchanged)
      { id: 'r1', rowIndex: 1, status: ImportRowStatus.valid, payload: { studentExternalRef: 'EL-already', className: '6eA' }, createdEntityId: null },
      // a genuinely new enrollment → created
      { id: 'r2', rowIndex: 2, status: ImportRowStatus.valid, payload: { studentExternalRef: 'EL-new', className: '6eA' }, createdEntityId: null },
    ];

    const result = await applyBatchRows({
      tx: tx as never,
      handler: enrollmentsHandler,
      rows,
      caches: makeEnrollmentCaches() as never,
      schoolId: 'school-1',
      actor: ACTOR,
      mode: MODE,
      batch: { id: 'batch-enr', type: 'enrollments' },
    });

    // The batch did NOT abort: the already-enrolled row is `unchanged` (0 created),
    // the new row is `created`, exactly one audit row written.
    expect(result.applied).toBe(2); // unchanged + created both count as applied
    expect(result.skipped).toBe(0);
    expect(result.byClass).toEqual({ created: 1, updated: 0, unchanged: 1, conflict: 0, skipped: 0 });
    expect(creates).toHaveLength(1); // ONLY the new student — 0 created for the unchanged row (AC-4)
    expect(audits).toHaveLength(1);
    expect(audits[0]!.data.action).toBe('import.apply');

    // The unchanged row carries createdEntityId = the PRE-EXISTING enrollment (rollback-safe).
    const r1Update = rowUpdates.find((u) => u.id === 'r1')!;
    expect(r1Update.data.status).toBe(ImportRowStatus.applied);
    expect(r1Update.data.reconciliation).toBe(ReconciliationClass.unchanged);
    expect(r1Update.data.createdEntityId).toBe('enr-already');
  });
});
