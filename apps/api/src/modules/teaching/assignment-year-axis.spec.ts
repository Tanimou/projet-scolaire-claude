import { assignmentYearScopeWhere, ASSIGNMENT_YEAR_AXIS } from './assignment-year-scope';
import { TeachersController } from './teachers.controller';
import { TeachingAssignmentsController } from './teaching-assignments.controller';

/**
 * S-E03-13 / `PF-36` / `PF-04` / `ADR-087` — LE ROUGE-AVANT / VERT-APRÈS.
 *
 * FICHIER NEUF. Aucune spec existante n'est retouchée pour obtenir le rouge :
 * une spec qu'on modifie pour la faire rougir ne prouve rien sur le produit.
 *
 * CE QU'IL MESURE
 * ---------------
 * `TeachingAssignment` porte deux axes d'année — la colonne
 * `academic_year_id` et celle de sa section — et la base ACCEPTE qu'ils se
 * contredisent (mesuré au run 103 contre le Postgres du conteneur : la ligne
 * dérivée est insérée, `INSERT 0 1`, puis annulée). Huit lectures de production
 * filtraient sur l'axe COLONNE. Cette suite exige que les huit passent par
 * l'axe SECTION.
 *
 * POURQUOI IL VOIT LE SITE ET NON UNE COPIE
 * ------------------------------------------
 * Il n'affirme rien sur un littéral recopié : il EXÉCUTE les vrais
 * contrôleurs avec un Prisma espion et lit les `where` que la production
 * construit réellement. Une seule ligne remise à `academicYearId: yearId` sur
 * n'importe lequel des cinq sites de `teaching/` rend cette suite ROUGE.
 *
 * CE QU'IL NE PROUVE PAS, ET C'EST DIT ICI
 * -----------------------------------------
 * Il ne prouve rien sur les ~15 lectures IMBRIQUÉES qui restent
 * (`assessment: { teachingAssignment: { academicYearId } }`, dans `analytics/`,
 * `alerts/rules/` et `grades/`) : elles sont hors de cette tranche et tracées
 * `PF-474`. Et il ne remplace PAS la clé étrangère composite qui rendrait la
 * dérive INEXPRIMABLE en base — `PF-473`, sa propre migration. Faire converger
 * les lectures retire la divergence des NOMBRES, jamais celle des DONNÉES.
 */

const TENANT = 't-1';
const SCHOOL = 'sch-1';
const YEAR = 'ay-Y';
const TEACHER = 'tp-T';

const JWT = { sub: 'u-T' } as never;
const usersStub = { ensureUser: jest.fn().mockResolvedValue({ id: 'u-T', tenantId: TENANT }) };
const ctxStub = {
  forUser: jest.fn().mockResolvedValue({ schoolId: SCHOOL, activeAcademicYearId: YEAR }),
  forTenant: jest.fn().mockResolvedValue({ schoolId: SCHOOL, activeAcademicYearId: YEAR }),
};
const teachersStub = { ensureForUser: jest.fn().mockResolvedValue({ id: TEACHER }) };

/** Tous les `where` passés à une lecture `teachingAssignment`, quel que soit le verbe. */
function buildSpy(): { prisma: any; seen: Array<Record<string, unknown>> } {
  const seen: Array<Record<string, unknown>> = [];
  const record = (args: any = {}) => {
    if (args && typeof args.where === 'object' && args.where !== null) seen.push(args.where);
  };
  const prisma = {
    teachingAssignment: {
      findMany: jest.fn().mockImplementation((a: any) => (record(a), Promise.resolve([]))),
      count: jest.fn().mockImplementation((a: any) => (record(a), Promise.resolve(0))),
      groupBy: jest.fn().mockImplementation((a: any) => (record(a), Promise.resolve([]))),
    },
    enrollment: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    teacherProfile: {
      findUnique: jest.fn().mockResolvedValue({ id: TEACHER, tenantId: TENANT }),
    },
    subject: { count: jest.fn().mockResolvedValue(0) },
  };
  return { prisma, seen };
}

const makeTeachers = (prisma: any) =>
  new TeachersController(prisma as never, usersStub as never, ctxStub as never, teachersStub as never);

/** L'axe COLONNE, tel qu'il s'écrivait avant la tranche. */
const usesColumnAxis = (w: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(w, 'academicYearId');

/** L'axe SECTION, tel que la tranche l'impose. */
const usesSectionAxis = (w: Record<string, unknown>) =>
  (w['classSection'] as { academicYearId?: string } | undefined)?.academicYearId === YEAR;

/* ================================================================== *
 * LE PRÉDICAT LUI-MÊME
 * ================================================================== */

describe('assignmentYearScopeWhere — la dérivation', () => {
  it("porte l'année sur la SECTION, jamais sur la colonne de l'affectation", () => {
    expect(assignmentYearScopeWhere(YEAR)).toEqual({ classSection: { academicYearId: YEAR } });
    expect(usesColumnAxis(assignmentYearScopeWhere(YEAR))).toBe(false);
    expect(ASSIGNMENT_YEAR_AXIS).toBe('section');
  });

  it('est TOTALE : « aucune année » se décide ici, une fois, et non sur chaque site', () => {
    expect(assignmentYearScopeWhere(undefined)).toEqual({});
    expect(assignmentYearScopeWhere(null)).toEqual({});
    expect(assignmentYearScopeWhere('')).toEqual({});
  });
});

/* ================================================================== *
 * LES SITES DE PRODUCTION, EXÉCUTÉS
 * ================================================================== */

describe('les lectures de `teaching/` filtrent par la SECTION', () => {
  it('GET /teachers/me/assignments', async () => {
    const { prisma, seen } = buildSpy();
    await makeTeachers(prisma).myAssignments(JWT);
    expect(seen).toHaveLength(1);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it('GET /teachers/me/assignments — une année EXPLICITE emprunte le même axe', async () => {
    const { prisma, seen } = buildSpy();
    await makeTeachers(prisma).myAssignments(JWT, YEAR);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it('GET /teachers/me/students', async () => {
    const { prisma, seen } = buildSpy();
    await makeTeachers(prisma).myStudents(JWT);
    expect(seen).toHaveLength(1);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it("GET /teachers/:id/load — la VARIANTE C de l'audit, le « 43 » de PF-36", async () => {
    const { prisma, seen } = buildSpy();
    await makeTeachers(prisma).getLoad(TEACHER, JWT);
    expect(seen).toHaveLength(1);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it('GET /teaching-assignments — la page ET le panneau « Couverture »', async () => {
    const { prisma, seen } = buildSpy();
    const controller = new TeachingAssignmentsController(
      prisma as never,
      usersStub as never,
      ctxStub as never,
    );
    await controller.list(JWT, undefined, undefined, undefined, YEAR);

    // `where` (page, total, deux groupBy) ET `coverageWhere` (trois groupBy)
    // partent tous les deux de la même dérivation : les sept portent l'axe.
    expect(seen.length).toBeGreaterThanOrEqual(7);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it("sans année nommée, la liste ne fabrique aucune clause d'année", async () => {
    const { prisma, seen } = buildSpy();
    const controller = new TeachingAssignmentsController(
      prisma as never,
      usersStub as never,
      ctxStub as never,
    );
    await controller.list(JWT);
    expect(seen.some(usesColumnAxis)).toBe(false);
    expect(seen.some((w) => w['classSection'] !== undefined)).toBe(false);
  });
});
