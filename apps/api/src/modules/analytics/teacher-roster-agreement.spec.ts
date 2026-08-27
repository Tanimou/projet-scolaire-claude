import { AnalyticsService } from './analytics.service';
import { AssessmentsController } from '../grades/assessments.controller';
import { TeachersController } from '../teaching/teachers.controller';

/**
 * S-E03-7 / PF-36 / ADR-079 — LE ROUGE-AVANT / VERT-APRÈS de la tranche.
 *
 * FICHIER NEUF. Aucune spec existante n'est modifiée pour obtenir le rouge :
 * une spec qu'on retouche pour la faire rougir ne prouve rien sur le produit.
 *
 * CE QU'IL MESURE, EN UNE PHRASE
 * -------------------------------
 * L'audit interne dit : « 48 élèves dans un contexte, 46 en cumul dans un autre,
 * 43 distincts dans un troisième, et une classe qui alterne entre 25 et 26 ».
 * Cette suite construit la fixture MINIMALE qui produit les trois écarts à la
 * fois et exige qu'ils disparaissent.
 *
 * LA FIXTURE, ET POURQUOI CHACUNE DE SES PIÈCES EST LÀ
 * -----------------------------------------------------
 *   • enseignant T, année Y, sections A et B ;
 *   • TROIS affectations dont DEUX sur A (physique ET chimie) — c'est le cas
 *     EXACT de l'audit, et c'est ce qui faisait compter A DEUX FOIS dans la
 *     somme cumulative du tableau de bord ;
 *   • s1..s24 `active` en A → effectif A = 24 ;
 *   • s24 AUSSI `active` en B, la MÊME année. C'EST LÉGAL :
 *     `@@unique([studentId, classSectionId, academicYearId])` l'autorise
 *     explicitement, et l'index partiel qui l'interdirait n'existe pas en base
 *     (PF-361, mesuré). Ce n'est donc PAS une donnée corrompue : c'est le schéma
 *     tel qu'il est livré, et c'est ce qui rend la somme fausse ;
 *   • s25..s30 `active` en B → effectif B = 7 (s24 + six) ;
 *   • s31 `dropped` en A → l'effectif « six statuts » de A vaut 25, l'effectif
 *     honnête vaut 24. C'est le « 25 / 26 » de l'audit.
 *
 * ATTENDU : effectif A = 24, effectif B = 7, élèves DISTINCTS = 30.
 * SOMME des effectifs = 24 + 24 + 7 = 55 (trois affectations) ou 31 (deux
 * sections) — dans les DEUX cas ≠ 30. La troisième assertion le NOMME, pour que
 * l'accord ne puisse jamais être obtenu en re-sommant autrement.
 *
 * ⚠ ATTENDU ROUGE SUR L'ARBRE D'AVANT LA CONVERSION
 * --------------------------------------------------
 *   • `teacherDashboard` rendait `24 + 24 + 7 = 55` (`stat.studentCount +=`,
 *     `analytics.service.ts:1821`) là où `/teachers/:id/load` rendait 30 ;
 *   • le dénominateur de `/teacher/assessments` rendait 25 pour A
 *     (`assessments.controller.ts:123`, `_count` NON FILTRÉ).
 * Si cette suite PASSAIT avant le changement, la prémisse de la story serait
 * fausse : il faudrait S'ARRÊTER, ne rien convertir et rapporter la mesure.
 *
 * AUCUNE AFFIRMATION LIVE ICI
 * ---------------------------
 * Docker est à l'arrêt ce run et `enrollment` porte 0 ligne sur 5432 : la preuve
 * EST cette fixture, et elle est nommée comme telle. Les seuls faits de base
 * revendiqués par la tranche sont des faits de SCHÉMA (`pg_indexes`,
 * `pg_constraint`), cités dans le docblock du module.
 */

const TENANT = 't-1';
const SCHOOL = 'sch-1';
const YEAR = 'ay-Y';
const TEACHER = 'tp-T';
const SECTION_A = 'cs-A';
const SECTION_B = 'cs-B';
const SUBJECT_PHYS = 'sub-phys';
const SUBJECT_CHIM = 'sub-chim';

