import { AnalyticsService } from './analytics.service';

/**
 * Unit tests for `AnalyticsService.adminDashboard` — focused on the U1 reorg:
 *   • schoolStructure.cycles drill-down
 *   • teacherCoverageBySubject / teacherCoverageByClass (incl. hasMainTeacher)
 *   • gradingRateByClass (planned vs graded, completion %, status thresholds)
 *   • studentTeacherRatio
 *
 * Prisma is fully mocked: each model method returns a deterministic fixture so
 * the aggregation logic can be asserted without a database.
 */

const TENANT = 't1';
const SCHOOL = 's1';
const ACTIVE_YEAR = 'ay-active';

// --- Fixtures -------------------------------------------------------------

const ACADEMIC_YEARS = [
  { id: ACTIVE_YEAR, name: '2025-2026', status: 'active' },
  { id: 'ay-old', name: '2024-2025', status: 'closed' },
];

// Two cycles: Collège (orderIndex 1) and Primaire (orderIndex 0). We expect the
// output ordered by orderIndex → Primaire first.
const CYCLE_COLLEGE = { id: 'cy-col', name: 'Collège', color: '#64748B', orderIndex: 1 };
const CYCLE_PRIMAIRE = { id: 'cy-pri', name: 'Primaire', color: '#2563EB', orderIndex: 0 };

const GRADE_LEVELS = [
  { id: 'gl-6e', name: '6e', orderIndex: 1, cycle: { id: CYCLE_COLLEGE.id, name: CYCLE_COLLEGE.name } },
  { id: 'gl-cp', name: 'CP', orderIndex: 0, cycle: { id: CYCLE_PRIMAIRE.id, name: CYCLE_PRIMAIRE.name } },
];

const SUBJECTS = [
  { id: 'sub-math', name: 'Mathématiques', _count: { teachingAssignments: 2 } },
  { id: 'sub-fr', name: 'Français', _count: { teachingAssignments: 1 } },
  // A subject with no teaching assignment at all (should appear with 0 teachers
  // only if it surfaces via a class assignment — here it never does).
  { id: 'sub-svt', name: 'Sciences de la Vie et de la Terre', _count: { teachingAssignments: 0 } },
];

// ClassSections of the active year, shaped exactly like the service's `select`.
// - 6eA (Collège): 25 students, 2 teachers (math t-a, fr t-b), main teacher set,
//   2 assessments (1 graded, 1 not) → 50% → medium.
// - 6eB (Collège): 20 students, 1 teacher (math t-a, reused), NO main teacher,
//   4 assessments all graded → 100% → good.
// - CPa (Primaire): 18 students, 1 teacher (fr t-c), main teacher set,
//   no assessments → 0% → late.
const CLASS_SECTIONS = [
  {
    id: 'cs-6eA',
    name: '6eA',
    gradeLevel: {
      name: '6e',
      orderIndex: 1,
      cycle: CYCLE_COLLEGE,
    },
    _count: { enrollments: 25 },
    teachingAssignments: [
      {
        teacherProfileId: 't-a',
        isMainTeacher: true,
        subject: { id: 'sub-math', name: 'Mathématiques' },
        assessments: [
          { id: 'as-1', grades: [{ id: 'g-1' }] }, // graded
          { id: 'as-2', grades: [] }, // planned, not graded
        ],
      },
      {
        teacherProfileId: 't-b',
        isMainTeacher: false,
        subject: { id: 'sub-fr', name: 'Français' },
        assessments: [],
      },
    ],
  },
  {
    id: 'cs-6eB',
    name: '6eB',
    gradeLevel: {
      name: '6e',
      orderIndex: 1,
      cycle: CYCLE_COLLEGE,
    },
    _count: { enrollments: 20 },
    teachingAssignments: [
      {
        teacherProfileId: 't-a', // same teacher as 6eA → distinct count stays sane
        isMainTeacher: false,
        subject: { id: 'sub-math', name: 'Mathématiques' },
        assessments: [
          { id: 'as-3', grades: [{ id: 'g-2' }] },
          { id: 'as-4', grades: [{ id: 'g-3' }] },
          { id: 'as-5', grades: [{ id: 'g-4' }] },
          { id: 'as-6', grades: [{ id: 'g-5' }] },
        ],
      },
    ],
  },
  {
    id: 'cs-CPa',
    name: 'CPa',
    gradeLevel: {
      name: 'CP',
      orderIndex: 0,
      cycle: CYCLE_PRIMAIRE,
    },
    _count: { enrollments: 18 },
    teachingAssignments: [
      {
        teacherProfileId: 't-c',
        isMainTeacher: true,
        subject: { id: 'sub-fr', name: 'Français' },
        assessments: [],
      },
    ],
  },
];

