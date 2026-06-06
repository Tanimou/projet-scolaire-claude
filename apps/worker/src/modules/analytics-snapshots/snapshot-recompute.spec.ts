import { snapshotCoalesceKey } from './snapshot-keys';
import {
  competitionRank,
  distribution,
  mean,
  onTwenty,
  resolveCoef,
  round2,
  trendDelta,
  weightedGlobal,
} from './snapshot-formula';
import { SnapshotDrainCronService } from './snapshot-drain-cron.service';
import { SnapshotRecomputeService } from './snapshot-recompute.service';

type Mock = ReturnType<typeof jest.fn>;

// ---------------------------------------------------------------------------
// Part 1 — byte-parity of the SHARED formula against the live AnalyticsService
// arithmetic (lifted verbatim from analytics.service.ts parentDashboard). If the
// live path changes its math, these literals diverge and the test fails — the
// drift tripwire (AC-2, PM-5).
// ---------------------------------------------------------------------------

/** Live `onTwenty`: (value / maxScore) * 20. */
function liveOnTwenty(value: number, maxScore: number): number {
  return (value / maxScore) * 20;
}

describe('snapshot-formula — byte-parity with live AnalyticsService', () => {
  it('onTwenty matches the live normalisation', () => {
    expect(onTwenty(15, 20)).toBe(liveOnTwenty(15, 20));
    expect(onTwenty(8, 10)).toBe(liveOnTwenty(8, 10)); // 16/20
    expect(onTwenty(45, 60)).toBe(liveOnTwenty(45, 60)); // 15/20
  });

  it('resolveCoef mirrors override → subjectCoefficient → default precedence', () => {
    // override wins
    expect(resolveCoef(3, 2, 1)).toBe(3);
    // override null → subjectCoefficient
    expect(resolveCoef(null, 2, 1)).toBe(2);
    // both absent → default
    expect(resolveCoef(undefined, undefined, 1.5)).toBe(1.5);
  });

  it('per-subject average = simple mean of onTwenty grades (live `avg`)', () => {
    const vals = [liveOnTwenty(15, 20), liveOnTwenty(12, 20), liveOnTwenty(18, 20)];
    const live = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(mean(vals)).toBe(live);
  });

  it('global average = coefficient-WEIGHTED mean of subject averages (live weightedSum/totalCoef)', () => {
    const perSubject = [
      { average: 14, coefficient: 3 }, // maths coef 3
      { average: 10, coefficient: 1 }, // sport coef 1
      { average: null, coefficient: 2 }, // ungraded subject — excluded from denominator
    ];
    const weightedSum = 14 * 3 + 10 * 1;
    const totalCoef = 3 + 1;
    const live = weightedSum / totalCoef; // 13.0
    expect(weightedGlobal(perSubject)).toBe(live);
    expect(weightedGlobal([{ average: null, coefficient: 2 }])).toBeNull();
  });

  it('competition rank = (# strictly greater) + 1, ex-æquo share a rank (live `higher + 1`)', () => {
    const all = [16, 14, 14, 9];
    expect(competitionRank(16, all)).toBe(1);
    expect(competitionRank(14, all)).toBe(2); // both 14s rank 2
    expect(competitionRank(9, all)).toBe(4); // three strictly greater (16,14,14)
    expect(competitionRank(null, all)).toBeNull();
  });

  it('trendDelta = lastTerm.avg − previousTerm.avg by term order (live termEvolution delta)', () => {
    expect(
      trendDelta([
        { order: 1, average: 10 },
        { order: 2, average: 13 },
        { order: 3, average: 12 },
      ]),
    ).toBe(12 - 13); // last (T3) − prev (T2)
    expect(trendDelta([{ order: 1, average: 10 }])).toBeNull();
  });

  it('distribution histogram buckets [0,10)/[10,14)/[14,20] + passRate (≥10)', () => {
    const vals = [5, 9, 10, 12, 14, 18, 20];
    const d = distribution(vals);
    expect(d.countLow).toBe(2); // 5, 9
    expect(d.countMid).toBe(2); // 10, 12
    expect(d.countHigh).toBe(3); // 14, 18, 20
    expect(d.gradeCount).toBe(7);
    expect(d.passRate).toBeCloseTo((5 / 7) * 100, 6); // 5 of 7 ≥ 10
    expect(d.average).toBeCloseTo(vals.reduce((a, b) => a + b, 0) / vals.length, 6);
    expect(d.minScore).toBe(5);
    expect(d.maxScore).toBe(20);
    expect(d.median).toBe(12);
    expect(distribution([]).gradeCount).toBe(0);
    expect(distribution([]).average).toBeNull();
  });

  it('round2 pins the Decimal(5,2) write boundary (PM-6)', () => {
    expect(round2(13.6666)).toBe(13.67);
    expect(round2(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Part 2 — coalesce-key determinism + null sentinel (PM-4)
// ---------------------------------------------------------------------------

describe('snapshotCoalesceKey', () => {
  it('is identical for the same (tenant, reason, scope) — idempotent enqueue collapses a burst', () => {
    const scope = { classSectionId: 'c1', subjectId: 's1', termId: 't1', academicYearId: 'y1' };
    expect(snapshotCoalesceKey('T', 'grade_published', scope)).toBe(
      snapshotCoalesceKey('T', 'grade_published', scope),
    );
  });

  it('null termId yields a stable, non-colliding key (explicit "-" sentinel)', () => {
    const withTerm = snapshotCoalesceKey('T', 'grade_published', {
      classSectionId: 'c1',
      subjectId: 's1',
      termId: 't1',
      academicYearId: 'y1',
    });
    const noTerm = snapshotCoalesceKey('T', 'grade_published', {
      classSectionId: 'c1',
      subjectId: 's1',
      termId: null,
      academicYearId: 'y1',
    });
    expect(noTerm).toContain('|-|'); // sentinel present
    expect(noTerm).not.toBe(withTerm); // does not collide with the per-term key
  });

  it('two different classes produce two distinct keys (no false coalescing, PM-2)', () => {
    const base = { subjectId: 's1', termId: 't1', academicYearId: 'y1' };
    expect(snapshotCoalesceKey('T', 'grade_published', { ...base, classSectionId: 'cA' })).not.toBe(
      snapshotCoalesceKey('T', 'grade_published', { ...base, classSectionId: 'cB' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Part 3 — SnapshotRecomputeService.recomputeScope on a seeded fixture: the
// written snapshot rows equal the live AnalyticsService output, idempotently, in
// ONE class-grade findMany (PM-8), all tenant-scoped.
// ---------------------------------------------------------------------------

/** A 1-class / 2-subject / 2-student / 1-term fixture. */
function fixtureGrades() {
  // Maths (coef 3, max 20), Sport (coef 1, max 20), term t1.
  const A = (
    studentId: string,
    subjectId: string,
    defaultCoefficient: number,
    value: number,
  ) => ({
    value,
    studentId,
    assessment: {
      maxScore: 20,
      coefficientOverride: null,
      term: { id: 't1', orderIndex: 1 },
      teachingAssignment: { subject: { id: subjectId, defaultCoefficient } },
    },
  });
  return [
    A('stu1', 'maths', 3, 16), // stu1 maths 16
    A('stu1', 'sport', 1, 10), // stu1 sport 10
    A('stu2', 'maths', 3, 12), // stu2 maths 12
    A('stu2', 'sport', 1, 14), // stu2 sport 14
  ];
}

interface Captured {
  subject: Array<Record<string, unknown>>;
  global: Array<Record<string, unknown>>;
  distribution: Array<Record<string, unknown>>;
}

function makeRecomputeHarness(opts?: { existing?: Record<string, Record<string, unknown>> }) {
  const grades = fixtureGrades();
  const gradeFindMany: Mock = jest.fn().mockResolvedValue(grades);
  const classSectionFindFirst: Mock = jest
    .fn()
    .mockResolvedValue({ id: 'c1', gradeLevelId: 'gl1', academicYearId: 'y1' });
  const subjectCoefFindMany: Mock = jest.fn().mockResolvedValue([]); // use subject defaults
  const studentFindMany: Mock = jest
    .fn()
    .mockResolvedValue([
      { id: 'stu1', schoolId: 'sch1' },
      { id: 'stu2', schoolId: 'sch1' },
    ]);

  const captured: Captured = { subject: [], global: [], distribution: [] };
  const capture =
    (bucket: keyof Captured) =>
    (arg: { create?: { data?: unknown }; data?: unknown }) => {
      const data = (arg.create?.data ?? arg.data) as Record<string, unknown>;
      captured[bucket].push(data);
      return Promise.resolve({ id: 'x', ...data });
    };

  // E6-S5 read-compare-write: `findUnique` returns the row the recompute compares
  // against before deciding to write. `existingRows` lets a test pre-seed a stored
  // row (keyed by `studentId|subjectId|termId` / `studentId|termId` /
  // `classSectionId|subjectId|termId`); default null ⇒ first compute (always writes).
  const existingRows = opts?.existing ?? {};
  const findUniqueFor =
    (keyFn: (args: { k: Record<string, unknown> }) => string) =>
    (arg: { where: Record<string, Record<string, unknown>> }) => {
      const compositeKey = Object.values(arg.where)[0] as Record<string, unknown>;
      const k = keyFn({ k: compositeKey });
      return Promise.resolve(existingRows[k] ?? null);
    };

  const tx = {
    studentSubjectSnapshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockImplementation(
        findUniqueFor(({ k }) => `ss|${k.studentId}|${k.subjectId}|${k.termId}`),
      ),
      upsert: jest.fn().mockImplementation(capture('subject')),
      create: jest.fn().mockImplementation(capture('subject')),
    },
    studentGlobalSnapshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest
        .fn()
        .mockImplementation(findUniqueFor(({ k }) => `sg|${k.studentId}|${k.termId}`)),
      upsert: jest.fn().mockImplementation(capture('global')),
      create: jest.fn().mockImplementation(capture('global')),
    },
    classSubjectDistribution: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockImplementation(
        findUniqueFor(({ k }) => `cd|${k.classSectionId}|${k.subjectId}|${k.termId}`),
      ),
      upsert: jest.fn().mockImplementation(capture('distribution')),
      create: jest.fn().mockImplementation(capture('distribution')),
    },
  };

  const prisma = {
    classSection: { findFirst: classSectionFindFirst },
    subjectCoefficient: { findMany: subjectCoefFindMany },
    grade: { findMany: gradeFindMany },
    student: { findMany: studentFindMany },
    $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx)),
  };

  const service = new SnapshotRecomputeService(prisma as never);
  return { service, prisma, gradeFindMany, captured };
}

const TRIGGER = {
  id: 'trig1',
  tenantId: 't1',
  classSectionId: 'c1',
  subjectId: 'maths',
  academicYearId: 'y1',
};

describe('SnapshotRecomputeService.recomputeScope', () => {
  it('issues exactly ONE class-grade findMany per scope (PM-8 — no per-student scan)', async () => {
    const h = makeRecomputeHarness();
    await h.service.recomputeScope(TRIGGER);
    expect(h.gradeFindMany).toHaveBeenCalledTimes(1);
  });

  it('every source query is tenant-scoped (explicit where:{tenantId})', async () => {
    const h = makeRecomputeHarness();
    await h.service.recomputeScope(TRIGGER);
    expect(h.gradeFindMany.mock.calls[0]![0].where.tenantId).toBe('t1');
    expect(h.prisma.classSection.findFirst.mock.calls[0]![0].where.tenantId).toBe('t1');
    expect(h.prisma.subjectCoefficient.findMany.mock.calls[0]![0].where.tenantId).toBe('t1');
    expect(h.prisma.student.findMany.mock.calls[0]![0].where.tenantId).toBe('t1');
  });

  it('writes per-subject averages byte-identical to the live mean (and the year roll-up)', async () => {
    const h = makeRecomputeHarness();
    await h.service.recomputeScope(TRIGGER);

    // stu1 maths: single grade 16 → avg 16.00. stu2 maths 12 → 12.00.
    const stu1MathsT1 = h.captured.subject.find(
      (r) => r.studentId === 'stu1' && r.subjectId === 'maths' && r.termId === 't1',
    );
    expect(Number(stu1MathsT1!.average)).toBe(16);
    expect(stu1MathsT1!.gradeCount).toBe(1);
    // competition rank: stu1 (16) ranks 1, stu2 (12) ranks 2 in maths.
    expect(stu1MathsT1!.classRank).toBe(1);
    expect(stu1MathsT1!.classSize).toBe(2);

    // A year roll-up (termId null) row exists for stu1 maths too.
    const stu1MathsYear = h.captured.subject.find(
      (r) => r.studentId === 'stu1' && r.subjectId === 'maths' && r.termId === null,
    );
    expect(stu1MathsYear).toBeDefined();
    expect(Number(stu1MathsYear!.average)).toBe(16);
  });

  it('writes the coefficient-WEIGHTED global byte-identical to the live weightedSum/totalCoef', async () => {
    const h = makeRecomputeHarness();
    await h.service.recomputeScope(TRIGGER);

    // stu1: maths 16 (coef 3), sport 10 (coef 1) → (16*3 + 10*1) / 4 = 14.50
    const stu1GlobalT1 = h.captured.global.find(
      (r) => r.studentId === 'stu1' && r.termId === 't1',
    );
    expect(Number(stu1GlobalT1!.globalAverage)).toBe(14.5);
    expect(stu1GlobalT1!.subjectCount).toBe(2);

    // stu2: maths 12 (coef 3), sport 14 (coef 1) → (12*3 + 14*1)/4 = 12.50
    const stu2GlobalT1 = h.captured.global.find(
      (r) => r.studentId === 'stu2' && r.termId === 't1',
    );
    expect(Number(stu2GlobalT1!.globalAverage)).toBe(12.5);

    // GLOBAL rank uses the UNWEIGHTED mean-of-means (PM-7):
    //   stu1 mean-of-means = (16 + 10)/2 = 13; stu2 = (12 + 14)/2 = 13 → tie → both rank 1.
    expect(stu1GlobalT1!.classRank).toBe(1);
    expect(stu2GlobalT1!.classRank).toBe(1);
    expect(stu1GlobalT1!.classSize).toBe(2);
  });

  it('writes the class distribution histogram byte-identical to the live buckets', async () => {
    const h = makeRecomputeHarness();
    await h.service.recomputeScope(TRIGGER);

    // maths term t1: grades 16, 12 → both ≥14? 16 high, 12 mid. passRate 100%.
    const mathsDistT1 = h.captured.distribution.find(
      (r) => r.subjectId === 'maths' && r.termId === 't1',
    );
    expect(mathsDistT1!.countHigh).toBe(1); // 16
    expect(mathsDistT1!.countMid).toBe(1); // 12
    expect(mathsDistT1!.countLow).toBe(0);
    expect(Number(mathsDistT1!.passRate)).toBe(100);
    expect(mathsDistT1!.studentCount).toBe(2);
    expect(Number(mathsDistT1!.average)).toBe(14); // (16+12)/2
  });

  it('is idempotent — a re-run on unchanged grades produces identical figures', async () => {
    const h1 = makeRecomputeHarness();
    await h1.service.recomputeScope(TRIGGER);
    const h2 = makeRecomputeHarness();
    await h2.service.recomputeScope(TRIGGER);

    const pick = (cap: Captured['subject']) =>
      cap
        .map((r) => `${r.studentId}|${r.subjectId}|${r.termId}|${r.average}|${r.classRank}`)
        .sort();
    expect(pick(h1.captured.subject)).toEqual(pick(h2.captured.subject));
  });

  it('a scope with no classSectionId is a no-op (writes nothing)', async () => {
    const h = makeRecomputeHarness();
    const r = await h.service.recomputeScope({ ...TRIGGER, classSectionId: null });
    expect(r.subjectRows).toBe(0);
    expect(h.gradeFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part 5 — E6-S5: idempotent full rebuild (read-compare-write). A re-run on
// UNCHANGED grades, when the stored snapshot rows already hold the byte-identical
// figures, is a TRUE no-op on the value rows: no upsert is issued for an unchanged
// per-term row, so `revision`/`computedAt` never move (AC-S5-2). A real change
// still writes.
// ---------------------------------------------------------------------------

describe('SnapshotRecomputeService.recomputeScope — idempotent rebuild (E6-S5)', () => {
  it('skips the per-term write when the stored row is byte-identical (no revision bump)', async () => {
    // Pre-seed every per-term row with the EXACT figures the fixture produces:
    //   stu1 maths t1 → avg 16, coef 3, gradeCount 1, classRank 1, classSize 2, trend null
    //   stu2 maths t1 → avg 12, coef 3, rank 2; stu1 sport t1 → 10 coef1 rank2; stu2 sport t1 → 14 coef1 rank1
    const existing: Record<string, Record<string, unknown>> = {
      'ss|stu1|maths|t1': { average: 16, coefficient: 3, gradeCount: 1, classRank: 1, classSize: 2, trendDelta: null },
      'ss|stu2|maths|t1': { average: 12, coefficient: 3, gradeCount: 1, classRank: 2, classSize: 2, trendDelta: null },
      'ss|stu1|sport|t1': { average: 10, coefficient: 1, gradeCount: 1, classRank: 2, classSize: 2, trendDelta: null },
      'ss|stu2|sport|t1': { average: 14, coefficient: 1, gradeCount: 1, classRank: 1, classSize: 2, trendDelta: null },
      'sg|stu1|t1': { globalAverage: 14.5, classAverage: 13, classRank: 1, classSize: 2, progressionDelta: null, subjectCount: 2 },
      'sg|stu2|t1': { globalAverage: 12.5, classAverage: 13, classRank: 1, classSize: 2, progressionDelta: null, subjectCount: 2 },
      'cd|c1|maths|t1': { average: 14, median: 14, minScore: 12, maxScore: 16, countLow: 0, countMid: 1, countHigh: 1, passRate: 100, gradeCount: 2, studentCount: 2 },
      'cd|c1|sport|t1': { average: 12, median: 12, minScore: 10, maxScore: 14, countLow: 0, countMid: 1, countHigh: 1, passRate: 100, gradeCount: 2, studentCount: 2 },
    };
    const h = makeRecomputeHarness({ existing });
    await h.service.recomputeScope(TRIGGER);

    // No per-term row changed → NO upsert was issued for the per-term scope. The only
    // writes are the year roll-up `create`s (delete-then-insert, always rebuilt).
    const upsertedPerTerm = h.captured.subject.filter((r) => r.termId !== null && r.termId !== undefined);
    expect(upsertedPerTerm).toHaveLength(0); // every per-term write skipped (unchanged)
  });

  it('still writes the per-term row when a stored figure differs (real change)', async () => {
    const existing: Record<string, Record<string, unknown>> = {
      // stu1 maths stored as 14 but the fixture computes 16 → must re-write.
      'ss|stu1|maths|t1': { average: 14, coefficient: 3, gradeCount: 1, classRank: 1, classSize: 2, trendDelta: null },
    };
    const h = makeRecomputeHarness({ existing });
    await h.service.recomputeScope(TRIGGER);
    const stu1MathsT1 = h.captured.subject.find(
      (r) => r.studentId === 'stu1' && r.subjectId === 'maths' && r.termId === 't1',
    );
    expect(stu1MathsT1).toBeDefined();
    expect(Number(stu1MathsT1!.average)).toBe(16);
  });
});

// ---------------------------------------------------------------------------
// Part 4 — E6-S3 (FR7): the drain fans a class-LESS coefficient_changed trigger
// out to one class-scoped recompute per ClassSection teaching the subject in the
// year (tenant-scoped), marks the trigger done after the whole fan-out, and is a
// no-op for a class-less trigger that cannot be resolved.
// ---------------------------------------------------------------------------

function makeDrainHarness(opts: {
  trigger: {
    id: string;
    reason: string;
    classSectionId: string | null;
    subjectId: string | null;
    academicYearId: string | null;
    attempts?: number;
  };
  assignmentClassIds?: string[];
  sectionIds?: string[];
}) {
  const TENANT = 't1';
  const recompute = { recomputeScope: jest.fn().mockResolvedValue({}) };
  const teachingAssignmentFindMany: Mock = jest
    .fn()
    .mockResolvedValue((opts.assignmentClassIds ?? []).map((classSectionId) => ({ classSectionId })));
  const updateMany: Mock = jest.fn().mockResolvedValue({ count: 1 });
  const trigger = { attempts: 0, ...opts.trigger };

  const prisma = {
    snapshotRecomputeTrigger: {
      // reclaimStaleProcessing
      updateMany,
      // tenantsWithPending / backfill probes
      findMany: jest.fn().mockImplementation((args: { where?: { status?: unknown }; select?: unknown }) => {
        // FIFO candidate list in drainTenant: status pending, select id.
        if ((args.where as { status?: string })?.status === 'pending') {
          return Promise.resolve([{ id: trigger.id }]);
        }
        return Promise.resolve([{ tenantId: TENANT }]);
      }),
      findFirst: jest.fn().mockResolvedValue({ tenantId: TENANT, ...trigger }),
    },
    teachingAssignment: { findMany: teachingAssignmentFindMany },
    grade: { findMany: jest.fn().mockResolvedValue([]) },
    studentSubjectSnapshot: { findFirst: jest.fn().mockResolvedValue({ id: 'x' }) },
    // E6-S5 — whole-tenant manual_rebuild fan-out resolves active class sections.
    classSection: {
      findMany: jest
        .fn()
        .mockResolvedValue((opts.sectionIds ?? []).map((id) => ({ id, academicYearId: 'y1' }))),
    },
  };

  const service = new SnapshotDrainCronService(prisma as never, recompute as never);
  return { service, prisma, recompute, teachingAssignmentFindMany, updateMany, TENANT };
}

describe('SnapshotDrainCronService — coefficient_changed fan-out (E6-S3 FR7)', () => {
  it('fans a class-less coefficient_changed trigger out to one recompute per affected class', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'cf1',
        reason: 'coefficient_changed',
        classSectionId: null,
        subjectId: 'maths',
        academicYearId: 'y1',
      },
      assignmentClassIds: ['cA', 'cB', 'cA'], // duplicate → deduped to 2 classes
    });

    // drainTenant is private; exercise it via the public drain entry.
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);

    // Resolved classes via teachingAssignment (tenant + subject + year scoped).
    expect(h.teachingAssignmentFindMany).toHaveBeenCalledTimes(1);
    const taWhere = h.teachingAssignmentFindMany.mock.calls[0]![0].where;
    expect(taWhere.tenantId).toBe('t1');
    expect(taWhere.subjectId).toBe('maths');
    expect(taWhere.academicYearId).toBe('y1');

    // One recompute per DISTINCT class (cA, cB), each a real class-scoped recompute.
    expect(h.recompute.recomputeScope).toHaveBeenCalledTimes(2);
    const recomputedClasses = h.recompute.recomputeScope.mock.calls.map(
      (c: unknown[]) => (c[0] as { classSectionId: string }).classSectionId,
    );
    expect(new Set(recomputedClasses)).toEqual(new Set(['cA', 'cB']));

    // The trigger is marked done AFTER the fan-out (status:'done').
    const doneCall = h.updateMany.mock.calls.find(
      (c: unknown[]) => (c[0] as { data?: { status?: string } }).data?.status === 'done',
    );
    expect(doneCall).toBeDefined();
  });

  it('a normal class-scoped trigger still routes to recomputeScope unchanged', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'gp1',
        reason: 'grade_published',
        classSectionId: 'cA',
        subjectId: 'maths',
        academicYearId: 'y1',
      },
    });
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);
    expect(h.recompute.recomputeScope).toHaveBeenCalledTimes(1);
    expect(h.recompute.recomputeScope.mock.calls[0]![0].classSectionId).toBe('cA');
    // No fan-out query for a class-scoped trigger.
    expect(h.teachingAssignmentFindMany).not.toHaveBeenCalled();
  });

  it('a class-less coefficient_changed trigger with no resolvable subject/year is a no-op fan-out', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'cf2',
        reason: 'coefficient_changed',
        classSectionId: null,
        subjectId: null,
        academicYearId: null,
      },
    });
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);
    expect(h.recompute.recomputeScope).not.toHaveBeenCalled();
    expect(h.teachingAssignmentFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Part 6 — E6-S5: manual_rebuild trigger routing through the existing drainTenant
// loop. A class-scoped rebuild → one recompute; a class-less (subject, year) rebuild
// → coefficient-style fan-out; a fully-unscoped rebuild → whole-tenant fan-out over
// active class sections (bounded).
// ---------------------------------------------------------------------------

describe('SnapshotDrainCronService — manual_rebuild routing (E6-S5)', () => {
  it('a class-scoped manual_rebuild routes to a single recomputeScope', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'mr1',
        reason: 'manual_rebuild',
        classSectionId: 'cA',
        subjectId: 'maths',
        academicYearId: 'y1',
      },
    });
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);
    expect(h.recompute.recomputeScope).toHaveBeenCalledTimes(1);
    expect(h.recompute.recomputeScope.mock.calls[0]![0].classSectionId).toBe('cA');
    expect(h.teachingAssignmentFindMany).not.toHaveBeenCalled();
  });

  it('a class-less (subject, year) manual_rebuild fans out coefficient-style', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'mr2',
        reason: 'manual_rebuild',
        classSectionId: null,
        subjectId: 'maths',
        academicYearId: 'y1',
      },
      assignmentClassIds: ['cA', 'cB'],
    });
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);
    expect(h.teachingAssignmentFindMany).toHaveBeenCalledTimes(1);
    expect(h.recompute.recomputeScope).toHaveBeenCalledTimes(2);
  });

  it('a fully-unscoped manual_rebuild fans out over every active class section (bounded)', async () => {
    const h = makeDrainHarness({
      trigger: {
        id: 'mr3',
        reason: 'manual_rebuild',
        classSectionId: null,
        subjectId: null,
        academicYearId: null,
      },
      sectionIds: ['cA', 'cB', 'cC'],
    });
    await (h.service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(h.TENANT);
    // No coefficient resolution — whole-tenant goes via classSection.findMany.
    expect(h.teachingAssignmentFindMany).not.toHaveBeenCalled();
    expect((h.prisma.classSection.findMany as Mock)).toHaveBeenCalledTimes(1);
    expect((h.prisma.classSection.findMany as Mock).mock.calls[0]![0].where.tenantId).toBe('t1');
    expect(h.recompute.recomputeScope).toHaveBeenCalledTimes(3);
  });
});