type EnrolRow = {
  studentId: string;
  classSectionId: string;
  academicYearId: string;
  status: string;
};

/** LA table d'inscriptions. UNE source pour toutes les surfaces jugées. */
const ENROLMENTS: EnrolRow[] = [
  // s1..s24 assis en A.
  ...Array.from({ length: 24 }, (_, i) => ({
    studentId: `s${i + 1}`,
    classSectionId: SECTION_A,
    academicYearId: YEAR,
    status: 'active',
  })),
  // s24 AUSSI assis en B, la MÊME année — légal (PF-361), et c'est le pivot.
  { studentId: 's24', classSectionId: SECTION_B, academicYearId: YEAR, status: 'active' },
  // s25..s30 assis en B.
  ...Array.from({ length: 6 }, (_, i) => ({
    studentId: `s${i + 25}`,
    classSectionId: SECTION_B,
    academicYearId: YEAR,
    status: 'active',
  })),
  // s31 SORTI de A : présent dans les six statuts, absent des assis.
  { studentId: 's31', classSectionId: SECTION_A, academicYearId: YEAR, status: 'dropped' },
];

/** LES NOMBRES ATTENDUS — dérivés de la fixture, jamais écrits deux fois. */
const EXPECTED = {
  rosterA: 24,
  rosterB: 7,
  distinctStudents: 30,
  /** L'effectif « six statuts » de A : le 25 que l'audit voyait alterner. */
  everRegisteredA: 25,
} as const;

/* ================================================================== *
 * LE FAUX PRISMA — il APPLIQUE le `where`, il ne le suppose pas
 * ================================================================== */

/**
 * ⚠ Ce faux LIT réellement le `where` qu'on lui passe et filtre la table.
 * Un mock qui rendrait une constante quel que soit l'argument « prouverait »
 * l'accord sans avoir rien exercé — le faux-vert que le run 81 a déjà mesuré
 * (`feedback_landed_is_not_ran`). C'est le filtrage ici qui rend la conversion
 * observable : un `_count` NON FILTRÉ rend 25, un `_count` « assis » rend 24.
 */
function matches(row: EnrolRow, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  const status = where.status as undefined | string | { in?: readonly string[] };
  if (typeof status === 'string' && row.status !== status) return false;
  if (status && typeof status === 'object' && Array.isArray(status.in)) {
    if (!status.in.includes(row.status)) return false;
  }
  const year = where.academicYearId as string | undefined;
  if (year !== undefined && row.academicYearId !== year) return false;
  const section = where.classSectionId as undefined | string | { in?: readonly string[] };
  if (typeof section === 'string' && row.classSectionId !== section) return false;
  if (section && typeof section === 'object' && Array.isArray(section.in)) {
    if (!section.in.includes(row.classSectionId)) return false;
  }
  return true;
}

const countFor = (sectionId: string, arg: unknown): number => {
  // `enrollments: true` (VARIANTE A) ⇒ AUCUN filtre : les six statuts.
  const where =
    arg === true || arg === undefined
      ? undefined
      : ((arg as { where?: Record<string, unknown> }).where ?? undefined);
  return ENROLMENTS.filter((r) => r.classSectionId === sectionId && matches(r, where)).length;
};

const SECTION_NAMES: Record<string, string> = { [SECTION_A]: '6eA', [SECTION_B]: '6eB' };

