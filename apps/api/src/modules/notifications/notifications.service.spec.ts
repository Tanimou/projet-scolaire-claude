import { NotificationsService, type CreateNotificationArgs } from './notifications.service';
import { NotificationPreferencesService } from './preferences.service';

type CreatedRow = { userProfileId: string; kind: string; readAt: Date | null };

type EnqueuedJob = {
  name: string;
  data: { to: string; kind: string; locale: string };
  opts?: { attempts: number; backoff: { type: string; delay: number } };
};

function makeService() {
  const created: CreatedRow[] = [];
  const enqueued: EnqueuedJob[] = [];
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(async ({ data }: { data: CreatedRow[] }) => {
        created.push(...data);
        return { count: data.length };
      }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    userProfile: {
      // Echo a deterministic email per requested id so dispatch can resolve them.
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map(
          (id): { id: string; email: string; firstName: string; lastName: string; locale: string | null } => ({
            id,
            email: `${id}@example.test`,
            firstName: 'Test',
            lastName: id.toUpperCase(),
            locale: 'fr-FR',
          }),
        ),
      ),
    },
  };
  const prefs = {
    // E5-S2 — createMany now drives the cadence-aware gates. `inAppPlan` returns
    // the in-app classification ({skip, hiddenSource}); `instantEmailKeys` returns
    // the keys that should email NOW (emailEnabled && cadence=instant). The legacy
    // `disabledInAppKeys`/`emailEnabledKeys` are kept on the service for other
    // callers (cron) but no longer used by createMany.
    inAppPlan: jest
      .fn()
      .mockResolvedValue({ skip: new Set<string>(), hiddenSource: new Set<string>() }),
    instantEmailKeys: jest.fn().mockResolvedValue(new Set<string>()),
    disabledInAppKeys: jest.fn().mockResolvedValue(new Set<string>()),
    emailEnabledKeys: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const emailQueue = {
    addBulk: jest.fn(async (jobs: EnqueuedJob[]) => {
      enqueued.push(...jobs);
      return jobs;
    }),
  };
  const service = new NotificationsService(
    prisma as never,
    prefs as unknown as NotificationPreferencesService,
    emailQueue as never,
  );
  return { service, prisma, prefs, emailQueue, created, enqueued };
}

function item(over: Partial<CreateNotificationArgs> = {}): CreateNotificationArgs {
  return {
    tenantId: 't1',
    userProfileId: 'u1',
    kind: 'grade_published',
    title: 'Nouvelle note',
    ...over,
  };
}

describe('NotificationsService.createMany — preference gating', () => {
  it('drops items whose recipient disabled the in-app channel for that kind', async () => {
    const { service, prefs, created } = makeService();
    prefs.inAppPlan.mockResolvedValue({
      skip: new Set(['u2|grade_published']),
      hiddenSource: new Set<string>(),
    });

    const res = await service.createMany([
      item({ userProfileId: 'u1' }),
      item({ userProfileId: 'u2' }), // disabled
      item({ userProfileId: 'u3' }),
    ]);

    expect(res.created).toBe(2);
    expect(created.map((c) => c.userProfileId).sort()).toEqual(['u1', 'u3']);
  });

  it('keeps recipients with no override (default in-app on)', async () => {
    const { service, created } = makeService();

    const res = await service.createMany([
      item({ userProfileId: 'u1' }),
      item({ userProfileId: 'u2' }),
    ]);

    expect(res.created).toBe(2);
    expect(created).toHaveLength(2);
  });

  it('gates per (user, kind): same user can disable one kind but keep another', async () => {
    const { service, prefs, created } = makeService();
    prefs.inAppPlan.mockResolvedValue({
      skip: new Set(['u1|alert']),
      hiddenSource: new Set<string>(),
    });

    const res = await service.createMany([
      item({ userProfileId: 'u1', kind: 'alert' }), // disabled
      item({ userProfileId: 'u1', kind: 'grade_published' }), // kept
    ]);

    expect(res.created).toBe(1);
    expect(created[0]!.kind).toBe('grade_published');
  });

  it('returns early without querying preferences when there are no items', async () => {
    const { service, prefs } = makeService();
    const res = await service.createMany([]);
    expect(res.created).toBe(0);
    expect(prefs.inAppPlan).not.toHaveBeenCalled();
  });

  it('applies source-based dedup before preference gating', async () => {
    const { service, prisma, created } = makeService();
    // Recipient u1 already has a notification for this source → skipped by dedup.
    prisma.notification.findMany.mockResolvedValue([
      { userProfileId: 'u1', sourceType: 'grade', sourceId: 'g1' },
    ]);

    const res = await service.createMany([
      item({ userProfileId: 'u1', sourceType: 'grade', sourceId: 'g1' }), // deduped
      item({ userProfileId: 'u2', sourceType: 'grade', sourceId: 'g1' }), // kept
    ]);

    expect(res.created).toBe(1);
    expect(created[0]!.userProfileId).toBe('u2');
  });
});

