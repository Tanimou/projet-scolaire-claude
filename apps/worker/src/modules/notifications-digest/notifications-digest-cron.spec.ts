import type { NotificationKind } from '@prisma/client';

import { dailyDigestMarkerId, dayKey } from './daily-key';
import { NotificationsDigestCronService } from './notifications-digest-cron.service';

type Mock = ReturnType<typeof jest.fn>;

/** 18:00 UTC — inside the default daily send window (SEND_HOUR=18). */
const TODAY_1800 = new Date(Date.UTC(2026, 5, 5, 18, 0, 0)); // 2026-06-05
/** 09:00 UTC — outside the send window. */
const TODAY_0900 = new Date(Date.UTC(2026, 5, 5, 9, 0, 0));

interface NotifRow {
  kind: NotificationKind;
  title: string;
  link: string | null;
  createdAt: Date;
}

interface Opts {
  /** (userProfileId, kind) daily_digest opt-ins for the tenant. */
  prefs?: Array<{
    userProfileId: string;
    kind: NotificationKind;
    userProfile: { id: string; email: string | null; firstName: string; lastName: string };
  }>;
  /** Day-window Notification rows returned per user, keyed by userProfileId. */
  notifsByUser?: Record<string, NotifRow[]>;
  existingMarkers?: string[];
  sendImpl?: Mock;
}

const profile = (id: string, email: string | null = `${id}@example.test`) => ({
  id,
  email,
  firstName: 'Marie',
  lastName: 'Curie',
});

function makeHarness(opts: Opts = {}) {
  const prefs =
    opts.prefs ??
    [
      { userProfileId: 'u1', kind: 'grade_published' as NotificationKind, userProfile: profile('u1') },
    ];
  const notifsByUser = opts.notifsByUser ?? {
    u1: [
      { kind: 'grade_published', title: 'Note de Maths', link: '/parent/grades/1', createdAt: new Date(Date.UTC(2026, 5, 5, 10)) },
      { kind: 'grade_published', title: 'Note de Français', link: '/parent/grades/2', createdAt: new Date(Date.UTC(2026, 5, 5, 11)) },
    ],
  };
  const markers = new Set(opts.existingMarkers ?? []);

  const prefFindMany: Mock = jest.fn().mockImplementation((arg: { distinct?: unknown }) => {
    if (arg?.distinct) {
      return Promise.resolve(prefs.length > 0 ? [{ tenantId: 't1' }] : []);
    }
    return Promise.resolve(prefs);
  });

  const notificationFindFirst: Mock = jest
    .fn()
    .mockImplementation((arg: { where: { sourceId: string } }) =>
      Promise.resolve(markers.has(arg.where.sourceId) ? { id: 'marker' } : null),
    );
  const notificationFindMany: Mock = jest
    .fn()
    .mockImplementation((arg: { where: { userProfileId: string } }) =>
      Promise.resolve(notifsByUser[arg.where.userProfileId] ?? []),
    );
  const notificationCreate: Mock = jest
    .fn()
    .mockImplementation((arg: { data: { sourceId: string } }) => {
      markers.add(arg.data.sourceId);
      return Promise.resolve({ id: 'created' });
    });

  const prisma = {
    notificationPreference: { findMany: prefFindMany },
    notification: {
      findFirst: notificationFindFirst,
      findMany: notificationFindMany,
      create: notificationCreate,
    },
  };

  const send: Mock = opts.sendImpl ?? jest.fn().mockResolvedValue(undefined);
  const mailer = { send };

  const service = new NotificationsDigestCronService(prisma as never, mailer as never);
  return { service, send, notificationCreate, notificationFindMany, prisma };
}

