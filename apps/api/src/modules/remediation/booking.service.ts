import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { BookingDto } from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { resolveCanonicalSessionAt } from './session-instance';

const BOOKING_INCLUDE = {
  tutor: { select: { displayName: true } },
} satisfies Prisma.BookingInclude;

type BookingFull = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

/** The active statuses that occupy a seat (mirror the partial-unique WHERE). */
const ACTIVE_STATUSES = ['requested', 'confirmed'] as const;

/** The DB index name that enforces the capacity-1 invariant (ADR-020). */
const ACTIVE_INSTANCE_INDEX = 'booking_active_instance_unique';

/**
 * E7-S2 — booking write path (the ADR-020 concurrency slice).
 *
 * Never over-books a capacity-limited slot under concurrent writes:
 *  - **capacity = 1** (common case): a raw partial-unique index
 *    `booking_active_instance_unique` on `(availability_id, session_at) WHERE
 *    status IN ('requested','confirmed')` makes a second ACTIVE booking of the
 *    instance impossible at the DB layer. A violation (P2002 on that index) → a
 *    deterministic 409. A defence-in-depth transactional count runs too, so a
 *    missing index degrades to "slower but still correct", never "over-book".
 *  - **capacity > 1**: a `$transaction` with `SELECT … FOR UPDATE` on the
 *    availability row then a COUNT of active bookings; insert only when
 *    count < capacity, else throw → 409. The partial index is not relied upon.
 *
 * Idempotency is SEPARATE from capacity: the `@@unique([availabilityId, sessionAt,
 * planId])` collapses a re-tap of the SAME instance for the SAME plan to the
 * existing row (200, no duplicate). A cancelled row for the same key is revived
 * (cancel → re-book is supported, append-only).
 *
 * The caller (controller) MUST have run guardianship ABAC on the plan's student
 * AND the E2 teaching wall (teacher-linked tutor) BEFORE invoking — those gates
 * are not this service's job. This service owns sessionAt canonicalisation, the
 * capacity guard, idempotency, and the cancel transition.
 */
