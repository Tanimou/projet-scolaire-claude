import { ClassesService } from './classes.service';

/**
 * Tests unitaires de l'agrégat de détail classe (taux de notation /
 * performance moyenne / taux de présence). Prisma est mocké : on vérifie la
 * logique de calcul pur, pas les requêtes.
 */

type GradeRow = { value: number | null; assessment: { maxScore: number } };

function makeService(opts: {
  assessmentTotal?: number;
  assessmentPublished?: number;
  attendanceTotal?: number;
  attendancePresent?: number;
  grades?: GradeRow[];
}) {
  const prisma = {
    assessment: {
      count: jest.fn(async ({ where }: { where: { isPublished?: boolean } }) =>
        where?.isPublished ? (opts.assessmentPublished ?? 0) : (opts.assessmentTotal ?? 0),
      ),
    },
    attendanceRecord: {
      count: jest.fn(async ({ where }: { where: { status?: string } }) =>
        where?.status === 'present'
          ? (opts.attendancePresent ?? 0)
          : (opts.attendanceTotal ?? 0),
      ),
    },
    grade: {
      findMany: jest.fn(async () => opts.grades ?? []),
    },
  };
  const service = new ClassesService(prisma as never);
  return { service, prisma };
}

describe('ClassesService.computeGradingRate', () => {
  it('returns the published/total ratio as a rounded percentage', async () => {
    const { service } = makeService({ assessmentTotal: 8, assessmentPublished: 6 });
    const res = await service.computeGradingRate('t1', 'c1');
    expect(res).toEqual({ total: 8, graded: 6, rate: 75 });
  });

  it('rounds the rate to one decimal', async () => {
    const { service } = makeService({ assessmentTotal: 3, assessmentPublished: 1 });
    const res = await service.computeGradingRate('t1', 'c1');
    // 1/3 = 33.33% → 33.3
    expect(res.rate).toBe(33.3);
  });

  it('returns rate=null when there is no assessment planned', async () => {
    const { service } = makeService({ assessmentTotal: 0, assessmentPublished: 0 });
    const res = await service.computeGradingRate('t1', 'c1');
    expect(res).toEqual({ total: 0, graded: 0, rate: null });
  });
});

describe('ClassesService.computePerformance', () => {
  it('normalises grades to /20 and computes average + pass rate', async () => {
    // 14/20, 8/20, and 30/40 (=15/20). Average = (14+8+15)/3 = 12.33.
    // Pass (>=10/20): 14 and 15 → 2/3 = 66.7%.
    const { service } = makeService({
      grades: [
        { value: 14, assessment: { maxScore: 20 } },
        { value: 8, assessment: { maxScore: 20 } },
        { value: 30, assessment: { maxScore: 40 } },
      ],
    });
    const res = await service.computePerformance('t1', 'c1');
    expect(res.gradedCount).toBe(3);
    expect(res.averageScore).toBe(12.33);
    expect(res.passRate).toBe(66.7);
  });

  it('treats a grade exactly at 10/20 as a pass', async () => {
    const { service } = makeService({
      grades: [{ value: 10, assessment: { maxScore: 20 } }],
    });
    const res = await service.computePerformance('t1', 'c1');
    expect(res.passRate).toBe(100);
    expect(res.averageScore).toBe(10);
  });

  it('returns nulls when no eligible grades exist', async () => {
    const { service } = makeService({ grades: [] });
    const res = await service.computePerformance('t1', 'c1');
    expect(res).toEqual({ averageScore: null, passRate: null, gradedCount: 0 });
  });

  it('guards against a zero maxScore (no division by zero)', async () => {
    const { service } = makeService({
      grades: [{ value: 5, assessment: { maxScore: 0 } }],
    });
    const res = await service.computePerformance('t1', 'c1');
    expect(res.averageScore).toBe(0);
    expect(res.passRate).toBe(0);
  });
});

describe('ClassesService.computeAttendanceRate', () => {
  it('returns the present/total ratio as a rounded percentage', async () => {
    const { service } = makeService({ attendanceTotal: 20, attendancePresent: 17 });
    const res = await service.computeAttendanceRate('t1', ['s1', 's2']);
    expect(res).toBe(85);
  });

  it('returns null when the class has no enrolled students', async () => {
    const { service, prisma } = makeService({});
    const res = await service.computeAttendanceRate('t1', []);
    expect(res).toBeNull();
    // Short-circuits before hitting the DB.
    expect(prisma.attendanceRecord.count).not.toHaveBeenCalled();
  });

  it('returns null when there are students but no attendance records', async () => {
    const { service } = makeService({ attendanceTotal: 0, attendancePresent: 0 });
    const res = await service.computeAttendanceRate('t1', ['s1']);
    expect(res).toBeNull();
  });
});

describe('ClassesService.detailAggregate', () => {
  it('composes grading rate, attendance rate and performance', async () => {
    const { service } = makeService({
      assessmentTotal: 4,
      assessmentPublished: 2,
      attendanceTotal: 10,
      attendancePresent: 9,
      grades: [
        { value: 16, assessment: { maxScore: 20 } },
        { value: 4, assessment: { maxScore: 20 } },
      ],
    });
    const res = await service.detailAggregate({
      tenantId: 't1',
      classSectionId: 'c1',
      studentIds: ['s1'],
    });
    expect(res.gradingRate).toEqual({ total: 4, graded: 2, rate: 50 });
    expect(res.attendanceRate).toBe(90);
    expect(res.performance.averageScore).toBe(10); // (16+4)/2
    expect(res.performance.passRate).toBe(50); // only 16 passes → 1/2
    expect(res.performance.gradedCount).toBe(2);
  });
});
