import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';

import { AdminRemediationService } from './admin-remediation.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const ME = 'admin-up-1';
const TUTOR = 'tutor-1';
const SUBJECT = 'subj-1';
const SUBJECT_2 = 'subj-2';
const TEACHER_PROFILE = 'tp-1';
const TEACHER_USER = 'teacher-up-1';

function svcWith(prisma: Record<string, unknown>) {
  return new AdminRemediationService(prisma as never);
}

// ---------------------------------------------------------------------------
// listTutors — tenant-scoped, full roster, no-N+1 counts
// ---------------------------------------------------------------------------

describe('AdminRemediationService.listTutors', () => {
  it('lists the FULL tenant-scoped roster (every published state) and counts bookings in ONE grouped query', async () => {
    const tutorFindMany = jest.fn().mockResolvedValue([
      {
        id: TUTOR,
        type: 'external',
        costKind: 'free',
        displayName: 'Aide aux devoirs',
        blurb: null,
        subjectIds: [SUBJECT],
        teacherProfileId: null,
        userProfileId: null,
        published: false,
        createdAt: new Date('2026-01-01T00:00:00Z'),
        availabilities: [{ id: 'a1' }],
      },
    ]);
    // ONE booking.findMany for the active-booking counts (no per-tutor N+1).
    const bookingFindMany = jest.fn().mockResolvedValue([{ availabilityId: 'a1' }]);
    const prisma = {
      tutor: { findMany: tutorFindMany },
      tutorAvailability: {
        findMany: jest.fn().mockResolvedValue([
          // a one_off in the future so resolveNextSessionAt yields an instance.
          {
            id: 'a1',
            tutorId: TUTOR,
            kind: 'one_off',
            weekday: null,
            startTime: null,
            startsAt: new Date(Date.now() + 86_400_000),
          },
        ]),
      },
      booking: { findMany: bookingFindMany },
    };
    const svc = svcWith(prisma);
    const res = await svc.listTutors({ tenantId: TENANT });

    expect(tutorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT }) }),
    );
    expect(res).toHaveLength(1);
    const row = res[0]!;
    expect(row.published).toBe(false); // unpublished tutor IS surfaced to the admin
    expect(row.availabilityCount).toBe(1);
    expect(row.activeBookingCount).toBe(1);
    expect(bookingFindMany).toHaveBeenCalledTimes(1); // no N+1
  });

  it('applies the optional subjectId filter', async () => {
    const tutorFindMany = jest.fn().mockResolvedValue([]);
    const prisma = {
      tutor: { findMany: tutorFindMany },
      tutorAvailability: { findMany: jest.fn() },
      booking: { findMany: jest.fn() },
    };
    await svcWith(prisma).listTutors({ tenantId: TENANT, subjectId: SUBJECT });
    expect(tutorFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId: TENANT,
          subjectIds: { has: SUBJECT },
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// createTutor — teacher-linked vs external/peer, FM-1 / FM-8 / 404-cross-tenant
// ---------------------------------------------------------------------------

describe('AdminRemediationService.createTutor', () => {
  it('teacher tutor: validates the in-tenant teacherProfile, resolves+persists userProfileId, constrains subjects to taught', async () => {
    const teacherProfileFindFirst = jest.fn().mockResolvedValue({
      id: TEACHER_PROFILE,
      userProfileId: TEACHER_USER,
    });
    // The teacher teaches SUBJECT but NOT SUBJECT_2.
    const teachingAssignmentFindMany = jest
      .fn()
      .mockResolvedValue([{ subjectId: SUBJECT }]);
    const tutorCreate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'teacher',
      costKind: 'free',
      displayName: 'M. Diallo',
      blurb: null,
      subjectIds: [SUBJECT],
      teacherProfileId: TEACHER_PROFILE,
      userProfileId: TEACHER_USER,
      published: false,
      createdAt: new Date(),
      availabilities: [],
    });
    const prisma = {
      teacherProfile: { findFirst: teacherProfileFindFirst },
      teachingAssignment: { findMany: teachingAssignmentFindMany },
      tutor: { findFirst: jest.fn().mockResolvedValue(null), create: tutorCreate },
    };
    const svc = svcWith(prisma);
    const { tutor } = await svc.createTutor({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      dto: {
        type: 'teacher',
        displayName: 'M. Diallo',
        subjectIds: [SUBJECT, SUBJECT_2], // SUBJECT_2 is untaught → dropped
        teacherProfileId: TEACHER_PROFILE,
      } as never,
    });

    expect(teacherProfileFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: TEACHER_PROFILE, tenantId: TENANT },
      }),
    );
    // userProfileId is server-resolved + persisted (S2 wall + notify resolve).
    expect(tutorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          userProfileId: TEACHER_USER,
          teacherProfileId: TEACHER_PROFILE,
          subjectIds: [SUBJECT], // FM-1: untaught subject was constrained out
        }),
      }),
    );
    expect(tutor.id).toBe(TUTOR);
  });

  it('teacher tutor with a missing/cross-tenant teacherProfile → 404 (no dangling link)', async () => {
    const prisma = {
      teacherProfile: { findFirst: jest.fn().mockResolvedValue(null) },
      teachingAssignment: { findMany: jest.fn() },
      tutor: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.createTutor({
        tenantId: TENANT,
        schoolId: SCHOOL,
        userProfileId: ME,
        dto: {
          type: 'teacher',
          displayName: 'X',
          subjectIds: [SUBJECT],
          teacherProfileId: 'cross-tenant',
        } as never,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('teacher tutor where NONE of the chosen subjects are taught → 422 (FM-1, never bypasses the wall)', async () => {
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: TEACHER_PROFILE, userProfileId: TEACHER_USER }),
      },
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([]) }, // teaches nothing requested
      tutor: { findFirst: jest.fn(), create: jest.fn() },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.createTutor({
        tenantId: TENANT,
        schoolId: SCHOOL,
        userProfileId: ME,
        dto: {
          type: 'teacher',
          displayName: 'X',
          subjectIds: [SUBJECT_2],
          teacherProfileId: TEACHER_PROFILE,
        } as never,
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('external tutor: persists name + subjects with NULL teacher links', async () => {
    const tutorCreate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'external',
      costKind: 'volunteer',
      displayName: 'Association Lire',
      blurb: 'Bénévoles',
      subjectIds: [SUBJECT, SUBJECT_2],
      teacherProfileId: null,
      userProfileId: null,
      published: false,
      createdAt: new Date(),
      availabilities: [],
    });
    const prisma = {
      teacherProfile: { findFirst: jest.fn() },
      teachingAssignment: { findMany: jest.fn() },
      tutor: { findFirst: jest.fn(), create: tutorCreate },
    };
    const svc = svcWith(prisma);
    const { tutor } = await svc.createTutor({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      dto: {
        type: 'external',
        costKind: 'volunteer',
        displayName: 'Association Lire',
        blurb: 'Bénévoles',
        subjectIds: [SUBJECT, SUBJECT_2],
      } as never,
    });
    expect(tutorCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ teacherProfileId: null, userProfileId: null }),
      }),
    );
    // No teacher-teaching constraint runs for an external tutor (free subjects).
    expect(prisma.teachingAssignment.findMany).not.toHaveBeenCalled();
    expect(tutor.teacherProfileId).toBeNull();
  });

  it('teacher tutor that already exists is REUSED, not duplicated (FM-8)', async () => {
    const existing = { id: TUTOR, subjectIds: [SUBJECT] };
    const tutorUpdate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'teacher',
      costKind: 'free',
      displayName: 'M. Diallo',
      blurb: null,
      subjectIds: [SUBJECT],
      teacherProfileId: TEACHER_PROFILE,
      userProfileId: TEACHER_USER,
      published: true,
      createdAt: new Date(),
      availabilities: [],
    });
    const tutorCreate = jest.fn();
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: TEACHER_PROFILE, userProfileId: TEACHER_USER }),
      },
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([{ subjectId: SUBJECT }]) },
      tutor: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: tutorUpdate,
        create: tutorCreate,
      },
      tutorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma);
    await svc.createTutor({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      dto: {
        type: 'teacher',
        displayName: 'M. Diallo',
        subjectIds: [SUBJECT],
        teacherProfileId: TEACHER_PROFILE,
        published: true,
      } as never,
    });
    expect(tutorCreate).not.toHaveBeenCalled(); // reused, not duplicated
    expect(tutorUpdate).toHaveBeenCalled();
  });

  it('FR-6: a reuse with NO `published` field does NOT silently retire a live teacher tutor + flags reused:true', async () => {
    const existing = { id: TUTOR, subjectIds: [SUBJECT], published: true }; // LIVE self-published
    const tutorUpdate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'teacher',
      costKind: 'free',
      displayName: 'M. Diallo',
      blurb: null,
      subjectIds: [SUBJECT],
      teacherProfileId: TEACHER_PROFILE,
      userProfileId: TEACHER_USER,
      published: true, // STAYS published — never silently retired
      createdAt: new Date(),
      availabilities: [],
    });
    const prisma = {
      teacherProfile: {
        findFirst: jest.fn().mockResolvedValue({ id: TEACHER_PROFILE, userProfileId: TEACHER_USER }),
      },
      teachingAssignment: { findMany: jest.fn().mockResolvedValue([{ subjectId: SUBJECT }]) },
      tutor: {
        findFirst: jest.fn().mockResolvedValue(existing),
        update: tutorUpdate,
        create: jest.fn(),
      },
      tutorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma);
    const res = await svc.createTutor({
      tenantId: TENANT,
      schoolId: SCHOOL,
      userProfileId: ME,
      dto: {
        type: 'teacher',
        displayName: 'M. Diallo',
        subjectIds: [SUBJECT],
        teacherProfileId: TEACHER_PROFILE,
        // NO `published` field — the admin left the toggle untouched.
      } as never,
    });
    // The update data must NOT include `published` (so the live state is preserved).
    expect(tutorUpdate.mock.calls[0][0].data).not.toHaveProperty('published');
    // The controller is signalled this was a reuse → it writes tutor_updated, not tutor_created.
    expect(res.reused).toBe(true);
    expect(res.publishedBefore).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// updateTutor — approve/retire toggle (history-preserving), tenant scope
