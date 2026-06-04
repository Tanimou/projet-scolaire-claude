import { NotFoundException } from '@nestjs/common';

import { MeetingRequestsService } from './meeting-requests.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const MR_ID = 'mr-1';
const TEACHER = 'teacher-up-1';
const OTHER_TEACHER = 'teacher-up-2';

function fullRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MR_ID,
    status: 'open',
    alertId: 'alert-1',
    alertCode: 'LOW_SUBJECT_AVG',
    studentId: 'stu-1',
    subjectId: 'subj-1',
    assignedToId: TEACHER,
    resolvedAt: null,
    createdAt: new Date('2026-06-04T10:00:00.000Z'),
    alert: { title: 'Moyenne faible', severity: 'high' },
    student: {
      firstName: 'Léa',
      lastName: 'Martin',
      enrollments: [{ classSection: { name: '6e B' } }],
    },
    subject: { code: 'MATH', name: 'Maths' },
    requester: { firstName: 'Marie', lastName: 'Martin' },
    assignedTo: { firstName: 'Paul', lastName: 'Durand' },
    ...overrides,
  };
}

function makeService(opts: { row?: unknown; rows?: unknown[] } = {}) {
  const prisma = {
    meetingRequest: {
      findMany: jest.fn().mockResolvedValue(opts.rows ?? [fullRow()]),
      count: jest.fn().mockResolvedValue((opts.rows ?? [fullRow()]).length),
      findFirst: jest.fn().mockResolvedValue(opts.row === undefined ? fullRow() : opts.row),
      update: jest.fn().mockResolvedValue(fullRow({ status: 'resolved', resolvedAt: new Date() })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
  };
  const service = new MeetingRequestsService(prisma as never);
  return { service, prisma };
}

describe('MeetingRequestsService.scopeFromRoles', () => {
  const { service } = makeService();

  it('maps super_admin / school_admin → admin scope', () => {
    expect(service.scopeFromRoles(['school_admin'], TEACHER)).toEqual({ kind: 'admin' });
    expect(service.scopeFromRoles(['super_admin'], TEACHER)).toEqual({ kind: 'admin' });
  });

  it('maps teacher → teacher scope carrying the caller id', () => {
    expect(service.scopeFromRoles(['teacher'], TEACHER)).toEqual({
      kind: 'teacher',
      userProfileId: TEACHER,
    });
  });

  it('maps any other role → none (defensive; parent is also blocked by the permission gate)', () => {
    expect(service.scopeFromRoles(['parent'], TEACHER)).toEqual({ kind: 'none' });
    expect(service.scopeFromRoles([], TEACHER)).toEqual({ kind: 'none' });
  });
});

describe('MeetingRequestsService.list (role + tenant scoped, no N+1)', () => {
  it('admin: where is tenant+school scoped, no assignee OR-filter', async () => {
    const { service, prisma } = makeService();

    const res = await service.list({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'admin' },
      status: 'open',
      limit: 50,
      offset: 0,
    });

    expect(res.total).toBe(1);
    const where = prisma.meetingRequest.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: TENANT, schoolId: SCHOOL, status: 'open' });
    expect(where.OR).toBeUndefined();
    // one query for rows + one for count — no per-row fetch
    expect(prisma.meetingRequest.findMany).toHaveBeenCalledTimes(1);
  });

  it('teacher: where restricts to assigned-to-me OR unassigned', async () => {
    const { service, prisma } = makeService();

    await service.list({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'teacher', userProfileId: TEACHER },
      status: 'open',
      limit: 50,
      offset: 0,
    });

    const where = prisma.meetingRequest.findMany.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ assignedToId: TEACHER }, { assignedToId: null }]);
  });

  it('none scope: returns empty without touching the DB', async () => {
    const { service, prisma } = makeService();

    const res = await service.list({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'none' },
      status: 'open',
      limit: 50,
      offset: 0,
    });

    expect(res).toEqual({ data: [], total: 0 });
    expect(prisma.meetingRequest.findMany).not.toHaveBeenCalled();
  });

  it('maps the joined row to a DTO with child/alert/subject/parent/assignee fields', async () => {
    const { service } = makeService();

    const res = await service.list({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'admin' },
      status: 'open',
      limit: 50,
      offset: 0,
    });

    expect(res.data[0]).toMatchObject({
      id: MR_ID,
      status: 'open',
      alertTitle: 'Moyenne faible',
      alertSeverity: 'high',
      studentName: 'Léa Martin',
      classSectionName: '6e B',
      subjectName: 'Maths',
      requestedByName: 'Marie Martin',
      assignedToName: 'Paul Durand',
    });
  });
});

describe('MeetingRequestsService.resolve (idempotent, scoped, audited)', () => {
  it('open → resolved: stamps fields, writes ONE meeting_request.resolve audit row', async () => {
    const { service, prisma } = makeService();

    const dto = await service.resolve({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'admin' },
      id: MR_ID,
      userProfileId: 'admin-1',
      actorRole: 'school_admin',
      portal: 'admin',
    });

    expect(dto.status).toBe('resolved');
    expect(prisma.meetingRequest.update).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'meeting_request.resolve',
        resourceType: 'meeting_request',
        resourceId: MR_ID,
        before: { status: 'open' },
        after: { status: 'resolved' },
      }),
    });
  });

  it('idempotent: resolving an already-resolved request is a no-op (no update, no audit)', async () => {
    const { service, prisma } = makeService({ row: fullRow({ status: 'resolved' }) });

    const dto = await service.resolve({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'admin' },
      id: MR_ID,
      userProfileId: 'admin-1',
      actorRole: 'school_admin',
      portal: 'admin',
    });

    expect(dto.status).toBe('resolved');
    expect(prisma.meetingRequest.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('out-of-scope / cross-tenant id → 404 (the scope filter is part of the lookup where)', async () => {
    const { service, prisma } = makeService({ row: null });

    await expect(
      service.resolve({
        tenantId: TENANT,
        schoolId: SCHOOL,
        scope: { kind: 'teacher', userProfileId: OTHER_TEACHER },
        id: MR_ID,
        userProfileId: OTHER_TEACHER,
        actorRole: 'teacher',
        portal: 'teacher',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    // The teacher OR-filter was applied to the lookup, so another teacher's row
    // is invisible (findFirst returned null).
    const where = prisma.meetingRequest.findFirst.mock.calls[0][0].where;
    expect(where.OR).toEqual([{ assignedToId: OTHER_TEACHER }, { assignedToId: null }]);
    expect(prisma.meetingRequest.update).not.toHaveBeenCalled();
  });

  it('none scope → 404 without touching the DB', async () => {
    const { service, prisma } = makeService();

    await expect(
      service.resolve({
        tenantId: TENANT,
        schoolId: SCHOOL,
        scope: { kind: 'none' },
        id: MR_ID,
        userProfileId: 'x',
        actorRole: null,
        portal: null,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.meetingRequest.findFirst).not.toHaveBeenCalled();
  });

  it('best-effort audit: an audit write failure still returns the resolved DTO', async () => {
    const { service, prisma } = makeService();
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit down'));

    const dto = await service.resolve({
      tenantId: TENANT,
      schoolId: SCHOOL,
      scope: { kind: 'admin' },
      id: MR_ID,
      userProfileId: 'admin-1',
      actorRole: 'school_admin',
      portal: 'admin',
    });

    expect(dto.status).toBe('resolved');
  });
});
