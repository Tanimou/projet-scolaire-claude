import { ForbiddenException } from '@nestjs/common';

import { StudentPortalService } from './student-portal.service';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

const TENANT = 't1';
const SCHOOL = 'school-1';
const ME = { id: 'profile-1', tenantId: TENANT };
const OWN_ID = 'student-self-id';
const JWT = { sub: 'kc', realm_access: { roles: ['student'] } } as unknown as KeycloakJwtPayload;

/**
 * Builds the service with hand-mocked collaborators. `linked` controls
 * `resolveSelf` (the `student.findFirst` lookup): the own Student row or null.
 */
function makeService(opts: {
  linked: boolean;
  canAccess?: boolean;
  upcoming?: unknown;
  attendanceRows?: unknown[];
}) {
  const studentFindFirst = jest
    .fn()
    .mockResolvedValue(opts.linked ? { id: OWN_ID, firstName: 'Lina', lastName: 'M.' } : null);
  const attendanceFindMany = jest.fn().mockResolvedValue(opts.attendanceRows ?? []);
  const prisma = {
    student: { findFirst: studentFindFirst },
    attendanceRecord: { findMany: attendanceFindMany },
  };
  const canAccessStudent = jest.fn().mockResolvedValue(opts.canAccess ?? true);
  const studentAccess = { canAccessStudent };
  const parentUpcoming = jest
    .fn()
    .mockResolvedValue(
      opts.upcoming ?? { classSectionName: null, gradeLevelName: null, data: [] },
    );
  const analytics = { parentUpcoming };

  const service = new StudentPortalService(
    prisma as never,
    studentAccess as never,
    analytics as never,
  );
  return { service, studentFindFirst, attendanceFindMany, canAccessStudent, parentUpcoming };
}

/**
 * E8-S2 — the two self-scoped reads ("À venir" + "Mon assiduité") behind the S1
 * student-self wall. These pin the load-bearing [auth]/[rgpd] invariants: the
 * studentId is server-resolved (never request-supplied), the wall runs before
 * each read, an unlinked caller degrades to a kind empty payload (never a 500,
 * never a peer), and the mapped attendance rows expose NO actor metadata.
 */
describe('StudentPortalService.upcoming — self-scoped upcoming assessments', () => {
  it('resolves self, calls parentUpcoming with the own id, and maps rows 1:1 into the narrowed DTO', async () => {
    const producerRows = [
      {
        id: 'a1',
        title: 'Contrôle de maths',
        description: 'chapitre 3',
        scheduledAt: '2026-06-20T08:00:00.000Z',
        kind: 'written_test',
        maxScore: 20,
        coefficient: 2,
        subjectId: 'subj-1',
        subjectCode: 'MATH',
        subjectName: 'Mathématiques',
        subjectColor: '#abc',
        classSectionName: '4e B', // producer-only field — must be dropped
        termId: 'term-1',
        termName: 'Trimestre 3',
      },
    ];
    const { service, parentUpcoming, canAccessStudent } = makeService({
      linked: true,
      upcoming: { classSectionName: '4e B', gradeLevelName: '4e', data: producerRows },
    });

    const res = await service.upcoming(ME, JWT, SCHOOL);

    expect(canAccessStudent).toHaveBeenCalledWith(ME, JWT, OWN_ID, SCHOOL);
    expect(parentUpcoming).toHaveBeenCalledWith({ tenantId: TENANT, studentId: OWN_ID });
    expect(res.classSectionName).toBe('4e B');
    expect(res.gradeLevelName).toBe('4e');
    expect(res.data).toHaveLength(1);
    // The narrowed DTO carries the self scalars but NOT the producer's per-row
    // classSectionName.
    expect(res.data[0]).not.toHaveProperty('classSectionName');
    expect(res.data[0]).toMatchObject({ id: 'a1', subjectName: 'Mathématiques', coefficient: 2 });
  });

  it('an UNLINKED caller → kind empty payload, parentUpcoming NOT called (no 500, no peer)', async () => {
    const { service, parentUpcoming } = makeService({ linked: false });

    const res = await service.upcoming(ME, JWT, SCHOOL);

    expect(res).toEqual({ classSectionName: null, gradeLevelName: null, data: [] });
    expect(parentUpcoming).not.toHaveBeenCalled();
  });

  it('defence-in-depth: if the wall denies the own id, it throws rather than leaking', async () => {
    const { service, parentUpcoming } = makeService({ linked: true, canAccess: false });

    await expect(service.upcoming(ME, JWT, SCHOOL)).rejects.toBeInstanceOf(ForbiddenException);
    expect(parentUpcoming).not.toHaveBeenCalled();
  });
});

describe('StudentPortalService.attendance — self-scoped attendance summary + records', () => {
  it('reads the own records tenant-scoped, computes the summary, and exposes NO actor metadata', async () => {
    const rows = [
      {
        id: 'r1',
        status: 'present',
        justification: null,
        classSession: {
          date: new Date('2026-06-01T08:00:00.000Z'),
          teachingAssignment: {
            subject: { name: 'Maths', color: '#abc' },
            classSection: { name: '4e B' },
          },
        },
      },
      {
        id: 'r2',
        status: 'absent_excused',
        justification: 'Rendez-vous médical',
        classSession: {
          date: new Date('2026-06-02T08:00:00.000Z'),
          teachingAssignment: {
            subject: { name: 'Histoire', color: '#def' },
            classSection: { name: '4e B' },
          },
        },
      },
      {
        id: 'r3',
        status: 'late',
        justification: null,
        classSession: { date: new Date('2026-06-03T08:00:00.000Z'), teachingAssignment: null },
      },
    ];
    const { service, attendanceFindMany, canAccessStudent } = makeService({
      linked: true,
      attendanceRows: rows,
    });

    const res = await service.attendance(ME, JWT, SCHOOL);

    expect(canAccessStudent).toHaveBeenCalledWith(ME, JWT, OWN_ID, SCHOOL);
    // Tenant-scoped + own id + bounded read.
    expect(attendanceFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: OWN_ID, tenantId: TENANT },
        take: 100,
      }),
    );
    expect(res.summary).toEqual({
      total: 3,
      present: 1,
      absent: 0,
      absentExcused: 1,
      late: 1,
      leftEarly: 0,
    });
    // RGPD: the mapped row carries ONLY the factual subset — never recordedBy /
    // justifiedBy / staff comment.
    expect(Object.keys(res.records[0]!).sort()).toEqual(
      ['classSectionName', 'date', 'id', 'justification', 'status', 'subjectColor', 'subjectName'].sort(),
    );
    expect(res.records[0]).toMatchObject({ status: 'present', subjectName: 'Maths' });
    // A null teaching assignment degrades subject/class to null, never throws.
    expect(res.records[2]).toMatchObject({ subjectName: null, classSectionName: null });
  });

  it('an UNLINKED caller → zero summary + empty records (no read, no 500)', async () => {
    const { service, attendanceFindMany } = makeService({ linked: false });

    const res = await service.attendance(ME, JWT, SCHOOL);

    expect(res).toEqual({
      summary: { total: 0, present: 0, absent: 0, absentExcused: 0, late: 0, leftEarly: 0 },
      records: [],
    });
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });

  it('defence-in-depth: a denied wall throws rather than leaking attendance', async () => {
    const { service, attendanceFindMany } = makeService({ linked: true, canAccess: false });

    await expect(service.attendance(ME, JWT, SCHOOL)).rejects.toBeInstanceOf(ForbiddenException);
    expect(attendanceFindMany).not.toHaveBeenCalled();
  });
});
