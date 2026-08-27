import { AnalyticsService } from './analytics.service';

/**
 * S-E03-7 / PF-36 / ADR-079 — AC-7 #6 : « % d'élèves actifs » ne peut plus
 * dépasser cent.
 *
 * POURQUOI CE FICHIER EXISTE
 * --------------------------
 * `studentsAggregate` porte le SEUL nombre que cette tranche change et que
 * RIEN n'observait : `grep -rn "activePct" apps/api/src --include=*.spec.ts`
 * rendait ZÉRO ligne avant ce fichier. Le docblock d'`analytics.service.ts`
 * (~3547) fait pourtant une affirmation FALSIFIABLE — « il ne peut plus
 * dépasser 100 % » — et une affirmation non observée n'est pas une preuve,
 * c'est une intention.
 *
 * Le numérateur cumulait DEUX défauts qui se COMPOSAIENT, et les deux
 * poussaient le pourcentage vers le HAUT :
 *
 *   (a) NUMÉRATEUR EN LIGNES, DÉNOMINATEUR EN TÊTES — `enrollment.count()`
 *       compte des LIGNES d'inscription ; `student.count()` compte des TÊTES.
 *       Un élève portant deux inscriptions actives la même année — LÉGAL, la
 *       clé unique est `(studentId, classSectionId, academicYearId)` et
 *       l'index partiel promis par `schema.prisma` n'existe pas (PF-361) —
 *       valait DEUX au numérateur et UN au dénominateur.
 *
 *   (b) NUMÉRATEUR SANS ÉCOLE — le dénominateur porte `schoolId`, le
 *       numérateur ne portait que `tenantId`. Dans un tenant multi-écoles il
 *       agrégeait TOUTES les écoles contre le total d'UNE SEULE.
 *
 * La fixture ci-dessous déclenche les deux À LA FOIS et rendait donc
 * **133,3 %** — un pourcentage de population supérieur à cent, affiché sur
 * `/admin/students` sous la phrase « X % des N élèves de l'établissement ont
 * une inscription active ».
 *
 * ⚠ CONTRÔLE DE NON-VACUITÉ. Le faux Prisma de ce fichier FILTRE réellement
 * sur `where.student.schoolId` et sur `where.status.in`. Un test dont le
 * double ignore la clause qu'il prétend éprouver est vert par construction —
 * le dernier `describe` l'assied avant que quoi que ce soit d'autre ne compte.
 */

const TENANT = 't1';
const SCHOOL = 's1';
const OTHER_SCHOOL = 's2';
const ACTIVE_YEAR = 'ay-active';

/**
 * Les LIGNES d'inscription du TENANT pour l'année active — toutes écoles
 * confondues, exactement ce que l'ancien `enrollment.count()` voyait.
 *
 *   • `stu-1` en porte DEUX (6eA et 6eB, la même année) → défaut (a).
 *   • `stu-9` appartient à une AUTRE école du même tenant → défaut (b).
 *
 * Quatre LIGNES ; deux TÊTES dans l'école courante.
 */
const TENANT_ENROLLMENT_ROWS = [
  { studentId: 'stu-1', classSectionId: 'cs-6eA', status: 'active', schoolId: SCHOOL },
  { studentId: 'stu-1', classSectionId: 'cs-6eB', status: 'active', schoolId: SCHOOL },
  { studentId: 'stu-2', classSectionId: 'cs-6eA', status: 'active', schoolId: SCHOOL },
  { studentId: 'stu-9', classSectionId: 'cs-autre', status: 'active', schoolId: OTHER_SCHOOL },
  // Un SORTI de l'école courante : il ne doit entrer dans aucune des deux
  // dérivations. Sans lui, `status` ne serait jamais éprouvé.
  { studentId: 'stu-3', classSectionId: 'cs-6eA', status: 'dropped', schoolId: SCHOOL },
];

/** L'école courante compte TROIS élèves actifs — le dénominateur. */
const ACTIVE_STUDENTS_IN_SCHOOL = 3;

interface EnrollmentWhere {
  status?: { in?: string[] };
  student?: { schoolId?: string; status?: string };
  academicYearId?: string;
}