// --- Mock Prisma ----------------------------------------------------------

function makeService(overrides?: {
  activeYear?: { id: string } | null;
  classSections?: typeof CLASS_SECTIONS;
}) {
  const activeYear = overrides?.activeYear === undefined ? { id: ACTIVE_YEAR } : overrides.activeYear;
  const classSections = overrides?.classSections ?? CLASS_SECTIONS;

  const prisma = {
    student: {
      // First call: active count (returns 63 = 25+20+18); second call: last-month.
      count: jest
        .fn()
        .mockResolvedValueOnce(63) // studentsCurrent
        .mockResolvedValueOnce(60) // studentsLastMonth
        .mockResolvedValue(0),
    },
    teacherProfile: {
      count: jest.fn().mockResolvedValue(0),
    },
    classSection: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue(classSections),
    },
    guardianship: {
      count: jest.fn().mockResolvedValue(0),
      findMany: jest.fn().mockResolvedValue([]),
    },
    academicYear: {
      // adminDashboard calls findFirst twice (active, then fallback). schoolPerformance
      // calls it once more (active). We return the active year each time, except when
      // the test forces `activeYear: null`.
      findFirst: jest.fn().mockResolvedValue(activeYear),
      findMany: jest.fn().mockResolvedValue(ACADEMIC_YEARS),
    },
    cycle: {
      count: jest.fn().mockResolvedValue(2),
      findMany: jest.fn().mockResolvedValue([]),
    },
    gradeLevel: {
      findMany: jest.fn().mockResolvedValue(GRADE_LEVELS),
    },
    subject: {
      findMany: jest.fn().mockResolvedValue(SUBJECTS),
    },
    grade: {
      // schoolPerformance grade lookup — empty is fine for these tests.
      findMany: jest.fn().mockResolvedValue([]),
    },
    auditLog: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    userProfile: {
      findMany: jest.fn().mockResolvedValue([]),
    },
  };

  const grades = { statsForStudent: jest.fn().mockResolvedValue(null) };
  const service = new AnalyticsService(prisma as never, grades as never);
  return { service, prisma };
}

// --- Tests ----------------------------------------------------------------

