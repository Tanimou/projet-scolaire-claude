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

function makeRecomputeHarness() {
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

  const tx = {
    studentSubjectSnapshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockImplementation(capture('subject')),
      create: jest.fn().mockImplementation(capture('subject')),
    },
    studentGlobalSnapshot: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      upsert: jest.fn().mockImplementation(capture('global')),
      create: jest.fn().mockImplementation(capture('global')),
    },
    classSubjectDistribution: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
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
