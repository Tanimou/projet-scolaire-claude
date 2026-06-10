import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  TeachableSubjectDto,
  TeacherAvailabilityDto,
  TeacherBookingDto,
  TeacherRemediationDto,
  TeacherTutorDto,
} from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { resolveNextSessionAt } from './session-instance';

/**
 * The active statuses that occupy a seat (mirror the partial-unique WHERE / the
 * S2 BookingService ACTIVE_STATUSES). A no-show/declined/cancelled booking no
 * longer counts toward a slot's `bookedCount`.
 */
const ACTIVE_STATUSES = ['requested', 'confirmed'] as const;

const BOOKING_INCLUDE = {
  student: { select: { firstName: true, lastName: true } },
  plan: { select: { subjectId: true, subject: { select: { name: true } } } },
} satisfies Prisma.BookingInclude;

type BookingFull = Prisma.BookingGetPayload<{ include: typeof BOOKING_INCLUDE }>;

/**
 * The legal teacher transitions per current booking status (the small,
 * append-only state machine). A teacher (the tutor owner) may:
 *  - `requested`  → confirmed | declined | proposed_alternative | no_show
 *  - `confirmed`  → completed | no_show | declined | proposed_alternative
 * Any other source status (completed/cancelled/declined/proposed_alternative)
 * is terminal for the teacher → an illegal transition is a deterministic 409.
 *
 * `no_show` is NOT a `BookingStatus` enum value (S4 ships no schema change); it
 * is recorded as `declined` with an "Absent" note (handled in `transition`).
 */
const LEGAL_FROM: Record<string, ReadonlySet<string>> = {
  requested: new Set(['confirmed', 'declined', 'proposed_alternative', 'no_show']),
  confirmed: new Set(['completed', 'no_show', 'declined', 'proposed_alternative']),
};

/**
 * E7-S4 — Teacher capacity management + booking transitions.
 *
 * A teacher publishes/edits the availability of their OWN auto-derived `Tutor`
 * record (the one whose `userProfileId === caller`) and moves their pupils'
 * bookings through the confirm/decline/honoured/no-show lifecycle. EVERY method
 * is **ownership-walled**: a teacher only ever touches their own tutor's slots
 * and bookings (the E2 teacher-reply idiom — re-checked server-side on every
 * write), and only publishes support in a subject they CURRENTLY teach.
 *
 * Rides `remediation.read` (no new permission) + the ownership wall. No schema
 * change — reuses the S1/S2 `Tutor`/`TutorAvailability`/`Booking` models. Every
 * state-changing call writes an append-only audit row in the controller.
 */
