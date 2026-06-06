import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { RemediationService } from './remediation.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const STUDENT = 'stu-1';
const SUBJECT = 'subj-1';
const ALERT = 'alert-1';
const PARENT = 'parent-up-1';

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    tenantId: TENANT,
    schoolId: SCHOOL,
    studentId: STUDENT,
    subjectId: SUBJECT,
    alertId: ALERT,
    status: 'open',
    objective: null,
    baselineAvg: new Prisma.Decimal(8.5),
    baselineTrendDelta: new Prisma.Decimal(-1.2),
    createdBy: PARENT,
    closedAt: null,
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    student: { firstName: 'Léa', lastName: 'Martin' },
    subject: { code: 'MATH', name: 'Maths' },
    ...overrides,
  };
}

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    alertInstance: {
      findFirst: jest.fn().mockResolvedValue({
        id: ALERT,
        studentId: STUDENT,
        subjectId: SUBJECT,
        schoolId: SCHOOL,
      }),
    },
    remediationPlan: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue(planRow()),
      findMany: jest.fn().mockResolvedValue([planRow()]),
    },
    studentSubjectSnapshot: {
      findFirst: jest.fn().mockResolvedValue({
        average: new Prisma.Decimal(8.5),
        trendDelta: new Prisma.Decimal(-1.2),
      }),
    },
    grade: { findMany: jest.fn().mockResolvedValue([]) },
    subject: { findFirst: jest.fn().mockResolvedValue({ name: 'Maths' }) },
    tutor: { findMany: jest.fn().mockResolvedValue([]) },
    ...overrides,
  };
}

