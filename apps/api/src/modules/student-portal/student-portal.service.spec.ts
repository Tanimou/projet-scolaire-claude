import { ForbiddenException, NotFoundException } from '@nestjs/common';

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
  receiptRows?: unknown[];
  receiptFindUnique?: unknown;
  snapshotRows?: unknown[];
  subjectRows?: unknown[];
  gradeRows?: unknown[];
  enrollment?: unknown;
  remediationRows?: unknown[];
  remediationThrows?: boolean;
  upcomingThrows?: boolean;
}) {
  const studentFindFirst = jest
    .fn()
    .mockResolvedValue(opts.linked ? { id: OWN_ID, firstName: 'Lina', lastName: 'M.' } : null);
  const attendanceFindMany = jest.fn().mockResolvedValue(opts.attendanceRows ?? []);
  const receiptFindMany = jest.fn().mockResolvedValue(opts.receiptRows ?? []);
  const receiptFindUnique = jest.fn().mockResolvedValue(opts.receiptFindUnique ?? null);
  const receiptUpdate = jest.fn().mockResolvedValue({});
  const snapshotFindMany = jest.fn().mockResolvedValue(opts.snapshotRows ?? []);
  const subjectFindMany = jest.fn().mockResolvedValue(opts.subjectRows ?? []);
  const gradeFindMany = jest.fn().mockResolvedValue(opts.gradeRows ?? []);
  const enrollmentFindFirst = jest.fn().mockResolvedValue(opts.enrollment ?? null);
  const prisma = {
    student: { findFirst: studentFindFirst },
    attendanceRecord: { findMany: attendanceFindMany },
    announcementReceipt: {
      findMany: receiptFindMany,
      findUnique: receiptFindUnique,
      update: receiptUpdate,
    },
    studentSubjectSnapshot: { findMany: snapshotFindMany },
    subject: { findMany: subjectFindMany },
    grade: { findMany: gradeFindMany },
    enrollment: { findFirst: enrollmentFindFirst },
  };
  const canAccessStudent = jest.fn().mockResolvedValue(opts.canAccess ?? true);
  const studentAccess = { canAccessStudent };
  const parentUpcoming = opts.upcomingThrows
    ? jest.fn().mockRejectedValue(new Error('upcoming boom'))
    : jest
        .fn()
        .mockResolvedValue(
          opts.upcoming ?? { classSectionName: null, gradeLevelName: null, data: [] },
        );
  const analytics = { parentUpcoming };
  const remediationProgress = opts.remediationThrows
    ? jest.fn().mockRejectedValue(new Error('remediation boom'))
    : jest.fn().mockResolvedValue(opts.remediationRows ?? []);
  const remediation = { remediationProgress };

  const service = new StudentPortalService(
    prisma as never,
    studentAccess as never,
    analytics as never,
    remediation as never,
  );
  return {
    service,
    studentFindFirst,
    attendanceFindMany,
    receiptFindMany,
    receiptFindUnique,
    receiptUpdate,
    snapshotFindMany,
    subjectFindMany,
    gradeFindMany,
    canAccessStudent,
    parentUpcoming,
    remediationProgress,
  };
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

/**
 * E8-S3 — "Les annonces": the receipt-scoped read + the ONE student mutation
 * (self-scoped mark-read). Pins the no-leak narrowing (no roster/stats/email), the
 * receipt-keyed self scope (no IDOR), and the idempotent / 404-on-no-receipt rules.
 */
describe('StudentPortalService.announcements — receipt-scoped, narrowed', () => {
  it('returns the caller-own receipts narrowed (no roster/stats/email), self-scoped on me.id', async () => {
    const rows = [
      {
        readAt: null,
        announcement: {
          id: 'ann-1',
          title: 'Sortie scolaire',
          body: 'Rendez-vous lundi.',
          scope: 'class_section_scope',
          priority: 'high',
          pinned: true,
          publishedAt: new Date('2026-06-01T08:00:00.000Z'),
          authorRoleHint: 'teacher',
          cycle: null,
          gradeLevel: null,
          classSection: { name: '4e B' },
        },
      },
    ];
    const { service, receiptFindMany, canAccessStudent } = makeService({
      linked: true,
      receiptRows: rows,
    });

    const res = await service.announcements(ME, JWT, SCHOOL);

    expect(canAccessStudent).toHaveBeenCalledWith(ME, JWT, OWN_ID, SCHOOL);
    // Self-scoped on me.id (the receipt owner), tenant-scoped on the announcement.
    expect(receiptFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userProfileId: ME.id }),
      }),
    );
    expect(res.data).toHaveLength(1);
    // The narrowed row carries NO recipient roster / read-stats / author email.
    expect(Object.keys(res.data[0]!).sort()).toEqual(
      [
        'audienceLabel',
        'authorRoleHint',
        'body',
        'id',
        'pinned',
        'priority',
        'publishedAt',
        'readAt',
        'scope',
        'title',
      ].sort(),
    );
    expect(res.data[0]).toMatchObject({ audienceLabel: '4e B', readAt: null, pinned: true });
  });

  it('an UNLINKED caller → { data: [] }, no receipt read (never a leak)', async () => {
    const { service, receiptFindMany } = makeService({ linked: false });

    const res = await service.announcements(ME, JWT, SCHOOL);

    expect(res).toEqual({ data: [] });
    expect(receiptFindMany).not.toHaveBeenCalled();
  });
});