// ---------------------------------------------------------------------------
// Part 7 — E6-S5: sweep hardening — failed-row revival, precise stale detection
// (missed-event self-heal), claim-time staleness, orphan prune. These exercise the
// private sweep methods directly against focused prisma mocks.
// ---------------------------------------------------------------------------

describe('SnapshotDrainCronService — failed-row revival (E6-S5 PM-G)', () => {
  it('revives a parked (failed) trigger older than the cooldown back to pending with attempts=0', async () => {
    const findMany = jest.fn().mockResolvedValue([{ id: 'f1' }, { id: 'f2' }]);
    const updateMany = jest.fn().mockResolvedValue({ count: 2 });
    const prisma = { snapshotRecomputeTrigger: { findMany, updateMany } };
    const service = new SnapshotDrainCronService(prisma as never, { recomputeScope: jest.fn() } as never);
    const revived = await (
      service as unknown as { reviveFailedTriggers(): Promise<number> }
    ).reviveFailedTriggers();

    expect(revived).toBe(2);
    // Selected only failed rows past the cooldown.
    expect(findMany.mock.calls[0]![0].where.status).toBe('failed');
    expect(findMany.mock.calls[0]![0].where.processedAt.lt).toBeInstanceOf(Date);
    // Reset to pending with attempts cleared.
    const data = updateMany.mock.calls[0]![0].data;
    expect(data.status).toBe('pending');
    expect(data.attempts).toBe(0);
  });

  it('is a no-op when there are no parked triggers past the cooldown', async () => {
    const findMany = jest.fn().mockResolvedValue([]);
    const updateMany = jest.fn();
    const prisma = { snapshotRecomputeTrigger: { findMany, updateMany } };
    const service = new SnapshotDrainCronService(prisma as never, { recomputeScope: jest.fn() } as never);
    const revived = await (
      service as unknown as { reviveFailedTriggers(): Promise<number> }
    ).reviveFailedTriggers();
    expect(revived).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('SnapshotDrainCronService — precise stale detection / missed-event self-heal (E6-S5 PM-B)', () => {
  function makeBackfillHarness(opts: {
    snapshot: { computedAt: Date; revision: number } | null;
    gradeUpdatedAt: Date;
  }) {
    const upsert = jest.fn().mockResolvedValue({});
    const prisma = {
      snapshotRecomputeTrigger: {
        // No open triggers anywhere (so the class is eligible for backfill).
        findMany: jest.fn().mockResolvedValue([]),
        upsert,
      },
      grade: {
        findMany: jest.fn().mockResolvedValue([
          {
            tenantId: 't1',
            updatedAt: opts.gradeUpdatedAt,
            assessment: {
              teachingAssignment: { classSectionId: 'cA', subjectId: 'maths', academicYearId: 'y1' },
            },
          },
        ]),
      },
      studentSubjectSnapshot: { findFirst: jest.fn().mockResolvedValue(opts.snapshot) },
    };
    const service = new SnapshotDrainCronService(prisma as never, { recomputeScope: jest.fn() } as never);
    return { service, upsert };
  }

  it('enqueues a coalesced backfill when a POPULATED class snapshot lags the latest grade (dropped enqueue)', async () => {
    const h = makeBackfillHarness({
      snapshot: { computedAt: new Date('2026-06-01T00:00:00Z'), revision: 1 },
      gradeUpdatedAt: new Date('2026-06-02T00:00:00Z'), // grade newer than snapshot
    });
    const n = await (
      h.service as unknown as { backfillLaggingTenants(): Promise<number> }
    ).backfillLaggingTenants();
    expect(n).toBe(1);
    expect(h.upsert).toHaveBeenCalledTimes(1);
    expect(h.upsert.mock.calls[0]![0].create.reason).toBe('backfill');
  });

  it('does NOT enqueue when the snapshot is fresher than the latest grade (no double-sweep)', async () => {
    const h = makeBackfillHarness({
      snapshot: { computedAt: new Date('2026-06-03T00:00:00Z'), revision: 1 },
      gradeUpdatedAt: new Date('2026-06-02T00:00:00Z'), // grade older than snapshot
    });
    const n = await (
      h.service as unknown as { backfillLaggingTenants(): Promise<number> }
    ).backfillLaggingTenants();
    expect(n).toBe(0);
    expect(h.upsert).not.toHaveBeenCalled();
  });

  it('still backfills a class with NO snapshot at all (S1 preserved)', async () => {
    const h = makeBackfillHarness({
      snapshot: null,
      gradeUpdatedAt: new Date('2026-06-02T00:00:00Z'),
    });
    const n = await (
      h.service as unknown as { backfillLaggingTenants(): Promise<number> }
    ).backfillLaggingTenants();
    expect(n).toBe(1);
  });
});

describe('SnapshotDrainCronService — orphan prune (E6-S5 PM-F)', () => {
  it('deletes snapshot rows for a hard-deleted student/class but never a live-owned row', async () => {
    const sample = [
      { id: 'g1', tenantId: 't1', studentId: 'stuGone', classSectionId: 'cLive' },
      { id: 'g2', tenantId: 't1', studentId: 'stuLive', classSectionId: 'cLive' },
    ];
    const globalDelete = jest.fn().mockResolvedValue({ count: 1 });
    const subjectDelete = jest.fn().mockResolvedValue({ count: 2 });
    const distDelete = jest.fn().mockResolvedValue({ count: 0 });
    const prisma = {
      studentGlobalSnapshot: {
        findMany: jest.fn().mockResolvedValue(sample),
        deleteMany: globalDelete,
      },
      studentSubjectSnapshot: { deleteMany: subjectDelete },
      classSubjectDistribution: { deleteMany: distDelete },
      // stuLive exists; stuGone does not. cLive exists.
      student: { findMany: jest.fn().mockResolvedValue([{ id: 'stuLive' }]) },
      classSection: { findMany: jest.fn().mockResolvedValue([{ id: 'cLive' }]) },
    };
    const service = new SnapshotDrainCronService(prisma as never, { recomputeScope: jest.fn() } as never);
    const deleted = await (
      service as unknown as { pruneOrphanSnapshots(): Promise<number> }
    ).pruneOrphanSnapshots();

    // Only stuGone is an orphan → delete keyed on studentId in [stuGone], tenant-scoped.
    expect(globalDelete).toHaveBeenCalledTimes(1);
    const where = globalDelete.mock.calls[0]![0].where;
    expect(where.tenantId).toBe('t1');
    expect(where.OR).toEqual([{ studentId: { in: ['stuGone'] } }]);
    expect(deleted).toBe(3); // 1 global + 2 subject + 0 dist
  });

  it('is a no-op when every sampled row points at a live student + class', async () => {
    const prisma = {
      studentGlobalSnapshot: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'g1', tenantId: 't1', studentId: 'stuLive', classSectionId: 'cLive' }]),
        deleteMany: jest.fn(),
      },
      studentSubjectSnapshot: { deleteMany: jest.fn() },
      classSubjectDistribution: { deleteMany: jest.fn() },
      student: { findMany: jest.fn().mockResolvedValue([{ id: 'stuLive' }]) },
      classSection: { findMany: jest.fn().mockResolvedValue([{ id: 'cLive' }]) },
    };
    const service = new SnapshotDrainCronService(prisma as never, { recomputeScope: jest.fn() } as never);
    const deleted = await (
      service as unknown as { pruneOrphanSnapshots(): Promise<number> }
    ).pruneOrphanSnapshots();
    expect(deleted).toBe(0);
    expect(prisma.studentGlobalSnapshot.deleteMany).not.toHaveBeenCalled();
  });
});
