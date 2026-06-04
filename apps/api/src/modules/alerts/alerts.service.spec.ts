import { AlertsService } from './alerts.service';
import type { NotificationsService } from '../notifications/notifications.service';

const TENANT = 't1';
const ALERT_ID = 'alert-1';
const USER = 'admin-1';

// Default lifecycle-call provenance: the common case (school_admin via the admin
// portal), now passed explicitly by the controller rather than hardcoded in the
// service. Tests that exercise other roles override these.
const SCHOOL_ADMIN = { actorRole: 'school_admin', portal: 'admin' } as const;

function makeService(initialStatus: string = 'open') {
  const updatedRow = { id: ALERT_ID, tenantId: TENANT, status: initialStatus };
  const prisma = {
    alertInstance: {
      findFirst: jest.fn().mockResolvedValue({ ...updatedRow }),
      update: jest.fn(async ({ data }: { data: { status: string } }) => ({
        ...updatedRow,
        ...data,
      })),
    },
    auditLog: {
      create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
    },
  };
  const notifications = {
    markReadBySource: jest.fn().mockResolvedValue(2),
  };
  const service = new AlertsService(
    prisma as never,
    notifications as unknown as NotificationsService,
  );
  return { service, prisma, notifications };
}

describe('AlertsService notification retraction on lifecycle close', () => {
  it('AC1 — resolve flips status to resolved AND retracts the source notifications', async () => {
    const { service, notifications, prisma } = makeService();

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
    expect(prisma.alertInstance.update).toHaveBeenCalledTimes(1);
    expect(notifications.markReadBySource).toHaveBeenCalledTimes(1);
    expect(notifications.markReadBySource).toHaveBeenCalledWith({
      tenantId: TENANT,
      sourceType: 'alert_instance',
      sourceId: ALERT_ID,
    });
  });

  it('AC2 — dismiss flips status to dismissed AND retracts the source notifications', async () => {
    const { service, notifications } = makeService();

    const result = await service.dismiss({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('dismissed');
    expect(notifications.markReadBySource).toHaveBeenCalledWith({
      tenantId: TENANT,
      sourceType: 'alert_instance',
      sourceId: ALERT_ID,
    });
  });

  it('AC3 — acknowledge does NOT retract (alert is still open/active)', async () => {
    const { service, notifications } = makeService();

    await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(notifications.markReadBySource).not.toHaveBeenCalled();
  });

  it('AC6 — best-effort: a markReadBySource rejection still returns the resolved row', async () => {
    const { service, notifications } = makeService();
    notifications.markReadBySource.mockRejectedValueOnce(new Error('db down'));

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
  });

  it('AC6 — best-effort: a markReadBySource rejection still returns the dismissed row', async () => {
    const { service, notifications } = makeService();
    notifications.markReadBySource.mockRejectedValueOnce(new Error('db down'));

    const result = await service.dismiss({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('dismissed');
  });
});

describe('AlertsService append-only audit on lifecycle transitions', () => {
  it('T1 — resolve writes one audit row with pinned fields (open -> resolved)', async () => {
    const { service, prisma } = makeService('open');

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        tenantId: TENANT,
        actorId: USER,
        actorRole: 'school_admin',
        portal: 'admin',
        action: 'alert.resolve',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        before: { status: 'open' },
        after: { status: 'resolved' },
      },
    });
  });

  it('T1 — dismiss writes one audit row with action alert.dismiss (open -> dismissed)', async () => {
    const { service, prisma } = makeService('open');

    const result = await service.dismiss({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('dismissed');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'alert.dismiss',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        tenantId: TENANT,
        actorId: USER,
        actorRole: 'school_admin',
        portal: 'admin',
        before: { status: 'open' },
        after: { status: 'dismissed' },
      }),
    });
  });

  it('T1 — acknowledge on an OPEN alert writes one audit row (open -> acknowledged)', async () => {
    const { service, prisma } = makeService('open');

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('acknowledged');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'alert.acknowledge',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        actorRole: 'school_admin',
        portal: 'admin',
        before: { status: 'open' },
        after: { status: 'acknowledged' },
      }),
    });
  });

  it('T2 — no-op acknowledge (already acknowledged) writes ZERO audit rows', async () => {
    const { service, prisma } = makeService('acknowledged');

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('acknowledged');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('T2b — no-op resolve (already dismissed) is idempotent: no update, no audit, no retraction', async () => {
    const { service, prisma, notifications } = makeService('dismissed');

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('dismissed');
    expect(prisma.alertInstance.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.markReadBySource).not.toHaveBeenCalled();
  });

  it('T2c — no-op dismiss (already resolved) is idempotent: no update, no audit, no retraction', async () => {
    const { service, prisma, notifications } = makeService('resolved');

    const result = await service.dismiss({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
    expect(prisma.alertInstance.update).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.markReadBySource).not.toHaveBeenCalled();
  });

  it('T2 — no-op acknowledge (already resolved) writes ZERO audit rows', async () => {
    const { service, prisma } = makeService('resolved');

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('T3 — auditLog.create rejection still returns the resolved row and does not throw', async () => {
    const { service, prisma } = makeService('open');
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
  });

  it('T3 — auditLog.create rejection still returns the acknowledged row and does not throw', async () => {
    const { service, prisma } = makeService('open');
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('acknowledged');
  });

  it('T4 — audit and notification-retraction failures are independent (both attempted)', async () => {
    const { service, prisma, notifications } = makeService('open');
    notifications.markReadBySource.mockRejectedValueOnce(new Error('notif down'));

    const result = await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      ...SCHOOL_ADMIN,
    });

    expect(result.status).toBe('resolved');
    // Retraction failed, yet the audit write was still attempted.
    expect(notifications.markReadBySource).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('AlertsService.recordMeetingIntent (E1-S3 — MeetingRequest model + audit + assignee notif)', () => {
  const PARENT = { actorRole: 'parent', portal: 'parent' } as const;
  const REQUESTED_AT = new Date('2026-06-04T10:00:00.000Z');
  const MR_ID = 'mr-1';

  function p2002(): Error {
    // Minimal Prisma.PrismaClientKnownRequestError stand-in. The service checks
    // `err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'`;
    // jest cannot easily construct the real class, so we tag a plain Error and
    // patch the prototype chain for the instanceof check.
    const { Prisma } = require('@prisma/client');
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'test',
    });
    return err;
  }

  function makeIntentService(opts: {
    alert?:
      | {
          studentId: string;
          code: string;
          subjectId: string | null;
          schoolId?: string | null;
          title?: string;
          student?: { firstName: string; lastName: string };
        }
      | null;
    existing?: { createdAt: Date } | null;
    createThrows?: Error;
    assignee?: string | null;
  }) {
    const alert =
      opts.alert === undefined
        ? {
            studentId: 'stu-1',
            code: 'LOW_SUBJECT_AVG',
            subjectId: 'subj-1',
            schoolId: 'school-1',
            title: 'Moyenne faible',
            student: { firstName: 'Léa', lastName: 'Martin' },
          }
        : opts.alert;
    // Resolve assignee via enrollment + teaching assignment lookups.
    const assignee = opts.assignee === undefined ? 'teacher-up-1' : opts.assignee;
    const prisma = {
      alertInstance: {
        findFirst: jest.fn().mockResolvedValue(alert),
        update: jest.fn(),
      },
      meetingRequest: {
        findUnique: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: opts.createThrows
          ? jest.fn().mockRejectedValue(opts.createThrows)
          : jest.fn().mockResolvedValue({ id: MR_ID, createdAt: REQUESTED_AT }),
      },
      enrollment: {
        findFirst: jest.fn().mockResolvedValue(
          assignee ? { classSectionId: 'cs-1', academicYearId: 'ay-1' } : null,
        ),
      },
      teachingAssignment: {
        findFirst: jest
          .fn()
          .mockResolvedValue(assignee ? { teacherProfile: { userProfileId: assignee } } : null),
      },
      auditLog: {
        create: jest.fn().mockResolvedValue({ id: 'audit-1' }),
      },
    };
    const notifications = {
      markReadBySource: jest.fn(),
      createMany: jest.fn().mockResolvedValue({ created: 1 }),
    };
    const service = new AlertsService(
      prisma as never,
      notifications as unknown as NotificationsService,
    );
    return { service, prisma, notifications };
  }

  it('creates ONE MeetingRequest (open) AND writes the append-only audit row', async () => {
    const { service, prisma } = makeIntentService({});

    const result = await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(result).toEqual({
      ok: true,
      alreadyRequested: false,
      requestedAt: REQUESTED_AT.toISOString(),
    });
    expect(prisma.meetingRequest.create).toHaveBeenCalledTimes(1);
    expect(prisma.meetingRequest.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: TENANT,
          alertId: ALERT_ID,
          studentId: 'stu-1',
          alertCode: 'LOW_SUBJECT_AVG',
          requestedBy: 'parent-1',
          status: 'open',
        }),
      }),
    );
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'alert.meeting_intent',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        actorRole: 'parent',
        portal: 'parent',
      }),
    });
  });

  it('does NOT mutate the alert status (no alertInstance.update)', async () => {
    const { service, prisma } = makeIntentService({});

    await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(prisma.alertInstance.update).not.toHaveBeenCalled();
  });

  it('notifies the resolved assignee exactly once on a new request (kind alert, sourceId = request id)', async () => {
    const { service, notifications } = makeIntentService({ assignee: 'teacher-up-1' });

    await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(notifications.createMany).toHaveBeenCalledTimes(1);
    expect(notifications.createMany).toHaveBeenCalledWith([
      expect.objectContaining({
        tenantId: TENANT,
        userProfileId: 'teacher-up-1',
        kind: 'alert',
        sourceType: 'meeting_request',
        sourceId: MR_ID,
      }),
    ]);
  });

  it('an unresolvable assignee still creates the request and notifies no one', async () => {
    const { service, prisma, notifications } = makeIntentService({ assignee: null });

    const result = await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(result.alreadyRequested).toBe(false);
    expect(prisma.meetingRequest.create).toHaveBeenCalledTimes(1);
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent (fast path): an existing request returns alreadyRequested:true, no create, no notif', async () => {
    const { service, prisma, notifications } = makeIntentService({
      existing: { createdAt: REQUESTED_AT },
    });

    const result = await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(result).toEqual({
      ok: true,
      alreadyRequested: true,
      requestedAt: REQUESTED_AT.toISOString(),
    });
    expect(prisma.meetingRequest.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('is idempotent under concurrency: a P2002 on create returns alreadyRequested:true (one row)', async () => {
    const { service, prisma, notifications } = makeIntentService({ createThrows: p2002() });
    // After the losing create, the service re-reads the winner.
    prisma.meetingRequest.findUnique
      .mockResolvedValueOnce(null) // fast-path miss
      .mockResolvedValueOnce({ createdAt: REQUESTED_AT }); // winner read

    const result = await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(result).toEqual({
      ok: true,
      alreadyRequested: true,
      requestedAt: REQUESTED_AT.toISOString(),
    });
    // No audit row, no notification on the idempotent (lost-race) path.
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
    expect(notifications.createMany).not.toHaveBeenCalled();
  });

  it('a notification failure never rolls back the create (best-effort)', async () => {
    const { service, notifications } = makeIntentService({});
    notifications.createMany.mockRejectedValueOnce(new Error('notif down'));

    const result = await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(result.alreadyRequested).toBe(false);
    expect(result.requestedAt).toBe(REQUESTED_AT.toISOString());
  });

  it('throws NotFound (and writes nothing) for an alert absent from the tenant', async () => {
    const { service, prisma } = makeIntentService({ alert: null });

    await expect(
      service.recordMeetingIntent({
        tenantId: TENANT,
        id: ALERT_ID,
        userProfileId: 'parent-1',
        ...PARENT,
      }),
    ).rejects.toThrow('Alert not found');
    expect(prisma.meetingRequest.create).not.toHaveBeenCalled();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });
});

describe('AlertsService audit provenance is derived from the caller (not hardcoded)', () => {
  it('T5 — a teacher caller records actorRole "teacher" and portal "teacher" (AC2 core fix)', async () => {
    const { service, prisma } = makeService('open');

    await service.resolve({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      actorRole: 'teacher',
      portal: 'teacher',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorRole: 'teacher',
        portal: 'teacher',
        action: 'alert.resolve',
      }),
    });
  });

  it('T6 — a super_admin caller records actorRole "super_admin" and portal "admin" (AC3)', async () => {
    const { service, prisma } = makeService('open');

    await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      actorRole: 'super_admin',
      portal: 'admin',
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorRole: 'super_admin',
        portal: 'admin',
        action: 'alert.acknowledge',
      }),
    });
  });

  it('T7 — an unknown/empty role writes null actorRole/portal without throwing (AC4)', async () => {
    const { service, prisma } = makeService('open');

    const result = await service.dismiss({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
      actorRole: null,
      portal: null,
    });

    expect(result.status).toBe('dismissed');
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        actorRole: null,
        portal: null,
        action: 'alert.dismiss',
        tenantId: TENANT,
      }),
    });
  });
});

