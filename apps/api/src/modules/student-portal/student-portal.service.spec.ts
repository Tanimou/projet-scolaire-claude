import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { StudentPortalService } from './student-portal.service';

const TENANT = 't1';
const SCHOOL = 'school-1';
const ME = { id: 'profile-1', tenantId: TENANT };
const OWN_ID = 'student-self-id';
const JWT = { sub: 'kc', realm_access: { roles: ['student'] } } as unknown as KeycloakJwtPayload;

/** S-E03-15 — l'année canonique que le résolveur rendra par défaut. */
const YEAR_ID = 'year-current';
const ACTIVE_YEAR = {
  id: YEAR_ID,
  schoolId: SCHOOL,
  name: '2025-2026',
  startDate: new Date('2025-09-01T00:00:00Z'),
  endDate: new Date('2026-07-05T00:00:00Z'),
  status: 'active',
};

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
  /**
   * S-E03-15 — les années que le résolveur canonique verra. Le DÉFAUT est UNE
   * année active, parce que c'est l'état de la seed et l'état nominal d'une
   * école ; un défaut vide aurait fait rendre `[]` à `subjectTrends` dans
   * chaque test existant, ce qui les aurait faits passer pour de mauvaises
   * raisons.
   */
  academicYears?: unknown[];
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
  const academicYearFindMany = jest.fn().mockResolvedValue(opts.academicYears ?? [ACTIVE_YEAR]);
  const prisma = {
    academicYear: { findMany: academicYearFindMany },
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

  /**
   * S-E01-1i — LE FAUX `TenantScopeService`, ET CE QU'IL PROUVE RÉELLEMENT.
   *
   * Il n'ouvre AUCUNE transaction et ne pose AUCUN GUC : ce spec n'a pas de base
   * et ne prétend pas en avoir une. Ce qu'il rend observable est la moitié que la
   * preuve exécutée (`scripts/tenant-scope-check.js`, base réelle) ne peut PAS
   * voir — l'ORDRE des appels et le TENANT passé à chaque ouverture :
   *
   *  - chaque instruction Prisma du producteur est atteinte à travers `run(...)`,
   *    parce que le client mock n'est accessible QUE par le callback ;
   *  - le tenant de chaque ouverture est enregistré, donc une portée ouverte sur
   *    autre chose que `me.tenantId` est visible plutôt que déduite ;
   *  - un `run` qui n'est jamais appelé laisse `scopeTenants` vide, ce qui fait
   *    échouer les assertions ci-dessous plutôt que de les rendre vacantes.
   */
  const scopeTenants: string[] = [];
  const scopeRun = jest.fn(
    async (tenantId: string, fn: (tx: unknown) => Promise<unknown>): Promise<unknown> => {
      scopeTenants.push(tenantId);
      return fn(prisma);
    },
  );
  const scope = { run: scopeRun };

  const service = new StudentPortalService(
    scope as never,
    studentAccess as never,
    analytics as never,
    remediation as never,
  );
  return {
    service,
    scopeRun,
    scopeTenants,
    academicYearFindMany,
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
      // `academicYearId` AJOUTÉ par S-E03-15 : cette assertion épinglait
      // jusqu'ici une lecture d'instantanés SANS année, qui rendait le dernier
      // instantané calculé quelle que soit son année.
      expect.objectContaining({
        where: {
          tenantId: TENANT,
          studentId: OWN_ID,
          academicYearId: YEAR_ID,
          termId: null,
        },
      }),
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

/**
 * S-E01-1i — G-TENANT : LA PORTÉE TENANT DU PORTAIL ÉLÈVE.
 *
 * Ce bloc est le pendant STATIQUE de la preuve exécutée. La preuve exécutée
 * (`scripts/tenant-scope-check.js` / `tenant-adversarial-check.js`, PostgreSQL
 * réel) montre que la base REFUSE le tenant étranger ; elle ne peut rien dire de
 * l'ORDRE dans lequel ce producteur appelle ses collaborateurs, parce que cet
 * ordre n'existe pas au niveau SQL.
 *
 * Or l'ordre est exactement ce que cette tranche pouvait casser :
 *
 *  - `canAccessStudent` / `parentUpcoming` / `remediationProgress` ferment sur
 *    LEUR PROPRE `PrismaService`. Appelés DEPUIS l'intérieur d'une portée, ils
 *    émettraient sur la connexion du propriétaire pendant qu'une transaction
 *    interactive est ouverte sur la connexion applicative — deux connexions pour
 *    une requête, et le compteur d'attribution ne le verrait pas.
 *  - une portée ouverte sur un tenant qui n'est pas `me.tenantId` rendrait
 *    `{data: []}` avec un 200, indiscernable d'un élève sans note.
 *
 * Les deux sont ici des assertions, pas des commentaires.
 */
describe('S-E01-1i — G-TENANT: every read of the student portal runs inside a tenant scope', () => {
  const READS: ReadonlyArray<{
    readonly name: string;
    readonly call: (s: StudentPortalService) => Promise<unknown>;
    /** Ouvertures de portée attendues : `resolveSelf` + celles du handler. */
    readonly scopes: number;
  }> = [
    { name: 'me', call: (s) => s.me(ME), scopes: 2 },
    { name: 'grades', call: (s) => s.grades(ME, JWT, SCHOOL), scopes: 2 },
    // `upcoming` délègue tout à `parentUpcoming`, qui n'est PAS converti : sa
    // seule portée est `resolveSelf`. Un 1 attendu ici, écrit exprès, pour que
    // personne ne lise ce compte comme un oubli de conversion.
    { name: 'upcoming', call: (s) => s.upcoming(ME, JWT, SCHOOL), scopes: 1 },
    { name: 'attendance', call: (s) => s.attendance(ME, JWT, SCHOOL), scopes: 2 },
    { name: 'announcements', call: (s) => s.announcements(ME, JWT, SCHOOL), scopes: 2 },
    // dashboard : resolveSelf + en-tête + `subjectTrends` (snapshot, puis la
    // retombée live sur les notes quand aucun snapshot n'existe) = 4.
    { name: 'dashboard', call: (s) => s.dashboard(ME, JWT, SCHOOL), scopes: 4 },
  ];

  it.each(READS)(
    '$name opens every scope on me.tenantId, and on nothing else',
    async ({ call, scopes }) => {
      const { service, scopeRun, scopeTenants } = makeService({ linked: true });

      await call(service);

      expect(scopeRun).toHaveBeenCalledTimes(scopes);
      // SET-shaped, pas « le premier argument du premier appel » : une seule
      // ouverture divergente parmi quatre resterait invisible autrement.
      expect([...new Set(scopeTenants)]).toEqual([TENANT]);
    },
  );

  it('the ABAC wall runs OUTSIDE any scope — no owner connection is held open inside one', async () => {
    const { service, scopeRun, canAccessStudent } = makeService({ linked: true });

    // `resolveSelf` ouvre la portée 1 et la REFERME ; le mur est appelé ensuite,
    // hors de toute portée ; la lecture ouvre la portée 2. On mesure donc que le
    // mur tombe ENTRE la première et la seconde ouverture.
    //
    // L'implémentation d'origine est CONSERVÉE et enveloppée : la remplacer
    // priverait le callback de son client et ferait échouer `resolveSelf`, ce qui
    // rendrait cette assertion verte pour la mauvaise raison (une seule portée,
    // parce que la première a levé).
    const order: string[] = [];
    const inner = scopeRun.getMockImplementation();
    scopeRun.mockImplementation(async (tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
      order.push('scope');
      return inner!(tenantId, fn);
    });
    canAccessStudent.mockImplementation(async () => {
      order.push('wall');
      return true;
    });

    await service.grades(ME, JWT, SCHOOL);

    // Le mur n'est ni premier ni dernier : il est ENCADRÉ par deux portées
    // distinctes, ce qui est la forme « portée tardive, fermeture précoce ».
    expect(order).toEqual(['scope', 'wall', 'scope']);
  });

  it('parentUpcoming and remediationProgress are never called from inside a scope', async () => {
    const { service, parentUpcoming, remediationProgress, scopeRun } = makeService({
      linked: true,
    });

    // Une portée « ouverte » est comptée à l'entrée et décomptée à la sortie ; si
    // un producteur non converti était appelé pendant qu'elle est ouverte, la
    // profondeur relevée à cet instant serait > 0.
    let depth = 0;
    const depthAtCall: number[] = [];
    const inner = scopeRun.getMockImplementation();
    scopeRun.mockImplementation(async (tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
      depth += 1;
      try {
        return await inner!(tenantId, fn);
      } finally {
        depth -= 1;
      }
    });
    parentUpcoming.mockImplementation(async () => {
      depthAtCall.push(depth);
      return { classSectionName: null, gradeLevelName: null, data: [] };
    });
    remediationProgress.mockImplementation(async () => {
      depthAtCall.push(depth);
      return [];
    });

    await service.upcoming(ME, JWT, SCHOOL);
    await service.dashboard(ME, JWT, SCHOOL);

    // Trois appels au total (upcoming ×1, dashboard ×2), tous à profondeur 0.
    expect(depthAtCall.length).toBeGreaterThan(0);
    expect(depthAtCall.every((d) => d === 0)).toBe(true);
  });

  it('there is NO un-scoped fallback: when the scope refuses, every read fails rather than degrading', async () => {
    // La preuve qu'aucun chemin ne contourne la portée : si `run` refuse, aucune
    // lecture ne peut plus aboutir. Un producteur qui garderait un client
    // propriétaire pour un seul chemin rendrait ici une réponse au lieu de lever
    // — et c'est précisément ce qui rendait `36 sites convertis` compatible avec
    // `tout tourne sur le propriétaire` avant S-E01-1h.
    const { service, scopeRun } = makeService({ linked: true });
    scopeRun.mockRejectedValue(new Error('scope refused'));

    await expect(service.me(ME)).rejects.toThrow('scope refused');
    await expect(service.grades(ME, JWT, SCHOOL)).rejects.toThrow('scope refused');
    await expect(service.attendance(ME, JWT, SCHOOL)).rejects.toThrow('scope refused');
    await expect(service.announcements(ME, JWT, SCHOOL)).rejects.toThrow('scope refused');
    await expect(service.upcoming(ME, JWT, SCHOOL)).rejects.toThrow('scope refused');
    await expect(service.markAnnouncementRead(ME, JWT, SCHOOL, 'ann-1')).rejects.toThrow(
      'scope refused',
    );
  });
});
