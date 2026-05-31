import { NotificationsService, type CreateNotificationArgs } from './notifications.service';
import { NotificationPreferencesService } from './preferences.service';

type CreatedRow = { userProfileId: string; kind: string };

type EnqueuedJob = { name: string; data: { to: string; kind: string } };

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
    },
    userProfile: {
      // Echo a deterministic email per requested id so dispatch can resolve them.
      findMany: jest.fn(async ({ where }: { where: { id: { in: string[] } } }) =>
        where.id.in.map((id) => ({
          id,
          email: `${id}@example.test`,
          firstName: 'Test',
          lastName: id.toUpperCase(),
          locale: 'fr-FR',
        })),
      ),
    },
  };
  const prefs = {
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
    prefs.disabledInAppKeys.mockResolvedValue(new Set(['u2|grade_published']));

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
    prefs.disabledInAppKeys.mockResolvedValue(new Set(['u1|alert']));

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
    expect(prefs.disabledInAppKeys).not.toHaveBeenCalled();
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
    prefs.emailEnabledKeys.mockResolvedValue(new Set(['u2|grade_published']));

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
    prefs.disabledInAppKeys.mockResolvedValue(new Set(['u1|grade_published']));
    prefs.emailEnabledKeys.mockResolvedValue(new Set(['u1|grade_published']));

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    // No in-app row, but the email still goes out — the channels are independent.
    expect(res.created).toBe(0);
    expect(created).toHaveLength(0);
    expect(enqueued.map((j) => j.data.to)).toEqual(['u1@example.test']);
  });

  it('never lets an email-enqueue failure break the in-app insert', async () => {
    const { service, prefs, emailQueue, created } = makeService();
    prefs.emailEnabledKeys.mockResolvedValue(new Set(['u1|grade_published']));
    emailQueue.addBulk.mockRejectedValueOnce(new Error('redis down'));

    const res = await service.createMany([item({ userProfileId: 'u1' })]);

    expect(res.created).toBe(1);
    expect(created).toHaveLength(1);
  });
});
