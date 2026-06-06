import { ConflictException, UnprocessableEntityException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { BookingService } from './booking.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const AVAIL = 'avail-1';
const TUTOR = 'tutor-1';
const STUDENT = 'stu-1';
const PARENT = 'parent-up-1';

// A future one_off slot instant — the canonical key both parents resolve to.
const FUTURE = new Date(Date.now() + 7 * 24 * 3600 * 1000);
FUTURE.setUTCSeconds(0, 0);
const FUTURE_ISO = FUTURE.toISOString();

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'booking-1',
    planId: 'plan-1',
    tutorId: TUTOR,
    availabilityId: AVAIL,
    studentId: STUDENT,
    sessionAt: FUTURE,
    status: 'requested',
    note: null,
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    tutor: { displayName: 'M. Dupont' },
    ...overrides,
  };
}

function p2002(target: string[]) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

const oneOffSlot = {
  kind: 'one_off' as const,
  weekday: null,
  startTime: null,
  startsAt: FUTURE,
};

function baseArgs(overrides: Record<string, unknown> = {}) {
  return {
    tenantId: TENANT,
    schoolId: SCHOOL,
    planId: 'plan-1',
    studentId: STUDENT,
    availabilityId: AVAIL,
    tutorId: TUTOR,
    capacity: 1,
    slot: oneOffSlot,
    sessionAtIso: FUTURE_ISO,
    userProfileId: PARENT,
    ...overrides,
  };
}

describe('BookingService.createBooking — sessionAt validation (never 500)', () => {
  it('rejects a one_off sessionAt that does not equal the slot startsAt → 422', async () => {
    const svc = new BookingService({ booking: { create: jest.fn() } } as never);
    const wrong = new Date(FUTURE.getTime() + 3600 * 1000).toISOString();
    await expect(svc.createBooking(baseArgs({ sessionAtIso: wrong }))).rejects.toBeInstanceOf(
      UnprocessableEntityException,
    );
  });

  it('rejects a past sessionAt → 422', async () => {
    const past = new Date(Date.now() - 24 * 3600 * 1000);
    past.setUTCSeconds(0, 0);
    const svc = new BookingService({ booking: { create: jest.fn() } } as never);
    await expect(
      svc.createBooking(
        baseArgs({
          slot: { kind: 'one_off', weekday: null, startTime: null, startsAt: past },
          sessionAtIso: past.toISOString(),
        }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('rejects a recurring_weekly sessionAt on the wrong weekday → 422', async () => {
    // FUTURE is some weekday; pick a slot weekday guaranteed different.
    const jsDay = FUTURE.getUTCDay();
    const slotWeekday = ((jsDay + 6) % 7 + 1) % 7; // a different Monday-based weekday
    const svc = new BookingService({ booking: { create: jest.fn() } } as never);
    await expect(
      svc.createBooking(
        baseArgs({
          slot: { kind: 'recurring_weekly', weekday: slotWeekday, startTime: '17:00', startsAt: null },
        }),
      ),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });
});

describe('BookingService.createBooking — capacity-1 concurrency (ADR-020)', () => {
  it('two concurrent books on a capacity-1 instance → exactly ONE succeeds, one deterministic 409 (never 500, never over-book)', async () => {
    // The partial-unique index booking_active_instance_unique is the DB authority:
    // the first create wins; the second raises P2002 on that index → 409. We model
    // a single active row in a shared store so only one create can succeed.
    let activeRows = 0;
    const create = jest.fn().mockImplementation(async () => {
      if (activeRows >= 1) {
        throw p2002(['booking_active_instance_unique']);
      }
      activeRows += 1;
      return bookingRow();
    });
    // On the conflict path the service re-reads by the natural key; the loser used a
    // DIFFERENT plan, so there is no idempotency row to reuse — re-read returns null.
    const findFirst = jest.fn().mockResolvedValue(null);
    const svc = new BookingService({ booking: { create, findFirst } } as never);

    const results = await Promise.allSettled([
      svc.createBooking(baseArgs({ planId: 'plan-A' })),
      svc.createBooking(baseArgs({ planId: 'plan-B' })),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected') as PromiseRejectedResult[];

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const loser = rejected[0];
    expect(loser).toBeDefined();
    expect(loser!.reason).toBeInstanceOf(ConflictException);
    expect((loser!.reason as ConflictException).message).toContain("vient d'être réservé");
    // Exactly one active row was ever created.
    expect(activeRows).toBe(1);
  });

  it('an idempotent re-tap of the SAME (availability, sessionAt, plan) → reuse 200, no over-book, no new row', async () => {
    // First create wins; the same plan re-taps and the idempotency @@unique fires
    // (target includes plan_id) → reuse the existing active row (created:false).
    let activeRows = 0;
    const existing = bookingRow();
    const create = jest.fn().mockImplementation(async () => {
      if (activeRows >= 1) {
        throw p2002(['availability_id', 'session_at', 'plan_id']);
      }
      activeRows += 1;
      return existing;
    });
    const findFirst = jest.fn().mockResolvedValue(existing);
    const svc = new BookingService({ booking: { create, findFirst } } as never);

    const first = await svc.createBooking(baseArgs());
    const second = await svc.createBooking(baseArgs());

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.booking.id).toBe(existing.id);
    expect(activeRows).toBe(1);
  });
});

describe('BookingService.createBooking — capacity-N (transactional FOR UPDATE count)', () => {
  function txPrisma(initialActive: number, capacity: number) {
    let active = initialActive;
    const tx = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(null),
        count: jest.fn().mockImplementation(async () => active),
        create: jest.fn().mockImplementation(async () => {
          active += 1;
          return bookingRow();
        }),
        update: jest.fn(),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ id: AVAIL }]),
    };
    return {
      prisma: {
        $transaction: jest.fn().mockImplementation(async (fn: (t: typeof tx) => unknown) => fn(tx)),
      },
      get active() {
        return active;
      },
      capacity,
    };
  }

  it('fills exactly N seats then 409s the (N+1)th', async () => {
    const store = txPrisma(2, 2); // already 2 active on a capacity-2 slot → full
    const svc = new BookingService(store.prisma as never);
    await expect(
      svc.createBooking(baseArgs({ capacity: 2, planId: 'plan-C' })),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('admits a seat when below capacity', async () => {
    const store = txPrisma(1, 2); // 1 active on capacity-2 → one seat left
    const svc = new BookingService(store.prisma as never);
    const res = await svc.createBooking(baseArgs({ capacity: 2, planId: 'plan-D' }));
    expect(res.created).toBe(true);
  });
});

describe('BookingService.cancelBooking — atomic seat free (append-only)', () => {
  it('cancels an active booking and frees the seat', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 1 });
    const findFirst = jest.fn().mockResolvedValue(bookingRow({ status: 'cancelled' }));
    const svc = new BookingService({ booking: { updateMany, findFirst } } as never);
    const res = await svc.cancelBooking({
      tenantId: TENANT,
      bookingId: 'booking-1',
      userProfileId: PARENT,
    });
    expect(res).not.toBeNull();
    expect(res?.booking.status).toBe('cancelled');
    // Guarded by the cancellable-status WHERE.
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ status: { in: ['requested', 'confirmed'] } }),
      }),
    );
  });

  it('a double-cancel is a safe no-op (updateMany matches 0 rows → null)', async () => {
    const updateMany = jest.fn().mockResolvedValue({ count: 0 });
    const svc = new BookingService({ booking: { updateMany } } as never);
    const res = await svc.cancelBooking({
      tenantId: TENANT,
      bookingId: 'booking-1',
      userProfileId: PARENT,
    });
    expect(res).toBeNull();
  });
});