describe('AlertsService.listForStudent meetingRequestedAt read-path (E1-S3 carried debt #2)', () => {
  const ALERT_A = 'alert-a';
  const ALERT_B = 'alert-b';
  const PARENT = 'parent-1';

  function makeListService(opts: {
    meetingRows?: { alertId: string; createdAt: Date }[];
  }) {
    const alertRows = [
      {
        id: ALERT_A,
        code: 'LOW_SUBJECT_AVG',
        severity: 'high',
        status: 'open',
        studentId: 'stu-1',
        student: { firstName: 'Léa', lastName: 'Martin' },
        subject: { id: 'subj-1', name: 'Maths', code: 'MATH' },
        classSection: { id: 'cs-1', name: '6e B' },
        title: 'T',
        body: 'B',
        recommendation: null,
        detectedAt: new Date('2026-06-01T00:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: null,
      },
      {
        id: ALERT_B,
        code: 'HIGH_ABSENCE',
        severity: 'medium',
        status: 'open',
        studentId: 'stu-1',
        student: { firstName: 'Léa', lastName: 'Martin' },
        subject: null,
        classSection: null,
        title: 'T2',
        body: 'B2',
        recommendation: null,
        detectedAt: new Date('2026-06-02T00:00:00.000Z'),
        acknowledgedAt: null,
        resolvedAt: null,
      },
    ];
    const prisma = {
      alertInstance: { findMany: jest.fn().mockResolvedValue(alertRows) },
      meetingRequest: { findMany: jest.fn().mockResolvedValue(opts.meetingRows ?? []) },
    };
    const notifications = {};
    const service = new AlertsService(
      prisma as never,
      notifications as unknown as NotificationsService,
    );
    return { service, prisma };
  }

  it('stamps meetingRequestedAt on the alert the caller has requested (keyed on their own requestedBy)', async () => {
    const at = new Date('2026-06-03T09:00:00.000Z');
    const { service, prisma } = makeListService({ meetingRows: [{ alertId: ALERT_A, createdAt: at }] });

    const dtos = await service.listForStudent({
      tenantId: TENANT,
      studentId: 'stu-1',
      userProfileId: PARENT,
    });

    expect(prisma.meetingRequest.findMany).toHaveBeenCalledWith({
      where: { tenantId: TENANT, alertId: { in: [ALERT_A, ALERT_B] }, requestedBy: PARENT },
      select: { alertId: true, createdAt: true },
    });
    expect(dtos.find((d) => d.id === ALERT_A)?.meetingRequestedAt).toBe(at.toISOString());
    expect(dtos.find((d) => d.id === ALERT_B)?.meetingRequestedAt).toBeNull();
  });

  it('does not query meeting requests when no caller is provided (admin path) → all null', async () => {
    const { service, prisma } = makeListService({});

    const dtos = await service.listForStudent({ tenantId: TENANT, studentId: 'stu-1' });

    expect(prisma.meetingRequest.findMany).not.toHaveBeenCalled();
    expect(dtos.every((d) => d.meetingRequestedAt === null)).toBe(true);
  });
});