describe('NotificationsDigestCronService.tick', () => {
  it('emails a daily-opted-in user once in the window and writes a hidden system marker', async () => {
    const h = makeHarness();
    await h.service.tick(TODAY_1800);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![0].to).toBe('u1@example.test');
    // Composite subject reflects the grouped headline.
    expect(h.send.mock.calls[0]![0].subject).toContain('2 nouvelles notes');

    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
    const data = h.notificationCreate.mock.calls[0]![0].data;
    expect(data.kind).toBe('system'); // marker reuses the system kind (no new kind)
    expect(data.sourceType).toBe('daily_digest');
    expect(data.readAt).toEqual(TODAY_1800); // pre-read → never rings the bell
    expect(data.sourceId).toBe(
      dailyDigestMarkerId({ tenantId: 't1', userProfileId: 'u1', dayKey: dayKey(TODAY_1800) }),
    );
  });

  it('does NOT send outside the configured send hour', async () => {
    const h = makeHarness();
    await h.service.tick(TODAY_0900);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('opt-in gate: no daily_digest prefs → zero sends', async () => {
    const h = makeHarness({ prefs: [] });
    await h.service.tick(TODAY_1800);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('empty day-window → no email and no marker (a later event the same day can still trigger)', async () => {
    const h = makeHarness({ notifsByUser: { u1: [] } });
    await h.service.tick(TODAY_1800);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('daily idempotency: two ticks the same UTC day email once', async () => {
    const h = makeHarness();
    await h.service.tick(TODAY_1800);
    await h.service.tick(TODAY_1800);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
  });

  it('skips a user whose marker already exists for the day', async () => {
    const marker = dailyDigestMarkerId({
      tenantId: 't1',
      userProfileId: 'u1',
      dayKey: dayKey(TODAY_1800),
    });
    const h = makeHarness({ existingMarkers: [marker] });
    await h.service.tick(TODAY_1800);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('skips a user with no email and never crashes', async () => {
    const h = makeHarness({
      prefs: [
        { userProfileId: 'u1', kind: 'grade_published', userProfile: profile('u1', null) },
      ],
    });
    await h.service.tick(TODAY_1800);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('groups across kinds: one email bundling notes + a message, with both headlines', async () => {
    const h = makeHarness({
      prefs: [
        { userProfileId: 'u1', kind: 'grade_published', userProfile: profile('u1') },
        { userProfileId: 'u1', kind: 'message', userProfile: profile('u1') },
      ],
      notifsByUser: {
        u1: [
          { kind: 'grade_published', title: 'Note A', link: '/g/1', createdAt: new Date(Date.UTC(2026, 5, 5, 10)) },
          { kind: 'grade_published', title: 'Note B', link: '/g/2', createdAt: new Date(Date.UTC(2026, 5, 5, 11)) },
          { kind: 'message', title: 'Msg prof', link: '/m/1', createdAt: new Date(Date.UTC(2026, 5, 5, 12)) },
        ],
      },
    });
    await h.service.tick(TODAY_1800);
    expect(h.send).toHaveBeenCalledTimes(1);
    const subject = h.send.mock.calls[0]![0].subject as string;
    expect(subject).toContain('2 nouvelles notes');
    expect(subject).toContain('1 message');
    // The query asked only for this user's daily_digest kinds.
    const findArg = h.notificationFindMany.mock.calls[0]![0];
    expect(new Set(findArg.where.kind.in)).toEqual(new Set(['grade_published', 'message']));
  });

  it('resilience: a send failure does NOT write the marker (next tick retries)', async () => {
    const failingSend = jest.fn().mockRejectedValue(new Error('smtp down'));
    const h = makeHarness({ sendImpl: failingSend });
    await expect(h.service.tick(TODAY_1800)).resolves.toBeUndefined();
    expect(failingSend).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('re-entrancy guard: an in-flight tick makes a concurrent tick a no-op', async () => {
    const h = makeHarness();
    // Park the first tick on send so `running` stays true while the 2nd runs.
    let release!: () => void;
    const parked = new Promise<void>((res) => (release = res));
    (h.send as Mock).mockImplementation(() => parked);

    const first = h.service.tick(TODAY_1800);
    // Let the first tick advance through its async prelude up to the parked send.
    await new Promise((r) => setImmediate(r));

    const second = await h.service.tick(TODAY_1800); // returns immediately (guard)
    expect(second).toBeUndefined();
    expect(h.send).toHaveBeenCalledTimes(1); // the 2nd tick never reached send

    release();
    await first;
    expect(h.send).toHaveBeenCalledTimes(1);
  });

  it('FR-7: excludes the weekly_digest kind from the source set (never re-groups its markers)', async () => {
    const h = makeHarness({
      prefs: [
        { userProfileId: 'u1', kind: 'grade_published', userProfile: profile('u1') },
        // User also (oddly) set the weekly-digest kind to daily cadence — must be dropped.
        { userProfileId: 'u1', kind: 'weekly_digest', userProfile: profile('u1') },
      ],
      notifsByUser: {
        u1: [
          { kind: 'grade_published', title: 'Note A', link: '/g/1', createdAt: new Date(Date.UTC(2026, 5, 5, 10)) },
        ],
      },
    });
    await h.service.tick(TODAY_1800);
    expect(h.send).toHaveBeenCalledTimes(1);
    // The day-window query asked ONLY for grade_published — weekly_digest dropped.
    const findArg = h.notificationFindMany.mock.calls[0]![0];
    expect(new Set(findArg.where.kind.in)).toEqual(new Set(['grade_published']));
  });

  it('FR-7: a user opted into ONLY weekly_digest cadence is skipped (empty source set)', async () => {
    const h = makeHarness({
      prefs: [
        { userProfileId: 'u1', kind: 'weekly_digest', userProfile: profile('u1') },
      ],
    });
    await h.service.tick(TODAY_1800);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
    // No day-window query is ever issued for a user with no eligible kinds.
    expect(h.notificationFindMany).not.toHaveBeenCalled();
  });

  it('tenant scope: the recipient resolver filters cadence=daily_digest + emailEnabled', async () => {
    const h = makeHarness();
    await h.service.tick(TODAY_1800);
    // tenantsWithDailyOptIns (distinct) + runTenant pref query both gate on cadence.
    const runTenantCall = (h.prisma.notificationPreference.findMany as Mock).mock.calls.find(
      (c) => !c[0]?.distinct,
    );
    expect(runTenantCall![0].where).toMatchObject({
      tenantId: 't1',
      cadence: 'daily_digest',
      emailEnabled: true,
    });
  });
});
