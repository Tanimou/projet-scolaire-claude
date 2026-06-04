import { ParentDigestCronService } from './parent-digest-cron.service';
import { digestMarkerId, isoWeekKey } from './iso-week';
import type { ChildDigest } from './digest-email.types';

type Mock = ReturnType<typeof jest.fn>;

/** A Monday 07:00 UTC inside the default send window. */
const MONDAY_0700 = new Date(Date.UTC(2026, 4, 25, 7, 0, 0)); // 2026-05-25 is a Monday
/** A Tuesday 07:00 UTC — outside the default DOW gate. */
const TUESDAY_0700 = new Date(Date.UTC(2026, 4, 26, 7, 0, 0));

const sampleChild = (): ChildDigest => ({
  studentId: 'stu-1',
  firstName: 'Léa',
  lastName: 'Martin',
  className: '6eA',
  globalAverage: 13.4,
  trendDelta: 0.6,
  trend: 'improving',
  newAlertsCount: 0,
  newAlertTitles: [],
  upcoming: [],
  recommendation: 'Tout va bien',
  recommendationLink: '/parent/dashboard?studentId=stu-1',
});

interface Opts {
  optedInProfiles?: Array<{
    id: string;
    email: string | null;
    firstName: string;
    lastName: string;
  }>;
  guardianStudentIds?: string[];
  /** Pre-existing marker rows: array of sourceId already present. */
  existingMarkers?: string[];
  sendImpl?: Mock;
}

function makeHarness(opts: Opts = {}) {
  const profiles = opts.optedInProfiles ?? [
    { id: 'u1', email: 'p1@example.test', firstName: 'Marie', lastName: 'Curie' },
  ];
  const studentIds = opts.guardianStudentIds ?? ['stu-1'];
  const markers = new Set(opts.existingMarkers ?? []);

  const prefFindMany: Mock = jest.fn().mockImplementation((arg: { distinct?: unknown }) => {
    if (arg?.distinct) {
      // tenantsWithOptIns: distinct tenantId
      return Promise.resolve(profiles.length > 0 ? [{ tenantId: 't1' }] : []);
    }
    // runTenant: opted-in guardians for the tenant
    return Promise.resolve(
      profiles.map((p) => ({ userProfileId: p.id, userProfile: p })),
    );
  });

  const notificationFindFirst: Mock = jest
    .fn()
    .mockImplementation((arg: { where: { sourceId: string } }) =>
      Promise.resolve(markers.has(arg.where.sourceId) ? { id: 'marker' } : null),
    );
  const notificationCreate: Mock = jest
    .fn()
    .mockImplementation((arg: { data: { sourceId: string } }) => {
      markers.add(arg.data.sourceId);
      return Promise.resolve({ id: 'created' });
    });
  const guardianshipFindMany: Mock = jest
    .fn()
    .mockResolvedValue(studentIds.map((studentId) => ({ studentId })));

  const prisma = {
    notificationPreference: { findMany: prefFindMany },
    notification: { findFirst: notificationFindFirst, create: notificationCreate },
    guardianship: { findMany: guardianshipFindMany },
  };

  const aggregate = {
    buildChildDigest: jest.fn().mockResolvedValue(sampleChild()),
  };
  const send: Mock = opts.sendImpl ?? jest.fn().mockResolvedValue(undefined);
  const mailer = { send };

  const service = new ParentDigestCronService(
    prisma as never,
    aggregate as never,
    mailer as never,
  );

  return { service, send, notificationCreate, notificationFindFirst, guardianshipFindMany, aggregate, prisma };
}

describe('ParentDigestCronService.tick', () => {
  it('emails an opted-in guardian once during the send window and writes a read marker', async () => {
    const h = makeHarness();
    await h.service.tick(MONDAY_0700);

    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.send.mock.calls[0]![0].to).toBe('p1@example.test');
    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
    const data = h.notificationCreate.mock.calls[0]![0].data;
    expect(data.kind).toBe('weekly_digest');
    expect(data.sourceType).toBe('weekly_digest');
    expect(data.readAt).toEqual(MONDAY_0700); // pre-read → never rings the bell
    expect(data.sourceId).toBe(
      digestMarkerId({ tenantId: 't1', userProfileId: 'u1', weekKey: isoWeekKey(MONDAY_0700) }),
    );
  });

  it('does NOT send outside the configured day-of-week window', async () => {
    const h = makeHarness();
    await h.service.tick(TUESDAY_0700);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('opt-in gate: a guardian with no opt-in pref gets zero sends', async () => {
    const h = makeHarness({ optedInProfiles: [] });
    await h.service.tick(MONDAY_0700);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('weekly idempotency: running twice in the same ISO week emails once', async () => {
    const h = makeHarness();
    await h.service.tick(MONDAY_0700);
    // Second tick later the same week (still Monday 07h window) → marker present.
    await h.service.tick(MONDAY_0700);
    expect(h.send).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate).toHaveBeenCalledTimes(1);
  });

  it('skips a guardian whose pre-existing marker exists for the week', async () => {
    const marker = digestMarkerId({
      tenantId: 't1',
      userProfileId: 'u1',
      weekKey: isoWeekKey(MONDAY_0700),
    });
    const h = makeHarness({ existingMarkers: [marker] });
    await h.service.tick(MONDAY_0700);
    expect(h.send).not.toHaveBeenCalled();
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('skips a guardian with no email and never crashes', async () => {
    const h = makeHarness({
      optedInProfiles: [{ id: 'u1', email: null, firstName: 'Sans', lastName: 'Email' }],
    });
    await h.service.tick(MONDAY_0700);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('skips a guardian with no active-guardianship children', async () => {
    const h = makeHarness({ guardianStudentIds: [] });
    await h.service.tick(MONDAY_0700);
    expect(h.send).not.toHaveBeenCalled();
  });

  it('resilience: a send failure does NOT write the week-marker (next tick retries)', async () => {
    const failingSend = jest.fn().mockRejectedValue(new Error('smtp down'));
    const h = makeHarness({ sendImpl: failingSend });
    await expect(h.service.tick(MONDAY_0700)).resolves.toBeUndefined();
    expect(failingSend).toHaveBeenCalledTimes(1);
    expect(h.notificationCreate).not.toHaveBeenCalled();
  });

  it('re-entrancy guard: an in-flight tick makes a concurrent tick a no-op', async () => {
    const h = makeHarness();
    // Force the first tick to hang on send so the second runs while running=true.
    let release!: () => void;
    (h.send as Mock).mockImplementation(
      () => new Promise<void>((res) => (release = res)),
    );
    const first = h.service.tick(MONDAY_0700);
    const second = await h.service.tick(MONDAY_0700); // returns immediately (guard)
    expect(second).toBeUndefined();
    release();
    await first;
    expect(h.send).toHaveBeenCalledTimes(1);
  });
});