describe('AnalyticsService.adminDashboard — U1 reorg', () => {
  it('builds the cycle drill-down ordered by cycle orderIndex', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const cycles = res.schoolStructure.cycles;
    expect(cycles.map((c) => c.cycleName)).toEqual(['Primaire', 'Collège']);

    const college = cycles.find((c) => c.cycleId === CYCLE_COLLEGE.id)!;
    expect(college.classCount).toBe(2); // 6eA + 6eB
    expect(college.studentCount).toBe(45); // 25 + 20
    expect(college.teacherCount).toBe(2); // t-a (shared) + t-b → distinct = 2
    expect(college.cycleColor).toBe('#64748B');
    // Maths taught in both classes (count 2) ranks before Français (count 1).
    expect(college.topSubjects[0]).toBe('Mathématiques');

    const primaire = cycles.find((c) => c.cycleId === CYCLE_PRIMAIRE.id)!;
    expect(primaire.classCount).toBe(1);
    expect(primaire.studentCount).toBe(18);
    expect(primaire.teacherCount).toBe(1);
  });

  it('still exposes the legacy levels buckets alongside cycles', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const levels = res.schoolStructure.levels;
    // GradeLevels: 6e → Collège bucket, CP → Primaire bucket.
    expect(levels.find((l) => l.key === 'primaire')!.count).toBe(1);
    expect(levels.find((l) => l.key === 'college')!.count).toBe(1);
  });

  it('counts distinct teachers per subject (teacherCoverageBySubject)', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const bySubject = res.teacherCoverageBySubject;
    const math = bySubject.find((s) => s.subjectId === 'sub-math')!;
    const fr = bySubject.find((s) => s.subjectId === 'sub-fr')!;

    // Maths taught by t-a in 6eA and 6eB → still a single distinct teacher.
    expect(math.teacherCount).toBe(1);
    // Français taught by t-b (6eA) and t-c (CPa) → two distinct teachers.
    expect(fr.teacherCount).toBe(2);
    // SVT never assigned → not present in coverage (derived from assignments).
    expect(bySubject.find((s) => s.subjectId === 'sub-svt')).toBeUndefined();
    // Short display names are applied.
    expect(fr.subjectName).toBe('Français');
  });

  it('computes per-class teacher coverage with hasMainTeacher flag', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const byClass = res.teacherCoverageByClass;
    const a = byClass.find((c) => c.classSectionId === 'cs-6eA')!;
    const b = byClass.find((c) => c.classSectionId === 'cs-6eB')!;
    const cp = byClass.find((c) => c.classSectionId === 'cs-CPa')!;

    expect(a.teacherCount).toBe(2);
    expect(a.hasMainTeacher).toBe(true);

    expect(b.teacherCount).toBe(1);
    expect(b.hasMainTeacher).toBe(false); // no isMainTeacher assignment

    expect(cp.hasMainTeacher).toBe(true);
  });

  it('computes gradingRateByClass with correct completion % and status thresholds', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const byClass = res.gradingRateByClass;
    const a = byClass.find((c) => c.classSectionId === 'cs-6eA')!;
    const b = byClass.find((c) => c.classSectionId === 'cs-6eB')!;
    const cp = byClass.find((c) => c.classSectionId === 'cs-CPa')!;

    // 6eA: 2 planned (1 graded) → 50% → medium
    expect(a.planned).toBe(2);
    expect(a.graded).toBe(1);
    expect(a.completionRate).toBe(50);
    expect(a.status).toBe('medium');

    // 6eB: 4 planned all graded → 100% → good
    expect(b.planned).toBe(4);
    expect(b.graded).toBe(4);
    expect(b.completionRate).toBe(100);
    expect(b.status).toBe('good');

    // CPa: 0 planned → 0% → late
    expect(cp.planned).toBe(0);
    expect(cp.completionRate).toBe(0);
    expect(cp.status).toBe('late');
  });

  it('computes the student-teacher ratio over distinct active-year teachers', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    // Distinct teachers across all classes: t-a, t-b, t-c → 3.
    expect(res.studentTeacherRatio.teachers).toBe(3);
    expect(res.studentTeacherRatio.students).toBe(63);
    // 63 / 3 = 21
    expect(res.studentTeacherRatio.ratio).toBe(21);
  });

  it('no longer returns the removed cards (enrollmentRequests / teachingAssignmentsSummary / alertRules / recentExports)', async () => {
    const { service } = makeService();
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    const payload = res as unknown as Record<string, unknown>;
    expect(payload.enrollmentRequests).toBeUndefined();
    expect(payload.teachingAssignmentsSummary).toBeUndefined();
    expect(payload.alertRules).toBeUndefined();
    expect(payload.recentExports).toBeUndefined();
    // The pendingRequests KPI is kept.
    expect(res.kpis.pendingRequests).toBeDefined();
  });

  it('handles a school with no active year gracefully (empty coverage/grading)', async () => {
    const { service } = makeService({ activeYear: null, classSections: [] });
    const res = await service.adminDashboard({ tenantId: TENANT, schoolId: SCHOOL });

    expect(res.schoolStructure.cycles).toEqual([]);
    expect(res.teacherCoverageBySubject).toEqual([]);
    expect(res.teacherCoverageByClass).toEqual([]);
    expect(res.gradingRateByClass).toEqual([]);
    expect(res.studentTeacherRatio.teachers).toBe(0);
    expect(res.studentTeacherRatio.ratio).toBe(0);
  });
});

