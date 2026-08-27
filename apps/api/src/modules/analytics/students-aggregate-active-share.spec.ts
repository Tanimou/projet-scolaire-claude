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
 * sur `where.schoolId` et sur `where.enrollments.some.status.in`. Un test dont le
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

/**
 * ⚠ LE MÉCANISME A CHANGÉ À LA PASSE DE LAND, PAS LA VÉRITÉ QU'IL PORTE.
 *
 * La tranche avait d'abord écrit le numérateur en
 * `enrollment.findMany({ select: { studentId } })` suivi d'un `Set` en
 * JavaScript. C'était juste — et c'était un éventail de lignes : sur la base
 * locale VIDE les deux formes sont indiscernables, mais en production ce site
 * tirait TOUTE inscription assise de l'école à chaque chargement du tableau de
 * bord admin, ce qui aggravait `PF-50` (« unpaginated / fan-out hotspots »),
 * une finding de CE MÊME épic. Le panel d'escalade l'a relevé ; la passe de
 * land l'a converti en `student.count({ where: { …, enrollments: { some } } })`,
 * qui compte des TÊTES DISTINCTES en SQL — une ligne `student` EST une tête —
 * et qui est de surcroît la MÊME requête que le dénominateur, à une clause près.
 *
 * Ce fichier a donc été réécrit pour éprouver la dérivation qui a RÉELLEMENT
 * embarqué. Les trois choses qu'il prouve sont inchangées :
 *   1. le numérateur rend 2 et non 4 — donc 66,7 % et non 133,3 % ;
 *   2. le 2 vient d'une DÉ-DUPLICATION réelle : la fixture contient bien les
 *      DEUX lignes de `stu-1`, elle ne les a pas discrètement omises ;
 *   3. le numérateur DEMANDE l'école, l'année et une population NOMMÉE — le
 *      code discriminant, pas seulement un total juste par coïncidence.
 *
 * Ce que la conversion déplace, c'est OÙ la dé-duplication a lieu : elle passe
 * du processus Node à la base. Le faux Prisma ci-dessous la refait donc
 * lui-même à partir des lignes de la fixture, ce qui est exactement le travail
 * que `student.count` délègue à Postgres.
 */

/** Le `where` d'un `student.count`, tel que le service le construit. */
interface StudentCountWhere {
  tenantId?: string;
  schoolId?: string;
  status?: string;
  enrollments?: {
    some?: {
      tenantId?: string;
      status?: { in?: string[] };
      academicYearId?: string;
    };
  };
}

