import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { StudentPortalService } from './student-portal.service';

import {
  gradeRecordWhere,
  scoringWindowGradesWhere,
  PUBLISHED_GRADE_STATUSES,
} from '@pilotage/contracts';

/**
 * S-E03-15 / `PF-338` / `PF-05` / `PF-04` — LES DEUX PROJECTIONS « MES NOTES »
 * DU PORTAIL ÉLÈVE, CAPTURÉES DEPUIS LA PRODUCTION.
 *
 * CE QUE CETTE SUITE PROUVE, ET COMMENT
 * --------------------------------------
 * Elle n'écrit AUCUN `where` attendu à la main. Elle intercepte le `where` que
 * le producteur passe réellement à Prisma et le compare à ce que le contrat
 * canonique (`packages/contracts/src/grades/published-grades-where.ts`) produit
 * pour les mêmes entrées. C'est la forme de `parent-grade-projection-agreement`
 * livrée par `S-E03-3`, appliquée au quatrième et au troisième adoptant.
 *
 * La différence entre « comparer à un littéral » et « comparer au contrat » est
 * la seule qui compte ici : un littéral recopié dans la spec dériverait avec le
 * code sans que rien ne rougisse — c'est `DNC-01`, et c'est exactement le
 * défaut que `PF-338` nomme. En comparant à l'APPEL du contrat, une divergence
 * introduite d'un côté OU de l'autre rougit.
 *
 * LES DEUX QUESTIONS, ET POURQUOI ELLES RESTENT DEUX
 * ---------------------------------------------------
 *   C  `GET /student/grades` — LE RELEVÉ. Garde les absences, toutes années.
 *   D  `subjectTrends` (retombée vive du tableau de bord) — LE JEU DE NOTATION.
 *      Écarte les absences, FENÊTRÉ sur l'année canonique.
 *
 * Elles divergent LÉGITIMEMENT sur deux axes, et cette suite l'ASSERTE plutôt
 * que de la déplorer — mais elles doivent s'accorder sur le STATUT, et c'est le
 * seul axe que le contrat réunit vraiment.
 *
 * LE DÉFAUT QUE CETTE SUITE FIGE (mesuré avant correction)
 * ---------------------------------------------------------
 * D calculait des MOYENNES PAR MATIÈRE sans aucune fenêtre d'année, pendant que
 * le portail PARENT fenêtre les siennes depuis toujours. Deux portails
 * affichaient donc une moyenne différente pour le MÊME élève dès qu'il portait
 * des notes sur deux années. `grep resolveActiveAcademicYear apps/api/src` ne
 * renvoyait AUCUN site dans `student-portal` : le portail élève était le seul
 * des quatre sans conscience d'année.
 */

const TENANT = 't1';
const SCHOOL = 'school-1';
const ME = { id: 'profile-1', tenantId: TENANT };
const OWN_ID = 'student-self-id';
const YEAR_ID = 'year-current';
const JWT = { sub: 'kc', realm_access: { roles: ['student'] } } as unknown as KeycloakJwtPayload;

const ACTIVE_YEAR = {
  id: YEAR_ID,
  schoolId: SCHOOL,
  name: '2025-2026',
  startDate: new Date('2025-09-01T00:00:00Z'),
  endDate: new Date('2026-07-05T00:00:00Z'),
  status: 'active',
};

type Captured = { where: unknown };

/**
 * Le `where` de l'UNIQUE appel capturé. L'assertion de longueur n'est pas une
 * politesse envers le compilateur : elle est ce qui empêche cette suite de
 * devenir vacante si le producteur cessait d'émettre la requête — auquel cas
 * chaque assertion négative ci-dessous passerait pour la pire des raisons.
 */
function onlyWhere(calls: Captured[]): Record<string, unknown> {
  expect(calls).toHaveLength(1);
  const first = calls[0];
  if (first === undefined) throw new Error('inatteignable : la longueur est assertée au-dessus');
  return first.where as Record<string, unknown>;
}

/**
 * Le producteur, câblé sur des collaborateurs muets. `snapshotRows: []` force
 * la RETOMBÉE VIVE — la branche instantané court-circuiterait D et rendrait
 * cette suite vacante, ce qui est précisément le faux-vert que `PF-478` décrit.
 */