// =============================================================================
// E6-S2 — Parent dashboard reads snapshots (snapshot-first + live fallback)
// =============================================================================
//
// A single seeded fixture (one child, 2 subjects, 1 classmate, 2 terms) drives
// BOTH read paths so the byte-parity contract can be proven against the live
// computation. maxScore = 20 everywhere so onTwenty = value (keeps the expected
// numbers human-checkable). Snapshot rows are pre-rounded (Decimal(5,2)); the
// parity comparison uses a 2-dp tolerance (PM-1), exactly as the slice mandates.

const PD_TENANT = 'pt1';
const PD_STUDENT = 'stu-1';
const PD_CLASSMATE = 'stu-2';
const PD_SECTION = 'cs-1';
const PD_GRADELEVEL = 'gl-1';
const PD_YEAR = 'ay-1';
const PD_SCHOOL = 'sch-1';
const SUB_MATH = 'sub-math';
const SUB_FR = 'sub-fr';
const T1 = { id: 't1', name: 'T1', orderIndex: 1, startDate: new Date('2025-09-01') };
const T2 = { id: 't2', name: 'T2', orderIndex: 2, startDate: new Date('2026-01-01') };

const SUBJECT_MATH = { id: SUB_MATH, code: 'MATH', name: 'Mathématiques', color: '#1', defaultCoefficient: 4 };
const SUBJECT_FR = { id: SUB_FR, code: 'FR', name: 'Français', color: '#2', defaultCoefficient: 2 };

// One graded row, shaped exactly like the per-student `grade.findMany` include.
function pdGrade(
  id: string,
  studentId: string,
  subject: typeof SUBJECT_MATH,
  term: typeof T1,
  value: number,
) {
  return {
    id,
    value,
    studentId,
    comment: null,
    updatedAt: new Date('2026-02-01'),
    assessment: {
      maxScore: 20,
      coefficientOverride: null,
      title: `${subject.code} ${term.name}`,
      kind: 'devoir',
      scheduledAt: term.startDate,
      conductedAt: null,
      createdAt: term.startDate,
      term: { id: term.id, name: term.name, orderIndex: term.orderIndex, startDate: term.startDate },
      teachingAssignment: { subject },
    },
  };
}

// The child's own grades (Math: 12,14 | 16  → year 14; French: 10 | 8,12 → year 10).
const PD_STUDENT_GRADES = [
  pdGrade('g1', PD_STUDENT, SUBJECT_MATH, T1, 12),
  pdGrade('g2', PD_STUDENT, SUBJECT_MATH, T1, 14),
  pdGrade('g3', PD_STUDENT, SUBJECT_MATH, T2, 16),
  pdGrade('g4', PD_STUDENT, SUBJECT_FR, T1, 10),
  pdGrade('g5', PD_STUDENT, SUBJECT_FR, T2, 8),
  pdGrade('g6', PD_STUDENT, SUBJECT_FR, T2, 12),
];
// The classmate's grades (Math: 8 | 10 → 9; French: 14 → 14).
const PD_CLASSMATE_GRADES = [
  pdGrade('g7', PD_CLASSMATE, SUBJECT_MATH, T1, 8),
  pdGrade('g8', PD_CLASSMATE, SUBJECT_MATH, T2, 10),
  pdGrade('g9', PD_CLASSMATE, SUBJECT_FR, T1, 14),
];
const PD_CLASS_GRADES = [...PD_STUDENT_GRADES, ...PD_CLASSMATE_GRADES];

