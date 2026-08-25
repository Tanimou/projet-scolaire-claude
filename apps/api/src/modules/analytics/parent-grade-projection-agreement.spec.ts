import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { type UserSyncService } from '../../shared/auth/user-sync.service';
import { type PrismaService } from '../../shared/prisma/prisma.service';
import { GradesController } from '../grades/grades.controller';
import { type GradesService } from '../grades/grades.service';
import { type RemediationService } from '../remediation/remediation.service';
import { type StudentAccessService } from '../students/student-access.service';
import { type TeacherProfileService } from '../teaching/teacher-profile.service';

import { AnalyticsService } from './analytics.service';

/**
 * S-E03-2 / `AC-5` / `PF-05` / `DNC-01` — LA SPEC DE CONVERGENCE des deux
 * projections « les notes de cet enfant » du portail parent.
 *
 * NE PAS SUPPRIMER CE FICHIER EN CROYANT QU'IL « AFFIRME LE BUG »
 * ---------------------------------------------------------------
 * Il ÉPINGLE une divergence CONNUE, AXE PAR AXE, pour qu'un changement apporté
 * à UNE projection et pas à l'autre devienne ROUGE au lieu de devenir un ticket
 * de support six mois plus tard. C'est la spec de convergence de `S-E03-3`, la
 * tranche qui unifiera réellement les deux requêtes. Quand elle atterrira, les
 * cas d'axe ci-dessous doivent être RETIRÉS avec la ligne de registre
 * correspondante — jamais « corrigés » en abaissant une assertion.
 *
 * LES DEUX PROJECTIONS
 * --------------------
 *   A  `AnalyticsService.parentDashboard` (`analytics.service.ts:881`) — sert
 *      `/parent/dashboard`, `/parent/subjects`, `/parent/children/[id]/report`
 *      ET `/admin/students/[id]`.
 *   B  `GradesController.studentGrades` (`grades.controller.ts`) — sert
 *      `/parent/grades` ET `/parent/documents`.
 *
 * POURQUOI LES `where` SONT CAPTURÉS ET NON RETAPÉS (R-30)
 * --------------------------------------------------------
 * Une spec qui recopie à la main les deux clauses `where` puis les compare ne
 * teste que la copie : elle reste verte quand la production diverge, et le
 * défaut qu'elle prétend garder est exactement celui-là. Les deux clauses sont
 * donc EXTRAITES DE LA PRODUCTION, en exécutant le vrai code au-dessus d'un
 * double Prisma qui CAPTURE l'argument puis interrompt l'appel par un sentinelle.
 * L'interruption est délibérée : `parentDashboard` émet ensuite une quinzaine
 * de requêtes sans rapport avec cette question, et les doubler toutes ferait de
 * ce fichier une réimplémentation du service.
 *
 * POURQUOI PAS UNE COMPARAISON DE COMPTES SEULE (AC-H2)
 * -----------------------------------------------------
 * La sonde live du run a mesuré « B n=1, A subjectPerf=1 » sur le seed du jour,
 * et cette égalité est une COÏNCIDENCE de fixture : `subjectPerf` compte des
 * MATIÈRES, `B.data` compte des NOTES. Deux notes dans une même matière la
 * feraient rougir sans qu'aucun défaut n'existe. La comparaison porte donc sur
 * l'ENSEMBLE DES LIGNES retenues par chaque `where` — la seule grandeur que les
 * deux projections partagent réellement.
 *
 * CE QUE CE FICHIER NE PROUVE PAS
 * -------------------------------
 * Il juge les `where`. L'axe (c) — `if (!g.value) continue`, qui écarte une note
 * de ZÉRO — vit dans la BOUCLE de regroupement de A, pas dans son `where` ; il
 * est donc porté ici par un ÉPINGLAGE DE SOURCE doublé d'une démonstration
 * exécutable du prédicat. `PF-339` reste ouvert : le corriger naïvement est
 * faux deux fois (`value` est un `Decimal`, et `Number(0)` est falsy — le
 * prédicat juste est `g.value == null`).
 */

const TENANT = 'tenant-a';
const STUDENT = 'student-1';
const ACTIVE_YEAR = 'year-active';
const OTHER_YEAR = 'year-previous';

type Row = Record<string, unknown>;

/** Le sentinelle d'interruption : capturer, puis arrêter net. */
class CapturedAndAborted extends Error {}

/* ================================================================== *
 * LE MOTEUR DE PRÉDICAT — UN seul, appliqué aux DEUX `where` capturés
 * ================================================================== */

/**
 * Évalue un `where` Prisma (le sous-ensemble que ces deux projections
 * emploient : égalité scalaire, `{ in: [...] }`, et objets de relation
 * imbriqués) contre une ligne de fixture APLATIE.
 *
 * UN SEUL moteur pour les deux clauses : deux évaluateurs pourraient diverger et
 * l'accord observé ne dirait plus rien.
 */