function makeService(opts: { academicYears?: unknown[]; snapshotRows?: unknown[] } = {}) {
  const gradeCalls: Captured[] = [];
  const snapshotCalls: Captured[] = [];
  const academicYearFindMany = jest.fn().mockResolvedValue(opts.academicYears ?? [ACTIVE_YEAR]);

  const prisma = {
    academicYear: { findMany: academicYearFindMany },
    student: {
      findFirst: jest.fn().mockResolvedValue({ id: OWN_ID, firstName: 'Lina', lastName: 'M.' }),
    },
    enrollment: { findFirst: jest.fn().mockResolvedValue(null) },
    subject: { findMany: jest.fn().mockResolvedValue([]) },
    studentSubjectSnapshot: {
      findMany: jest.fn(async (args: Captured) => {
        snapshotCalls.push(args);
        return opts.snapshotRows ?? [];
      }),
    },
    grade: {
      findMany: jest.fn(async (args: Captured) => {
        gradeCalls.push(args);
        return [];
      }),
    },
  };

  const scope = {
    run: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const service = new StudentPortalService(
    scope as never,
    { canAccessStudent: jest.fn().mockResolvedValue(true) } as never,
    {
      parentUpcoming: jest
        .fn()
        .mockResolvedValue({ classSectionName: null, gradeLevelName: null, data: [] }),
    } as never,
    { remediationProgress: jest.fn().mockResolvedValue([]) } as never,
  );
  return { service, gradeCalls, snapshotCalls, academicYearFindMany };
}

describe('C — `GET /student/grades` est LE RELEVÉ, dérivé de `gradeRecordWhere`', () => {
  it('passe à Prisma exactement ce que le contrat produit — pas un littéral recopié', async () => {
    const { service, gradeCalls } = makeService();

    await service.grades(ME, JWT, SCHOOL);

    expect(onlyWhere(gradeCalls)).toEqual(
      gradeRecordWhere({ tenantId: TENANT, studentId: OWN_ID }),
    );
  });

  it('GARDE les absences et ne se fenêtre sur AUCUNE année — un relevé tronqué n’est plus un relevé', async () => {
    const { service, gradeCalls } = makeService();

    await service.grades(ME, JWT, SCHOOL);
    const where = onlyWhere(gradeCalls);

    // Anti-vacuité : la clé doit exister et valoir la constante partagée, sinon
    // un `where` vide passerait les deux assertions négatives ci-dessous.
    expect(where.status).toEqual({ in: [...PUBLISHED_GRADE_STATUSES] });
    expect(where).not.toHaveProperty('isAbsent');
    expect(where).not.toHaveProperty('assessment');
  });
});

describe('D — la retombée vive du tableau de bord est LE JEU DE NOTATION, FENÊTRÉ sur l’année', () => {
  it('passe à Prisma exactement ce que `scoringWindowGradesWhere` produit pour l’année canonique', async () => {
    const { service, gradeCalls } = makeService({ snapshotRows: [] });

    await service.dashboard(ME, JWT, SCHOOL);

    expect(onlyWhere(gradeCalls)).toEqual(
      scoringWindowGradesWhere({ tenantId: TENANT, studentId: OWN_ID, academicYearId: YEAR_ID }),
    );
  });

  /**
   * L'ASSERTION CENTRALE DE CETTE TRANCHE. Avant S-E03-15 ce `where` ne portait
   * aucune clé `assessment`, donc la moyenne par matière du portail ÉLÈVE
   * mélangeait les années pendant que celle du portail PARENT ne le faisait pas.
   */
  it('FENÊTRE sur l’année canonique — c’est le défaut que PF-338 nomme, et il est mesuré ici', async () => {
    const { service, gradeCalls } = makeService({ snapshotRows: [] });

    await service.dashboard(ME, JWT, SCHOOL);
    const where = onlyWhere(gradeCalls);

    expect(where.assessment).toEqual({ teachingAssignment: { academicYearId: YEAR_ID } });
    expect(where.isAbsent).toBe(false);
  });

  it('la branche INSTANTANÉ porte la même année — sans quoi elle rendrait le dernier instantané calculé', async () => {
    const { service, snapshotCalls } = makeService({ snapshotRows: [] });

    await service.dashboard(ME, JWT, SCHOOL);

    expect(onlyWhere(snapshotCalls)).toEqual({
      tenantId: TENANT,
      studentId: OWN_ID,
      academicYearId: YEAR_ID,
      termId: null,
    });
  });

  /**
   * La posture de A (`analytics.service.ts` n'émet pas la requête quand l'année
   * ne se résout pas). Sans ce test, un futur « repli sur toutes années »
   * passerait inaperçu et recréerait la projection que le contrat refuse.
   */
  it('sans année active, ne lit AUCUNE note et rend `[]` — jamais un repli toutes-années', async () => {
    const { service, gradeCalls } = makeService({ academicYears: [], snapshotRows: [] });

    const out = await service.dashboard(ME, JWT, SCHOOL);

    expect(out.subjects).toEqual([]);
    expect(gradeCalls).toHaveLength(0);
  });
});

/**
 * POURQUOI CE BLOC EXISTE, ALORS QUE LES ASSERTIONS CI-DESSUS SONT VERTES
 * -----------------------------------------------------------------------
 * Le contrôle ROUGE de cette tranche a été EXÉCUTÉ (les deux `where` remis à
 * leur forme d'avant), et il a rougi les assertions d'ANNÉE — mais PAS celles
 * de C. C'est un fait sur l'instrument, pas sur le code : un littéral
 * `['published','revised']` correctement recopié produit une valeur ÉGALE à
 * celle du contrat, donc aucune comparaison de VALEUR ne peut distinguer « la
 * copie a disparu » de « la copie est juste ».
 *
 * Or « la copie a disparu » est précisément ce que `PF-338` demande : une copie
 * juste aujourd'hui est une copie qui dérivera demain sans rien faire rougir
 * (`DNC-01`). La seule preuve possible est donc au niveau de la SOURCE, et la
 * voici — bornée à CE fichier, parce que cette tranche revendique DEUX SITES
 * NOMMÉS et non une CLASSE. Un cliquet à l'échelle du dépôt appartiendrait à la
 * tranche qui fermera la classe, avec l'allowlist dérivée que cela suppose.
 */
describe('la SOURCE — le littéral de statut ne vit plus dans ce producteur', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require('fs') as typeof import('fs');
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require('path') as typeof import('path');

  const SOURCE = join(__dirname, 'student-portal.service.ts');

  it('ne contient AUCUN statut de note écrit à la main', () => {
    const source = readFileSync(SOURCE, 'utf8');

    // Anti-vacuité : si le fichier disparaissait ou était vidé, l'assertion
    // ci-dessous passerait pour la pire des raisons.
    expect(source.length).toBeGreaterThan(1000);
    expect(source).toContain('scoringWindowGradesWhere');
    expect(source).toContain('gradeRecordWhere');

    // Le corps SANS les commentaires : la prose de ce module cite les statuts
    // en toutes lettres, et juger la prose ferait rougir une explication.
    const code = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((line) => !line.trim().startsWith('//'))
      .join('\n');

    for (const status of PUBLISHED_GRADE_STATUSES) {
      expect(code).not.toContain(`'${status}'`);
    }
  });
});