describe('NotificationsService.createMany — email channel (R8.2)', () => {
  it('does not enqueue any email when no recipient opted in (email default off)', async () => {
    const { service, emailQueue, enqueued } = makeService();
    const res = await service.createMany([item({ userProfileId: 'u1' })]);
    expect(res.created).toBe(1);
    expect(emailQueue.addBulk).not.toHaveBeenCalled();
    expect(enqueued).toHaveLength(0);
  });

  it('enqueues an email only for recipients who explicitly enabled it for the kind', async () => {
    const { service, prefs, enqueued } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u2|grade_published']));

    await service.createMany([
      item({ userProfileId: 'u1' }), // not opted in
      item({ userProfileId: 'u2' }), // opted in
      item({ userProfileId: 'u3' }), // not opted in
    ]);

    expect(enqueued.map((j) => j.data.to)).toEqual(['u2@example.test']);
    expect(enqueued[0]!.name).toBe('grade_published');
  });

  it('emails a recipient who turned the in-app feed off but kept email on', async () => {
    const { service, prefs, created, enqueued } = makeService();
    prefs.inAppPlan.mockResolvedValue({
      skip: new Set(['u1|grade_published']),
      hiddenSource: new Set<string>(),
    });
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    // No in-app row, but the email still goes out — the channels are independent.
    expect(res.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(enqueued.map((j) => j.data.to)).toEqual(['u1@example.test']);
  });

  it('never lets an email-enqueue failure break the in-app insert', async () => {
    const { service, prefs, emailQueue, created } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));
    emailQueue.addBulk.mockRejectedValueOnce(new Error('redis down'));

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    expect(res.created).toBe(1);
    expect(created).toHaveLength(1);
  });
});