// ---------------------------------------------------------------------------

describe('AdminRemediationService.updateTutor', () => {
  it('publish toggle preserves the row and reports before/after (no delete)', async () => {
    const tutorFindFirst = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'external',
      teacherProfileId: null,
      published: false,
    });
    const tutorUpdate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'external',
      costKind: 'free',
      displayName: 'Aide',
      blurb: null,
      subjectIds: [SUBJECT],
      teacherProfileId: null,
      userProfileId: null,
      published: true,
      createdAt: new Date(),
      availabilities: [],
    });
    const prisma = {
      tutor: { findFirst: tutorFindFirst, update: tutorUpdate },
      tutorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma);
    const res = await svc.updateTutor({
      tenantId: TENANT,
      tutorId: TUTOR,
      dto: { published: true } as never,
    });
    expect(res.publishedBefore).toBe(false);
    expect(res.publishedAfter).toBe(true);
    // Retire/approve is a published flip — never a delete.
    expect((prisma.tutor as Record<string, unknown>).delete).toBeUndefined();
  });

  it('a cross-tenant / missing tutor → 404 (never leaks)', async () => {
    const prisma = {
      tutor: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.updateTutor({ tenantId: TENANT, tutorId: 'other', dto: { published: true } as never }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('a teacher tutor subjectIds edit is constrained to taught subjects (FM-1)', async () => {
    const tutorFindFirst = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'teacher',
      teacherProfileId: TEACHER_PROFILE,
      published: true,
    });
    const teachingAssignmentFindMany = jest.fn().mockResolvedValue([{ subjectId: SUBJECT }]);
    const tutorUpdate = jest.fn().mockResolvedValue({
      id: TUTOR,
      type: 'teacher',
      costKind: 'free',
      displayName: 'M. Diallo',
      blurb: null,
      subjectIds: [SUBJECT],
      teacherProfileId: TEACHER_PROFILE,
      userProfileId: TEACHER_USER,
      published: true,
      createdAt: new Date(),
      availabilities: [],
    });
    const prisma = {
      tutor: { findFirst: tutorFindFirst, update: tutorUpdate },
      teachingAssignment: { findMany: teachingAssignmentFindMany },
      tutorAvailability: { findMany: jest.fn().mockResolvedValue([]) },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const svc = svcWith(prisma);
    await svc.updateTutor({
      tenantId: TENANT,
      tutorId: TUTOR,
      dto: { subjectIds: [SUBJECT, SUBJECT_2] } as never, // SUBJECT_2 untaught → dropped
    });
    expect(tutorUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ subjectIds: { set: [SUBJECT] } }) }),
    );
  });
});

