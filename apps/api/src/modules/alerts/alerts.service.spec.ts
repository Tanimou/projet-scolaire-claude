import { AlertsService } from './alerts.service';
import type { NotificationsService } from '../notifications/notifications.service';

const TENANT = 't1';
const ALERT_ID = 'alert-1';
const USER = 'admin-1';

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

    const result = await service.resolve({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

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

    const result = await service.dismiss({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('dismissed');
    expect(notifications.markReadBySource).toHaveBeenCalledWith({
      tenantId: TENANT,
      sourceType: 'alert_instance',
      sourceId: ALERT_ID,
    });
  });

  it('AC3 — acknowledge does NOT retract (alert is still open/active)', async () => {
    const { service, notifications } = makeService();

    await service.acknowledge({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(notifications.markReadBySource).not.toHaveBeenCalled();
  });

  it('AC6 — best-effort: a markReadBySource rejection still returns the resolved row', async () => {
    const { service, notifications } = makeService();
    notifications.markReadBySource.mockRejectedValueOnce(new Error('db down'));

    const result = await service.resolve({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('resolved');
  });

  it('AC6 — best-effort: a markReadBySource rejection still returns the dismissed row', async () => {
    const { service, notifications } = makeService();
    notifications.markReadBySource.mockRejectedValueOnce(new Error('db down'));

    const result = await service.dismiss({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('dismissed');
  });
});

describe('AlertsService append-only audit on lifecycle transitions', () => {
  it('T1 — resolve writes one audit row with pinned fields (open -> resolved)', async () => {
    const { service, prisma } = makeService('open');

    const result = await service.resolve({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

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

    const result = await service.dismiss({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('dismissed');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'alert.dismiss',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
        tenantId: TENANT,
        actorId: USER,
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
    });

    expect(result.status).toBe('acknowledged');
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        action: 'alert.acknowledge',
        resourceType: 'alert_instance',
        resourceId: ALERT_ID,
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
    });

    expect(result.status).toBe('acknowledged');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('T2 — no-op acknowledge (already resolved) writes ZERO audit rows', async () => {
    const { service, prisma } = makeService('resolved');

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
    });

    expect(result.status).toBe('resolved');
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('T3 — auditLog.create rejection still returns the resolved row and does not throw', async () => {
    const { service, prisma } = makeService('open');
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));

    const result = await service.resolve({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('resolved');
  });

  it('T3 — auditLog.create rejection still returns the acknowledged row and does not throw', async () => {
    const { service, prisma } = makeService('open');
    prisma.auditLog.create.mockRejectedValueOnce(new Error('audit table down'));

    const result = await service.acknowledge({
      tenantId: TENANT,
      id: ALERT_ID,
      userProfileId: USER,
    });

    expect(result.status).toBe('acknowledged');
  });

  it('T4 — audit and notification-retraction failures are independent (both attempted)', async () => {
    const { service, prisma, notifications } = makeService('open');
    notifications.markReadBySource.mockRejectedValueOnce(new Error('notif down'));

    const result = await service.resolve({ tenantId: TENANT, id: ALERT_ID, userProfileId: USER });

    expect(result.status).toBe('resolved');
    // Retraction failed, yet the audit write was still attempted.
    expect(notifications.markReadBySource).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});
