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

describe('AlertsService.recordMeetingIntent (E1-S2 — append-only, idempotent, status-neutral)', () => {
  const PARENT = { actorRole: 'parent', portal: 'parent' } as const;
  const REQUESTED_AT = new Date('2026-06-04T10:00:00.000Z');

  function makeIntentService(opts: {
    alert?: { studentId: string; code: string; subjectId: string | null } | null;
    existing?: { createdAt: Date } | null;
  }) {
    const alert =
      opts.alert === undefined
        ? { studentId: 'stu-1', code: 'LOW_SUBJECT_AVG', subjectId: 'subj-1' }
        : opts.alert;
    const prisma = {
      alertInstance: {
        findFirst: jest.fn().mockResolvedValue(alert),
        update: jest.fn(),
      },
      auditLog: {
        findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
        create: jest.fn().mockResolvedValue({ createdAt: REQUESTED_AT }),
      },
    };
    const notifications = { markReadBySource: jest.fn() };
    const service = new AlertsService(
      prisma as never,
      notifications as unknown as NotificationsService,
    );
    return { service, prisma };
  }

  it('writes exactly ONE audit row with action alert.meeting_intent and the {studentId,alertCode,subjectId} payload', async () => {
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
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: TENANT,
        actorId: 'parent-1',
        actorRole: 'parent',
        portal: 'parent',
        action: 'alert.meeting_intent',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        after: { studentId: 'stu-1', alertCode: 'LOW_SUBJECT_AVG', subjectId: 'subj-1' },
      }),
      select: { createdAt: true },
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

  it('is idempotent: a second intent by the same actor writes NO new row and returns alreadyRequested:true with the original timestamp', async () => {
    const { service, prisma } = makeIntentService({ existing: { createdAt: REQUESTED_AT } });

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
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('serialises a null subjectId (subject-less alert) without a broken payload', async () => {
    const { service, prisma } = makeIntentService({
      alert: { studentId: 'stu-9', code: 'HIGH_ABSENCE', subjectId: null },
    });

    await service.recordMeetingIntent({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: 'parent-1',
      ...PARENT,
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        after: { studentId: 'stu-9', alertCode: 'HIGH_ABSENCE', subjectId: null },
      }),
      select: { createdAt: true },
    });
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
    expect(prisma.auditLog.findFirst).not.toHaveBeenCalled();
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