@Injectable()
export class BookingService {
  private readonly logger = new Logger(BookingService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Create a booking (or reuse the idempotent existing one). Returns the booking
   * DTO + whether it was freshly created (drives the audit + notify fan-out — both
   * fire ONLY on a fresh booking, never on an idempotent reuse).
   *
   * Throws (mapped to HTTP by Nest):
   *  - 422 if `sessionAt` does not match the slot shape or is in the past.
   *  - 409 if the instance is full (capacity reached / lost the concurrency race).
   */
  async createBooking(args: {
    tenantId: string;
    schoolId: string | null;
    planId: string;
    studentId: string;
    availabilityId: string;
    tutorId: string;
    capacity: number;
    slot: {
      kind: 'recurring_weekly' | 'one_off';
      weekday: number | null;
      startTime: string | null;
      startsAt: Date | null;
    };
    sessionAtIso: string;
    userProfileId: string;
    note?: string;
  }): Promise<{ booking: BookingDto; created: boolean }> {
    // (1) Canonicalise sessionAt server-side — the capacity-guard key. A mismatch
    // (wrong weekday/time, ≠ one_off startsAt, malformed) is a deterministic 422,
    // never a 500. This makes two parents booking "the same instance" compute a
    // byte-identical key, so both the partial-unique index and the idempotency
    // @@unique see the same row → no silent over-book on a TZ/ms variance.
    const canonical = resolveCanonicalSessionAt(args.slot, args.sessionAtIso);
    if (!canonical) {
      throw new UnprocessableEntityException(
        'Ce créneau ne correspond pas à la disponibilité',
      );
    }
    if (canonical.getTime() <= Date.now()) {
      throw new UnprocessableEntityException(
        'Ce créneau est déjà passé',
      );
    }

    const data: Prisma.BookingUncheckedCreateInput = {
      tenantId: args.tenantId,
      schoolId: args.schoolId,
      planId: args.planId,
      tutorId: args.tutorId,
      availabilityId: args.availabilityId,
      studentId: args.studentId,
      sessionAt: canonical,
      status: 'requested',
      note: args.note ?? null,
      bookedBy: args.userProfileId,
    };

    if (args.capacity > 1) {
      return this.createWithTransactionalCount({ ...args, canonical, data });
    }
    return this.createCapacityOne({ ...args, canonical, data });
  }

  // ----- capacity = 1: partial-unique index is the authority ------------------

  private async createCapacityOne(args: {
    tenantId: string;
    availabilityId: string;
    planId: string;
    canonical: Date;
    data: Prisma.BookingUncheckedCreateInput;
  }): Promise<{ booking: BookingDto; created: boolean }> {
    // The partial-unique index booking_active_instance_unique is the authority: the
    // FIRST active booking of the instance wins; a concurrent second raises P2002 on
    // that index → handleCreateConflict maps it to a deterministic 409 (never a 500,
    // never a 2nd active row). A direct insert + the P2002 catch is the whole guard
    // here — no transaction needed, because the DB unique constraint is atomic. The
    // index is ensured idempotently on API boot (BookingIndexBootstrap) so this path
    // always has its DB-level belt; ADR-020 records the (accepted) drift risk + the
    // capacity-N transactional FOR UPDATE count as the broader authority.
    try {
      const row = await this.prisma.booking.create({
        data: args.data,
        include: BOOKING_INCLUDE,
      });
      return { booking: this.toDto(row), created: true };
    } catch (err) {
      return this.handleCreateConflict(err, args);
    }
  }

  // ----- capacity > 1: transactional FOR UPDATE count is the sole authority ----

  private async createWithTransactionalCount(args: {
    tenantId: string;
    availabilityId: string;
    planId: string;
    capacity: number;
    canonical: Date;
    data: Prisma.BookingUncheckedCreateInput;
  }): Promise<{ booking: BookingDto; created: boolean }> {
    try {
      const row = await this.prisma.$transaction(async (tx) => {
        // Idempotency first: an existing ACTIVE booking for (availability, sessionAt,
        // plan) is reused (no duplicate). A cancelled row for the key is revived.
        const mine = await tx.booking.findFirst({
          where: {
            availabilityId: args.availabilityId,
            sessionAt: args.canonical,
            planId: args.planId,
          },
          include: BOOKING_INCLUDE,
        });
        if (mine && ACTIVE_STATUSES.includes(mine.status as (typeof ACTIVE_STATUSES)[number])) {
          return { row: mine, created: false };
        }

        // Serialise concurrent counters on this instance by locking the
        // availability row (FOR UPDATE) — two concurrent (N+1)th claims can't both
        // read count < capacity.
        await tx.$queryRaw`SELECT id FROM tutor_availability WHERE id = ${args.availabilityId}::uuid FOR UPDATE`;

        const active = await tx.booking.count({
          where: {
            availabilityId: args.availabilityId,
            sessionAt: args.canonical,
            status: { in: [...ACTIVE_STATUSES] },
          },
        });
        if (active >= args.capacity) {
          throw new ConflictException("Ce créneau vient d'être réservé");
        }

        if (mine) {
          // Revive a cancelled/declined row for the same idempotency key.
          const revived = await tx.booking.update({
            where: { id: mine.id },
            data: { status: 'requested', note: args.data.note ?? null, decidedAt: null, decidedBy: null },
            include: BOOKING_INCLUDE,
          });
          return { row: revived, created: true };
        }

        const created = await tx.booking.create({ data: args.data, include: BOOKING_INCLUDE });
        return { row: created, created: true };
      });
      return { booking: this.toDto(row.row), created: row.created };
    } catch (err) {
      if (err instanceof ConflictException) throw err;
      // A P2002 on the idempotency @@unique can still surface from a concurrent
      // same-plan insert — collapse to the winning row.
      return this.handleCreateConflict(err, args);
    }
  }

  /**
   * Distinguish the two unique constraints (Winston PM-A4 — deterministic by KIND,
   * not by accident of which DB error fired):
   *  - idempotency `@@unique([availabilityId, sessionAt, planId])` (target includes
   *    `plan_id`) → an idempotent re-tap → reuse the existing row (200), NOT a 409.
   *  - the partial-unique `booking_active_instance_unique` (a DIFFERENT plan lost
   *    the capacity race) → the deterministic 409.
   *  - any other error → rethrow (a genuine bug, not silently mapped to 409).
   */
  private async handleCreateConflict(
    err: unknown,
    args: { availabilityId: string; planId: string; canonical: Date },
  ): Promise<{ booking: BookingDto; created: boolean }> {
    if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') {
      throw err;
    }

    const target = err.meta?.target;
    const targetStr = Array.isArray(target) ? target.join(',') : String(target ?? '');

    // The capacity-1 partial-unique (a different plan won the seat) → 409.
    if (targetStr.includes(ACTIVE_INSTANCE_INDEX) || targetStr.includes('booking_active_instance')) {
      throw new ConflictException("Ce créneau vient d'être réservé");
    }

    // Otherwise it is the idempotency @@unique (same plan re-tap): reuse the row.
    // We re-read by the natural key; if the existing row is itself cancelled we
    // revive it (cancel → re-book), guarded by the active-instance index so we
    // never revive into an over-book.
    const existing = await this.prisma.booking.findFirst({
      where: {
        availabilityId: args.availabilityId,
        sessionAt: args.canonical,
        planId: args.planId,
      },
      include: BOOKING_INCLUDE,
    });
    if (!existing) throw err;

    if (ACTIVE_STATUSES.includes(existing.status as (typeof ACTIVE_STATUSES)[number])) {
      return { booking: this.toDto(existing), created: false };
    }

    // Revive a cancelled/declined idempotency row. The partial-unique index still
    // guards the capacity-1 invariant on the update (a concurrent active row for
    // the instance makes the status flip raise P2002 → 409).
    try {
      const revived = await this.prisma.booking.update({
        where: { id: existing.id },
        data: { status: 'requested', decidedAt: null, decidedBy: null },
        include: BOOKING_INCLUDE,
      });
      return { booking: this.toDto(revived), created: true };
    } catch (reviveErr) {
      if (
        reviveErr instanceof Prisma.PrismaClientKnownRequestError &&
        reviveErr.code === 'P2002'
      ) {
        throw new ConflictException("Ce créneau vient d'être réservé");
      }
      throw reviveErr;
    }
  }

