import { AnalyticsService } from './analytics.service';

/**
 * S-E03-14 / `PF-36` / `ADR-088` — LE ROUGE-AVANT / VERT-APRÈS du NEUVIÈME site.
 *
 * FICHIER NEUF. `assignment-year-axis.spec.ts` (run 103) n'est pas retouché :
 * une spec qu'on modifie pour la faire rougir ne prouve rien sur le produit, et
 * ce fichier-ci existe précisément parce que celui-là ne pouvait pas échouer sur
 * le site qu'il avait omis.
 *
 * CE QU'IL MESURE
 * ---------------
 * `AnalyticsService.teacherReports` — `GET /analytics/teacher-reports`, la page
 * « Rapports » du portail enseignant — filtrait l'année sur la COLONNE
 * `teaching_assignment.academic_year_id` (`...(academicYearId ? {
 * academicYearId } : {})`) là où les huit lectures converties par `S-E03-13`
 * dérivent l'année de la SECTION. Comme la base ACCEPTE qu'une affectation
 * contredise sa propre section (aucune clé étrangère composite — `PF-473`,
 * mesuré), les deux surfaces pouvaient rendre des ENSEMBLES DE CLASSES
 * DIFFÉRENTS au même enseignant.
 *
 * POURQUOI IL VOIT LE SITE ET NON UNE COPIE
 * ------------------------------------------
 * Il n'affirme rien sur un littéral recopié : il EXÉCUTE le vrai service avec un
 * Prisma espion et lit le `where` que la production construit réellement.
 * Remettre `academicYearId: academicYearId` à la place de la dérivation rend
 * cette suite ROUGE — vérifié par exécution au run 104, sur la source d'origine
 * restaurée depuis l'index git, avant que le correctif ne soit réappliqué.
 *
 * CE QU'IL NE PROUVE PAS
 * ----------------------
 * Une forme dans UN `where`. Que les deux surfaces s'accordent sur la PILE QUI
 * TOURNE est porté par `scripts/teacher-year-axis-agreement-probe.js`, qui parle
 * HTTP avec de vrais jetons ; que la classe entière soit fermée est porté par
 * `apps/api/src/shared/quality/assignment-year-axis-derivation-gate.spec.ts`,
 * qui DÉRIVE les sites au lieu de les énumérer. Trois affirmations, trois
 * mécanismes.
 */

const TENANT = 't-1';
const TEACHER = 'tp-T';
const YEAR = 'ay-Y';

/** Tous les `where` passés à une lecture `teachingAssignment`. */
function buildSpy(): {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  prisma: any;
  seen: Array<Record<string, unknown>>;
} {
  const seen: Array<Record<string, unknown>> = [];
  const prisma = {
    teachingAssignment: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      findMany: jest.fn().mockImplementation((args: any = {}) => {
        if (args && typeof args.where === 'object' && args.where !== null) seen.push(args.where);
        return Promise.resolve([]);
      }),
    },
    academicYear: {
      findUnique: jest.fn().mockResolvedValue({ id: YEAR, name: '2023–2024' }),
    },
    term: { findMany: jest.fn().mockResolvedValue([]) },
    assessment: { findMany: jest.fn().mockResolvedValue([]) },
  };
  return { prisma, seen };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const makeService = (prisma: any) =>
  new AnalyticsService(prisma as never, {} as never, {} as never);

/** L'axe COLONNE, tel qu'il s'écrivait avant cette tranche. */
const usesColumnAxis = (w: Record<string, unknown>) =>
  Object.prototype.hasOwnProperty.call(w, 'academicYearId');

/** L'axe SECTION, tel que la tranche l'impose. */
const usesSectionAxis = (w: Record<string, unknown>) =>
  (w['classSection'] as { academicYearId?: string } | undefined)?.academicYearId === YEAR;

describe('GET /analytics/teacher-reports — le NEUVIÈME site, celui que S-E03-13 a manqué', () => {
  it("dérive l'année de la SECTION, jamais de la colonne de l'affectation", async () => {
    const { prisma, seen } = buildSpy();
    await makeService(prisma).teacherReports({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
      academicYearId: YEAR,
    });

    expect(seen).toHaveLength(1);
    expect(seen.every(usesSectionAxis)).toBe(true);
    expect(seen.some(usesColumnAxis)).toBe(false);
  });

  it("garde le mur de TENANT et celui de l'ENSEIGNANT — la conversion n'élargit rien", async () => {
    const { prisma, seen } = buildSpy();
    await makeService(prisma).teacherReports({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
      academicYearId: YEAR,
    });

    // Une conversion d'axe qui perdrait `tenantId` échangerait un défaut de
    // vérité contre une fuite de tenant. On l'assied plutôt que de l'espérer.
    expect(seen[0]).toMatchObject({ tenantId: TENANT, teacherProfileId: TEACHER });
  });

  it("sans année nommée, aucune clause d'année n'est fabriquée", async () => {
    const { prisma, seen } = buildSpy();
    await makeService(prisma).teacherReports({
      tenantId: TENANT,
      teacherProfileId: TEACHER,
    });

    // `assignmentYearScopeWhere` est TOTALE : « toutes années confondues » est
    // décidé dans le foyer, une fois, et non re-épelé ici.
    expect(seen).toHaveLength(1);
    expect(seen.some(usesColumnAxis)).toBe(false);
    // `some` sur un tableau VIDE rendrait `false` et laisserait ce test vert
    // sans qu'aucune requête n'ait été observée ; la longueur ci-dessus est ce
    // qui l'en empêche, et l'accès explicite au premier `where` le confirme.
    expect(seen.every((w) => w['classSection'] === undefined)).toBe(true);
  });
});
