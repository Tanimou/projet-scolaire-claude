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

  const service = new AnalyticsService(prisma as never);
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

    const payload = res as Record<string, unknown>;
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
