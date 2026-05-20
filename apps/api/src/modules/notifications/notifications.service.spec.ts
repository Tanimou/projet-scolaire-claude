import { NotificationsService, type CreateNotificationArgs } from './notifications.service';
import { NotificationPreferencesService } from './preferences.service';

type CreatedRow = { userProfileId: string; kind: string };

function makeService() {
  const created: CreatedRow[] = [];
  const prisma = {
    notification: {
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn(async ({ data }: { data: CreatedRow[] }) => {
        created.push(...data);
        return { count: data.length };
      }),
    },
  };
  const prefs = {
    disabledInAppKeys: jest.fn().mockResolvedValue(new Set<string>()),
  };
  const service = new NotificationsService(
    prisma as never,
    prefs as unknown as NotificationPreferencesService,
  );
  return { service, prisma, prefs, created };
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
    expect(created[0].kind).toBe('grade_published');
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
    expect(created[0].userProfileId).toBe('u2');
  });
});
