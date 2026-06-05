import { AlertsEvaluatorService } from './alerts-evaluator.service';

/**
 * Focused unit tests for the cron-path guardian notification fan-out
 * (`notifyGuardiansOfAlert`). The method is private; we exercise it directly
 * with a hand-rolled Prisma mock so no DB / Nest context is needed.
 *
 * The in-app fan-out does NOT consult NotificationPreference for the in-app
 * channel (parity with the API's unconditional alert in-app insert). The
 * EMAIL channel (E3-S4) DOES: it is opt-in / OFF by default, gated by
 * `NotificationPreference(alert, emailEnabled=true)` and enqueued onto the
 * shared `notifications-email` queue. These tests assert the severity map,
 * source-dedup, early returns, best-effort error swallowing, AND the email
 * opt-in gate + job shape.
 */
type Mock = ReturnType<typeof jest.fn>;

function makePrisma(opts: {
  guardians: Array<{ userProfileId: string | null }>;
  alreadyNotified?: string[];
  /** userProfileIds with NotificationPreference(alert, emailEnabled=true). */
  emailOptIn?: string[];
  /** id → profile row returned by userProfile.findMany. */
  profiles?: Array<{
    id: string;
    email: string;
    firstName?: string;
    lastName?: string;
    locale?: string | null;
  }>;
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
  const notificationPreferenceFindMany: Mock = jest
    .fn()
    .mockResolvedValue((opts.emailOptIn ?? []).map((userProfileId) => ({ userProfileId })));
  const userProfileFindMany: Mock = jest
    .fn()
    .mockResolvedValue(opts.profiles ?? []);
  return {
    prisma: {
      guardianship: { findMany: guardianshipFindMany },
      notification: { findMany: notificationFindMany, createMany: notificationCreateMany },
      notificationPreference: { findMany: notificationPreferenceFindMany },
      userProfile: { findMany: userProfileFindMany },
    },
    guardianshipFindMany,
    notificationFindMany,
    notificationCreateMany,
    notificationPreferenceFindMany,
    userProfileFindMany,
  };
}

function makeQueue() {
  const addBulk: Mock = jest.fn().mockResolvedValue(undefined);
  return { queue: { addBulk }, addBulk };
}

function callNotifyWith(
  prisma: unknown,
  queue: unknown,
  severity: 'low' | 'medium' | 'high',
) {
  const service = new AlertsEvaluatorService(prisma as never, queue as never);
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

/** Back-compat helper: most in-app tests don't care about the email queue. */
function callNotify(prisma: unknown, severity: 'low' | 'medium' | 'high') {
  return callNotifyWith(prisma, makeQueue().queue, severity);
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

describe('AlertsEvaluatorService — E3-S4 email parity on the cron path', () => {
  it('enqueues one notifications-email job per opted-in guardian (default OFF → none)', async () => {
    // u1 opted in, u2 did not.
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }, { userProfileId: 'u2' }],
      emailOptIn: ['u1'],
      profiles: [{ id: 'u1', email: 'p1@ex.fr', firstName: 'Anne', lastName: 'Dupond', locale: 'fr-FR' }],
    });
    const q = makeQueue();
    const count = await callNotifyWith(m.prisma, q.queue, 'high');

    expect(count).toBe(2); // in-app to both, unchanged
    expect(q.addBulk).toHaveBeenCalledTimes(1);
    const jobs = q.addBulk.mock.calls[0]![0];
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({
      name: 'alert',
      data: {
        tenantId: 'tenant-1',
        to: 'p1@ex.fr',
        recipientName: 'Anne Dupond',
        kind: 'alert',
        severity: 'danger',
        title: 'Moyenne faible',
        body: 'Moyenne sous le seuil',
        link: '/parent/recommendations?studentId=student-1',
        sourceType: 'alert_instance',
        sourceId: 'alert-1',
      },
    });
    expect(jobs[0].opts).toMatchObject({ attempts: 3 });
  });

  it('default OFF: no opt-in row → no email enqueued, in-app still fans out', async () => {
    const m = makePrisma({ guardians: [{ userProfileId: 'u1' }], emailOptIn: [] });
    const q = makeQueue();
    const count = await callNotifyWith(m.prisma, q.queue, 'medium');

    expect(count).toBe(1);
    expect(m.notificationPreferenceFindMany).toHaveBeenCalledTimes(1);
    expect(q.addBulk).not.toHaveBeenCalled();
    expect(m.userProfileFindMany).not.toHaveBeenCalled();
  });

  it('queries the email opt-in scoped to tenant + alert kind + freshly-notified recipients only', async () => {
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }, { userProfileId: 'u2' }],
      alreadyNotified: ['u2'], // only u1 is fresh
      emailOptIn: ['u1'],
      profiles: [{ id: 'u1', email: 'p1@ex.fr' }],
    });
    const q = makeQueue();
    await callNotifyWith(m.prisma, q.queue, 'low');

    const where = m.notificationPreferenceFindMany.mock.calls[0]![0].where;
    // E5-S2: the cron alert-email gate now also pins cadence='instant' so a parent
    // on daily_digest/off gets no instant email here (the digest bundles it).
    expect(where).toMatchObject({
      tenantId: 'tenant-1',
      kind: 'alert',
      emailEnabled: true,
      cadence: 'instant',
    });
    // only the fresh recipient (u1) — never the already-notified u2 → no double-send
    expect(where.userProfileId.in).toEqual(['u1']);
    const profWhere = m.userProfileFindMany.mock.calls[0]![0].where;
    expect(profWhere).toMatchObject({ tenantId: 'tenant-1' });
  });

  it('skips opted-in recipients with no email on file', async () => {
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }],
      emailOptIn: ['u1'],
      profiles: [{ id: 'u1', email: '' }], // no usable email
    });
    const q = makeQueue();
    await callNotifyWith(m.prisma, q.queue, 'high');
    expect(q.addBulk).not.toHaveBeenCalled();
  });

  it('falls back to the email as recipient name when no first/last name', async () => {
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }],
      emailOptIn: ['u1'],
      profiles: [{ id: 'u1', email: 'solo@ex.fr' }],
    });
    const q = makeQueue();
    await callNotifyWith(m.prisma, q.queue, 'high');
    expect(q.addBulk.mock.calls[0]![0][0].data.recipientName).toBe('solo@ex.fr');
  });

  it('email enqueue failure is swallowed; in-app fan-out count is unaffected', async () => {
    const m = makePrisma({
      guardians: [{ userProfileId: 'u1' }],
      emailOptIn: ['u1'],
      profiles: [{ id: 'u1', email: 'p1@ex.fr' }],
    });
    const q = { queue: { addBulk: jest.fn().mockRejectedValue(new Error('redis down')) }, addBulk: jest.fn() };
    const count = await callNotifyWith(m.prisma, q.queue, 'high');
    expect(count).toBe(1); // in-app unaffected
  });
});
