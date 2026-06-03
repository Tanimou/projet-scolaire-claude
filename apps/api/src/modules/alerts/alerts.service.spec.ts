import { AlertsService } from './alerts.service';
import type { NotificationsService } from '../notifications/notifications.service';

const TENANT = 't1';
const ALERT_ID = 'alert-1';
const USER = 'admin-1';

function makeService() {
  const updatedRow = { id: ALERT_ID, tenantId: TENANT, status: 'open' as string };
  const prisma = {
    alertInstance: {
      findFirst: jest.fn().mockResolvedValue({ ...updatedRow }),
      update: jest.fn(async ({ data }: { data: { status: string } }) => ({
        ...updatedRow,
        ...data,
      })),
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