// ---------------------------------------------------------------------------
// upsertAvailability — admin variant: no ownership wall, capacity-floor guard
// ---------------------------------------------------------------------------

describe('AdminRemediationService.upsertAvailability', () => {
  it('re-scopes the tutor to the caller tenant (404 cross-tenant)', async () => {
    const prisma = {
      tutor: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({
        tenantId: TENANT,
        tutorId: 'other',
        userProfileId: ME,
        dto: { kind: 'recurring_weekly', weekday: 1, startTime: '14:00' },
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('publishes a slot for ANY tutor (no subject-ownership wall); FR-7 createdBy = actor, FR-4 surfaces the teacher link', async () => {
    const tutorAvailabilityCreate = jest.fn().mockResolvedValue({
      id: 'a1',
      kind: 'recurring_weekly',
      weekday: 1,
      startTime: '14:00',
      endTime: null,
      startsAt: null,
      endsAt: null,
      capacity: 1,
      active: true,
    });
    const prisma = {
      tutor: {
        findFirst: jest
          .fn()
          .mockResolvedValue({ id: TUTOR, schoolId: SCHOOL, userProfileId: TEACHER_USER }),
      },
      tutorAvailability: { create: tutorAvailabilityCreate },
    };
    const svc = svcWith(prisma);
    const res = await svc.upsertAvailability({
      tenantId: TENANT,
      tutorId: TUTOR,
      userProfileId: ME,
      dto: { kind: 'recurring_weekly', weekday: 1, startTime: '14:00' },
    });
    expect(res.created).toBe(true);
    expect(res.availability.id).toBe('a1');
    // FR-7: the slot's createdBy is the ACTOR admin's userProfileId, not the Tutor id.
    expect(tutorAvailabilityCreate.mock.calls[0][0].data.createdBy).toBe(ME);
    // FR-4: the linked teacher's userProfileId is surfaced so the controller can notify.
    expect(res.tutorUserProfileId).toBe(TEACHER_USER);
  });

  it('rejects lowering capacity below active bookings on the next instance → 422 (ADR-020)', async () => {
    const next = new Date(Date.now() + 86_400_000);
    const prisma = {
      tutor: { findFirst: jest.fn().mockResolvedValue({ id: TUTOR, schoolId: SCHOOL }) },
      tutorAvailability: {
        findFirst: jest.fn().mockResolvedValue({
          id: 'a1',
          kind: 'one_off',
          weekday: null,
          startTime: null,
          startsAt: next,
        }),
        update: jest.fn(),
      },
      booking: { count: jest.fn().mockResolvedValue(3) }, // 3 active bookings
    };
    const svc = svcWith(prisma);
    await expect(
      svc.upsertAvailability({
        tenantId: TENANT,
        tutorId: TUTOR,
        availabilityId: 'a1',
        userProfileId: ME,
        dto: { kind: 'one_off', startsAt: next.toISOString(), capacity: 1 }, // 1 < 3
      }),
    ).rejects.toBeInstanceOf(UnprocessableEntityException);
    expect(prisma.tutorAvailability.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// overview — RGPD-clean aggregate (NO child-by-name), no N+1
// ---------------------------------------------------------------------------

describe('AdminRemediationService.overview', () => {
  it('returns AGGREGATE COUNTS ONLY — no studentId / studentName / per-child row (FM-3 RGPD)', async () => {
    const prisma = {
      remediationPlan: {
        groupBy: jest.fn().mockResolvedValue([{ subjectId: SUBJECT, _count: { _all: 2 } }]),
      },
      booking: {
        findMany: jest.fn().mockResolvedValue([
          { plan: { subjectId: SUBJECT } },
          { plan: { subjectId: SUBJECT } },
        ]),
      },
      tutor: {
        findMany: jest.fn().mockResolvedValue([
          { subjectIds: [SUBJECT], published: true },
          { subjectIds: [SUBJECT, SUBJECT_2], published: false },
        ]),
      },
      subject: {
        findMany: jest.fn().mockResolvedValue([
          { id: SUBJECT, name: 'Mathématiques' },
          { id: SUBJECT_2, name: 'Français' },
        ]),
      },
    };
    const svc = svcWith(prisma);
    const res = await svc.overview({ tenantId: TENANT });

    // Tenant-scoped on every aggregate.
    expect(prisma.remediationPlan.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ tenantId: TENANT, status: 'open' }) }),
    );
    // The booking aggregate selects ONLY plan.subjectId — no student include (RGPD).
    expect(prisma.booking.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ select: { plan: { select: { subjectId: true } } } }),
    );

    // Aggregate shape: counts per subject + totals, no per-child field anywhere.
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/studentId/i);
    expect(serialized).not.toMatch(/studentName/i);
    expect(serialized).not.toMatch(/firstName|lastName/i);

    expect(res.totals).toEqual({ openPlans: 2, activeBookings: 2, publishedTutors: 1 });
    const maths = res.bySubject.find((s) => s.subjectId === SUBJECT);
    // FR-8: tutorCount counts ONLY published tutors — SUBJECT has 1 published + 1
    // retired → tutorCount:1 (the retired tutor no longer masks the real capacity).
    expect(maths).toMatchObject({ openPlans: 2, activeBookings: 2, tutorCount: 1 });
  });

  it('FR-8: a subject covered ONLY by a retired tutor reads as tutorCount:0 (a genuine gap)', async () => {
    const prisma = {
      remediationPlan: {
        groupBy: jest.fn().mockResolvedValue([{ subjectId: SUBJECT, _count: { _all: 1 } }]),
      },
      booking: { findMany: jest.fn().mockResolvedValue([]) },
      tutor: {
        findMany: jest.fn().mockResolvedValue([
          { subjectIds: [SUBJECT], published: false }, // the ONLY tutor is retired
        ]),
      },
      subject: {
        findMany: jest.fn().mockResolvedValue([{ id: SUBJECT, name: 'Mathématiques' }]),
      },
    };
    const res = await svcWith(prisma).overview({ tenantId: TENANT });
    const maths = res.bySubject.find((s) => s.subjectId === SUBJECT);
    expect(maths?.tutorCount).toBe(0); // the gap surfaces
    expect(res.totals.publishedTutors).toBe(0);
  });
});