const PD_STUDENT_ROW = {
  id: PD_STUDENT,
  firstName: 'Léa',
  lastName: 'Martin',
  photoUrl: null,
  externalRef: 'EXT-1',
  birthDate: new Date('2014-05-01'),
  school: { name: 'École Test' },
  enrollments: [
    {
      academicYearId: PD_YEAR,
      classSectionId: PD_SECTION,
      classSection: {
        name: '6eA',
        gradeLevelId: PD_GRADELEVEL,
        gradeLevel: { id: PD_GRADELEVEL, name: '6e' },
      },
      academicYear: {
        id: PD_YEAR,
        name: '2025-2026',
        status: 'active',
        startDate: new Date('2025-09-01'),
        endDate: new Date('2026-07-01'),
      },
    },
  ],
};

// Pre-rounded snapshot rows (what S1's recompute would have written). The global
// roll-up carries the freshness provenance (computedAt/sourceEventId/revision) the
// S4 chip renders; the subject rows carry the per-subject gradeCount summed into it.
const PD_SNAPSHOT_COMPUTED_AT = new Date('2026-02-02T10:00:00.000Z');
const PD_SNAPSHOT_EVENT_ID = '11111111-1111-1111-1111-111111111111';
const PD_GLOBAL_SNAPSHOT = {
  classRank: 1,
  classSize: 2,
  computedAt: PD_SNAPSHOT_COMPUTED_AT,
  sourceEventId: PD_SNAPSHOT_EVENT_ID,
  revision: 3,
};
const PD_SUBJECT_SNAPSHOTS = [
  { subjectId: SUB_MATH, classRank: 1, classSize: 2, gradeCount: 3 },
  { subjectId: SUB_FR, classRank: 2, classSize: 2, gradeCount: 3 },
];
const PD_DISTRIBUTIONS = [
  { subjectId: SUB_MATH, average: 12 },
  { subjectId: SUB_FR, average: 11 },
];

interface PdOpts {
  /** Provide the snapshot rows (snapshot path) or leave empty (live path). */
  withSnapshots?: boolean;
  /** An open recompute trigger exists for the scope (forces fall-through to live). */
  openTrigger?: boolean;
}

function makeParentDashboardService(opts: PdOpts = {}) {
  const classScan = jest.fn();
  const prisma = {
    student: {
      findFirst: jest.fn().mockResolvedValue(PD_STUDENT_ROW),
      findMany: jest.fn().mockResolvedValue([]),
    },
    grade: {
      findMany: jest.fn().mockImplementation((args: Record<string, unknown>) => {
        const where = (args.where ?? {}) as Record<string, unknown>;
        // recentGrades: per-student, take 30, ordered by updatedAt.
        if (args.take === 30) return Promise.resolve(PD_STUDENT_GRADES);
        // Per-student grade scan (has studentId in where).
        if (where.studentId) return Promise.resolve(PD_STUDENT_GRADES);
        // Class-wide scan (no studentId; keyed by assessment.teachingAssignment).
        classScan();
        return Promise.resolve(PD_CLASS_GRADES);
      }),
    },
    subjectCoefficient: {
      findMany: jest.fn().mockResolvedValue([
        { subjectId: SUB_MATH, coefficient: 4 },
        { subjectId: SUB_FR, coefficient: 2 },
      ]),
    },
    assessment: { findMany: jest.fn().mockResolvedValue([]) },
    attendanceRecord: { findMany: jest.fn().mockResolvedValue([]) },
    teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) },
    academicYear: { findFirst: jest.fn().mockResolvedValue(null) },
    // Snapshot point-reads (tenant-scoped). Empty unless `withSnapshots`.
    studentGlobalSnapshot: {
      findFirst: jest.fn().mockResolvedValue(opts.withSnapshots ? PD_GLOBAL_SNAPSHOT : null),
    },
    studentSubjectSnapshot: {
      findMany: jest.fn().mockResolvedValue(opts.withSnapshots ? PD_SUBJECT_SNAPSHOTS : []),
    },
    classSubjectDistribution: {
      findMany: jest.fn().mockResolvedValue(opts.withSnapshots ? PD_DISTRIBUTIONS : []),
    },
    snapshotRecomputeTrigger: {
      findFirst: jest.fn().mockResolvedValue(opts.openTrigger ? { id: 'trig-1' } : null),
    },
  };

  const grades = { statsForStudent: jest.fn().mockResolvedValue({ overallAverage: null }) };
  const service = new AnalyticsService(prisma as never, grades as never);
  return { service, prisma, classScan };
}