describe('RemediationService.promotePlan — idempotency + baseline', () => {
  it('reuses an existing OPEN plan (idempotent, no create, no re-baseline)', async () => {
    const existing = planRow();
    const prisma = makePrisma({
      remediationPlan: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn(),
      },
    });
    const service = new RemediationService(prisma as never);

    const res = await service.promotePlan({
      tenantId: TENANT,
      schoolId: SCHOOL,
      alertId: ALERT,
      userProfileId: PARENT,
    });

    expect(res.created).toBe(false);
    expect(res.plan.id).toBe('plan-1');
    // No new row, and the baseline snapshot read is skipped on the reuse path.
    expect((prisma.remediationPlan as { create: jest.Mock }).create).not.toHaveBeenCalled();
    expect(
      (prisma.studentSubjectSnapshot as { findFirst: jest.Mock }).findFirst,
    ).not.toHaveBeenCalled();
  });

  it('creates a fresh plan capturing the snapshot baseline when none is open', async () => {
    const prisma = makePrisma();
    const service = new RemediationService(prisma as never);

    const res = await service.promotePlan({
      tenantId: TENANT,
      schoolId: SCHOOL,
      alertId: ALERT,
      userProfileId: PARENT,
    });

    expect(res.created).toBe(true);
    expect(res.plan.baselineAvg).toBe(8.5);
    expect(res.plan.baselineTrendDelta).toBe(-1.2);
    // The created row was seeded from the alert's server-derived student/subject.
    const createArg = (prisma.remediationPlan as { create: jest.Mock }).create.mock
      .calls[0][0];
    expect(createArg.data.studentId).toBe(STUDENT);
    expect(createArg.data.subjectId).toBe(SUBJECT);
    expect(createArg.data.status).toBe('open');
  });

  it('collapses a P2002 race onto the winning open plan (still idempotent)', async () => {
    const winner = planRow({ id: 'plan-winner' });
    const findFirst = jest
      .fn()
      .mockResolvedValueOnce(null) // initial idempotency probe: none open
      .mockResolvedValueOnce(winner); // post-P2002 re-read: the racing winner
    const prisma = makePrisma({
      remediationPlan: {
        findFirst,
        create: jest.fn().mockRejectedValue(
          new Prisma.PrismaClientKnownRequestError('unique', {
            code: 'P2002',
            clientVersion: 'x',
          }),
        ),
      },
    });
    const service = new RemediationService(prisma as never);

    const res = await service.promotePlan({
      tenantId: TENANT,
      schoolId: SCHOOL,
      alertId: ALERT,
      userProfileId: PARENT,
    });

    expect(res.created).toBe(false);
    expect(res.plan.id).toBe('plan-winner');
  });

  it('falls through to the live grade average when no snapshot exists', async () => {
    const prisma = makePrisma({
      studentSubjectSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
      grade: {
        findMany: jest.fn().mockResolvedValue([
          { value: new Prisma.Decimal(7), assessment: { maxScore: new Prisma.Decimal(20) } },
          { value: new Prisma.Decimal(10), assessment: { maxScore: new Prisma.Decimal(20) } },
        ]),
      },
      remediationPlan: {
        findFirst: jest.fn().mockResolvedValue(null),
        create: jest
          .fn()
          .mockImplementation((args: { data: { baselineAvg: unknown } }) =>
            Promise.resolve(planRow({ baselineAvg: args.data.baselineAvg, baselineTrendDelta: null })),
          ),
      },
    });
    const service = new RemediationService(prisma as never);

    const res = await service.promotePlan({
      tenantId: TENANT,
      schoolId: SCHOOL,
      alertId: ALERT,
      userProfileId: PARENT,
    });

    // (7 + 10) / 2 on /20 = 8.5; trend null on the live path.
    expect(res.plan.baselineAvg).toBe(8.5);
    expect(res.plan.baselineTrendDelta).toBeNull();
    expect((prisma.grade as { findMany: jest.Mock }).findMany).toHaveBeenCalled();
  });

  it('404s when the alert is outside the tenant', async () => {
    const prisma = makePrisma({
      alertInstance: { findFirst: jest.fn().mockResolvedValue(null) },
    });
    const service = new RemediationService(prisma as never);
    await expect(
      service.promotePlan({
        tenantId: TENANT,
        schoolId: SCHOOL,
        alertId: ALERT,
        userProfileId: PARENT,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('422s (not 404) when the alert has no subject to remediate', async () => {
    const prisma = makePrisma({
      alertInstance: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: ALERT, studentId: STUDENT, subjectId: null, schoolId: SCHOOL }),
      },
    });
    const service = new RemediationService(prisma as never);
    await expect(
      service.promotePlan({
        tenantId: TENANT,
        schoolId: SCHOOL,
        alertId: ALERT,
        userProfileId: PARENT,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    // No plan is written on the unremediable-alert path.
    expect((prisma.remediationPlan as { create: jest.Mock }).create).not.toHaveBeenCalled();
  });
});

describe('RemediationService.remediationProgress — S3 progress strip payload', () => {
  function progressPrisma(overrides: Record<string, unknown> = {}) {
    return {
      remediationPlan: {
        findMany: jest.fn().mockResolvedValue([planRow()]),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      studentSubjectSnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          average: new Prisma.Decimal(11),
          trendDelta: new Prisma.Decimal(2.5),
        }),
      },
      grade: { findMany: jest.fn().mockResolvedValue([]) },
      ...overrides,
    };
  }

  it('scopes open plans to (tenant, student, status:open)', async () => {
    const prisma = progressPrisma();
    const service = new RemediationService(prisma as never);
    await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    const where = (prisma.remediationPlan as { findMany: jest.Mock }).findMany.mock.calls[0][0]
      .where;
    expect(where).toEqual({ tenantId: TENANT, studentId: STUDENT, status: 'open' });
  });

  it('snapshot hit: trendDelta = current − baseline, improved at/above the threshold', async () => {
    // baseline 8.5 (planRow), current snapshot 11 → delta +2.5 ≥ 1.5 → improved.
    const prisma = progressPrisma();
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(p?.baselineAvg).toBe(8.5);
    expect(p?.currentAvg).toBe(11);
    expect(p?.trendDelta).toBe(2.5);
    expect(p?.improved).toBe(true);
  });

  it('a sub-threshold delta stays calm (not improved)', async () => {
    // baseline 8.5, current 9 → +0.5 < 1.5 → calm, not emerald.
    const prisma = progressPrisma({
      studentSubjectSnapshot: {
        findFirst: jest.fn().mockResolvedValue({ average: new Prisma.Decimal(9), trendDelta: null }),
      },
    });
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(p?.trendDelta).toBe(0.5);
    expect(p?.improved).toBe(false);
  });

  it('live fall-through when no snapshot row exists', async () => {
    const prisma = progressPrisma({
      studentSubjectSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
      grade: {
        findMany: jest.fn().mockResolvedValue([
          { value: new Prisma.Decimal(10), assessment: { maxScore: new Prisma.Decimal(20) } },
          { value: new Prisma.Decimal(12), assessment: { maxScore: new Prisma.Decimal(20) } },
        ]),
      },
    });
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    // live avg (10+12)/2 = 11; delta vs 8.5 baseline = +2.5.
    expect(p?.currentAvg).toBe(11);
    expect(p?.trendDelta).toBe(2.5);
    expect((prisma.grade as { findMany: jest.Mock }).findMany).toHaveBeenCalled();
  });

  it('null baseline → null delta, never a fabricated positive (PM-4)', async () => {
    const prisma = progressPrisma({
      remediationPlan: {
        findMany: jest.fn().mockResolvedValue([planRow({ baselineAvg: null })]),
      },
    });
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(p?.baselineAvg).toBeNull();
    expect(p?.currentAvg).toBe(11); // current still read
    expect(p?.trendDelta).toBeNull(); // but no delta vs a null baseline
    expect(p?.improved).toBe(false);
  });

  it('null current (total miss) → trendDelta null → "en attente"', async () => {
    const prisma = progressPrisma({
      studentSubjectSnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
      grade: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(p?.currentAvg).toBeNull();
    expect(p?.trendDelta).toBeNull();
    expect(p?.improved).toBe(false);
  });

  it('session counts + nextSessionAt from ONE grouped Booking query (no N+1)', async () => {
    const future = new Date(Date.now() + 86_400_000);
    const past = new Date(Date.now() - 86_400_000);
    const bookingFindMany = jest.fn().mockResolvedValue([
      { planId: 'plan-1', status: 'confirmed', sessionAt: future },
      { planId: 'plan-1', status: 'requested', sessionAt: past }, // past → not "prochaine"
      { planId: 'plan-1', status: 'completed', sessionAt: past },
    ]);
    const prisma = progressPrisma({ booking: { findMany: bookingFindMany } });
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(bookingFindMany).toHaveBeenCalledTimes(1);
    expect(p?.sessionsPlanned).toBe(2); // confirmed + requested
    expect(p?.sessionsDone).toBe(1); // completed
    expect(p?.nextSessionAt).toBe(future.toISOString()); // soonest FUTURE active
  });

  it('empty booking tables → 0/0/null, trend still renders', async () => {
    const prisma = progressPrisma();
    const service = new RemediationService(prisma as never);
    const [p] = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(p?.sessionsPlanned).toBe(0);
    expect(p?.sessionsDone).toBe(0);
    expect(p?.nextSessionAt).toBeNull();
    expect(p?.trendDelta).toBe(2.5); // trend independent of bookings
  });

  it('no open plan → empty array, no Booking query', async () => {
    const prisma = progressPrisma({
      remediationPlan: { findMany: jest.fn().mockResolvedValue([]) },
    });
    const service = new RemediationService(prisma as never);
    const res = await service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });
    expect(res).toEqual([]);
    expect((prisma.booking as { findMany: jest.Mock }).findMany).not.toHaveBeenCalled();
  });
});

describe('RemediationService.catalogue — tenant + published + subject filter', () => {
  it('queries only published, tenant-scoped, subject-matching tutors with active slots', async () => {
    const findMany = jest.fn().mockResolvedValue([
      {
        id: 'tutor-1',
        type: 'teacher',
        costKind: 'free',
        displayName: 'M. Diallo',
        blurb: 'Soutien maths',
        subjectIds: [SUBJECT],
        availabilities: [
          {
            id: 'slot-1',
            kind: 'recurring_weekly',
            weekday: 1,
            startTime: '17:00',
            endTime: '18:00',
            startsAt: null,
            endsAt: null,
            capacity: 1,
          },
        ],
      },
    ]);
    const prisma = makePrisma({ tutor: { findMany } });
    const service = new RemediationService(prisma as never);

    const res = await service.catalogue({ tenantId: TENANT, schoolId: SCHOOL, subjectId: SUBJECT });

    const whereArg = findMany.mock.calls[0][0].where;
    expect(whereArg.tenantId).toBe(TENANT);
    expect(whereArg.schoolId).toBe(SCHOOL);
    expect(whereArg.published).toBe(true);
    expect(whereArg.subjectIds).toEqual({ has: SUBJECT });
    // Only active slots are included.
    expect(findMany.mock.calls[0][0].include.availabilities.where.active).toBe(true);
    expect(res.tutors).toHaveLength(1);
    expect(res.tutors[0]?.slots).toHaveLength(1);
  });
});