/** Les TROIS affectations : DEUX sur A (physique + chimie), UNE sur B. */
const ASSIGNMENT_SHAPE = [
  { id: 'ta-1', classSectionId: SECTION_A, subjectId: SUBJECT_PHYS, code: 'PHYS', name: 'Physique' },
  { id: 'ta-2', classSectionId: SECTION_A, subjectId: SUBJECT_CHIM, code: 'CHIM', name: 'Chimie' },
  { id: 'ta-3', classSectionId: SECTION_B, subjectId: SUBJECT_PHYS, code: 'PHYS', name: 'Physique' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildPrisma(): any {
  const sectionSelectOf = (args: any) =>
    args?.include?.classSection?.select ??
    args?.include?.classSection?.include ??
    args?.select?.classSection?.select ??
    undefined;

  return {
    teachingAssignment: {
      findMany: jest.fn().mockImplementation((args: any = {}) => {
        const sel = sectionSelectOf(args);
        const countArg = sel?._count?.select?.enrollments;
        return Promise.resolve(
          ASSIGNMENT_SHAPE.map((a) => ({
            id: a.id,
            classSectionId: a.classSectionId,
            subjectId: a.subjectId,
            weeklyHours: null,
            isMainTeacher: false,
            subject: { id: a.subjectId, code: a.code, name: a.name, color: null },
            classSection: {
              id: a.classSectionId,
              name: SECTION_NAMES[a.classSectionId],
              gradeLevel: { name: '6e' },
              ...(countArg === undefined
                ? {}
                : { _count: { enrollments: countFor(a.classSectionId, countArg) } }),
            },
          })),
        );
      }),
    },
    enrollment: {
      findMany: jest.fn().mockImplementation((args: any = {}) =>
        Promise.resolve(
          ENROLMENTS.filter((r) => matches(r, args.where)).map((r) => ({
            studentId: r.studentId,
            classSectionId: r.classSectionId,
          })),
        ),
      ),
      count: jest.fn().mockImplementation((args: any = {}) =>
        Promise.resolve(ENROLMENTS.filter((r) => matches(r, args.where)).length),
      ),
    },
    teacherProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: TEACHER, tenantId: TENANT, userProfileId: 'up-T' }),
    },
    userProfile: { findUnique: jest.fn().mockResolvedValue({ id: 'up-T' }) },
    assessment: {
      findMany: jest.fn().mockImplementation((args: any = {}) => {
        const countArg =
          args?.include?.teachingAssignment?.include?.classSection?.select?._count?.select
            ?.enrollments;
        if (countArg === undefined) return Promise.resolve([]);
        // Un devoir par affectation — la surface `/teacher/assessments`.
        return Promise.resolve(
          ASSIGNMENT_SHAPE.map((a, i) => ({
            id: `as-${i}`,
            title: `Devoir ${i}`,
            scheduledAt: null,
            createdAt: new Date(Date.UTC(2026, 0, 1)),
            teachingAssignment: {
              classSection: {
                id: a.classSectionId,
                name: SECTION_NAMES[a.classSectionId],
                gradeLevel: { name: '6e' },
                _count: { enrollments: countFor(a.classSectionId, countArg) },
              },
              subject: { id: a.subjectId, name: a.name, color: null, code: a.code },
            },
            teacherProfile: { userProfile: { firstName: 'T', lastName: 'T', photoUrl: null } },
            term: null,
            _count: { grades: 0 },
          })),
        );
      }),
    },
    auditLog: { findMany: jest.fn().mockResolvedValue([]) },
    meetingRequest: { count: jest.fn().mockResolvedValue(0) },
  };
}

const JWT = { sub: 'u-T' } as never;
const usersStub = { ensureUser: jest.fn().mockResolvedValue({ id: 'u-T', tenantId: TENANT }) };
const ctxStub = {
  forUser: jest.fn().mockResolvedValue({ schoolId: SCHOOL, activeAcademicYearId: YEAR }),
  forTenant: jest.fn().mockResolvedValue({ schoolId: SCHOOL, activeAcademicYearId: YEAR }),
};
const teachersStub = { ensureForUser: jest.fn().mockResolvedValue({ id: TEACHER }) };

/* ================================================================== *
 * LA FIXTURE EST BIEN CE QU'ELLE PRÉTEND ÊTRE
 * ================================================================== */