function matches(where: Row, row: Row, prefix = ''): boolean {
  for (const [key, expected] of Object.entries(where)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (expected !== null && typeof expected === 'object' && !Array.isArray(expected)) {
      const obj = expected as Row;
      if ('in' in obj) {
        if (!(obj['in'] as unknown[]).includes(row[path])) return false;
        continue;
      }
      // Objet de relation : on descend en préfixant le chemin.
      if (!matches(obj, row, path)) return false;
      continue;
    }
    if (row[path] !== expected) return false;
  }
  return true;
}

/* ================================================================== *
 * LES FIXTURES — UN AXE PAR LIGNE, exactement une fois
 * ================================================================== */

/**
 * Lignes APLATIES : la clé porte le chemin relationnel que le `where` emprunte.
 * `assessment.teachingAssignment.academicYearId` est la seule relation que A
 * contraint.
 */
const GRADES: ReadonlyArray<Row & { id: string; axis: string }> = [
  {
    id: 'g-baseline',
    axis: 'accord',
    tenantId: TENANT,
    studentId: STUDENT,
    status: 'published',
    isAbsent: false,
    value: 12,
    'assessment.teachingAssignment.academicYearId': ACTIVE_YEAR,
    'assessment.termId': 'term-1',
  },
  {
    id: 'g-other-year',
    axis: '(a) année scolaire',
    tenantId: TENANT,
    studentId: STUDENT,
    status: 'published',
    isAbsent: false,
    value: 14,
    'assessment.teachingAssignment.academicYearId': OTHER_YEAR,
    'assessment.termId': 'term-0',
  },
  {
    id: 'g-absent',
    axis: '(b) isAbsent',
    tenantId: TENANT,
    studentId: STUDENT,
    status: 'published',
    isAbsent: true,
    value: null,
    'assessment.teachingAssignment.academicYearId': ACTIVE_YEAR,
    'assessment.termId': 'term-1',
  },
  {
    id: 'g-zero',
    axis: '(c) valeur ZÉRO',
    tenantId: TENANT,
    studentId: STUDENT,
    status: 'published',
    isAbsent: false,
    value: 0,
    'assessment.teachingAssignment.academicYearId': ACTIVE_YEAR,
    'assessment.termId': 'term-1',
  },
  {
    id: 'g-draft',
    axis: '(d) statut',
    tenantId: TENANT,
    studentId: STUDENT,
    status: 'draft',
    isAbsent: false,
    value: 17,
    'assessment.teachingAssignment.academicYearId': ACTIVE_YEAR,
    'assessment.termId': 'term-1',
  },
];

const idsMatching = (where: Row): string[] => GRADES.filter((g) => matches(where, g)).map((g) => g.id);

/* ================================================================== *
 * CAPTURE DE A — le vrai `AnalyticsService.parentDashboard`
 * ================================================================== */

/**
 * `enrollments` pilote l'axe « pas d'inscription active » : A REND `[]` SANS
 * ÉMETTRE DE REQUÊTE quand il n'y a pas d'année à résoudre (`:926`).
 */
async function captureA(opts: { withActiveEnrollment: boolean }): Promise<Row | undefined> {
  let captured: Row | undefined;

  const prisma = {
    student: {
      findFirst: jest.fn(async () => ({
        id: STUDENT,
        tenantId: TENANT,
        school: { name: 'École' },
        enrollments: opts.withActiveEnrollment
          ? [
              {
                academicYearId: ACTIVE_YEAR,
                classSectionId: 'cs-1',
                classSection: { gradeLevelId: 'gl-1', gradeLevel: { id: 'gl-1', name: '6e' } },
                academicYear: { id: ACTIVE_YEAR, name: '2025-2026', status: 'active' },
              },
            ]
          : [],
      })),
    },
    grade: {
      findMany: jest.fn(async (args: { where: Row }) => {
        captured = args.where;
        throw new CapturedAndAborted();
      }),
    },
  };

  const service = new AnalyticsService(
    prisma as unknown as PrismaService,
    {} as unknown as GradesService,
    {} as unknown as RemediationService,
  );

  try {
    await service.parentDashboard({ tenantId: TENANT, studentId: STUDENT });
  } catch (err) {
    // TOUT SAUF le sentinelle est une vraie panne et doit remonter : sans cette
    // discrimination, une erreur de harnais se lirait comme « rien capturé ».
    if (!(err instanceof CapturedAndAborted)) throw err;
  }
  return captured;
}

/* ================================================================== *
 * CAPTURE DE B — le vrai `GradesController.studentGrades`
 * ================================================================== */