  // ----- cancel: atomic seat free (append-only status flip) -------------------

  /**
   * Parent cancel — flip an active booking to `cancelled` in ONE updateMany guarded
   * by the cancellable-status WHERE (a concurrent double-cancel is a safe no-op,
   * matching 0 rows). The cancel frees the seat automatically: the active-status
   * filter / partial index only counts ('requested','confirmed'), so a cancelled
   * row no longer occupies the instance — no extra mutation needed. Append-only
   * (status flip, never a row delete). The caller has already run guardianship
   * ABAC on the booking's student.
   *
   * Returns the cancelled booking + true, or null when nothing was cancellable
   * (already cancelled/declined/completed → no-op, the controller maps to 409/200).
   */
  async cancelBooking(args: {
    tenantId: string;
    bookingId: string;
    userProfileId: string;
  }): Promise<{ booking: BookingDto } | null> {
    const result = await this.prisma.booking.updateMany({
      where: {
        id: args.bookingId,
        tenantId: args.tenantId,
        status: { in: [...ACTIVE_STATUSES] },
      },
      data: {
        status: 'cancelled',
        decidedBy: args.userProfileId,
        decidedAt: new Date(),
      },
    });
    if (result.count === 0) return null;

    const row = await this.prisma.booking.findFirst({
      where: { id: args.bookingId, tenantId: args.tenantId },
      include: BOOKING_INCLUDE,
    });
    if (!row) return null;
    return { booking: this.toDto(row) };
  }

  /** Load a booking tenant-scoped (for the controller's guardianship pre-check). */
  async loadBooking(args: {
    tenantId: string;
    bookingId: string;
  }): Promise<{
    id: string;
    studentId: string;
    planId: string;
    tutorId: string;
    availabilityId: string;
    sessionAt: Date;
    status: string;
  } | null> {
    const row = await this.prisma.booking.findFirst({
      where: { id: args.bookingId, tenantId: args.tenantId },
      select: {
        id: true,
        studentId: true,
        planId: true,
        tutorId: true,
        availabilityId: true,
        sessionAt: true,
        status: true,
      },
    });
    return row;
  }

  private toDto(row: BookingFull): BookingDto {
    return {
      id: row.id,
      planId: row.planId,
      tutorId: row.tutorId,
      tutorName: row.tutor.displayName,
      availabilityId: row.availabilityId,
      studentId: row.studentId,
      sessionAt: row.sessionAt.toISOString(),
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