describe('C et D — l’accord et la divergence, tous deux DÉCLARÉS', () => {
  it('s’accordent sur le STATUT (le seul axe que le contrat réunit)', async () => {
    const a = makeService();
    await a.service.grades(ME, JWT, SCHOOL);
    const b = makeService({ snapshotRows: [] });
    await b.service.dashboard(ME, JWT, SCHOOL);

    const record = onlyWhere(a.gradeCalls);
    const scoring = onlyWhere(b.gradeCalls);

    expect(record.status).toEqual(scoring.status);
    expect(record.status).toEqual({ in: [...PUBLISHED_GRADE_STATUSES] });
  });

  it('divergent sur l’ABSENCE et sur l’ANNÉE, et ces deux axes-là sont VOULUS', async () => {
    const a = makeService();
    await a.service.grades(ME, JWT, SCHOOL);
    const b = makeService({ snapshotRows: [] });
    await b.service.dashboard(ME, JWT, SCHOOL);

    const record = onlyWhere(a.gradeCalls);
    const scoring = onlyWhere(b.gradeCalls);

    // (b) absence : le relevé garde, la notation écarte.
    expect(record.isAbsent).toBeUndefined();
    expect(scoring.isAbsent).toBe(false);
    // (a) année : le relevé n'a pas de fenêtre, la notation en a une.
    expect(record.assessment).toBeUndefined();
    expect(scoring.assessment).toBeDefined();
  });
});