function makeService() {
  const enrollmentFindMany = jest.fn().mockImplementation((args: { where?: EnrollmentWhere } = {}) => {
    const where = args.where ?? {};
    const rows = TENANT_ENROLLMENT_ROWS.filter((row) => {
      // La POPULATION, telle que le module canonique la nomme.
      if (where.status?.in && !where.status.in.includes(row.status)) return false;
      // L'ÉCOLE — la clause dont l'absence produisait le > 100 %.
      if (where.student?.schoolId && where.student.schoolId !== row.schoolId) return false;
      return true;
    });
    return Promise.resolve(rows.map((row) => ({ studentId: row.studentId })));
  });

  const prisma = {
    student: {
      count: jest
        .fn()
        .mockResolvedValueOnce(ACTIVE_STUDENTS_IN_SCHOOL) // totalStudents
        .mockResolvedValueOnce(0) // newThisMonth
        .mockResolvedValueOnce(0) // totalLastYear
        .mockResolvedValue(0),
      // Les sparklines : trois lectures, aucune incidence sur le pourcentage.
      findMany: jest.fn().mockResolvedValue([]),
    },
    academicYear: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: ACTIVE_YEAR,
          schoolId: SCHOOL,
          name: '2025-2026',
          startDate: new Date('2025-09-01T00:00:00.000Z'),
          endDate: new Date('2026-07-05T00:00:00.000Z'),
          status: 'active',
        },
      ]),
    },
    enrollment: {
      findMany: enrollmentFindMany,
      groupBy: jest.fn().mockResolvedValue([]),
    },
    classSection: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new AnalyticsService(prisma as never, {} as never, {} as never);
  return { service, prisma, enrollmentFindMany };
}

describe('AC-7 #6 — « % d’élèves actifs » compte des TÊTES de CETTE école', () => {
  it('rend 2 / 3 = 66,7 %, et non 4 / 3 = 133,3 %', async () => {
    const { service } = makeService();
    const res = await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    // DEUX élèves distincts de l'école courante ont une inscription assise.
    expect(res.activeStudents).toBe(2);
    expect(res.totalStudents).toBe(ACTIVE_STUDENTS_IN_SCHOOL);
    expect(res.activePct).toBe(66.7);

    // La valeur que l'ANCIENNE dérivation rendait sur CETTE MÊME fixture :
    // quatre LIGNES, toutes écoles confondues. Elle est nommée pour que le
    // jour où quelqu'un revient au `count()`, l'échec dise QUOI a régressé.
    expect(res.activeStudents).not.toBe(4);
    expect(res.activePct).not.toBeCloseTo(133.3, 1);
  });

  it('l’invariant tient : une PART d’une population ne dépasse pas 100 %', async () => {
    const { service } = makeService();
    const res = await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    expect(res.activePct).toBeLessThanOrEqual(100);
    // Le numérateur est un SOUS-ENSEMBLE du dénominateur, pas un compte parallèle.
    expect(res.activeStudents).toBeLessThanOrEqual(res.totalStudents);
  });

  it('un élève à DEUX inscriptions actives la même année ne vaut qu’UNE tête', async () => {
    const { service, enrollmentFindMany } = makeService();
    await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    // Le détail DISCRIMINANT : la lecture a bien rapporté les DEUX lignes de
    // `stu-1`. Le 2 ci-dessus vient donc d'une DÉ-DUPLICATION, pas d'une
    // fixture qui aurait discrètement omis le doublon.
    const numeratorCall = enrollmentFindMany.mock.results[0]?.value as Promise<
      Array<{ studentId: string }>
    >;
    const rows = await numeratorCall;
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.studentId === 'stu-1')).toHaveLength(2);
  });

  it('le numérateur DEMANDE l’école — le code discriminant, pas seulement le total', async () => {
    const { service, enrollmentFindMany } = makeService();
    await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    const where = (enrollmentFindMany.mock.calls[0]?.[0] as { where: EnrollmentWhere }).where;
    // C'est la clause absente qui produisait le > 100 %. Un total juste par
    // coïncidence de fixture ne suffit pas : on exige la clause elle-même.
    expect(where.student?.schoolId).toBe(SCHOOL);
    expect(where.academicYearId).toBe(ACTIVE_YEAR);
    // La population est NOMMÉE, jamais un `status: 'active'` écrit à la main.
    expect(where.status?.in).toEqual(['active']);
  });
});

describe('CONTRÔLE — le faux Prisma FILTRE réellement', () => {
  it('sans clause d’école il rendrait bien 4 lignes : la suite n’est pas vacante', async () => {
    const { prisma } = makeService();
    const unscoped = (await prisma.enrollment.findMany({
      where: { status: { in: ['active'] } },
    })) as Array<{ studentId: string }>;

    // C'est EXACTEMENT ce que l'ancienne dérivation comptait — 4 lignes pour
    // 3 élèves, donc 133,3 %. Si ce contrôle tombe à 3, le double a cessé de
    // porter le défaut et les assertions ci-dessus ne prouvent plus rien.
    expect(unscoped).toHaveLength(4);
    expect(new Set(unscoped.map((r) => r.studentId)).size).toBe(3);
  });

  it('il filtre aussi la POPULATION — le `dropped` n’entre nulle part', async () => {
    const { prisma } = makeService();
    const all = (await prisma.enrollment.findMany({ where: {} })) as Array<{ studentId: string }>;
    expect(all).toHaveLength(TENANT_ENROLLMENT_ROWS.length);
    const seated = (await prisma.enrollment.findMany({
      where: { status: { in: ['active'] } },
    })) as Array<{ studentId: string }>;
    expect(seated.length).toBe(TENANT_ENROLLMENT_ROWS.length - 1);
  });
});
