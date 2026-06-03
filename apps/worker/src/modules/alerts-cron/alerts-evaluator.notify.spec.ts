import { AlertsEvaluatorService } from './alerts-evaluator.service';

/**
 * Focused unit tests for the cron-path guardian notification fan-out
 * (`notifyGuardiansOfAlert`). The method is private; we exercise it directly
 * with a hand-rolled Prisma mock so no DB / Nest context is needed.
 *
 * NOTE: the worker fan-out is IN-APP ONLY by design — it does NOT consult
 * NotificationPreference (that gate is API-owned). So these tests assert the
 * severity map, source-dedup, the early return, and best-effort error
 * swallowing — NOT preference gating.
 */
type Mock = ReturnType<typeof jest.fn>;

function makePrisma(opts: {
  guardians: Array<{ userProfileId: string | null }>;
  alreadyNotified?: string[];
}) {
  const guardianshipFindMany: Mock = jest
    .fn()
    .mockResolvedValue(opts.guardians.map((g) => ({ guardian: { userProfileId: g.userProfileId } })));
  const notificationFindMany: Mock = jest
    .fn()
    .mockResolvedValue((opts.alreadyNotified ?? []).map((userProfileId) => ({ userProfileId })));
  const notificationCreateMany: Mock = jest
    .fn()
    .mockImplementation((arg: { data: unknown[] }) => Promise.resolve({ count: arg.data.length }));
  return {
    prisma: {
      guardianship: { findMany: guardianshipFindMany },
      notification: { findMany: notificationFindMany, createMany: notificationCreateMany },
    },
    guardianshipFindMany,
    notificationFindMany,
    notificationCreateMany,
  };
}

function callNotify(prisma: unknown, severity: 'low' | 'medium' | 'high') {
  const service = new AlertsEvaluatorService(prisma as never);
  // private method — exercised directly
  return (service as unknown as {
    notifyGuardiansOfAlert(a: {
      tenantId: string;
      studentId: string;
      alertId: string;
      severity: 'low' | 'medium' | 'high';
      title: string;
      body: string;
    }): Promise<number>;
  }).notifyGuardiansOfAlert({
    tenantId: 'tenant-1',
    studentId: 'student-1',
    alertId: 'alert-1',
    severity,
    title: 'Moyenne faible',
    body: 'Moyenne sous le seuil',
  });
}

describe('AlertsEvaluatorService.notifyGuardiansOfAlert', () => {
  it('creates one in-app notification per active guardian with the deep link', async () => {
    const m = makePrisma({ guardians: [{ userProfileId: 'u1' }, { userProfileId: 'u2' }] });
    const count = await callNotify(m.prisma, 'high');

    expect(count).toBe(2);
    expect(m.notificationCreateMany).toHaveBeenCalledTimes(1);
    const rows = m.notificationCreateMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      tenantId: 'tenant-1',
      userProfileId: 'u1',
      kind: 'alert',
      severity: 'danger', // high -> danger
      link: '/parent/recommendations?studentId=student-1',
      sourceType: 'alert_instance',
      sourceId: 'alert-1',
    });
  });

  it('maps AlertSeverity -> NotificationSeverity (low->info, medium->warning, high->danger)', async () => {
    for (const [sev, expected] of [
      ['low', 'info'],
      ['medium', 'warning'],
      ['high', 'danger'],
    ] as const) {
      const m = makePrisma({ guardians: [{ userProfileId: 'u1' }] });
      await callNotify(m.prisma, sev);
      expect(m.notificationCreateMany.mock.calls[0]![0].data[0].severity).toBe(expected);
    }
  });

  it('source-dedups guardians who were already notified for this alert', async () => {
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }, { userProfileId: 'u2' }],
      alreadyNotified: ['u1'],
    });
    const count = await callNotify(m.prisma, 'medium');

    expect(count).toBe(1);
    const rows = m.notificationCreateMany.mock.calls[0]![0].data;
    expect(rows).toHaveLength(1);
    expect(rows[0].userProfileId).toBe('u2');
  });

  it('skips guardians with no linked user account', async () => {
    const m = makePrisma({ guardians: [{ userProfileId: null }] });
    const count = await callNotify(m.prisma, 'low');

    expect(count).toBe(0);
    expect(m.notificationFindMany).not.toHaveBeenCalled();
    expect(m.notificationCreateMany).not.toHaveBeenCalled();
  });

  it('returns 0 without inserting when every recipient was already notified', async () => {
    const m = makePrisma({ guardians: [{ userProfileId: 'u1' }], alreadyNotified: ['u1'] });
    const count = await callNotify(m.prisma, 'high');

    expect(count).toBe(0);
    expect(m.notificationCreateMany).not.toHaveBeenCalled();
  });

  it('is best-effort: a Prisma failure is swallowed and returns 0 (never aborts the eval loop)', async () => {
    const prisma = {
      guardianship: { findMany: jest.fn().mockRejectedValue(new Error('db down')) },
      notification: { findMany: jest.fn(), createMany: jest.fn() },
    };
    await expect(callNotify(prisma, 'high')).resolves.toBe(0);
  });
});