describe('NotificationsService.createMany — E5-S2 cadence composition (FR-2)', () => {
  it('daily_digest: suppresses the per-event email but keeps the in-app row', async () => {
    const { service, prefs, created, enqueued } = makeService();
    // The recipient is emailEnabled but on daily_digest → instantEmailKeys excludes
    // them (no instant email); inAppPlan leaves them as a normal visible row.
    prefs.instantEmailKeys.mockResolvedValue(new Set<string>());

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    expect(res.created).toBe(1); // in-app row written (bell stays a live feed)
    expect(created).toHaveLength(1);
    expect(enqueued).toHaveLength(0); // NO per-event email — the cron will bundle it
  });

  it('daily_digest + in-app off: writes a hidden (readAt) digest-source row', async () => {
    const { service, prefs, created } = makeService();
    prefs.inAppPlan.mockResolvedValue({
      skip: new Set<string>(),
      hiddenSource: new Set(['u1|grade_published']),
    });

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    // The row exists so the daily cron has a durable source…
    expect(res.created).toBe(1);
    // …but it is pre-read so it never rings the bell (data-model §3.3).
    expect(created[0]!.readAt).toBeInstanceOf(Date);
  });

  it('off: suppresses BOTH the in-app row and the per-event email', async () => {
    const { service, prefs, created, enqueued } = makeService();
    prefs.inAppPlan.mockResolvedValue({
      skip: new Set(['u1|grade_published']),
      hiddenSource: new Set<string>(),
    });
    // off also means no instant email (instantEmailKeys excludes it) — default mock.

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    expect(res.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(enqueued).toHaveLength(0);
  });

  it('instant (default): writes a visible row AND enqueues the per-event email', async () => {
    const { service, prefs, created, enqueued } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    expect(res.created).toBe(1);
    expect(created[0]!.readAt).toBeNull(); // visible (rings the bell)
    expect(enqueued.map((j) => j.data.to)).toEqual(['u1@example.test']);
  });
});

describe('NotificationsService.dispatchEmails — E5-S1 producer edges', () => {
  it('skips a recipient with no email on file but still emails a co-batched valid recipient', async () => {
    const { service, prisma, prefs, enqueued } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(
      new Set(['u1|grade_published', 'u2|grade_published']),
    );
    // u1 has no usable email (empty string), u2 does. The producer must drop u1
    // without throwing while u2 still gets a job.
    prisma.userProfile.findMany.mockResolvedValueOnce([
      { id: 'u1', email: '', firstName: 'A', lastName: 'One', locale: 'fr-FR' },
      { id: 'u2', email: 'u2@example.test', firstName: 'B', lastName: 'Two', locale: 'fr-FR' },
    ]);

    const res = await service.createMany([
      item({ userProfileId: 'u1' }),
      item({ userProfileId: 'u2' }),
    ]);

    // Both still get the in-app row — the empty email only suppresses the email channel.
    expect(res.created).toBe(2);
    expect(enqueued.map((j) => j.data.to)).toEqual(['u2@example.test']);
  });

  it('defaults a null locale to fr-FR on the enqueued job', async () => {
    const { service, prisma, prefs, emailQueue } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));
    prisma.userProfile.findMany.mockResolvedValueOnce([
      { id: 'u1', email: 'u1@example.test', firstName: 'A', lastName: 'One', locale: null },
    ]);

    await service.createMany([item({ userProfileId: 'u1' })]);

    // The enqueued job carries the FR fallback (template localisation itself is
    // an S2 non-goal — only the field is plumbed here).
    const job = emailQueue.addBulk.mock.calls[0]![0][0] as { data: { locale: string } };
    expect(job.data.locale).toBe('fr-FR');
  });

  it('enqueues with exactly the retry/backoff opts {attempts:3, exponential 5000}', async () => {
    const { service, prefs, emailQueue } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));

    await service.createMany([item({ userProfileId: 'u1' })]);

    const jobs = emailQueue.addBulk.mock.calls[0]![0];
    expect(jobs[0]!.opts).toMatchObject({
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
    });
  });

  it('scopes the profile + preference lookups by tenantId (parity with the worker cron path)', async () => {
    const { service, prisma, prefs } = makeService();
    prefs.instantEmailKeys.mockResolvedValue(new Set(['u1|grade_published']));

    await service.createMany([item({ userProfileId: 'u1', tenantId: 't1' })]);

    // instantEmailKeys (the cadence-aware email gate) receives the batch tenant…
    expect(prefs.instantEmailKeys.mock.calls[0]![1]).toBe('t1');
    // …and the profile lookup is tenant-scoped, not id-only.
    const profileWhere = prisma.userProfile.findMany.mock.calls[0]![0].where;
    expect(profileWhere).toMatchObject({ tenantId: 't1' });
  });
});

describe('NotificationsService.markReadBySource — source retraction', () => {
  it('runs a tenant-scoped updateMany keyed by source + readAt:null, returns count', async () => {
    const { service, prisma } = makeService();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 2 });

    const count = await service.markReadBySource({
      tenantId: 't1',
      sourceType: 'alert_instance',
      sourceId: 'a1',
    });

    expect(count).toBe(2);
    expect(prisma.notification.updateMany).toHaveBeenCalledTimes(1);
    const arg = prisma.notification.updateMany.mock.calls[0]![0];
    // AC4 tenant isolation + AC5 idempotency guard + source pinning.
    expect(arg.where).toEqual({
      tenantId: 't1',
      sourceType: 'alert_instance',
      sourceId: 'a1',
      readAt: null,
    });
    // Cleared across ALL guardians — never scoped to a single recipient.
    expect(arg.where).not.toHaveProperty('userProfileId');
    expect(arg.data).toEqual({ readAt: expect.any(Date) });
  });

  it('is idempotent / a no-op when no unread rows match (returns 0)', async () => {
    const { service, prisma } = makeService();
    prisma.notification.updateMany.mockResolvedValueOnce({ count: 0 });

    const count = await service.markReadBySource({
      tenantId: 't1',
      sourceType: 'alert_instance',
      sourceId: 'a-none',
    });

    expect(count).toBe(0);
  });
});