describe('la fixture reproduit les TROIS écarts de l’audit', () => {
  it('effectif A = 24 assis, mais 25 si l’on compte les SIX statuts', () => {
    expect(countFor(SECTION_A, { where: { status: { in: ['active'] } } })).toBe(EXPECTED.rosterA);
    // `true` = la VARIANTE A. C'est ce 25 que le portail enseignant affichait.
    expect(countFor(SECTION_A, true)).toBe(EXPECTED.everRegisteredA);
  });

  it('effectif B = 7 assis, s24 y étant AUSSI inscrit la MÊME année (légal, PF-361)', () => {
    expect(countFor(SECTION_B, { where: { status: { in: ['active'] } } })).toBe(EXPECTED.rosterB);
    const s24 = ENROLMENTS.filter((r) => r.studentId === 's24' && r.status === 'active');
    expect(s24.map((r) => r.classSectionId).sort()).toEqual([SECTION_A, SECTION_B]);
  });

  it('30 élèves DISTINCTS existent réellement', () => {
    const heads = new Set(ENROLMENTS.filter((r) => r.status === 'active').map((r) => r.studentId));
    expect(heads.size).toBe(EXPECTED.distinctStudents);
  });
});

/* ================================================================== *
 * ASSERTION 1 — les deux surfaces rendent le MÊME 30
 * ================================================================== */

describe('AC-4 assertion 1 — `teacherDashboard` et `GET /teachers/:id/load` s’accordent', () => {
  it('les deux rendent 30, et non 55 d’un côté et 30 de l’autre', async () => {
    const prisma = buildPrisma();
    const analytics = new AnalyticsService(prisma as never, {} as never, {} as never);
    const teachers = new TeachersController(
      prisma as never,
      usersStub as never,
      ctxStub as never,
      teachersStub as never,
    );

    const dashboard = await analytics.teacherDashboard({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
      academicYearId: YEAR,
    });
    const load = await teachers.getLoad(TEACHER, JWT);

    // ⚠ AVANT LA CONVERSION : la carte matière PHYS valait 24 + 7 = 31 et CHIM
    // valait 24 — la classe A comptée DEUX FOIS parce qu'elle porte DEUX
    // affectations. `/load` valait 30. C'est l'écart 46-vs-43 de l'audit.
    const phys = dashboard.subjectStats.find((s) => s.subjectId === SUBJECT_PHYS);
    const chim = dashboard.subjectStats.find((s) => s.subjectId === SUBJECT_CHIM);
    expect(phys).toBeDefined();
    expect(chim).toBeDefined();

    // PHYS couvre A et B ⇒ 30 élèves distincts (s24 compté UNE fois).
    expect(phys!.distinctStudentCount).toBe(EXPECTED.distinctStudents);
    // CHIM ne couvre que A ⇒ 24.
    expect(chim!.distinctStudentCount).toBe(EXPECTED.rosterA);

    // LA question de l'audit : les deux surfaces disent-elles la même chose ?
    expect(load.uniqueStudents).toBe(EXPECTED.distinctStudents);
    expect(phys!.distinctStudentCount).toBe(load.uniqueStudents);
  });

  it('`classCount` reste le nombre d’AFFECTATIONS — la correction ne l’a pas emporté', () => {
    // Contrôle NÉGATIF de la conversion : on a changé le nombre d'ÉLÈVES, pas le
    // nombre de classes. Sans lui, « tout mettre à 30 » passerait le test ci-dessus.
    expect(ASSIGNMENT_SHAPE.filter((a) => a.subjectId === SUBJECT_PHYS)).toHaveLength(2);
  });
});

/* ================================================================== *
 * ASSERTION 2 — l'effectif de A vaut 24 partout, jamais 25
 * ================================================================== */