async function captureB(roles: string[]): Promise<Row | undefined> {
  let captured: Row | undefined;

  const prisma = {
    student: {
      findUnique: jest.fn(async () => ({ id: STUDENT, tenantId: TENANT, schoolId: 'school-1' })),
    },
    grade: {
      findMany: jest.fn(async (args: { where: Row }) => {
        captured = args.where;
        throw new CapturedAndAborted();
      }),
    },
  };

  const controller = new GradesController(
    prisma as unknown as PrismaService,
    { ensureUser: jest.fn(async () => ({ id: 'user-1', tenantId: TENANT })) } as unknown as UserSyncService,
    {} as unknown as TeacherProfileService,
    {} as unknown as GradesService,
    { canAccessStudent: jest.fn(async () => true) } as unknown as StudentAccessService,
  );

  const jwt: KeycloakJwtPayload = { sub: 'sub-1', realm_access: { roles } };
  try {
    await controller.studentGrades(STUDENT, jwt);
  } catch (err) {
    if (!(err instanceof CapturedAndAborted)) throw err;
  }
  return captured;
}

/* ================================================================== *
 * LE HARNAIS EST-IL VIVANT ?
 * ================================================================== */

describe('le harnais capture bien les DEUX clauses de PRODUCTION', () => {
  it('A émet une lecture de notes et sa clause est capturée', async () => {
    const where = await captureA({ withActiveEnrollment: true });
    expect(where).toBeDefined();
    expect(where?.['studentId']).toBe(STUDENT);
    expect(where?.['tenantId']).toBe(TENANT);
  });

  it('B émet une lecture de notes et sa clause est capturée', async () => {
    const where = await captureB(['parent']);
    expect(where).toBeDefined();
    expect(where?.['studentId']).toBe(STUDENT);
    expect(where?.['tenantId']).toBe(TENANT);
  });

  it('le moteur de prédicat n’est pas vacant — il DISCRIMINE', () => {
    expect(idsMatching({ studentId: STUDENT })).toHaveLength(GRADES.length);
    expect(idsMatching({ studentId: 'quelqu’un d’autre' })).toEqual([]);
    expect(idsMatching({ status: { in: ['published'] } })).not.toHaveLength(GRADES.length);
  });
});

/* ================================================================== *
 * AC-5 — L'ACCORD SUR UNE FIXTURE
 * ================================================================== */

describe('AC-5 — A et B S’ACCORDENT sur le cas nominal', () => {
  it('même enfant, même note publiée de l’année active : MÊME ligne, MÊME compte', async () => {
    const whereA = await captureA({ withActiveEnrollment: true });
    const whereB = await captureB(['parent']);
    expect(whereA).toBeDefined();
    expect(whereB).toBeDefined();

    const baseline = GRADES.filter((g) => g.axis === 'accord');
    expect(baseline).toHaveLength(1);

    const onlyBaseline = (where: Row) =>
      baseline.filter((g) => matches(where, g)).map((g) => g.id);

    expect(onlyBaseline(whereA as Row)).toEqual(['g-baseline']);
    expect(onlyBaseline(whereB as Row)).toEqual(['g-baseline']);
    // Le compte, exigé par `AC-5`, mais dérivé du MÊME jeu de lignes plutôt que
    // de deux grandeurs incomparables.
    expect(onlyBaseline(whereA as Row).length).toBe(onlyBaseline(whereB as Row).length);
  });

  it('l’axe (d) STATUT est le seul où les deux clauses S’ACCORDENT DÉJÀ', async () => {
    const whereA = await captureA({ withActiveEnrollment: true });
    const whereB = await captureB(['parent']);
    // Ni l'une ni l'autre ne retient le `draft` : c'est le seul accord de fond
    // des quatre axes, et il doit le rester.
    expect(idsMatching(whereA as Row)).not.toContain('g-draft');
    expect(idsMatching(whereB as Row)).not.toContain('g-draft');
  });
});

/* ================================================================== *
 * AC-5 — LES QUATRE AXES DE DIVERGENCE, EXÉCUTABLES
 * ================================================================== */