/** Deep-compare two payloads (minus `freshness`) within a 2-dp tolerance. */
function expectByteParity(a: unknown, b: unknown, path = ''): void {
  if (typeof a === 'number' && typeof b === 'number') {
    expect(Math.abs(a - b)).toBeLessThanOrEqual(0.01);
    return;
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    expect(a).toEqual(b);
    return;
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    expect(Array.isArray(a) && Array.isArray(b)).toBe(true);
    const arrA = a as unknown[];
    const arrB = b as unknown[];
    expect(arrA.length).toBe(arrB.length);
    arrA.forEach((v, i) => expectByteParity(v, arrB[i], `${path}[${i}]`));
    return;
  }
  const objA = a as Record<string, unknown>;
  const objB = b as Record<string, unknown>;
  const keys = new Set([...Object.keys(objA), ...Object.keys(objB)]);
  keys.delete('freshness');
  for (const k of keys) expectByteParity(objA[k], objB[k], `${path}.${k}`);
}

describe('AnalyticsService.parentDashboard — E6-S2 snapshot reads', () => {
  it('AC-S2-1 — snapshot payload is byte-identical to live (minus freshness, 2-dp)', async () => {
    const live = await makeParentDashboardService({ withSnapshots: false }).service.parentDashboard({
      tenantId: PD_TENANT,
      studentId: PD_STUDENT,
    });
    const snap = await makeParentDashboardService({ withSnapshots: true }).service.parentDashboard({
      tenantId: PD_TENANT,
      studentId: PD_STUDENT,
    });

    // Sanity: the seeded live numbers are what we expect.
    expect(live.globalPerformance.studentAverage).toBeCloseTo(76 / 6, 2); // weighted 12.667
    expect(live.globalPerformance.classAverage).toBeCloseTo(70 / 6, 2); // weighted 11.667
    expect(live.student.rank).toBe(1);
    expect(live.student.classSize).toBe(2);
    const liveMath = live.subjectPerf.find((s) => s.subjectId === SUB_MATH)!;
    expect(liveMath.classAverage).toBeCloseTo(12, 2);
    expect(liveMath.studentRank).toBe(1);

    // The whole payload matches between the two paths (freshness excluded).
    expectByteParity(snap, live);
  });

  it('AC-S2-2 — snapshot hit issues NO class-wide grade findMany', async () => {
    const { service, classScan } = makeParentDashboardService({ withSnapshots: true });
    await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(classScan).not.toHaveBeenCalled();
  });

  it('AC-S2-2 — live fall-through DOES run the class-wide scan', async () => {
    const { service, classScan } = makeParentDashboardService({ withSnapshots: false });
    await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(classScan).toHaveBeenCalledTimes(1);
  });

  it('AC-S2-4/6 — fresh snapshot hit → freshness carries the SERVED snapshot provenance', async () => {
    const { service } = makeParentDashboardService({ withSnapshots: true });
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness).toBeDefined();
    expect(res.freshness!.source).toBe('snapshot');
    expect(res.freshness!.recomputing).toBe(false);
    // The freshness block must reflect the snapshot's REAL provenance (not now()), so
    // the S4 chip can render "à jour il y a Xs" instead of always "0s ago".
    expect(res.freshness!.computedAt).toBe(PD_SNAPSHOT_COMPUTED_AT.toISOString());
    expect(res.freshness!.sourceEventId).toBe(PD_SNAPSHOT_EVENT_ID);
    expect(res.freshness!.revision).toBe(3);
    expect(res.freshness!.gradeCount).toBe(6); // 3 (Math) + 3 (FR)
  });

  it('AC-S2-3/6 — missing snapshot → served live, recomputing=true', async () => {
    const { service, classScan } = makeParentDashboardService({ withSnapshots: false });
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness!.source).toBe('live');
    expect(res.freshness!.recomputing).toBe(true);
    expect(classScan).toHaveBeenCalledTimes(1);
  });

  it('AC-S2-3/6 — open trigger → fall-through to live even with fresh rows present', async () => {
    const { service, classScan, prisma } = makeParentDashboardService({
      withSnapshots: true,
      openTrigger: true,
    });
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness!.source).toBe('live');
    expect(res.freshness!.recomputing).toBe(true);
    // The class scan ran (live), and snapshot rows were NOT read (trigger short-circuit).
    expect(classScan).toHaveBeenCalledTimes(1);
    expect(prisma.studentGlobalSnapshot.findFirst).not.toHaveBeenCalled();
  });

  it('AC-S2-5 — every snapshot/trigger query is tenant-scoped', async () => {
    const { service, prisma } = makeParentDashboardService({ withSnapshots: true });
    await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    const tenantWhere = (m: { mock: { calls: unknown[][] } }) =>
      m.mock.calls.forEach((c) => {
        const where = (c[0] as { where?: { tenantId?: string } }).where ?? {};
        expect(where.tenantId).toBe(PD_TENANT);
      });
    tenantWhere(prisma.snapshotRecomputeTrigger.findFirst as never);
    tenantWhere(prisma.studentGlobalSnapshot.findFirst as never);
    tenantWhere(prisma.studentSubjectSnapshot.findMany as never);
    tenantWhere(prisma.classSubjectDistribution.findMany as never);
  });

  it('PM-5 — one missing subject snapshot row → whole payload served live (all-or-nothing)', async () => {
    const { service, classScan, prisma } = makeParentDashboardService({ withSnapshots: true });
    // Drop the French subject snapshot row → not every graded subject has a row.
    (prisma.studentSubjectSnapshot.findMany as jest.Mock).mockResolvedValue([
      { subjectId: SUB_MATH, classRank: 1, classSize: 2 },
    ]);
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness!.source).toBe('live');
    expect(classScan).toHaveBeenCalledTimes(1);
  });

  it('PM-5 — one missing class-distribution row → whole payload served live (no wrong classAverage)', async () => {
    const { service, classScan, prisma } = makeParentDashboardService({ withSnapshots: true });
    // Subject snapshots are complete but the French distribution row is absent. Without
    // folding dist presence into the all-or-nothing gate, the snapshot path would emit
    // card.classAverage=null for French while still claiming source:'snapshot' — a wrong
    // number (AC-S2-3). The gate must instead fall through to a byte-identical live read.
    (prisma.classSubjectDistribution.findMany as jest.Mock).mockResolvedValue([
      { subjectId: SUB_MATH, average: 12 },
    ]);
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness!.source).toBe('live');
    expect(classScan).toHaveBeenCalledTimes(1);
    const fr = res.subjectPerf.find((s) => s.subjectId === SUB_FR)!;
    expect(fr.classAverage).not.toBeNull(); // live class mean, not a snapshot-miss null
  });

  it('INV-4 — a snapshot-read throw degrades to live, never throws', async () => {
    const { service, classScan, prisma } = makeParentDashboardService({ withSnapshots: true });
    (prisma.studentGlobalSnapshot.findFirst as jest.Mock).mockRejectedValue(new Error('no table'));
    const res = await service.parentDashboard({ tenantId: PD_TENANT, studentId: PD_STUDENT });
    expect(res.freshness!.source).toBe('live');
    expect(classScan).toHaveBeenCalledTimes(1);
  });
});