@Injectable()
export class TeacherRemediationService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- read: the teacher's own surface -------------------------------------

  /**
   * The teacher remediation surface payload: the caller's own tutor record (or a
   * null-tutor shell before any slot is published), its availabilities with live
   * booked counts, and the bookings on their slots (ownership-walled). One read
   * per concern, no N+1.
   */
  async getSurface(args: {
    tenantId: string;
    userProfileId: string;
  }): Promise<TeacherRemediationDto> {
    const teachableSubjects = await this.resolveTeachableSubjects(args);

    const tutor = await this.prisma.tutor.findFirst({
      where: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        type: 'teacher',
      },
      include: {
        availabilities: {
          orderBy: [{ active: 'desc' }, { startsAt: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
        },
      },
    });

    if (!tutor) {
      return {
        tutor: {
          tutorId: null,
          displayName: null,
          published: false,
          subjectIds: [],
          availabilities: [],
        },
        bookings: [],
        teachableSubjects,
      };
    }

    // Live booked counts per slot's NEXT instance (one grouped Booking query, no
    // per-slot N+1) — mirrors the catalogue's remaining-seats computation.
    const now = new Date();
    const slotInstances = new Map<string, Date>();
    for (const a of tutor.availabilities) {
      const next = resolveNextSessionAt(
        { kind: a.kind, weekday: a.weekday, startTime: a.startTime, startsAt: a.startsAt },
        now,
      );
      if (next) slotInstances.set(a.id, next);
    }
    const instanceList = [...slotInstances.entries()];
    const activeBookings =
      instanceList.length > 0
        ? await this.prisma.booking.findMany({
            where: {
              tenantId: args.tenantId,
              status: { in: [...ACTIVE_STATUSES] },
              OR: instanceList.map(([availabilityId, sessionAt]) => ({
                availabilityId,
                sessionAt,
              })),
            },
            select: { availabilityId: true },
          })
        : [];
    const bookedCount = new Map<string, number>();
    for (const b of activeBookings) {
      bookedCount.set(b.availabilityId, (bookedCount.get(b.availabilityId) ?? 0) + 1);
    }

    const availabilities: TeacherAvailabilityDto[] = tutor.availabilities.map((a) => ({
      id: a.id,
      kind: a.kind,
      weekday: a.weekday,
      startTime: a.startTime,
      endTime: a.endTime,
      startsAt: a.startsAt?.toISOString() ?? null,
      endsAt: a.endsAt?.toISOString() ?? null,
      capacity: a.capacity,
      active: a.active,
      bookedCount: bookedCount.get(a.id) ?? 0,
    }));

    const tutorDto: TeacherTutorDto = {
      tutorId: tutor.id,
      displayName: tutor.displayName,
      published: tutor.published,
      subjectIds: tutor.subjectIds,
      availabilities,
    };

    // Bookings on the caller's tutor (the ownership wall: tutorId === my tutor).
    const bookings = await this.listBookingsForTutor({
      tenantId: args.tenantId,
      tutorId: tutor.id,
    });

    return { tutor: tutorDto, bookings, teachableSubjects };
  }

  /**
   * The DISTINCT subjects the caller currently teaches (active academic year) —
   * the publish-slot subject dropdown. Empty when the caller has no
   * TeacherProfile or no active assignment. One bounded query + a dedupe; the
   * ownership wall for publishing re-validates the chosen subject server-side.
   */
  private async resolveTeachableSubjects(args: {
    tenantId: string;
    userProfileId: string;
  }): Promise<TeachableSubjectDto[]> {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: args.tenantId,
        teacherProfile: { userProfileId: args.userProfileId },
        academicYear: { status: 'active' },
      },
      select: { subject: { select: { id: true, code: true, name: true } } },
    });
    const seen = new Map<string, TeachableSubjectDto>();
    for (const a of assignments) {
      if (a.subject && !seen.has(a.subject.id)) {
        seen.set(a.subject.id, {
          id: a.subject.id,
          code: a.subject.code ?? null,
          name: a.subject.name,
        });
      }
    }
    return [...seen.values()].sort((x, y) => x.name.localeCompare(y.name, 'fr'));
  }

  /** Aggregate read of bookings on one tutor (ownership-scoped by tutorId). */
  private async listBookingsForTutor(args: {
    tenantId: string;
    tutorId: string;
  }): Promise<TeacherBookingDto[]> {
    const rows = await this.prisma.booking.findMany({
      where: { tenantId: args.tenantId, tutorId: args.tutorId },
      include: BOOKING_INCLUDE,
      orderBy: [{ sessionAt: 'asc' }],
    });
    return rows.map((r) => this.toBookingDto(r));
  }

  // ----- write: publish/edit an availability slot ----------------------------

  /**
   * Publish (or update) one of the caller's OWN availability slots. The teacher's
   * `Tutor` record is resolved (or lazily created) from the caller — never
   * client-supplied. `subjectId` MUST be a subject the caller CURRENTLY teaches
   * (the ownership wall) → 403 otherwise. Slot shape is re-validated (422 on a
   * malformed recurring/one-off). Returns the created/updated availability +
   * whether it was freshly created (drives the audit action).
   */
  async upsertAvailability(args: {
    tenantId: string;
    schoolId: string;
    userProfileId: string;
    availabilityId?: string;
    dto: {
      kind: 'recurring_weekly' | 'one_off';
      subjectId: string;
      weekday?: number | null;
      startTime?: string | null;
      endTime?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      capacity?: number;
      active?: boolean;
    };
  }): Promise<{ availability: TeacherAvailabilityDto; created: boolean; tutorId: string }> {
    // Resolve the caller's TeacherProfile (the ownership anchor). A non-teacher
    // (no profile) can never publish a teacher tutor → 403.
    const teacherProfile = await this.prisma.teacherProfile.findFirst({
      where: { tenantId: args.tenantId, userProfileId: args.userProfileId },
      select: { id: true, schoolId: true, userProfile: { select: { firstName: true, lastName: true } } },
    });
    if (!teacherProfile) {
      throw new ForbiddenException("Seul·e un·e enseignant·e peut proposer du soutien");
    }

    // Ownership wall: the teacher must CURRENTLY teach the requested subject.
    const teaches = await this.teachesSubject({
      tenantId: args.tenantId,
      teacherProfileId: teacherProfile.id,
      subjectId: args.dto.subjectId,
    });
    if (!teaches) {
      throw new ForbiddenException("Vous n'enseignez pas cette matière");
    }

    this.validateSlotShape(args.dto);

    const schoolId = teacherProfile.schoolId ?? args.schoolId;

    // Resolve (or lazily create) the caller's own teacher tutor. Idempotent on
    // (tenant, userProfileId, type=teacher) — one tutor row per teacher.
    const tutor = await this.ensureTeacherTutor({
      tenantId: args.tenantId,
      schoolId,
      userProfileId: args.userProfileId,
      teacherProfileId: teacherProfile.id,
      displayName: `${teacherProfile.userProfile.firstName} ${teacherProfile.userProfile.lastName}`.trim(),
      subjectId: args.dto.subjectId,
    });

    const data: Prisma.TutorAvailabilityUncheckedCreateInput = {
      tenantId: args.tenantId,
      schoolId,
      tutorId: tutor.id,
      kind: args.dto.kind,
      weekday: args.dto.kind === 'recurring_weekly' ? (args.dto.weekday ?? null) : null,
      startTime: args.dto.kind === 'recurring_weekly' ? (args.dto.startTime ?? null) : null,
      endTime: args.dto.kind === 'recurring_weekly' ? (args.dto.endTime ?? null) : null,
      startsAt: args.dto.kind === 'one_off' && args.dto.startsAt ? new Date(args.dto.startsAt) : null,
      endsAt: args.dto.kind === 'one_off' && args.dto.endsAt ? new Date(args.dto.endsAt) : null,
      capacity: args.dto.capacity ?? 1,
      active: args.dto.active ?? true,
      createdBy: args.userProfileId,
    };

    if (args.availabilityId) {
      // Edit — re-scope to the caller's own tutor (ownership wall): an
      // availability not on the caller's tutor is indistinguishable from missing.
      const existing = await this.prisma.tutorAvailability.findFirst({
        where: { id: args.availabilityId, tenantId: args.tenantId, tutorId: tutor.id },
        select: { id: true, kind: true, weekday: true, startTime: true, startsAt: true },
      });
      if (!existing) throw new NotFoundException('Créneau introuvable');

      // Capacity-floor guard (FR3 / AC3 / PM-7): editing capacity DOWN below the
      // count of active bookings already on the slot's next instance is rejected
      // with a deterministic 422 — never silently over-committing a held seat.
      const newCapacity = data.capacity as number;
      const activeBookings = await this.countActiveBookings({
        tenantId: args.tenantId,
        availabilityId: existing.id,
        slot: {
          kind: existing.kind,
          weekday: existing.weekday,
          startTime: existing.startTime,
          startsAt: existing.startsAt,
        },
      });
      if (newCapacity < activeBookings) {
        throw new UnprocessableEntityException('Des réservations occupent déjà ce créneau');
      }

      const updated = await this.prisma.tutorAvailability.update({
        where: { id: existing.id },
        data: {
          kind: data.kind,
          weekday: data.weekday,
          startTime: data.startTime,
          endTime: data.endTime,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          capacity: data.capacity,
          active: data.active,
        },
      });
      return { availability: this.toAvailabilityDto(updated), created: false, tutorId: tutor.id };
    }

    const created = await this.prisma.tutorAvailability.create({ data });
    return { availability: this.toAvailabilityDto(created), created: true, tutorId: tutor.id };
  }

  // ----- write: transition a booking -----------------------------------------

  /**
   * Move a booking through the teacher lifecycle, ownership-walled. The caller
   * must own the booking's tutor (`tutor.userProfileId === caller`) — re-checked
   * here BEFORE the write (404-before-403: a booking on another tutor is
   * indistinguishable from missing). An illegal transition for the current
   * status → deterministic 409. `proposed_alternative` requires a note → 422.
   * `no_show` is recorded as `declined` + an "Absent" note (no enum value, no
   * schema change). Returns the transitioned booking + the effective status.
   */
  async transition(args: {
    tenantId: string;
    userProfileId: string;
    bookingId: string;
    toStatus: 'confirmed' | 'declined' | 'completed' | 'no_show' | 'proposed_alternative';
    note?: string;
  }): Promise<{ booking: TeacherBookingDto; effectiveStatus: string; bookedBy: string }> {
    const existing = await this.prisma.booking.findFirst({
      where: { id: args.bookingId, tenantId: args.tenantId },
      select: {
        id: true,
        status: true,
        note: true,
        bookedBy: true,
        tutor: { select: { userProfileId: true } },
      },
    });
    if (!existing) throw new NotFoundException('Réservation introuvable');

    // Ownership wall: the booking's tutor must be the caller's own tutor.
    if (existing.tutor.userProfileId !== args.userProfileId) {
      throw new NotFoundException('Réservation introuvable');
    }

    const legal = LEGAL_FROM[existing.status];
    if (!legal || !legal.has(args.toStatus)) {
      throw new ConflictException("Cette transition n'est pas possible pour cette réservation");
    }

    if (args.toStatus === 'proposed_alternative' && !args.note?.trim()) {
      throw new UnprocessableEntityException(
        'Une note est requise pour proposer un autre créneau',
      );
    }

    // Map no_show → declined + an "Absent" marker note (no enum value; the seat
    // is freed because declined is not an ACTIVE status).
    const effectiveStatus = args.toStatus === 'no_show' ? 'declined' : args.toStatus;
    const note =
      args.toStatus === 'no_show'
        ? `Absent·e${args.note?.trim() ? ` — ${args.note.trim()}` : ''}`
        : (args.note?.trim() || existing.note);

    // Concurrency guard (ADR-020 / FR5(d) / AC8): flip the status with the
    // from-status pinned in the WHERE clause. The JS legality check above raced
    // two concurrent transitions (both read `requested`, both passed, both wrote
    // — last-writer-wins, no 409). Guarding on the exact `existing.status` makes
    // the SECOND concurrent transition a safe no-op (`count === 0`) → a
    // deterministic 409, never a silent double-flip.
    const flip = await this.prisma.booking.updateMany({
      where: { id: existing.id, tenantId: args.tenantId, status: existing.status },
      data: {
        status: effectiveStatus as BookingFull['status'],
        note: note ?? null,
        decidedBy: args.userProfileId,
        decidedAt: new Date(),
      },
    });
    if (flip.count === 0) {
      throw new ConflictException(
        "Cette transition n'est pas possible pour cette réservation",
      );
    }

    // Re-read for the DTO (the guarded updateMany does not return the row).
    const updated = await this.prisma.booking.findFirstOrThrow({
      where: { id: existing.id, tenantId: args.tenantId },
      include: BOOKING_INCLUDE,
    });

    return { booking: this.toBookingDto(updated), effectiveStatus, bookedBy: existing.bookedBy };
  }

  // ----- helpers -------------------------------------------------------------

  /**
   * Count the bookings that actively occupy the slot's NEXT instance (the same
   * key the capacity guard uses at booking time). A slot with no resolvable
   * future instance (past one-off / malformed recurring) holds zero active
   * seats, so any new capacity ≥ 1 is accepted.
   */
  private async countActiveBookings(args: {
    tenantId: string;
    availabilityId: string;
    slot: {
      kind: 'recurring_weekly' | 'one_off';
      weekday: number | null;
      startTime: string | null;
      startsAt: Date | null;
    };
  }): Promise<number> {
    const next = resolveNextSessionAt(args.slot, new Date());
    if (!next) return 0;
    return this.prisma.booking.count({
      where: {
        tenantId: args.tenantId,
        availabilityId: args.availabilityId,
        sessionAt: next,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
  }

  /** Does the teacher CURRENTLY have a teaching assignment for the subject? */
  private async teachesSubject(args: {
    tenantId: string;
    teacherProfileId: string;
    subjectId: string;
  }): Promise<boolean> {
    const assignment = await this.prisma.teachingAssignment.findFirst({
      where: {
        tenantId: args.tenantId,
        teacherProfileId: args.teacherProfileId,
        subjectId: args.subjectId,
        academicYear: { status: 'active' },
      },
      select: { id: true },
    });
    return assignment != null;
  }

  /**
   * Resolve or lazily create the caller's own `teacher` tutor row (idempotent on
   * the caller). On reuse, ensure the requested subject is in `subjectIds` (a
   * teacher can offer several subjects over time) without dropping the others.
   */
  private async ensureTeacherTutor(args: {
    tenantId: string;
    schoolId: string;
    userProfileId: string;
    teacherProfileId: string;
    displayName: string;
    subjectId: string;
  }): Promise<{ id: string }> {
    const existing = await this.prisma.tutor.findFirst({
      where: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        type: 'teacher',
      },
      select: { id: true, subjectIds: true },
    });
    if (existing) {
      if (!existing.subjectIds.includes(args.subjectId)) {
        await this.prisma.tutor.update({
          where: { id: existing.id },
          data: { subjectIds: { set: [...existing.subjectIds, args.subjectId] } },
        });
      }
      return { id: existing.id };
    }

    const created = await this.prisma.tutor.create({
      data: {
        tenantId: args.tenantId,
        schoolId: args.schoolId,
        type: 'teacher',
        costKind: 'free',
        displayName: args.displayName || 'Soutien enseignant·e',
        subjectIds: [args.subjectId],
        teacherProfileId: args.teacherProfileId,
        userProfileId: args.userProfileId,
        // The admin still PUBLISHES the tutor to the parent catalogue (S5).
        // A teacher-published slot is visible to the teacher immediately but
        // discoverable by parents only once an admin publishes the tutor.
        published: false,
        createdBy: args.userProfileId,
      },
      select: { id: true },
    });
    return created;
  }

  private validateSlotShape(dto: {
    kind: 'recurring_weekly' | 'one_off';
    weekday?: number | null;
    startTime?: string | null;
    startsAt?: string | null;
  }): void {
    if (dto.kind === 'recurring_weekly') {
      if (dto.weekday == null || dto.weekday < 0 || dto.weekday > 6 || !dto.startTime) {
        throw new UnprocessableEntityException(
          'Un créneau hebdomadaire requiert un jour et une heure de début',
        );
      }
      if (!/^\d{1,2}:\d{2}/.test(dto.startTime.trim())) {
        throw new UnprocessableEntityException("L'heure de début doit être au format HH:mm");
      }
      return;
    }
    // one_off
    if (!dto.startsAt) {
      throw new UnprocessableEntityException('Un créneau ponctuel requiert une date');
    }
    const at = new Date(dto.startsAt);
    if (Number.isNaN(at.getTime())) {
      throw new UnprocessableEntityException('La date du créneau est invalide');
    }
  }

  private toAvailabilityDto(a: {
    id: string;
    kind: 'recurring_weekly' | 'one_off';
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    capacity: number;
    active: boolean;
  }): TeacherAvailabilityDto {
    return {
      id: a.id,
      kind: a.kind,
      weekday: a.weekday,
      startTime: a.startTime,
      endTime: a.endTime,
      startsAt: a.startsAt?.toISOString() ?? null,
      endsAt: a.endsAt?.toISOString() ?? null,
      capacity: a.capacity,
      active: a.active,
      bookedCount: 0,
    };
  }

  private toBookingDto(row: BookingFull): TeacherBookingDto {
    return {
      id: row.id,
      planId: row.planId,
      availabilityId: row.availabilityId,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      subjectId: row.plan?.subjectId ?? null,
      subjectName: row.plan?.subject?.name ?? null,
      sessionAt: row.sessionAt.toISOString(),
      status: row.status,
      note: row.note,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
