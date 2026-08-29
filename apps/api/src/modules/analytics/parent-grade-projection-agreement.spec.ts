import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { type UserSyncService } from '../../shared/auth/user-sync.service';
import { type PrismaService } from '../../shared/prisma/prisma.service';
import { MeetingRequestsService } from '../alerts/meeting-requests.service';
import { GradesController } from '../grades/grades.controller';
import { type GradesService } from '../grades/grades.service';
import { type RemediationService } from '../remediation/remediation.service';
import { type SchoolContextService } from '../school-structure/school-context.service';
import { type StudentAccessService } from '../students/student-access.service';
import { StudentsController } from '../students/students.controller';
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
 * Il juge les `where`. L'axe (c) — le sort d'une note de ZÉRO — vit dans la
 * BOUCLE de regroupement de A, pas dans son `where` ; il est donc porté ici par
 * un ÉPINGLAGE DE SOURCE doublé d'une démonstration exécutable du prédicat.
 *
 * `PF-339` a été FALSIFIÉE par `S-E03-2b` : `value` est un `Prisma.Decimal`,
 * donc un objet, donc `!Decimal(0)` vaut `false` et le zéro était gardé — par
 * ACCIDENT, puisque la sûreté tenait au seul fait que la valeur arrive brute.
 * Les quatre sites portent depuis le prédicat explicite, et l'épinglage
 * ci-dessous s'est inversé en garde de non-régression. Voir `ADR-084`.
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
        schoolId: 'school-1',
        school: { name: 'École' },
        // S-E03-3 / ADR-072 — la fixture porte désormais `id`, `status`,
        // `enrolledAt` et `_count` : ce sont les champs que la sélection
        // canonique DÉCLARE lire. Une fixture qui les omet ne teste pas le code,
        // elle teste `undefined` (DNC-06).
        enrollments: opts.withActiveEnrollment
          ? [
              {
                id: 'enr-1',
                status: 'active',
                enrolledAt: new Date('2025-09-01T00:00:00.000Z'),
                endedAt: null,
                academicYearId: ACTIVE_YEAR,
                classSectionId: 'cs-1',
                classSection: { gradeLevelId: 'gl-1', gradeLevel: { id: 'gl-1', name: '6e' } },
                academicYear: { id: ACTIVE_YEAR, name: '2025-2026', status: 'active' },
              },
            ]
          : [],
        _count: { enrollments: opts.withActiveEnrollment ? 1 : 0 },
      })),
    },
    // S-E03-3 — le résolveur canonique d'année (ADR-070) est désormais sur ce
    // chemin : `parentDashboard` AFFIRME l'activité à travers lui. Il rend `[]`
    // ici, donc `activeEnrollment` est `null` — et c'est précisément le cas que
    // la spec d'accord de S-E03-3 exploite : la FENÊTRE de reporting, elle, reste
    // dérivée de l'inscription, donc la capture ci-dessous a toujours lieu.
    academicYear: { findMany: jest.fn(async () => []) },
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

  it('AXE (c) — la BOUCLE de A porte le prédicat NULL-SÛR, et plus la truthiness', () => {
    // ÉPINGLAGE DE SOURCE, RETOURNÉ PAR `S-E03-2b`.
    //
    // Cette assertion épinglait `if (!g.value) continue` — la PRÉSENCE du défaut,
    // parce que `PF-339` était alors ouvert et que le pin servait à dire OÙ il
    // vivait (dans la boucle de regroupement de A, pas dans son `where`, donc
    // hors de portée du harnais qui capture les `where`).
    //
    // `S-E03-2b` a remplacé les quatre sites par le prédicat explicite. Le pin
    // ne disparaît pas pour autant : il s'INVERSE en garde de NON-RÉGRESSION,
    // ce qui est strictement plus fort que ce qu'il affirmait avant — il
    // interdit désormais le retour de l'idiome au lieu de constater sa présence.
    // Voir `ADR-084`.
    const SOURCE = readFileSync(join(__dirname, 'analytics.service.ts'), 'utf8');
    expect(SOURCE).not.toContain('if (!g.value) continue');
    expect(SOURCE).not.toContain('if (!cy || !g.value) continue');

    // NON-VACUITÉ : le prédicat de remplacement est bien LÀ, sans quoi les deux
    // assertions ci-dessus passeraient tout aussi bien sur un fichier où la
    // boucle entière aurait disparu.
    //
    // DÉLIBÉRÉMENT UN TÉMOIN, PAS UN PLANCHER DE COMPTE. Le fichier porte huit
    // sites au prédicat sûr (quatre d'avant la tranche, quatre qu'elle a
    // convertis), et épingler `>= 8` — ou même `>= 4` — plancherait sur une
    // classe que la roadmap fait BAISSER : `S-E03-3` converge ces projections et
    // supprimera légitimement des boucles. Un tel plancher rougirait alors sur
    // du travail correct, ce qui est précisément le piège que documente
    // `ADR-068`. La garde qui porte la classe est l'assertion UNIVERSELLE
    // ci-dessus (« aucun site n'emploie l'idiome truthiness », ensemble fermé) ;
    // celle-ci ne fait qu'attester que le sujet n'a pas disparu.
    const safe = SOURCE.split('g.value === null || g.value === undefined').length - 1;
    expect(safe).toBeGreaterThanOrEqual(1);

    // DÉMONSTRATION EXÉCUTABLE de ce que le changement achète. La note de ZÉRO
    // franchit le `where` de A ; ce qui décidait ensuite de son sort, c'était le
    // prédicat. Sur la valeur NUMÉRISÉE — la forme que produit tout `Number()`
    // en amont, et le seul axe où la truthiness était atteignable — l'ancien
    // prédicat la supprime et le nouveau la garde.
    const zero = GRADES.find((g) => g.id === 'g-zero');
    expect(zero).toBeDefined();
    const numeric = Number(zero!['value']);
    expect(numeric).toBe(0);
    const droppedByOldPredicate = !numeric;
    const keptByNewPredicate = !(numeric === null || numeric === undefined);
    expect(droppedByOldPredicate).toBe(true);
    expect(keptByNewPredicate).toBe(true);
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

/* ================================================================================ *
 *                                                                                  *
 *  S-E03-3 / PF-12 / ADR-072 — AC-5 : L'ACCORD SUR « CET ENFANT EST-IL             *
 *  ACTIVEMENT INSCRIT ? », À TRAVERS LES CINQ PROJECTIONS                          *
 *                                                                                  *
 * ================================================================================ */

/**
 * POURQUOI CETTE SECTION VIT ICI ET PAS DANS UN FICHIER À ELLE
 * ------------------------------------------------------------
 * `AC-5` exige de RÉUTILISER la machinerie ci-dessus — le sentinelle
 * `CapturedAndAborted` et l'UNIQUE moteur de prédicat — et interdit d'écrire un
 * SECOND moteur de capture. Deux hébergements seulement étaient sanctionnés :
 * étendre cette spec EN PLACE, ou extraire la machinerie vers
 * `scripts/lib/projection-agreement.js`. Un helper `.ts` sorti d'ici vers
 * `apps/api/src` EXPÉDIERAIT de l'outillage de test dans `apps/api/dist`
 * (`tsconfig.build.json` n'exclut que les specs). C'est donc l'extension EN
 * PLACE — même sentinelle, même fichier, zéro second moteur.
 *
 * CE QUE CETTE SECTION PROUVE, ET CE QU'ELLE NE PROUVE PAS
 * --------------------------------------------------------
 * Elle prouve que les CINQ projections SERVEUR rendent le MÊME verdict sur la
 * MÊME fixture, en exécutant le VRAI code de production au-dessus de doubles
 * Prisma. Elle NE prouve PAS que les surfaces web ne re-dérivent plus :
 * `apps/web` n'a aucun runner unitaire, et cette moitié-là est portée par le
 * CLIQUET (`apps/api/src/shared/quality/enrollment-activity-derivation-gate.spec.ts`).
 * Deux affirmations, deux mécanismes. Laisser croire à un accord EXÉCUTÉ sur
 * quatre portails serait exactement le `DNC-06` que cette tranche ferme.
 *
 * LE ROUGE-AVANT EST TRANSCRIT, ET C'EST ASSUMÉ
 * ---------------------------------------------
 * Les quatre dérivations historiques (P1..P4) sont RECOPIÉES plus bas comme
 * fonctions pures. Ce n'est pas une entorse à « ne jamais retaper la
 * production » : elles ont été SUPPRIMÉES de la production par cette tranche,
 * donc il n'y a plus rien à capturer. Elles figurent ici en PIÈCES À CONVICTION,
 * pour que la contradiction d'avant reste démontrable après le correctif.
 */

const AY_CANON = 'ay-canonical';
const AY_OTHER = 'ay-other';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

type EnrolFixture = {
  id: string;
  status: string;
  enrolledAt: Date;
  endedAt: Date | null;
  academicYearId: string;
  classSectionId: string;
  classSection: {
    id: string;
    name: string;
    gradeLevelId: string;
    gradeLevel: { id: string; name: string };
  };
  academicYear: { id: string; name: string; status: string; startDate: Date; endDate: Date };
};

function section(id: string, name: string, glId: string, glName: string) {
  return { id, name, gradeLevelId: glId, gradeLevel: { id: glId, name: glName } };
}

function enrol(over: Partial<EnrolFixture> & { id: string }): EnrolFixture {
  const yearId = over.academicYearId ?? AY_CANON;
  const base: EnrolFixture = {
    id: over.id,
    status: 'active',
    enrolledAt: new Date('2025-09-01T00:00:00.000Z'),
    endedAt: null,
    academicYearId: yearId,
    classSectionId: 'cs-default',
    classSection: section('cs-default', '6eA', 'gl-1', '6e'),
    academicYear: {
      id: yearId,
      name: yearId === AY_CANON ? '2025-2026' : '2024-2025',
      // ⚠ `AcademicYear.status` est une colonne INDÉPENDANTE de la canonicité :
      // ici l'année NON canonique est elle aussi marquée `active`, ce qui est
      // parfaitement légal en base — et c'est EXACTEMENT le piège de l'axe 1.
      status: 'active',
      startDate: new Date('2025-09-01T00:00:00.000Z'),
      endDate: new Date('2026-07-05T00:00:00.000Z'),
    },
  };
  return { ...base, ...over };
}

/**
 * LES TROIS ENFANTS DU ROUGE-AVANT, plus une ligne de base.
 *
 *  W — inscription active dans l'année CANONIQUE. Toutes les dérivations,
 *      l'ancienne comme la neuve, disent « actif ». C'est le CONTRÔLE POSITIF :
 *      sans lui, un comparateur toujours-« inactif » satisferait tous les cas.
 *  X — inscription ACTIVE dans une année NON canonique. C'est l'enfant que le
 *      dashboard décrivait « inscrit en 2nde A » pendant que la liste disait
 *      « aucune inscription active ». Il porte AUSSI le BLOQUANT 1 : sa FENÊTRE
 *      de reporting doit SURVIVRE alors que son verdict d'activité est négatif.
 *  Y — UNIQUEMENT `graduated`. C'est l'enfant qui lisait « Inscription active »
 *      en VERT à cause du repli `?? enrollments[0]`.
 *  Z — DEUX lignes ACTIVES, MÊME année canonique, DEUX sections, `enrolledAt`
 *      différents. Légal aujourd'hui (l'index unique porte
 *      `[studentId, classSectionId, academicYearId]`), donc l'ordre total est
 *      PORTEUR DE CHARGE et pas décoratif.
 */
const CHILD_ROWS: Record<string, EnrolFixture[]> = {
  W: [enrol({ id: 'w-1', classSectionId: 'cs-w', classSection: section('cs-w', '6eA', 'gl-1', '6e') })],
  X: [
    enrol({
      id: 'x-1',
      academicYearId: AY_OTHER,
      classSectionId: 'cs-x',
      classSection: section('cs-x', '2nde A', 'gl-2', '2nde'),
    }),
  ],
  Y: [
    enrol({
      id: 'y-1',
      status: 'graduated',
      academicYearId: AY_OTHER,
      endedAt: new Date('2025-07-01T00:00:00.000Z'),
      classSectionId: 'cs-y',
      classSection: section('cs-y', '3ème B', 'gl-3', '3ème'),
    }),
  ],
  Z: [
    enrol({
      id: 'z-early',
      enrolledAt: new Date('2025-09-01T00:00:00.000Z'),
      classSectionId: 'cs-z-early',
      classSection: section('cs-z-early', '5eA', 'gl-4', '5e'),
    }),
    enrol({
      id: 'z-late',
      enrolledAt: new Date('2025-11-15T00:00:00.000Z'),
      classSectionId: 'cs-z-late',
      classSection: section('cs-z-late', '5eB', 'gl-4', '5e'),
    }),
  ],
};

/** L'année canonique, telle que le résolveur d'ADR-070 la lira. */
const CANONICAL_YEAR_ROW = {
  id: AY_CANON,
  schoolId: SCHOOL_A,
  name: '2025-2026',
  startDate: new Date('2025-09-01T00:00:00.000Z'),
  endDate: new Date('2026-07-05T00:00:00.000Z'),
  status: 'active',
};

/** La SECONDE école, avec sa PROPRE année active (HAUT 2 / axe 4). */
const CANONICAL_YEAR_ROW_B = {
  id: 'ay-canonical-b',
  schoolId: SCHOOL_B,
  name: '2025-2026 (B)',
  startDate: new Date('2025-09-01T00:00:00.000Z'),
  endDate: new Date('2026-07-05T00:00:00.000Z'),
  status: 'active',
};

function studentRow(child: string, schoolId: string = SCHOOL_A, rows?: EnrolFixture[]) {
  const enrollments = rows ?? (CHILD_ROWS[child] as EnrolFixture[]);
  return {
    id: `student-${child}`,
    tenantId: TENANT,
    schoolId,
    firstName: 'Enfant',
    lastName: child,
    photoUrl: null,
    externalRef: null,
    birthDate: null,
    school: { name: 'École' },
    enrollments,
    _count: { enrollments: enrollments.length, guardianships: 0 },
    guardianships: [],
  };
}

/* ------------------------------------------------------------------ *
 * LES QUATRE DÉRIVATIONS HISTORIQUES — pièces à conviction
 * ------------------------------------------------------------------ */

type Historic = 'active' | 'inactive';

/** P1 — dashboard : `student.enrollments[0]?.classSection`, en ordre de retour serveur. */
const historicP1 = (rows: EnrolFixture[]): Historic =>
  rows[0]?.classSection ? 'active' : 'inactive';

/** P2 — fiche enfant : `find(status === 'active') ?? enrollments[0]`, sur un payload NON filtré. */
const historicP2 = (rows: EnrolFixture[]): Historic =>
  (rows.find((e) => e.status === 'active') ?? rows[0]) ? 'active' : 'inactive';

/**
 * P3/P4 — liste enfants et « Ma famille » : `find(e => e.academicYear.status === 'active')`.
 *
 * ⚠ CE N'ÉTAIT PAS DÉPENDANT DES DONNÉES, C'ÉTAIT INCONDITIONNEL. `GET /students`
 * ne sélectionnait que `academicYear: { select: { id, name } }`, donc `status`
 * n'était JAMAIS envoyé, donc `undefined === 'active'` valait `false` pour TOUS
 * les enfants : « CLASSES ACTIVES » était structurellement `0` et le badge
 * lisait toujours « Aucune inscription active ». `DNC-06` à l'état pur, reproduit
 * ici par la projection AMPUTÉE plutôt que décrit en prose.
 */
const historicP3 = (rows: EnrolFixture[]): Historic => {
  const asShipped = rows.map((e) => ({
    status: e.status,
    academicYear: { id: e.academicYear.id, name: e.academicYear.name } as {
      id: string;
      name: string;
      status?: string;
    },
  }));
  return asShipped.find((e) => e.academicYear.status === 'active') ? 'active' : 'inactive';
};

/* ------------------------------------------------------------------ *
 * LES CINQ CAPTURES — le VRAI code de production, sur des doubles
 * ------------------------------------------------------------------ */

type ActivityVerdict = {
  state: string;
  classSectionName: string | null;
  scopeLabel: string;
};

const academicYearDouble = (rows: unknown[] = [CANONICAL_YEAR_ROW]) => ({
  findMany: jest.fn(async (args: { where: { schoolId?: string; status?: string } }) => {
    // Le double honore les DEUX clauses du résolveur canonique : sans le filtre
    // de statut, la branche de repli d'ADR-070 ne serait jamais exercée.
    const out = rows.filter((r) => {
      const row = r as { schoolId: string; status: string };
      if (args.where.schoolId !== undefined && row.schoolId !== args.where.schoolId) return false;
      if (args.where.status !== undefined && row.status !== args.where.status) return false;
      return true;
    });
    return out;
  }),
});

/** B1 — `AnalyticsService.parentDashboard`, exécuté JUSQU'AU BOUT. */
async function verdictB1(
  child: string,
): Promise<{ verdict: ActivityVerdict; gradeWheres: Row[]; include: Row }> {
  const gradeWheres: Row[] = [];
  let include: Row = {};
  const prisma = {
    student: {
      findFirst: jest.fn(async (args: { include: Row }) => {
        include = args.include;
        return studentRow(child);
      }),
      findMany: jest.fn(async () => []),
    },
    academicYear: { ...academicYearDouble(), findFirst: jest.fn(async () => null) },
    grade: {
      findMany: jest.fn(async (args: { where: Row }) => {
        // TOUTES les clauses sont collectées : parentDashboard emet plusieurs
        // lectures de notes (subjectPerf fenetre par annee, recentGrades non).
        // Ne garder que la derniere ferait juger la mauvaise.
        gradeWheres.push(args.where);
        return [];
      }),
    },
    subjectCoefficient: { findMany: jest.fn(async () => []) },
    assessment: { findMany: jest.fn(async () => []) },
    attendanceRecord: { findMany: jest.fn(async () => []) },
    teachingAssignment: { findMany: jest.fn(async () => []) },
    studentGlobalSnapshot: { findFirst: jest.fn(async () => null) },
    studentSubjectSnapshot: { findMany: jest.fn(async () => []) },
    classSubjectDistribution: { findMany: jest.fn(async () => []) },
    snapshotRecomputeTrigger: { findFirst: jest.fn(async () => null) },
  };
  const service = new AnalyticsService(
    prisma as unknown as PrismaService,
    { statsForStudent: jest.fn(async () => ({ overallAverage: null })) } as unknown as GradesService,
    { remediationProgress: jest.fn(async () => []) } as unknown as RemediationService,
  );
  const payload = await service.parentDashboard({ tenantId: TENANT, studentId: `student-${child}` });
  const a = payload.enrollmentActivity;
  return {
    verdict: { state: a.state, classSectionName: a.classSectionName, scopeLabel: a.scopeLabel },
    gradeWheres,
    include,
  };
}

/** B2 — `AnalyticsService.parentUpcoming`. */
async function verdictB2(child: string): Promise<ActivityVerdict> {
  const prisma = {
    student: { findFirst: jest.fn(async () => studentRow(child)) },
    academicYear: academicYearDouble(),
    assessment: { findMany: jest.fn(async () => []) },
    subjectCoefficient: { findMany: jest.fn(async () => []) },
  };
  const service = new AnalyticsService(
    prisma as unknown as PrismaService,
    {} as unknown as GradesService,
    {} as unknown as RemediationService,
  );
  const payload = await service.parentUpcoming({ tenantId: TENANT, studentId: `student-${child}` });
  const a = payload.enrollmentActivity;
  return { state: a.state, classSectionName: a.classSectionName, scopeLabel: a.scopeLabel };
}

function studentsController(prisma: Record<string, unknown>) {
  return new StudentsController(
    prisma as unknown as PrismaService,
    { ensureUser: jest.fn(async () => ({ id: 'u1', tenantId: TENANT })) } as unknown as UserSyncService,
    {
      forUser: jest.fn(async () => ({ schoolId: SCHOOL_A, activeAcademicYearId: AY_CANON })),
    } as unknown as SchoolContextService,
    {
      scopeForUser: jest.fn(async () => ({ studentIds: null, reason: 'test' })),
      canAccessStudent: jest.fn(async () => true),
    } as unknown as StudentAccessService,
  );
}

type ListPayload = {
  data: Array<{
    id: string;
    enrollmentActivity: { state: string; classSectionName: string | null; scopeLabel: string };
  }>;
};

/** B3 — `GET /students` (liste). */
async function verdictB3(
  child: string,
): Promise<{ verdict: ActivityVerdict; yearCalls: number; include: Row }> {
  let include: Row = {};
  const findMany = jest.fn(async (args: { include: Row }) => {
    include = args.include;
    return [studentRow(child)];
  });
  const year = academicYearDouble();
  const controller = studentsController({
    student: { findMany, count: jest.fn(async () => 1) },
    academicYear: year,
  });
  const res = (await controller.list({ sub: 'kc' } as unknown as KeycloakJwtPayload)) as ListPayload;
  const a = res.data[0]!.enrollmentActivity;
  return {
    verdict: { state: a.state, classSectionName: a.classSectionName, scopeLabel: a.scopeLabel },
    yearCalls: year.findMany.mock.calls.length,
    include,
  };
}

/** B4 — `GET /students/:id` (fiche). */
async function verdictB4(
  child: string,
): Promise<{ verdict: ActivityVerdict; history: EnrolFixture[]; include: Row }> {
  let include: Row = {};
  const findUnique = jest.fn(async (args: { include: Row }) => {
    include = args.include;
    return studentRow(child);
  });
  const controller = studentsController({
    student: { findUnique },
    academicYear: academicYearDouble(),
  });
  const res = (await controller.getOne(`student-${child}`, {
    sub: 'kc',
  } as unknown as KeycloakJwtPayload)) as unknown as {
    enrollments: EnrolFixture[];
    enrollmentActivity: { state: string; classSectionName: string | null; scopeLabel: string };
  };
  const a = res.enrollmentActivity;
  return {
    verdict: { state: a.state, classSectionName: a.classSectionName, scopeLabel: a.scopeLabel },
    history: res.enrollments,
    include,
  };
}

/** B5 — `MeetingRequestsService.list`. */
async function verdictB5(child: string): Promise<{ verdict: ActivityVerdict; include: Row }> {
  let include: Row = {};
  // ⚠ La projection de B5 ne fournit que le jeu CANDIDAT (`status: 'active'`),
  // exactement comme la vraie requête : le total passe par `_count`.
  const rows = [
    {
      id: 'mr-1',
      status: 'open',
      alertId: 'a-1',
      alertCode: 'LOW_SUBJECT_AVG',
      studentId: `student-${child}`,
      subjectId: null,
      assignedToId: null,
      resolvedAt: null,
      createdAt: new Date('2026-06-04T10:00:00.000Z'),
      alert: { title: 'x', severity: 'high' },
      student: {
        firstName: 'Enfant',
        lastName: child,
        enrollments: (CHILD_ROWS[child] as EnrolFixture[]).filter((e) => e.status === 'active'),
        _count: { enrollments: (CHILD_ROWS[child] as EnrolFixture[]).length },
      },
      subject: null,
      requester: { firstName: 'M', lastName: 'M' },
      assignedTo: null,
    },
  ];
  const prisma = {
    meetingRequest: {
      findMany: jest.fn(async (args: { include: Row }) => {
        include = args.include;
        return rows;
      }),
      count: jest.fn(async () => 1),
    },
    academicYear: academicYearDouble(),
  };
  const scope = {
    run: jest.fn(async (_t: string, fn: (tx: unknown) => Promise<unknown>) => fn(prisma)),
  };
  const service = new MeetingRequestsService(scope as never);
  const res = await service.list({
    tenantId: TENANT,
    schoolId: SCHOOL_A,
    scope: { kind: 'admin' },
    status: 'open',
    limit: 20,
    offset: 0,
  });
  const dto = res.data[0]!;
  return {
    verdict: {
      state: dto.enrollmentActivityState,
      classSectionName: dto.classSectionName,
      scopeLabel: dto.enrollmentScopeLabel,
    },
    include,
  };
}

/* ================================================================== *
 * LE HARNAIS EST-IL VIVANT ? (le contrôle positif du contrôle)
 * ================================================================== */

describe('S-E03-3 — le harnais exécute bien les CINQ projections de PRODUCTION', () => {
  it('W (inscription active dans l’année canonique) est ACTIF partout', async () => {
    const b1 = await verdictB1('W');
    const b2 = await verdictB2('W');
    const b3 = await verdictB3('W');
    const b4 = await verdictB4('W');
    const b5 = await verdictB5('W');
    for (const v of [b1.verdict, b2, b3.verdict, b4.verdict, b5.verdict]) {
      expect(v.state).toBe('active');
      expect(v.classSectionName).toBe('6eA');
    }
  });

  it('les cinq projections ont réellement RÉSOLU l’année à travers `resolveActiveAcademicYear`', async () => {
    // Sans cette assertion, un double qui n'est jamais appelé rendrait
    // « pas d'année canonique » et TOUT le monde s'accorderait sur `out_of_scope`
    // — un accord obtenu par panne, pas par convergence.
    const b3 = await verdictB3('W');
    expect(b3.yearCalls).toBeGreaterThanOrEqual(1);
  });
});

/* ================================================================== *
 * ROUGE-AVANT — les dérivations historiques SE CONTREDISENT
 * ================================================================== */

describe('S-E03-3 ROUGE-AVANT — les quatre dérivations historiques divergeaient', () => {
  const AXES = [
    {
      child: 'X',
      why: 'inscription ACTIVE dans une année NON canonique (axe 1)',
      p1: 'active' as Historic,
      p2: 'active' as Historic,
      p3: 'inactive' as Historic,
    },
    {
      child: 'Y',
      why: 'UNIQUEMENT `graduated` — le repli `?? enrollments[0]` mentait en VERT (axe 2)',
      p1: 'active' as Historic,
      p2: 'active' as Historic,
      p3: 'inactive' as Historic,
    },
  ];

  it.each(AXES)('$child — $why : P1/P2 disent « actif », P3/P4 disent « inactif »', (axis) => {
    const rows = CHILD_ROWS[axis.child] as EnrolFixture[];
    expect(historicP1(rows)).toBe(axis.p1);
    expect(historicP2(rows)).toBe(axis.p2);
    expect(historicP3(rows)).toBe(axis.p3);
    // LA CONTRADICTION, énoncée plutôt que déduite du tableau.
    expect(historicP1(rows)).not.toBe(historicP3(rows));
  });

  it('W — le contrôle POSITIF : sur le cas nominal les quatre S’ACCORDAIENT DÉJÀ… sauf P3', () => {
    const rows = CHILD_ROWS['W'] as EnrolFixture[];
    expect(historicP1(rows)).toBe('active');
    expect(historicP2(rows)).toBe('active');
    // P3 est faux même ici : `academicYear.status` n'était JAMAIS envoyé par
    // `GET /students`. Le défaut n'était pas dépendant des données, il était
    // INCONDITIONNEL — `DNC-06`.
    expect(historicP3(rows)).toBe('inactive');
  });
});

/* ================================================================== *
 * VERT-APRÈS — les cinq projections s'accordent, axe par axe
 * ================================================================== */

describe('AC-5 — les CINQ projections rendent le MÊME verdict sur la MÊME fixture', () => {
  const AXES = [
    { child: 'W', state: 'active', section: '6eA' },
    { child: 'X', state: 'out_of_scope', section: null },
    { child: 'Y', state: 'out_of_scope', section: null },
    { child: 'Z', state: 'active', section: '5eB' },
  ];

  it.each(AXES)('$child — verdict identique en B1, B2, B3, B4 et B5 ($state)', async (axis) => {
    const b1 = await verdictB1(axis.child);
    const b2 = await verdictB2(axis.child);
    const b3 = await verdictB3(axis.child);
    const b4 = await verdictB4(axis.child);
    const b5 = await verdictB5(axis.child);

    const verdicts = [b1.verdict, b2, b3.verdict, b4.verdict, b5.verdict];
    for (const v of verdicts) expect(v.state).toBe(axis.state);

    // L'ACCORD porte aussi sur le LABEL DE PORTÉE (ADR-041 §D3) : deux surfaces
    // qui s'accordent sur l'état mais pas sur la portée affichée ne s'accordent
    // qu'à moitié.
    const labels = new Set(verdicts.map((v) => v.scopeLabel));
    expect([...labels]).toHaveLength(1);

    // …et sur la classe AFFIRMÉE quand il y en a une.
    if (axis.section !== null) {
      for (const v of [b1.verdict, b2, b3.verdict, b4.verdict]) {
        expect(v.classSectionName).toBe(axis.section);
      }
    }
  });

  it('Z — DEUX lignes actives la même année : l’ordre total tranche, et il tranche PAREIL partout', async () => {
    // C'est la preuve que l'ordre total est PORTEUR DE CHARGE : deux lignes
    // actives dans la même année sont légales (l'index unique porte la SECTION),
    // et `enrolledAt desc, id desc` désigne `5eB` sans ambiguïté — depuis les
    // cinq projections, y compris celles qui ne trient pas côté SQL.
    const b1 = await verdictB1('Z');
    const b4 = await verdictB4('Z');
    expect(b1.verdict.classSectionName).toBe('5eB');
    expect(b4.verdict.classSectionName).toBe('5eB');
  });

  it('Z — l’ordre reste total même quand la base rend les lignes à l’ENVERS', async () => {
    // Un tri JS qui ne ferait que « garder l'ordre reçu » passerait le test
    // précédent par coïncidence. On inverse donc la source.
    const reversed = [...(CHILD_ROWS['Z'] as EnrolFixture[])].reverse();
    const findUnique = jest.fn(async () => studentRow('Z', SCHOOL_A, reversed));
    const controller = studentsController({
      student: { findUnique },
      academicYear: academicYearDouble(),
    });
    const res = (await controller.getOne('student-Z', {
      sub: 'kc',
    } as unknown as KeycloakJwtPayload)) as unknown as {
      enrollmentActivity: { classSectionName: string | null; candidateCount: number };
    };
    expect(res.enrollmentActivity.classSectionName).toBe('5eB');
    expect(res.enrollmentActivity.candidateCount).toBe(2);
  });
});

/* ================================================================== *
 * BLOQUANT 1 — la canonicalisation ne VIDE PAS le dashboard parent
 * ================================================================== */

describe('AC-2 — le champ canonique change ce qui est AFFIRMÉ, jamais la clé de FENÊTRAGE', () => {
  it('X — `activeEnrollment` est négatif ET la lecture de notes est TOUJOURS émise, fenêtrée', async () => {
    // C'EST LE TEST QUI DISCRIMINE. Si la clé de fenêtrage était devenue
    // canonique, `academicYearId` serait `undefined`, `grade.findMany` ne serait
    // JAMAIS appelé, et notes/alertes/assiduité/évolution retomberaient à zéro
    // pour exactement les enfants que cette tranche existe pour servir.
    const b1 = await verdictB1('X');
    expect(b1.verdict.state).toBe('out_of_scope');
    const windowed = b1.gradeWheres.filter((w) => w['assessment'] !== undefined);
    expect(windowed.length).toBeGreaterThanOrEqual(1);
    for (const w of windowed) {
      const assessment = w['assessment'] as { teachingAssignment: { academicYearId: string } };
      expect(assessment.teachingAssignment.academicYearId).toBe(AY_OTHER);
    }
  });

  it('Y — aucune ligne ACTIVE : la fenêtre s’effondre honnêtement, sans repli sur une ligne arbitraire', async () => {
    // La contrepartie de l'assertion précédente : la fenêtre suit la précédence
    // HISTORIQUE (`status: 'active'` le plus récent), donc un enfant qui n'a que
    // du `graduated` n'a pas de fenêtre — comme AVANT cette tranche. Ce qui est
    // interdit, c'est de REMPLIR la fenêtre avec une ligne diplômée.
    const b1 = await verdictB1('Y');
    expect(b1.verdict.state).toBe('out_of_scope');
    expect(b1.verdict.classSectionName).toBeNull();
  });
});

/* ================================================================== *
 * G-TENANT + N+1 — les DEUX propriétés de la nouvelle requête
 * ================================================================== */

describe('G-TENANT / N+1 — la résolution d’année est TENANT-KEYÉE et HISSÉE', () => {
  it('la résolution porte TOUJOURS `tenantId` — un `where` sans tenant est inexprimable', async () => {
    const year = academicYearDouble();
    const controller = studentsController({
      student: { findMany: jest.fn(async () => [studentRow('W')]), count: jest.fn(async () => 1) },
      academicYear: year,
    });
    await controller.list({ sub: 'kc' } as unknown as KeycloakJwtPayload);
    expect(year.findMany.mock.calls.length).toBeGreaterThanOrEqual(1);
    for (const call of year.findMany.mock.calls) {
      const where = (call[0] as { where: Record<string, unknown> }).where;
      expect(where['tenantId']).toBe(TENANT);
    }
  });

  it('un identifiant d’ÉCOLE ÉTRANGÈRE ne rend rien — la clé tenant est dans le `where`, pas dans un commentaire', async () => {
    // Le double filtre exactement comme Postgres : une école qui n'a pas d'année
    // canonique rend `null`, donc l'enfant est `out_of_scope`, JAMAIS l'année
    // d'une autre école.
    const findMany = jest.fn(async () => [studentRow('W', 'school-foreign')]);
    const controller = studentsController({
      student: { findMany, count: jest.fn(async () => 1) },
      academicYear: academicYearDouble(),
    });
    const res = (await controller.list({ sub: 'kc' } as unknown as KeycloakJwtPayload)) as ListPayload;
    expect(res.data[0]!.enrollmentActivity.state).toBe('out_of_scope');
  });

  it('200 élèves d’UNE école ⇒ UNE résolution d’année, pas 200 (GUARDRAILS §2)', async () => {
    // Le N+1 le plus cher du produit : `GET /students` rend jusqu'à 200 lignes.
    // Le plafond est ASSERTABLE, pas un commentaire.
    const many = Array.from({ length: 200 }, (_, i) => ({
      ...studentRow('W'),
      id: `student-w-${i}`,
    }));
    const year = academicYearDouble();
    const controller = studentsController({
      student: { findMany: jest.fn(async () => many), count: jest.fn(async () => 200) },
      academicYear: year,
    });
    await controller.list({ sub: 'kc' } as unknown as KeycloakJwtPayload);
    expect(year.findMany.mock.calls.length).toBe(1);
  });

  it('DEUX écoles, DEUX années actives ⇒ les DEUX enfants sont ACTIFS (axe 4 / HAUT 2)', async () => {
    // Sans le keyage sur `student.schoolId`, la « correction » déclarerait non
    // inscrits tous les enfants de l'école minoritaire : PF-12 reproduit dans
    // son propre correctif, sur un axe neuf.
    const rowsB: EnrolFixture[] = [
      enrol({
        id: 'b-1',
        academicYearId: 'ay-canonical-b',
        classSectionId: 'cs-b',
        classSection: section('cs-b', '4eB', 'gl-5', '4e'),
      }),
    ];
    const many = [studentRow('W', SCHOOL_A), studentRow('B', SCHOOL_B, rowsB)];
    const year = academicYearDouble([CANONICAL_YEAR_ROW, CANONICAL_YEAR_ROW_B]);
    const controller = studentsController({
      student: { findMany: jest.fn(async () => many), count: jest.fn(async () => 2) },
      academicYear: year,
    });
    const res = (await controller.list({ sub: 'kc' } as unknown as KeycloakJwtPayload)) as ListPayload;
    expect(res.data.map((d) => d.enrollmentActivity.state)).toEqual(['active', 'active']);
    // …et UNE résolution PAR ÉCOLE DISTINCTE, pas par élève.
    expect(year.findMany.mock.calls.length).toBe(2);
  });
});

/* ================================================================== *
 * DNC-06 — la PROJECTION livre ce que le contrat DÉCLARE lire
 * ================================================================== */

describe('DNC-06 — chaque champ que la sélection canonique lit EST dans la projection qui l’alimente', () => {
  /**
   * LE DÉFAUT MESURÉ ÉTAIT EXACTEMENT CELUI-LÀ, à l'envers : le type client
   * déclarait `academicYear.status` non-optionnel et la projection serveur ne
   * l'envoyait jamais. Un accord de `where` ne l'aurait PAS vu — le mécanisme
   * vivait dans un `select` incomplet, pas dans un `where`. On juge donc AUSSI
   * les projections.
   */
  const REQUIRED_SCALARS = ['id', 'status', 'enrolledAt', 'academicYearId'];

  it('B1 / B2 / B3 / B4 emploient `include` sur `enrollments` — tous les scalaires arrivent', async () => {
    const shapes = [
      ['B1', (await verdictB1('W')).include],
      ['B3', (await verdictB3('W')).include],
      ['B4', (await verdictB4('W')).include],
    ] as const;
    for (const [name, include] of shapes) {
      const enrollments = (include as Record<string, Record<string, unknown>>)['enrollments'];
      expect({ name, defined: enrollments !== undefined }).toEqual({ name, defined: true });
      // `include` (et non `select`) ⇒ Prisma rend TOUS les scalaires du modèle.
      // Un `select` ici DEVRAIT énumérer les scalaires requis : l'assertion
      // suivante le vérifie plutôt que de le supposer.
      const select = enrollments!['select'] as Record<string, unknown> | undefined;
      if (select !== undefined) {
        for (const field of REQUIRED_SCALARS) {
          expect({ name, field, present: select[field] === true }).toEqual({
            name,
            field,
            present: true,
          });
        }
      }
    }
  });

  it('B5 emploie un `select` — il DOIT donc énumérer les scalaires que le contrat lit', async () => {
    const include = (await verdictB5('W')).include as Record<string, Record<string, unknown>>;
    const student = include['student'] as Record<string, Record<string, unknown>>;
    const enrollments = (student['select'] as Record<string, Record<string, unknown>>)['enrollments'];
    const select = enrollments!['select'] as Record<string, unknown>;
    for (const field of REQUIRED_SCALARS) {
      expect({ field, present: select[field] === true }).toEqual({ field, present: true });
    }
    // …et le TOTAL, sans lequel « diplômé » deviendrait « aucun dossier ».
    expect((student['select'] as Record<string, unknown>)['_count']).toBeDefined();
  });

  it('B4 rend TOUJOURS l’historique COMPLET et NON FILTRÉ (AC-2)', async () => {
    // La fiche enfant a besoin du parcours entier ; le tronquer serait une
    // régression. Ce qui change est que l'historique ne fait plus DOUBLE EMPLOI
    // comme réponse d'activité.
    const b4 = await verdictB4('Y');
    expect(b4.history.map((e) => e.status)).toEqual(['graduated']);
    const include = b4.include as Record<string, Record<string, unknown>>;
    expect(include['enrollments']!['where']).toBeUndefined();
  });
});

/* ================================================================== *
 * PF-364 (ADR-072 §R-7) — `endedAt` est RAPPORTÉ, jamais SÉLECTIONNÉ
 * ================================================================== */

describe('PF-364 — le désaccord `status:active` / `endedAt` passé est RAPPORTÉ, pas choisi', () => {
  it('une ligne active dont `endedAt` est passé reste SÉLECTIONNÉE, et le désaccord est visible', async () => {
    // `ADR-041 §D2` demandait un « effective-dated as of today ». On sélectionne
    // sur `status` (ce que les cinq projections faisaient déjà) et on RAPPORTE le
    // désaccord — exactement comme `academic-year/` rapporte la vétusté sans
    // jamais la choisir. §D2 est donc déchargé EN INTENTION SEULEMENT.
    const rows: EnrolFixture[] = [
      enrol({
        id: 'ended-1',
        endedAt: new Date('2000-01-01T00:00:00.000Z'),
        classSectionId: 'cs-e',
        classSection: section('cs-e', '1èreA', 'gl-6', '1ère'),
      }),
    ];
    const controller = studentsController({
      student: { findUnique: jest.fn(async () => studentRow('E', SCHOOL_A, rows)) },
      academicYear: academicYearDouble(),
    });
    const res = (await controller.getOne('student-E', {
      sub: 'kc',
    } as unknown as KeycloakJwtPayload)) as unknown as {
      enrollmentActivity: { state: string; endedAtDisagreement: boolean | null };
    };
    expect(res.enrollmentActivity.state).toBe('active');
    expect(res.enrollmentActivity.endedAtDisagreement).toBe(true);
  });
});
