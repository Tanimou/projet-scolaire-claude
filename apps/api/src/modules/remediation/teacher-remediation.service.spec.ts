import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';

import { TeacherRemediationService } from './teacher-remediation.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const ME = 'teacher-up-1';
const OTHER = 'teacher-up-2';
const TUTOR = 'tutor-1';
const SUBJECT = 'subj-1';

function svcWith(prisma: Record<string, unknown>) {
  return new TeacherRemediationService(prisma as never);
}

// ---------------------------------------------------------------------------
// getSurface — ownership-walled, lazy null-tutor shell
// ---------------------------------------------------------------------------

describe('TeacherRemediationService.getSurface', () => {
  it('returns a null-tutor shell when the caller has no tutor yet (no slots published)', async () => {
    const prisma = {
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      tutor: { findFirst: jest.fn().mockResolvedValue(null) },
      booking: { findMany: jest.fn() },
    };
    const svc = svcWith(prisma);
    const res = await svc.getSurface({ tenantId: TENANT, userProfileId: ME });
    expect(res.tutor.tutorId).toBeNull();
    expect(res.tutor.availabilities).toEqual([]);
    expect(res.bookings).toEqual([]);
    // Never queries bookings without a tutor (no leak surface).
    expect(prisma.booking.findMany).not.toHaveBeenCalled();
  });

  it('scopes the surface to the caller own tutor (userProfileId === me)', async () => {
    const tutorFindFirst = jest.fn().mockResolvedValue({
      id: TUTOR,
      displayName: 'M. Diallo',
      published: true,
      subjectIds: [SUBJECT],
      availabilities: [],
    });
    const prisma = {
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) },
      tutor: { findFirst: tutorFindFirst },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma);
    await svc.getSurface({ tenantId: TENANT, userProfileId: ME });
    expect(tutorFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          userProfileId: ME,
          type: 'teacher',
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// upsertAvailability — ownership wall (teacher profile + subject taught)
// ---------------------------------------------------------------------------

describe('TeacherRemediationService.upsertAvailability — ownership wall', () => {
  const dto = {
    kind: 'recurring_weekly' as const,
    subjectId: SUBJECT,
    weekday: 1,
    startTime: '17:00',
    endTime: '18:00',
    capacity: 1,
  };

  it('403 when the caller has no TeacherProfile (not a teacher)', async () => {
    const prisma = {
      teacherProfile: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({ tenantId: TENANT, schoolId: SCHOOL, userProfileId: ME, dto }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('403 when the caller does NOT currently teach the requested subject', async () => {
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'A', lastName: 'B' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({ tenantId: TENANT, schoolId: SCHOOL, userProfileId: ME, dto }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('422 on a malformed recurring slot (missing weekday/startTime)', async () => {
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'A', lastName: 'B' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'ta-1' }) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({
        tenantId: TENANT,
        schoolId: SCHOOL,
        userProfileId: ME,
        dto: { kind: 'recurring_weekly', subjectId: SUBJECT, weekday: null, startTime: null },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('lazily creates the teacher tutor + the slot on a first publish', async () => {
    const tutorCreate = jest.fn().mockResolvedValue({ id: TUTOR });
    const availCreate = jest.fn().mockResolvedValue({
      id: 'avail-1',
      kind: 'recurring_weekly',
      weekday: 1,
      startTime: '17:00',
      endTime: '18:00',
      startsAt: null,
      endsAt: null,
      capacity: 1,
      active: true,
    });
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'Mamadou', lastName: 'Diallo' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'ta-1' }) },
      tutor: { findFirst: jest.fn().mockResolvedValue(null), create: tutorCreate },
      tutorAvailability: { create: availCreate },
    };
    const svc = svcWith(prisma);
    const res = await svc.upsertAvailability({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      dto,
    });
    expect(res.created).toBe(true);
    expect(res.tutorId).toBe(TUTOR);
    // The lazily-created tutor is teacher-linked + unpublished (admin publishes in S5).
    expect(tutorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          type: 'teacher',
          userProfileId: ME,
          teacherProfileId: 'tp-1',
          published: false,
          subjectIds: [SUBJECT],
        }),
      }),
    );
  });

  it('422 when lowering capacity below the slot active booking count (capacity-floor guard)', async () => {
    // The slot is a recurring Tuesday 17:00; resolveNextSessionAt finds the next
    // Tuesday and the count of active bookings on that instance is 2 — lowering
    // capacity to 1 must be rejected with a 422, never silently over-committing.
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'A', lastName: 'B' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'ta-1' }) },
      tutor: {
        findFirst: jest.fn().mockResolvedValue({ id: TUTOR, subjectIds: [SUBJECT] }),
      },
      tutorAvailability: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'avail-1',
          kind: 'recurring_weekly',
          weekday: 1,
          startTime: '17:00',
          startsAt: null,
        }),
        update: jest.fn(),
      },
      booking: { count: jest.fn().mockResolvedValue(2) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({
        tenantId: TENANT,
        schoolId: SCHOOL,
        userProfileId: ME,
        availabilityId: 'avail-1',
        dto: { kind: 'recurring_weekly', subjectId: SUBJECT, weekday: 1, startTime: '17:00', capacity: 1 },
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    // The held seats are never dropped — the update never runs.
    expect(prisma.tutorAvailability.update).not.toHaveBeenCalled();
  });

  it('allows lowering capacity to exactly the active booking count (boundary)', async () => {
    const update = jest.fn().mockResolvedValue({
      id: 'avail-1',
      kind: 'recurring_weekly',
      weekday: 1,
      startTime: '17:00',
      endTime: '18:00',
      startsAt: null,
      endsAt: null,
      capacity: 2,
      active: true,
    });
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'A', lastName: 'B' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'ta-1' }) },
      tutor: {
        findFirst: jest.fn().mockResolvedValue({ id: TUTOR, subjectIds: [SUBJECT] }),
      },
      tutorAvailability: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'avail-1',
          kind: 'recurring_weekly',
          weekday: 1,
          startTime: '17:00',
          startsAt: null,
        }),
        update,
      },
      booking: { count: jest.fn().mockResolvedValue(2) },
    };
    const svc = svcWith(prisma);
    const res = await svc.upsertAvailability({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      availabilityId: 'avail-1',
      dto: { kind: 'recurring_weekly', subjectId: SUBJECT, weekday: 1, startTime: '17:00', capacity: 2 },
    });
    expect(res.created).toBe(false);
    expect(update).toHaveBeenCalled();
  });

  it('404 when editing an availability that is NOT on the caller own tutor', async () => {
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'tp-1',
          schoolId: SCHOOL,
          userProfile: { firstName: 'A', lastName: 'B' },
        }),
      },
      teachingAssignment: { findFirst: jest.fn().mockResolvedValue({ id: 'ta-1' }) },
      tutor: {
        findFirst: jest.fn().mockResolvedValue({ id: TUTOR, subjectIds: [SUBJECT] }),
      },
      tutorAvailability: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({
        tenantId: TENANT,
        schoolId: SCHOOL,
        userProfileId: ME,
        availabilityId: 'other-avail',
        dto,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ---------------------------------------------------------------------------
// transition — ownership wall + state machine
// ---------------------------------------------------------------------------

function bookingFor(ownerUp: string, status: string) {
  return {
    id: 'b-1',
    status,
    note: null,
    bookedBy: 'parent-up-1',
    tutor: { userProfileId: ownerUp },
  };
}

function updatedBookingRow(status: string, note: string | null = null) {
  return {
    id: 'b-1',
    planId: 'plan-1',
    availabilityId: 'avail-1',
    studentId: 'stu-1',
    sessionAt: new Date('2026-07-01T15:00:00.000Z'),
    status,
    note,
    createdAt: new Date('2026-06-06T10:00:00.000Z'),
    student: { firstName: 'Léa', lastName: 'Martin' },
    plan: { subjectId: SUBJECT, subject: { name: 'Maths' } },
  };
}

describe('TeacherRemediationService.transition', () => {
  it('404 when the booking tutor is NOT the caller own tutor (ownership wall)', async () => {
    const prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(bookingFor(OTHER, 'requested')) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.transition({
        tenantId: TENANT,
        userProfileId: ME,
        bookingId: 'b-1',
        toStatus: 'confirmed',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('409 on an illegal transition (confirm an already-completed booking)', async () => {
    const prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(bookingFor(ME, 'completed')) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.transition({
        tenantId: TENANT,
        userProfileId: ME,
        bookingId: 'b-1',
        toStatus: 'confirmed',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('422 when proposing an alternative without a note', async () => {
    const prisma = {
      booking: { findFirst: jest.fn().mockResolvedValue(bookingFor(ME, 'requested')) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.transition({
        tenantId: TENANT,
        userProfileId: ME,
        bookingId: 'b-1',
        toStatus: 'proposed_alternative',
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('confirms a requested booking (the happy path) and returns the parent booker', async () => {
    const update = jest.fn().mockResolvedValue(updatedBookingRow('confirmed'));
    const prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(bookingFor(ME, 'requested')),
        update,
      },
    };
    const svc = svcWith(prisma);
    const res = await svc.transition({
      tenantId: TENANT,
      userProfileId: ME,
      bookingId: 'b-1',
      toStatus: 'confirmed',
    });
    expect(res.effectiveStatus).toBe('confirmed');
    expect(res.booking.status).toBe('confirmed');
    expect(res.bookedBy).toBe('parent-up-1');
  });

  it('maps no_show onto declined + an "Absent" note (no enum value, no schema change)', async () => {
    const update = jest.fn().mockResolvedValue(updatedBookingRow('declined', 'Absent·e'));
    const prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(bookingFor(ME, 'confirmed')),
        update,
      },
    };
    const svc = svcWith(prisma);
    const res = await svc.transition({
      tenantId: TENANT,
      userProfileId: ME,
      bookingId: 'b-1',
      toStatus: 'no_show',
    });
    expect(res.effectiveStatus).toBe('declined');
    // The DB write flips to declined (the seat frees) + the Absent marker note.
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'declined', note: expect.stringContaining('Absent') }),
      }),
    );
  });

  it('marks a confirmed booking honoured (completed)', async () => {
    const update = jest.fn().mockResolvedValue(updatedBookingRow('completed'));
    const prisma = {
      booking: {
        findFirst: jest.fn().mockResolvedValue(bookingFor(ME, 'confirmed')),
        update,
      },
    };
    const svc = svcWith(prisma);
    const res = await svc.transition({
      tenantId: TENANT,
      userProfileId: ME,
      bookingId: 'b-1',
      toStatus: 'completed',
    });
    expect(res.effectiveStatus).toBe('completed');
    expect(res.booking.status).toBe('completed');
  });
});