describe('StudentPortalService.markAnnouncementRead — the one self-scoped mutation', () => {
  it('flips the caller-own receipt readAt (keyed on announcementId + me.id)', async () => {
    const { service, receiptFindUnique, receiptUpdate } = makeService({
      linked: true,
      receiptFindUnique: { id: 'rcpt-1', readAt: null },
    });

    const res = await service.markAnnouncementRead(ME, JWT, SCHOOL, 'ann-1');

    expect(receiptFindUnique).toHaveBeenCalledWith({
      where: { announcementId_userProfileId: { announcementId: 'ann-1', userProfileId: ME.id } },
    });
    expect(receiptUpdate).toHaveBeenCalledTimes(1);
    expect(res).toEqual({ ok: true });
  });

  it('is idempotent — an already-read receipt is a no-op 200, no update', async () => {
    const { service, receiptUpdate } = makeService({
      linked: true,
      receiptFindUnique: { id: 'rcpt-1', readAt: new Date() },
    });

    const res = await service.markAnnouncementRead(ME, JWT, SCHOOL, 'ann-1');

    expect(res).toEqual({ ok: true, alreadyRead: true });
    expect(receiptUpdate).not.toHaveBeenCalled();
  });

  it('404s when the caller has no receipt (never reveals existence, never touches a peer)', async () => {
    const { service } = makeService({ linked: true, receiptFindUnique: null });

    await expect(service.markAnnouncementRead(ME, JWT, SCHOOL, 'ann-1')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

/**
 * E8-S3 — "Mon objectif": the composed, best-effort, PEER-FREE dashboard.
 */
describe('StudentPortalService.dashboard — composed, best-effort, peer-free', () => {
  const SNAP = [{ subjectId: 'subj-1', average: 14.5, trendDelta: 2.0 }];
  const SUBJECTS = [{ id: 'subj-1', name: 'Maths', color: '#abc' }];
  const UPCOMING = {
    classSectionName: '4e B',
    gradeLevelName: '4e',
    data: Array.from({ length: 5 }).map((_, i) => ({
      id: `a${i}`,
      title: `Eval ${i}`,
      description: null,
      scheduledAt: '2026-06-20T08:00:00.000Z',
      kind: 'written_test',
      maxScore: 20,
      coefficient: 1,
      subjectId: 'subj-1',
      subjectCode: 'MATH',
      subjectName: 'Maths',
      subjectColor: '#abc',
      classSectionName: '4e B',
      termId: 't1',
      termName: 'T3',
    })),
  };
  const REMEDIATION = [
    {
      planId: 'plan-1',
      subjectId: 'subj-1',
      subjectCode: 'MATH',
      subjectName: 'Maths',
      objective: 'consolider',
      baselineAvg: 11,
      currentAvg: 14,
      trendDelta: 3,
      improved: true,
      sessionsPlanned: 2,
      sessionsDone: 1,
      nextSessionAt: '2026-06-25T15:00:00.000Z',
      createdAt: '2026-06-01T08:00:00.000Z',
    },
  ];

  it('composes the snapshot trend + next-3 upcoming + remediation; STRUCTURALLY lacks every peer field', async () => {
    const { service, snapshotFindMany } = makeService({
      linked: true,
      snapshotRows: SNAP,
      subjectRows: SUBJECTS,
      upcoming: UPCOMING,
      remediationRows: REMEDIATION,
      enrollment: { classSection: { name: '4e B' } },
    });

    const res = await service.dashboard(ME, JWT, SCHOOL);

    expect(snapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tenantId: TENANT, studentId: OWN_ID, termId: null } }),
    );
    expect(res.firstName).toBe('Lina');
    expect(res.classSectionName).toBe('4e B');
    // Trend: snapshot delta +2.0 ≥ 1.5 → "up"; own average only, no peer figure.
    expect(res.subjects).toEqual([
      { subjectId: 'subj-1', subjectName: 'Maths', subjectColor: '#abc', studentAverage: 14.5, trend: 'up' },
    ]);
    // Upcoming bounded to the next 3, narrowed (no per-row classSectionName).
    expect(res.upcoming).toHaveLength(3);
    expect(res.upcoming[0]).not.toHaveProperty('classSectionName');
    expect(res.remediation).toHaveLength(1);

    // The peer-comparison wall is in the PAYLOAD SHAPE — assert no peer key leaks
    // anywhere in the serialized dashboard (subjects + the whole envelope).
    const serialized = JSON.stringify(res);
    expect(serialized).not.toMatch(/rank|classAverage|classSize|classRankTotal|classOverall|medicalNotes/i);
  });

  it('best-effort: a remediation throw degrades that block to [], the dashboard still returns', async () => {
    const { service } = makeService({
      linked: true,
      snapshotRows: SNAP,
      subjectRows: SUBJECTS,
      upcoming: UPCOMING,
      remediationThrows: true,
      enrollment: { classSection: { name: '4e B' } },
    });

    const res = await service.dashboard(ME, JWT, SCHOOL);

    expect(res.subjects).toHaveLength(1);
    expect(res.upcoming).toHaveLength(3);
    expect(res.remediation).toEqual([]);
  });

  it('best-effort: an upcoming throw degrades only that block, never errors', async () => {
    const { service } = makeService({
      linked: true,
      snapshotRows: SNAP,
      subjectRows: SUBJECTS,
      upcomingThrows: true,
      remediationRows: REMEDIATION,
    });

    const res = await service.dashboard(ME, JWT, SCHOOL);

    expect(res.upcoming).toEqual([]);
    expect(res.subjects).toHaveLength(1);
    expect(res.remediation).toHaveLength(1);
  });

  it('snapshot miss → single grade-based fall-through (no class scan, trend "unknown")', async () => {
    const { service, snapshotFindMany, gradeFindMany } = makeService({
      linked: true,
      snapshotRows: [],
      gradeRows: [
        {
          value: 16,
          assessment: {
            maxScore: 20,
            teachingAssignment: { subject: { id: 'subj-1', name: 'Maths', color: '#abc' } },
          },
        },
        {
          value: 12,
          assessment: {
            maxScore: 20,
            teachingAssignment: { subject: { id: 'subj-1', name: 'Maths', color: '#abc' } },
          },
        },
      ],
    });

    const res = await service.dashboard(ME, JWT, SCHOOL);

    expect(snapshotFindMany).toHaveBeenCalledTimes(1);
    expect(gradeFindMany).toHaveBeenCalledTimes(1);
    expect(res.subjects).toEqual([
      { subjectId: 'subj-1', subjectName: 'Maths', subjectColor: '#abc', studentAverage: 14, trend: 'unknown' },
    ]);
  });

  it('an UNLINKED caller → kind empty dashboard (no 500, no peer)', async () => {
    const { service, parentUpcoming, remediationProgress } = makeService({ linked: false });

    const res = await service.dashboard(ME, JWT, SCHOOL);

    expect(res).toEqual({
      firstName: '',
      classSectionName: null,
      subjects: [],
      upcoming: [],
      remediation: [],
    });
    expect(parentUpcoming).not.toHaveBeenCalled();
    expect(remediationProgress).not.toHaveBeenCalled();
  });

  it('defence-in-depth: a denied wall throws rather than leaking the dashboard', async () => {
    const { service, snapshotFindMany } = makeService({ linked: true, canAccess: false });

    await expect(service.dashboard(ME, JWT, SCHOOL)).rejects.toBeInstanceOf(ForbiddenException);
    expect(snapshotFindMany).not.toHaveBeenCalled();
  });
});
