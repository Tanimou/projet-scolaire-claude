import { AnnouncementRecipientsService } from './announcements.service';

/**
 * E8-S3 (FR-S3-7) — the additive student-receipt rule on the SHARED recipient
 * producer. These pin the regression-safe invariants the architect + pre-mortem
 * flagged (PM-2 / PM-3): a class/student-scoped announcement now ALSO materialises
 * a receipt for an enrolled+linked student, materialises NOTHING new for an
 * enrolled student with no linked profile, adds NO non-class student, and leaves
 * what guardians/teachers receive UNCHANGED.
 */
const TENANT = 't1';
const SCHOOL = 'school-1';

/**
 * Hand-mocked Prisma. Each query returns the configured rows. `students` is the
 * `student.findMany({ where: { id: { in }, userProfileId: { not: null } } })` set
 * (already filtered to linked students in the mock, matching the real query).
 */
function makeService(opts: {
  enrollments?: Array<{ studentId: string }>;
  guardianships?: Array<{ guardian: { userProfileId: string | null } }>;
  assignments?: Array<{ teacherProfile: { userProfileId: string } }>;
  linkedStudents?: Array<{ userProfileId: string | null }>;
  classSections?: Array<{ id: string }>;
}) {
  const enrollmentFindMany = jest.fn().mockResolvedValue(opts.enrollments ?? []);
  const guardianshipFindMany = jest.fn().mockResolvedValue(opts.guardianships ?? []);
  const teachingAssignmentFindMany = jest.fn().mockResolvedValue(opts.assignments ?? []);
  const studentFindMany = jest.fn().mockResolvedValue(opts.linkedStudents ?? []);
  const classSectionFindMany = jest.fn().mockResolvedValue(opts.classSections ?? []);
  const prisma = {
    enrollment: { findMany: enrollmentFindMany },
    guardianship: { findMany: guardianshipFindMany },
    teachingAssignment: { findMany: teachingAssignmentFindMany },
    student: { findMany: studentFindMany },
    classSection: { findMany: classSectionFindMany },
  };
  const service = new AnnouncementRecipientsService(prisma as never);
  return { service, studentFindMany, guardianshipFindMany, teachingAssignmentFindMany };
}

const baseAnnouncement = {
  tenantId: TENANT,
  schoolId: SCHOOL,
  cycleId: null,
  gradeLevelId: null,
  classSectionId: null as string | null,
  studentId: null as string | null,
  userProfileId: null as string | null,
};

describe('AnnouncementRecipientsService — E8-S3 additive student receipts', () => {
  it('class_section_scope: unions the enrolled+linked student profile alongside guardians+teachers', async () => {
    const { service, studentFindMany } = makeService({
      enrollments: [{ studentId: 'stu-1' }, { studentId: 'stu-2' }],
      guardianships: [{ guardian: { userProfileId: 'guardian-1' } }],
      assignments: [{ teacherProfile: { userProfileId: 'teacher-1' } }],
      // stu-1 is linked; stu-2 has no account (filtered out by the real query).
      linkedStudents: [{ userProfileId: 'student-profile-1' }],
    });

    const recipients = await service.computeRecipients({
      ...baseAnnouncement,
      scope: 'class_section_scope' as never,
      classSectionId: 'cs-1',
    });

    // Guardians + teachers UNCHANGED, PLUS the linked student's own profile.
    expect(recipients).toEqual(new Set(['guardian-1', 'teacher-1', 'student-profile-1']));
    // The student query is bounded to the enrolled set + guarded by a non-null link.
    expect(studentFindMany).toHaveBeenCalledWith({
      where: { id: { in: ['stu-1', 'stu-2'] }, userProfileId: { not: null } },
      select: { userProfileId: true },
    });
  });

  it('an enrolled student with NO linked profile materialises nothing new (guardians/teachers unchanged)', async () => {
    const { service } = makeService({
      enrollments: [{ studentId: 'stu-1' }],
      guardianships: [{ guardian: { userProfileId: 'guardian-1' } }],
      assignments: [{ teacherProfile: { userProfileId: 'teacher-1' } }],
      linkedStudents: [], // no linked student account
    });

    const recipients = await service.computeRecipients({
      ...baseAnnouncement,
      scope: 'class_section_scope' as never,
      classSectionId: 'cs-1',
    });

    expect(recipients).toEqual(new Set(['guardian-1', 'teacher-1']));
  });

  it('individual_student: unions the student own profile with their guardians', async () => {
    const { service } = makeService({
      guardianships: [{ guardian: { userProfileId: 'guardian-1' } }],
      linkedStudents: [{ userProfileId: 'student-profile-1' }],
    });

    const recipients = await service.computeRecipients({
      ...baseAnnouncement,
      scope: 'individual_student' as never,
      studentId: 'stu-1',
    });

    expect(recipients).toEqual(new Set(['guardian-1', 'student-profile-1']));
  });
});