describe('AC-5 — les axes de divergence sont ÉPINGLÉS, un cas exécutable par axe', () => {
  /**
   * Chaque ligne dit : « aujourd'hui, A retient/écarte, B retient/écarte ».
   * Une convergence future rendra ce tableau ROUGE — c'est le signal voulu, et
   * la réparation est de SUPPRIMER la ligne avec sa ligne de registre.
   */
  const AXES: ReadonlyArray<{ id: string; axis: string; inA: boolean; inB: boolean }> = [
    { id: 'g-other-year', axis: '(a) année scolaire — A filtre, B non', inA: false, inB: true },
    { id: 'g-absent', axis: '(b) isAbsent — A écarte, B garde', inA: false, inB: true },
    { id: 'g-zero', axis: '(c) valeur ZÉRO — les deux `where` la GARDENT', inA: true, inB: true },
    { id: 'g-draft', axis: '(d) statut — les deux écartent (ACCORD)', inA: false, inB: false },
  ];

  it.each(AXES)('$axis', async ({ id, inA, inB }) => {
    const whereA = await captureA({ withActiveEnrollment: true });
    const whereB = await captureB(['parent']);
    expect(idsMatching(whereA as Row).includes(id)).toBe(inA);
    expect(idsMatching(whereB as Row).includes(id)).toBe(inB);
  });

  it('AXE (a) bis — SANS inscription active, la lecture FILTRÉE PAR ANNÉE de A n’est jamais émise', async () => {
    // La forme la plus dure de l'axe année : ce n'est pas un `where` plus
    // étroit, c'est l'ABSENCE de la lecture qui alimente `subjectPerf`. Un
    // enfant sans inscription active voit `/parent/dashboard` afficher zéro note
    // par matière pendant que `/parent/grades` en affiche l'historique complet.
    //
    // CE QUE LE HARNAIS PEUT ET NE PEUT PAS AFFIRMER, ÉCRIT PLUTÔT QUE
    // SOUS-ENTENDU : « aucune requête `grade` du tout » serait FAUX et le test
    // le prouverait à l'envers. `parentDashboard` porte DEUX sites
    // `grade.findMany` — celui filtré par année (`analytics.service.ts:929`,
    // conditionné par `academicYearId`) et celui des « 5 dernières notes »
    // (`:1096`, INCONDITIONNEL). Sans inscription active, le premier est sauté
    // et l'exécution atteint le second ; le double capture donc bien un `where`,
    // mais c'est celui du SECOND site.
    //
    // On assied donc l'IDENTITÉ de la clause capturée, pas son absence : la
    // lecture par année est la SEULE des deux à porter une clause `assessment`
    // (`assessment: { teachingAssignment: { academicYearId } }`), si bien que
    // « pas de clé `assessment` » ⇔ « le site année n'a pas tiré ».
    const where = await captureA({ withActiveEnrollment: false });
    expect(where).toBeDefined();
    expect(where?.['assessment']).toBeUndefined();
    // NON-VACUITÉ : avec une inscription active, la MÊME sonde capture bien la
    // clause année — sans quoi l'assertion ci-dessus passerait sur un harnais
    // qui ne capture plus rien d'utile.
    const withYear = await captureA({ withActiveEnrollment: true });
    expect(withYear?.['assessment']).toBeDefined();
  });

  it('AXE (c) — le rejet du ZÉRO est dans la BOUCLE de A, pas dans son `where`', () => {
    // ÉPINGLAGE DE SOURCE. Il n'est pas capturable par le harnais (il vit après
    // la requête), et il est réel : `PF-339`.
    const SOURCE = readFileSync(join(__dirname, 'analytics.service.ts'), 'utf8');
    expect(SOURCE).toContain('if (!g.value) continue');

    // DÉMONSTRATION EXÉCUTABLE du prédicat épinglé ci-dessus : la note de ZÉRO
    // franchit le `where` de A puis se fait écarter par lui, tandis que B la
    // rend au parent. Le prédicat JUSTE — celui que `S-E03-3` devra poser — est
    // `g.value == null`, et il GARDE le zéro.
    const zero = GRADES.find((g) => g.id === 'g-zero');
    expect(zero).toBeDefined();
    const droppedByA = !zero!['value'];
    const keptByCorrectPredicate = zero!['value'] != null;
    expect(droppedByA).toBe(true);
    expect(keptByCorrectPredicate).toBe(true);
  });
});

/* ================================================================== *
 * DNC-01 — on ne crée pas une projection de plus en unifiant
 * ================================================================== */

describe('DNC-01 — le nombre de projections n’a pas augmenté', () => {
  it('A porte DEUX lectures de notes dans UNE réponse — résidu `PF-336`, pas une nouveauté', () => {
    // `subjectPerf` est filtré par année ; `recentGrades` (`:1096`) ne l'est
    // PAS et n'écarte pas les absences. Un parent lit donc, dans la MÊME
    // réponse, des moyennes de l'année courante au-dessus d'une liste qui ne
    // l'est pas. ÉPINGLÉ pour que la convergence n'en oublie pas la moitié.
    const SOURCE = readFileSync(join(__dirname, 'analytics.service.ts'), 'utf8');
    const reads = SOURCE.split('grade.' + 'findMany').length - 1;
    expect(reads).toBeGreaterThanOrEqual(2);
  });

  it('B n’a pas gagné de lecture de notes en changeant de garde', () => {
    const SOURCE = readFileSync(join(__dirname, '..', 'grades', 'grades.controller.ts'), 'utf8');
    expect(SOURCE.split('grade.' + 'findMany').length - 1).toBe(1);
  });
});