describe('AC-4 assertion 2 — l’effectif de A vaut 24 sur toutes les surfaces, jamais 25', () => {
  it('`/teacher/assessments` (le dénominateur de « Saisie X % ») rend 24', async () => {
    const prisma = buildPrisma();
    const assessments = new AssessmentsController(
      prisma as never,
      usersStub as never,
      teachersStub as never,
      {} as never,
    );
    const out = (await assessments.list(JWT, undefined, undefined, undefined, 'true')) as {
      data: Array<{ teachingAssignment: { classSection: { id: string; _count: { enrollments: number } } } }>;
    };
    const forA = out.data.filter((d) => d.teachingAssignment.classSection.id === SECTION_A);
    expect(forA.length).toBeGreaterThan(0);
    for (const row of forA) {
      // ⚠ AVANT : 25 — le `_count` NON FILTRÉ comptait s31, `dropped`. Un
      // enseignant ne pouvait donc JAMAIS atteindre « saisie complète ».
      expect(row.teachingAssignment.classSection._count.enrollments).toBe(EXPECTED.rosterA);
    }
  });

  it('le tableau de bord enseignant ne rend jamais 25 pour A non plus', async () => {
    const prisma = buildPrisma();
    const analytics = new AnalyticsService(prisma as never, {} as never, {} as never);
    const dashboard = await analytics.teacherDashboard({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
      academicYearId: YEAR,
    });
    for (const stat of dashboard.subjectStats) {
      expect(stat.distinctStudentCount).not.toBe(EXPECTED.everRegisteredA);
    }
  });
});

/* ================================================================== *
 * ASSERTION 3 — l'accord ne peut PAS être obtenu en re-sommant
 * ================================================================== */

describe('AC-4 assertion 3 — la SOMME des effectifs DIFFÈRE du nombre d’élèves, et c’est dit', () => {
  it('24 + 7 = 31 places pour 30 têtes : sommer ne répondra jamais à la question', () => {
    const sumOverSections = EXPECTED.rosterA + EXPECTED.rosterB;
    expect(sumOverSections).toBe(31);
    expect(sumOverSections).not.toBe(EXPECTED.distinctStudents);

    // Et sur les AFFECTATIONS — la forme exacte de l'ancien `+=` — l'écart est
    // encore plus large : A est comptée deux fois parce qu'elle porte deux
    // matières. 24 + 24 + 7 = 55.
    const sumOverAssignments = ASSIGNMENT_SHAPE.reduce(
      (s, a) => s + (a.classSectionId === SECTION_A ? EXPECTED.rosterA : EXPECTED.rosterB),
      0,
    );
    expect(sumOverAssignments).toBe(55);
    expect(sumOverAssignments).not.toBe(EXPECTED.distinctStudents);
  });

  it('l’écart vient d’UN élève réel, pas d’un artefact de fixture', () => {
    // 31 − 30 = 1 : c'est s24, et il est identifiable. Un écart qu'on ne sait
    // pas attribuer à une ligne n'est pas une preuve, c'est une coïncidence.
    const shared = ENROLMENTS.filter((r) => r.status === 'active')
      .reduce((m, r) => m.set(r.studentId, (m.get(r.studentId) ?? 0) + 1), new Map<string, number>());
    const doubled = [...shared.entries()].filter(([, n]) => n > 1).map(([id]) => id);
    expect(doubled).toEqual(['s24']);
  });
});

/* ================================================================== *
 * LA LECTURE EST BIEN UNE LECTURE — contrôle anti-N+1 et anti-mock-mou
 * ================================================================== */

describe('la dé-duplication est LUE, jamais devinée', () => {
  it('UNE seule requête d’inscriptions couvre toutes les sections (jamais une par matière)', async () => {
    const prisma = buildPrisma();
    const analytics = new AnalyticsService(prisma as never, {} as never, {} as never);
    await analytics.teacherDashboard({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
      academicYearId: YEAR,
    });
    expect(prisma.enrollment.findMany).toHaveBeenCalledTimes(1);
    const where = prisma.enrollment.findMany.mock.calls[0][0].where;
    // FR-7 / AC-8 — `tenantId` est dans le `where`, pas seulement « impliqué ».
    expect(where.tenantId).toBe(TENANT);
    expect(where.classSectionId.in.sort()).toEqual([SECTION_A, SECTION_B]);
  });

  it('le faux Prisma FILTRE réellement — sinon toute cette suite serait vacante', () => {
    // Contrôle de l'INSTRUMENT. Si `matches()` ignorait le `where`, le `_count`
    // « assis » et le `_count` non filtré rendraient le même nombre et les
    // assertions ci-dessus passeraient sans rien avoir exercé.
    expect(countFor(SECTION_A, true)).not.toBe(
      countFor(SECTION_A, { where: { status: { in: ['active'] } } }),
    );
  });
});