function makeService() {
  /**
   * Les lignes que le `enrollments: { some }` du numérateur SÉLECTIONNE.
   * Exposées pour l'assertion de dé-duplication : sans elles, « 2 » pourrait
   * venir d'une fixture qui n'a jamais porté le doublon.
   */
  let numeratorMatchedRows: Array<{ studentId: string }> = [];

  /** Les trois `student.count` NON liés aux inscriptions, dans l'ordre du service. */
  const plainCounts = [ACTIVE_STUDENTS_IN_SCHOOL, 0, 0];
  let plainCallIndex = 0;

  const studentCount = jest.fn().mockImplementation((args: { where?: StudentCountWhere } = {}) => {
    const where = args.where ?? {};
    const some = where.enrollments?.some;

    // Pas de clause d'inscription ⇒ c'est un des trois comptes simples
    // (`totalStudents`, `newThisMonth`, `totalLastYear`).
    if (!some) {
      const value = plainCounts[plainCallIndex] ?? 0;
      plainCallIndex += 1;
      return Promise.resolve(value);
    }

    // LE NUMÉRATEUR. On filtre exactement comme Postgres le ferait, puis on
    // compte des TÊTES — car `student.count` compte des lignes `student`.
    const matched = TENANT_ENROLLMENT_ROWS.filter((row) => {
      // La POPULATION, telle que le module canonique la nomme.
      if (some.status?.in && !some.status.in.includes(row.status)) return false;
      // L'ÉCOLE — la clause dont l'absence produisait le > 100 %. Elle vit
      // désormais sur l'élève (`where.schoolId`), plus sur l'inscription.
      if (where.schoolId && where.schoolId !== row.schoolId) return false;
      return true;
    });
    numeratorMatchedRows = matched.map((row) => ({ studentId: row.studentId }));
    return Promise.resolve(new Set(matched.map((row) => row.studentId)).size);
  });

  const prisma = {
    student: {
      count: studentCount,
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
      findMany: jest.fn().mockResolvedValue([]),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    classSection: { findMany: jest.fn().mockResolvedValue([]) },
  };

  const service = new AnalyticsService(prisma as never, {} as never, {} as never);
  return {
    service,
    prisma,
    studentCount,
    numeratorWhere: () =>
      (studentCount.mock.calls.find(
        (call) => (call[0] as { where?: StudentCountWhere } | undefined)?.where?.enrollments?.some,
      )?.[0] as { where: StudentCountWhere } | undefined)?.where,
    numeratorMatchedRows: () => numeratorMatchedRows,
  };
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
    // jour où quelqu'un revient au `count()` de lignes, l'échec dise QUOI a
    // régressé.
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
    const { service, numeratorMatchedRows } = makeService();
    await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    // Le détail DISCRIMINANT : la clause du numérateur a bien SÉLECTIONNÉ les
    // DEUX lignes de `stu-1`. Le 2 ci-dessus vient donc d'une DÉ-DUPLICATION —
    // faite par la base plutôt que par Node depuis la passe de land — et non
    // d'une fixture qui aurait discrètement omis le doublon.
    const rows = numeratorMatchedRows();
    expect(rows).toHaveLength(3);
    expect(rows.filter((r) => r.studentId === 'stu-1')).toHaveLength(2);
  });

  it('le numérateur DEMANDE l’école — le code discriminant, pas seulement le total', async () => {
    const { service, numeratorWhere } = makeService();
    await service.studentsAggregate({ tenantId: TENANT, schoolId: SCHOOL });

    const where = numeratorWhere();
    // C'est la clause absente qui produisait le > 100 %. Un total juste par
    // coïncidence de fixture ne suffit pas : on exige la clause elle-même.
    expect(where).toBeDefined();
    expect(where?.schoolId).toBe(SCHOOL);
    expect(where?.tenantId).toBe(TENANT);
    expect(where?.enrollments?.some?.academicYearId).toBe(ACTIVE_YEAR);
    // Le tenant est énoncé DES DEUX CÔTÉS de la jointure, pas seulement sur
    // l'élève : `enrollment.tenant_id` ne porte ni FK ni contrainte (PF-415).
    expect(where?.enrollments?.some?.tenantId).toBe(TENANT);
    // La population est NOMMÉE, jamais un `status: 'active'` écrit à la main.
    expect(where?.enrollments?.some?.status?.in).toEqual(['active']);
  });
});

describe('CONTRÔLE — le faux Prisma FILTRE réellement', () => {
  it('sans clause d’école il rendrait bien 4 lignes pour 3 têtes : la suite n’est pas vacante', async () => {
    const { studentCount } = makeService();

    // Le MÊME double, interrogé SANS `schoolId` : c'est exactement ce que
    // l'ancienne dérivation voyait. S'il rendait 2 ici, le double aurait cessé
    // de porter le défaut et les assertions ci-dessus ne prouveraient rien.
    const unscopedHeads = await studentCount({
      where: { tenantId: TENANT, enrollments: { some: { status: { in: ['active'] } } } },
    });
    expect(unscopedHeads).toBe(3);

    const rows = TENANT_ENROLLMENT_ROWS.filter((r) => r.status === 'active');
    expect(rows).toHaveLength(4);
    expect(new Set(rows.map((r) => r.studentId)).size).toBe(3);
  });

  it('il filtre aussi la POPULATION — le `dropped` n’entre nulle part', async () => {
    const { studentCount } = makeService();

    // `stu-3` est `dropped` dans l'école courante. Sans filtre de population il
    // ferait une troisième tête ; avec, il n'en fait aucune.
    const seatedHeads = await studentCount({
      where: {
        tenantId: TENANT,
        schoolId: SCHOOL,
        enrollments: { some: { status: { in: ['active'] } } },
      },
    });
    const everRegisteredHeads = await studentCount({
      where: {
        tenantId: TENANT,
        schoolId: SCHOOL,
        enrollments: { some: { status: { in: ['active', 'dropped'] } } },
      },
    });
    expect(seatedHeads).toBe(2);
    expect(everRegisteredHeads).toBe(3);
  });
});
