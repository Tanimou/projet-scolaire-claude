import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { NotFoundException } from '@nestjs/common';

import {
  APP_ROLE_REQUIRED_PRIVILEGES,
  currentTenantScopeFrame,
  privilegeKey,
  runInTenantScope,
} from '../../shared/prisma/tenant-scope';
import type { TenantScopeService } from '../../shared/prisma/tenant-scope.service';

import { BookingService } from './booking.service';
import { RemediationService } from './remediation.service';

/**
 * S-E01-1j — `RemediationService` entre dans la portée tenant sur ses 23 sites
 * d'appel, la clôture de privilèges passe de 30 à 37, et ADR-058 §D1 pose la
 * règle « une erreur rattrapée sort de sa portée ».
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUE CE FICHIER PROUVE, ET CE QU'IL NE PROUVE PAS (DNC-06)             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * RIEN ICI NE TOUCHE POSTGRESQL. Aucune connexion, aucun GUC, aucune policy
 * n'est exercée. Ce fichier prouve la FORME des requêtes (leur `where`, leur
 * tenant, l'ordre des instructions), la PRÉSENCE du cadre de portée au moment
 * où chaque instruction est émise, et des propriétés LEXICALES de la source.
 * Il ne prouve PAS que RLS refuse : cette preuve-là est exécutée contre un vrai
 * PostgreSQL en `app_user` par `scripts/tenant-adversarial-check.js` et par
 * l'orchestrateur, et elle est consignée dans PROGRESS.md avec ses chiffres.
 *
 * Cet agent n'exécute NI jest NI typecheck (budget CPU : seul le test-architect
 * lance la chaîne). Les assertions de ce fichier n'ont donc jamais été exécutées
 * par leur auteur ; ce qui a réellement tourné dans cette tranche est
 * l'ATTRIBUTION (`node scripts/tenant-adversarial-check.js`, re-dérivée avant et
 * après le diff) et les sondes GUC sur la base de la pile.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX CLIENT FILTRE VRAIMENT SUR `where` — sinon il tamponnerait       │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `makeDb()` honore le `where` SCALAIRE qu'on lui passe (`id`, `tenantId`,
 * `status`, …). Un double qui l'IGNORE rend vertes des assertions de propriété
 * qui ne peuvent pas échouer — c'est la leçon PM-1 du spec `announcements`, et
 * c'est pire qu'une assertion qui ne peut pas passer. Il n'applique en revanche
 * AUCUN filtre tenant ambiant : c'est la simulation du chemin
 * `degraded_no_app_url` (connexion du propriétaire, où RLS ne filtre rien), donc
 * un `where` sans `tenantId:` explicite ferait FUIR ici comme en production.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';

const STUDENT = 'aaaaaaaa-0000-0000-0000-000000000001';
const SUBJECT = 'bbbbbbbb-0000-0000-0000-000000000001';
const FOREIGN_SUBJECT = 'bbbbbbbb-0000-0000-0000-000000000002';
const ALERT = 'cccccccc-0000-0000-0000-000000000001';
const FOREIGN_ALERT = 'cccccccc-0000-0000-0000-000000000002';
const PLAN = 'dddddddd-0000-0000-0000-000000000001';
const FOREIGN_PLAN = 'dddddddd-0000-0000-0000-000000000002';
const TUTOR = 'eeeeeeee-0000-0000-0000-000000000001';
const SLOT = 'ffffffff-0000-0000-0000-000000000001';
const FOREIGN_SLOT = 'ffffffff-0000-0000-0000-000000000002';
const PARENT = '99999999-0000-0000-0000-000000000001';

type Row = Record<string, unknown>;

const SOURCE = readFileSync(join(__dirname, 'remediation.service.ts'), 'utf8');

/**
 * Le double Prisma. Chaque instruction est JOURNALISÉE avec le tenant du cadre
 * de portée ACTIF au moment de son émission — c'est ce qui rend la preuve de
 * cadre mesurable plutôt que déclarative.
 */
function makeDb() {
  const tables: Record<string, Row[]> = {
    alertInstance: [
      { id: ALERT, tenantId: TENANT, studentId: STUDENT, subjectId: SUBJECT, schoolId: 'sc' },
      {
        id: FOREIGN_ALERT,
        tenantId: OTHER_TENANT,
        studentId: 'other-student',
        subjectId: FOREIGN_SUBJECT,
        schoolId: 'sc2',
      },
    ],
    remediationPlan: [
      {
        id: PLAN,
        tenantId: TENANT,
        schoolId: 'sc',
        studentId: STUDENT,
        subjectId: SUBJECT,
        alertId: ALERT,
        status: 'open',
        objective: null,
        baselineAvg: 8.5,
        baselineTrendDelta: null,
        closedAt: null,
        createdAt: new Date('2026-06-06T10:00:00.000Z'),
        student: { firstName: 'Léa', lastName: 'Martin' },
        subject: { code: 'MATH', name: 'Maths' },
      },
      {
        id: FOREIGN_PLAN,
        tenantId: OTHER_TENANT,
        schoolId: 'sc2',
        studentId: 'other-student',
        subjectId: FOREIGN_SUBJECT,
        alertId: FOREIGN_ALERT,
        status: 'open',
        objective: null,
        baselineAvg: null,
        baselineTrendDelta: null,
        closedAt: null,
        createdAt: new Date('2026-06-06T10:00:00.000Z'),
        student: { firstName: 'X', lastName: 'Y' },
        subject: { code: 'HIST', name: 'Histoire' },
      },
    ],
    studentSubjectSnapshot: [
      { tenantId: TENANT, studentId: STUDENT, subjectId: SUBJECT, termId: null, average: 8.5, trendDelta: -1.2 },
    ],
    grade: [],
    subject: [
      { id: SUBJECT, tenantId: TENANT, name: 'Maths' },
      { id: FOREIGN_SUBJECT, tenantId: OTHER_TENANT, name: 'Histoire' },
    ],
    tutor: [
      {
        id: TUTOR,
        tenantId: TENANT,
        schoolId: 'sc',
        published: true,
        type: 'teacher',
        costKind: 'free',
        displayName: 'M. Dupont',
        blurb: null,
        subjectIds: [SUBJECT],
        availabilities: [],
      },
    ],
    booking: [],
    tutorAvailability: [
      {
        id: SLOT,
        tenantId: TENANT,
        tutorId: TUTOR,
        active: true,
        capacity: 2,
        kind: 'one_off',
        weekday: null,
        startTime: null,
        startsAt: new Date('2099-01-01T10:00:00.000Z'),
        tutor: { teacherProfileId: null, userProfileId: PARENT, published: true },
      },
      {
        id: FOREIGN_SLOT,
        tenantId: OTHER_TENANT,
        tutorId: 'other-tutor',
        active: true,
        capacity: 1,
        kind: 'one_off',
        weekday: null,
        startTime: null,
        startsAt: new Date('2099-01-01T10:00:00.000Z'),
        tutor: { teacherProfileId: null, userProfileId: 'other', published: true },
      },
    ],
    enrollment: [
      { id: 'e1', tenantId: TENANT, studentId: STUDENT, status: 'active', classSectionId: 'cs1', academicYearId: 'ay1' },
    ],
    teachingAssignment: [{ id: 'ta1', tenantId: TENANT, classSectionId: 'cs1', academicYearId: 'ay1' }],
  };

  /** Instruction émise -> le tenant du cadre ACTIF, ou `undefined` hors portée. */
  const statements: { model: string; verb: string; where?: Row; frame: string | undefined }[] = [];

  /**
   * Comparaison scalaire, PLUS les trois opérateurs que ce module utilise
   * réellement (`has`, `in`, `not`). Ils ne sont pas un luxe : sans `has`, le
   * `findMany` du catalogue rendrait le tuteur de la matière PROPRE même
   * interrogé sur une matière ÉTRANGÈRE, et l'assertion « tutors: [] » passerait
   * pour la mauvaise raison — la vacuité PM-1 exactement.
   *
   * Une condition RELATIONNELLE (`academicYear: { status: 'active' }`) est
   * enregistrée et considérée satisfaite : ce fichier prouve l'ORDRE, la PORTÉE
   * et le REFUS, pas le moteur de requêtes de Prisma.
   */
  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, value]) => {
      if (value !== null && typeof value === 'object') {
        const cond = value as Record<string, unknown>;
        if ('has' in cond) {
          const column = row[key];
          return Array.isArray(column) && column.includes(cond.has);
        }
        if ('in' in cond) {
          return Array.isArray(cond.in) && cond.in.includes(row[key]);
        }
        if ('not' in cond) return row[key] !== cond.not;
        return true;
      }
      return row[key] === value;
    });

  const rowsOf = (name: string): Row[] => {
    const rows = tables[name];
    if (rows === undefined) {
      throw new Error(`double Prisma : le modèle « ${name} » n’est pas déclaré dans ce harnais`);
    }
    return rows;
  };

  const record = (model: string, verb: string, where?: Row) => {
    statements.push({ model, verb, where, frame: currentTenantScopeFrame()?.tenantId });
  };

  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      record(name, 'findFirst', where);
      return rowsOf(name).find((row) => matches(row, where)) ?? null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => {
      record(name, 'findMany', where);
      return rowsOf(name).filter((row) => matches(row, where));
    },
    create: async ({ data }: { data: Row }) => {
      record(name, 'create');
      const row = {
        id: 'new-' + name,
        student: { firstName: 'Léa', lastName: 'Martin' },
        subject: { code: 'MATH', name: 'Maths' },
        closedAt: null,
        createdAt: new Date('2026-06-06T10:00:00.000Z'),
        ...data,
      };
      rowsOf(name).push(row);
      return row;
    },
    updateMany: async ({ where, data }: { where?: Row; data: Row }) => {
      record(name, 'updateMany', where);
      const hits = rowsOf(name).filter((row) => matches(row, where));
      for (const row of hits) Object.assign(row, data);
      return { count: hits.length };
    },
  });

  return {
    tables,
    statements,
    tx: {
      alertInstance: model('alertInstance'),
      remediationPlan: model('remediationPlan'),
      studentSubjectSnapshot: model('studentSubjectSnapshot'),
      grade: model('grade'),
      subject: model('subject'),
      tutor: model('tutor'),
      booking: model('booking'),
      tutorAvailability: model('tutorAvailability'),
      enrollment: model('enrollment'),
      teachingAssignment: model('teachingAssignment'),
    },
  };
}

/**
 * Le double de `TenantScopeService` installe le VRAI cadre `AsyncLocalStorage`
 * (`runInTenantScope`, importé de la couture) plutôt qu'un booléen : c'est ce
 * qui rend la preuve de cadre MESURÉE au lieu de déclarée. Il refuse aussi
 * l'imbrication sur un autre tenant, comme le vrai service.
 */
function makeHarness() {
  const db = makeDb();
  const runs: string[] = [];
  const scope = {
    run: async <T>(tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      runs.push(tenantId);
      const active = currentTenantScopeFrame();
      if (active !== undefined && active.tenantId !== tenantId) {
        throw new Error('portée imbriquée sur un AUTRE tenant');
      }
      return runInTenantScope({ tenantId, tx: db.tx }, async () => fn(db.tx));
    },
    current: () => {
      const frame = currentTenantScopeFrame();
      return frame === undefined ? undefined : { tenantId: frame.tenantId };
    },
  } as unknown as TenantScopeService;

  return { db, runs, service: new RemediationService(scope) };
}

// ---------------------------------------------------------------------------
// (e) LE CADRE — chaque instruction convertie voit une portée, et le NÉGATIF
// ---------------------------------------------------------------------------

describe('AC-1 — chaque instruction de RemediationService est émise DANS une portée', () => {
  it('promotePlan : les quatre portées sont ouvertes sur args.tenantId, jamais sur la donnée lue', async () => {
    const h = makeHarness();
    // Pas de plan ouvert pour ce (student, subject) : on force le chemin création.
    h.db.tables.remediationPlan = [];

    await h.service.promotePlan({
      tenantId: TENANT,
      schoolId: 'sc',
      alertId: ALERT,
      userProfileId: PARENT,
    });

    expect(h.db.statements.length).toBeGreaterThanOrEqual(3);
    expect(h.db.statements.map((s) => s.frame)).toEqual(h.db.statements.map(() => TENANT));
    // Le tenant de la portée est TOUJOURS l'argument, jamais `alert.tenantId`.
    expect([...new Set(h.runs)]).toEqual([TENANT]);
  });

  it('remediationProgress : la boucle n’ouvre AUCUNE lecture de booking (pas de N+1)', async () => {
    const h = makeHarness();

    await h.service.remediationProgress({ tenantId: TENANT, studentId: STUDENT });

    const bookingReads = h.db.statements.filter((s) => s.model === 'booking');
    expect(bookingReads).toHaveLength(1);
    expect(h.db.statements.every((s) => s.frame === TENANT)).toBe(true);
  });

  it('catalogue, lectures de plan et mur enseignant : toutes leurs instructions voient le cadre', async () => {
    const h = makeHarness();

    await h.service.catalogue({
      tenantId: TENANT,
      schoolId: 'sc',
      subjectId: SUBJECT,
      userProfileId: PARENT,
    });
    await h.service.getPlan({ tenantId: TENANT, planId: PLAN });
    await h.service.listPlansForStudent({ tenantId: TENANT, studentId: STUDENT });
    await h.service.loadPlanForLifecycle({ tenantId: TENANT, planId: PLAN });
    await h.service.loadPlanForBooking({ tenantId: TENANT, planId: PLAN });
    await h.service.loadBookableAvailability({ tenantId: TENANT, availabilityId: SLOT });
    await h.service.isTeacherOfStudent({
      tenantId: TENANT,
      teacherUserProfileId: PARENT,
      studentId: STUDENT,
    });

    expect(h.db.statements.length).toBeGreaterThanOrEqual(8);
    const outside = h.db.statements.filter((s) => s.frame !== TENANT);
    expect(outside.map((s) => `${s.model}.${s.verb}`)).toEqual([]);
  });

  it('CONTRÔLE NÉGATIF — BookingService, NON converti, émet HORS de toute portée', async () => {
    // Le collaborateur garde son propre `PrismaService` : appelé exactement comme
    // le service converti (depuis l'extérieur de toute portée, ce que fait le
    // contrôleur), son instruction ne voit AUCUN cadre. Sans ce cas, un
    // `currentTenantScopeFrame()` qui rendrait toujours le tenant ferait passer
    // tous les tests ci-dessus sans rien prouver.
    const seen: (string | undefined)[] = [];
    const prisma = {
      booking: {
        findFirst: async () => {
          seen.push(currentTenantScopeFrame()?.tenantId);
          return null;
        },
      },
    };
    const booking = new BookingService(prisma as never);

    await booking.loadBooking({ tenantId: TENANT, bookingId: 'b1' });

    expect(seen).toEqual([undefined]);
  });
});

// ---------------------------------------------------------------------------
// LA PROPRIÉTÉ (non vacuité) — un identifiant ÉTRANGER ne rend rien, sans oracle
// ---------------------------------------------------------------------------

describe('S-E01-1j — un identifiant d’un AUTRE tenant ne traverse aucune méthode', () => {
  it('promotePlan sur une alerte étrangère 404 avec le MÊME message que l’absence', async () => {
    const h = makeHarness();
    const foreign = h.service.promotePlan({
      tenantId: TENANT,
      schoolId: 'sc',
      alertId: FOREIGN_ALERT,
      userProfileId: PARENT,
    });
    await expect(foreign).rejects.toBeInstanceOf(NotFoundException);
    // Byte-identique au cas « n'existe pas » : aucun oracle d'existence.
    await expect(foreign).rejects.toThrow('Alert not found');

    const missing = h.service.promotePlan({
      tenantId: TENANT,
      schoolId: 'sc',
      alertId: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
      userProfileId: PARENT,
    });
    await expect(missing).rejects.toThrow('Alert not found');
  });

  it('getPlan / loadPlanForLifecycle / loadPlanForBooking rendent null sur un plan étranger', async () => {
    const h = makeHarness();
    expect(await h.service.getPlan({ tenantId: TENANT, planId: FOREIGN_PLAN })).toBeNull();
    expect(
      await h.service.loadPlanForLifecycle({ tenantId: TENANT, planId: FOREIGN_PLAN }),
    ).toBeNull();
    expect(await h.service.loadPlanForBooking({ tenantId: TENANT, planId: FOREIGN_PLAN })).toBeNull();
    // …et la MÊME lecture sur le plan propre rend bien la ligne : sans ce
    // contrôle POSITIF, un `where` cassé rendrait `null` partout et les trois
    // assertions ci-dessus passeraient pour la mauvaise raison.
    expect(await h.service.getPlan({ tenantId: TENANT, planId: PLAN })).not.toBeNull();
  });

  it('loadBookableAvailability rend null sur un créneau étranger, la ligne sur le sien', async () => {
    const h = makeHarness();
    expect(
      await h.service.loadBookableAvailability({ tenantId: TENANT, availabilityId: FOREIGN_SLOT }),
    ).toBeNull();
    expect(
      await h.service.loadBookableAvailability({ tenantId: TENANT, availabilityId: SLOT }),
    ).not.toBeNull();
  });

  it('catalogue sur une matière étrangère : subjectName null ET tutors vide, sans oracle', async () => {
    const h = makeHarness();
    const foreign = await h.service.catalogue({
      tenantId: TENANT,
      schoolId: 'sc',
      subjectId: FOREIGN_SUBJECT,
      userProfileId: PARENT,
    });
    expect(foreign.subjectName).toBeNull();
    expect(foreign.tutors).toEqual([]);

    const own = await h.service.catalogue({
      tenantId: TENANT,
      schoolId: 'sc',
      subjectId: SUBJECT,
      userProfileId: PARENT,
    });
    expect(own.subjectName).toBe('Maths');
    expect(own.tutors).toHaveLength(1);
  });

  it('closePlan / reopenPlan ne mordent pas sur un plan étranger (0 ligne → null)', async () => {
    const h = makeHarness();
    expect(
      await h.service.closePlan({
        tenantId: TENANT,
        planId: FOREIGN_PLAN,
        resolution: 'met',
        userProfileId: PARENT,
      }),
    ).toBeNull();
    expect(
      await h.service.reopenPlan({ tenantId: TENANT, planId: FOREIGN_PLAN, userProfileId: PARENT }),
    ).toBeNull();
    // La ligne étrangère est INTACTE : un `updateMany` sans garde tenant l'aurait
    // clôturée en silence, et le `null` ci-dessus aurait quand même été rendu.
    const foreignRow = h.db.tables.remediationPlan?.find((r) => r.id === FOREIGN_PLAN);
    expect(foreignRow?.status).toBe('open');
  });
});

// ---------------------------------------------------------------------------
// (f) ADR-058 §D1 — LA RÈGLE D'AVORTEMENT, PROUVÉE LEXICALEMENT (PF-247)
// ---------------------------------------------------------------------------

/**
 * POURQUOI CES ASSERTIONS SONT SUR LE TEXTE ET NON SUR LE COMPORTEMENT, dit ici
 * plutôt que laissé à deviner : la règle est TRANSACTIONNELLE. Un faux `run` qui
 * appelle `fn(client)` n'ouvre aucune transaction, donc rien ne peut être
 * AVORTÉ, donc aucun test à faux client — y compris ceux de ce fichier — ne peut
 * distinguer « la récupération ouvre une portée fraîche » de « la récupération
 * réutilise la transaction morte ». La seule preuve disponible sans PostgreSQL
 * est LEXICALE, et c'est une limite qu'il faut écrire, pas contourner (PF-247 :
 * la règle reste une obligation de REVUE que le matcher dérivé ne voit pas).
 */
describe('ADR-058 §D1 — toute récupération d’erreur ouvre une portée FRAÎCHE', () => {
  const bodyOf = (from: string, to: string): string => {
    const start = SOURCE.indexOf(from);
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf(to, start);
    expect(end).toBeGreaterThan(start);
    return SOURCE.slice(start, end);
  };

  it('promotePlan : `try` AVANT la portée de création, `catch` APRÈS, gagnant dans une portée NEUVE', () => {
    const body = bodyOf('async promotePlan(args: {', 'async getPlan(args: {');
    const iTry = body.lastIndexOf('try {');
    const iCreateRun = body.indexOf('this.scope.run(', iTry);
    const iCatch = body.indexOf('} catch (err)');
    const iWinnerRun = body.indexOf('this.scope.run(', iCatch);

    expect(iTry).toBeGreaterThan(-1);
    expect(iCreateRun).toBeGreaterThan(iTry); // la portée s'ouvre DANS le try
    expect(iCatch).toBeGreaterThan(iCreateRun); // le catch se ferme APRÈS la portée
    expect(iWinnerRun).toBeGreaterThan(iCatch); // la relecture ouvre une portée neuve
    // …et elle lit bien le plan gagnant, pas autre chose.
    expect(body.indexOf('tx.remediationPlan.findFirst(', iWinnerRun)).toBeGreaterThan(iWinnerRun);
  });

  it('reopenPlan : la sentinelle conflict_open_exists est produite APRÈS la fin de la portée', () => {
    const body = bodyOf('async reopenPlan(args: {', 'async loadPlanForLifecycle(args: {');
    const iTry = body.indexOf('try {');
    const iRun = body.indexOf('this.scope.run(');
    const iCatch = body.indexOf('} catch (err)');
    const iSentinel = body.indexOf("return 'conflict_open_exists';");

    expect(iTry).toBeGreaterThan(-1);
    expect(iRun).toBeGreaterThan(iTry);
    expect(iCatch).toBeGreaterThan(iRun);
    expect(iSentinel).toBeGreaterThan(iCatch);
  });

  it('readSubjectAverage : la portée du snapshot et celle de la retombée sont SÉPARÉES', () => {
    const body = bodyOf(
      'private async readSubjectAverage(args: {',
      'return this.computeLiveSubjectBaseline(args);',
    );
    const iTry = body.indexOf('try {');
    const iRun = body.indexOf('this.scope.run(');
    const iCatch = body.indexOf('} catch (err)');

    expect(iTry).toBeGreaterThan(-1);
    expect(iRun).toBeGreaterThan(iTry);
    expect(iCatch).toBeGreaterThan(iRun);
    // La retombée est un APPEL, hors du try, donc hors de la transaction du
    // snapshot : c'est exactement ce qui empêche un 25P02 de transformer une
    // dégradation gracieuse en `{avg:null}` dur.
    expect(SOURCE).toContain('return this.computeLiveSubjectBaseline(args);');
    // …et le helper de retombée ouvre SA propre portée (ADR-057 §D2).
    const live = bodyOf('private async computeLiveSubjectBaseline(args: {', '// ----- mappers');
    expect(live.indexOf('try {')).toBeLessThan(live.indexOf('this.scope.run('));
    expect(live).toContain('tx.grade.findMany(');
  });

  it('LE CLIQUET — aucun callback de portée ne contient de `catch`', () => {
    // La forme interdite est « rattraper DANS la portée et continuer d'y émettre ».
    // Aujourd'hui aucun callback n'attrape quoi que ce soit ; asserter l'absence
    // du mot-clé est donc la garde la plus forte disponible, et elle vire au
    // rouge à la PREMIÈRE tentative de la forme dangereuse — moment où l'auteur
    // doit lire ADR-058 §D1 plutôt que redécouvrir 25P02 en production.
    const ranges: { start: number; end: number }[] = [];
    for (const match of SOURCE.matchAll(/this\.scope\.run\s*\(/g)) {
      const open = match.index! + match[0].length - 1;
      let depth = 0;
      for (let i = open; i < SOURCE.length; i += 1) {
        if (SOURCE[i] === '(') depth += 1;
        else if (SOURCE[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            ranges.push({ start: open, end: i });
            break;
          }
        }
      }
    }
    // NON VACUITÉ : vingt portées ouvertes dans ce fichier (les deux mentions de
    // docblock portent leur parenthèse fermante, donc elles se referment aussi).
    expect(ranges.length).toBeGreaterThanOrEqual(20);
    const offenders = ranges.filter((r) => SOURCE.slice(r.start, r.end).includes('catch'));
    expect(offenders).toEqual([]);
  });

  it('AC-2 — le constructeur EST la preuve : plus aucun client propriétaire', () => {
    expect(SOURCE).toContain('constructor(private readonly scope: TenantScopeService) {}');
    expect(SOURCE).not.toContain('this.prisma.');
    expect(SOURCE).not.toContain("from '../../shared/prisma/prisma.service'");
    // G-AUTHZ — le contrôleur, lui, GARDE son client propriétaire et n'ouvre
    // AUCUNE portée : aucun mur ABAC ne peut se retrouver dans une transaction.
    const controller = readFileSync(join(__dirname, 'remediation.controller.ts'), 'utf8');
    expect(controller).toContain('this.prisma.');
    expect(controller).not.toContain('this.scope.run(');
  });

  it('G-DNC — aucun drapeau de contournement, aucun SQL, aucun port en dur sur la couture', () => {
    expect(SOURCE).not.toMatch(/\$queryRaw|\$executeRaw/);
    expect(SOURCE).not.toMatch(/process\.env/);
    expect(SOURCE).not.toContain('5432');
    // Les gardes `tenantId` explicites SURVIVENT à la conversion (ADR-042 §D1 /
    // ADR-056) : sur un déploiement sans `DATABASE_URL_APP`, la portée tourne
    // sur le propriétaire et elles sont la SEULE isolation qui reste.
    expect(SOURCE.match(/tenantId: args\.tenantId/g)?.length ?? 0).toBeGreaterThanOrEqual(15);
  });
});

// ---------------------------------------------------------------------------
// (a)(b)(c)(d) LA CLÔTURE DÉCLARÉE DOIT SUIVRE LES SITES D'APPEL
// ---------------------------------------------------------------------------

/**
 * Miroir de `lessons-scope-ownership.spec.ts` (AC-9) et de
 * `announcements-scope-ownership.spec.ts`, adapté à un SERVICE plutôt qu'à un
 * contrôleur. `APP_ROLE_REQUIRED_PRIVILEGES` est parcourue par `appRoleVerdict`
 * AU DÉMARRAGE, GLOBALEMENT : une entrée manquante fait certifier
 * `enforcing: true` sur une clôture jamais vérifiée (42501 à la requête), et une
 * entrée EN TROP rend `refused_unusable`, donc un 503 sur calendar, lessons,
 * announcements ET student-portal aussi.
 */
describe('AC-5 — les sites d’appel Prisma de remediation ⊆ la clôture déclarée', () => {
  /** `verbe Prisma -> privilège SQL`. Un verbe inconnu ÉCHOUE, il n'est pas ignoré. */
  const VERB_PRIVILEGE: Record<string, string> = {
    aggregate: 'SELECT',
    count: 'SELECT',
    findFirst: 'SELECT',
    findMany: 'SELECT',
    findUnique: 'SELECT',
    groupBy: 'SELECT',
    create: 'INSERT',
    createMany: 'INSERT',
    update: 'UPDATE',
    updateMany: 'UPDATE',
    delete: 'DELETE',
    deleteMany: 'DELETE',
  };

  /** `remediationPlan` -> `remediation_plan`, la convention `@@map` du schéma. */
  const toTable = (model: string): string => model.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

  const sites = [...SOURCE.matchAll(/\btx\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g)].map(([, model, verb]) => ({
    model: String(model),
    verb: String(verb),
    table: toTable(String(model)),
  }));

  const declared = new Set(
    APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)),
  );

  it('le corpus de sites d’appel est NON VIDE et n’utilise que des verbes connus', () => {
    // Une regex qui ne matche plus rien rendrait tout ce qui suit vert à vide :
    // c'est le mode de défaillance normal d'une assertion dérivée.
    expect(sites.length).toBeGreaterThanOrEqual(23);
    const unknown = sites.filter((s) => VERB_PRIVILEGE[s.verb] === undefined);
    expect(unknown.map((s) => `${s.model}.${s.verb}`)).toEqual([]);
  });

  it('chaque (table, privilège) émis DANS une portée est DÉCLARÉ dans APP_ROLE_REQUIRED_PRIVILEGES', () => {
    const missing = [
      ...new Set(
        sites
          .map((s) => privilegeKey(s.table, VERB_PRIVILEGE[s.verb] ?? 'UNKNOWN'))
          .filter((key) => !declared.has(key)),
      ),
    ].sort();
    // Le message NOMME ce qui manque : un rouge ici se corrige en une ligne dans
    // `tenant-scope.ts`, pas en une enquête.
    expect(missing).toEqual([]);
  });

  it('ANTI-VACUITÉ — les sept tables NOUVELLES sont présentes, verbe par verbe', () => {
    for (const key of [
      'alert_instance.SELECT',
      'remediation_plan.SELECT',
      'remediation_plan.INSERT',
      'remediation_plan.UPDATE',
      'booking.SELECT',
      'tutor.SELECT',
      'tutor_availability.SELECT',
    ]) {
      expect(declared.has(key)).toBe(true);
    }
    // 30 -> 37, compté et non affirmé : une huitième entrée ajoutée « par
    // symétrie » est un privilège que la sonde de démarrage exigera VRAIMENT.
    //
    // S-E01-1k — 37 -> 38, et le littéral N'EST PAS remonté « pour repasser au
    // vert ». La trente-huitième entrée est `guardian.SELECT`, NOMMÉE par la
    // dérivation de `scripts/tenant-adversarial-check.js` (ADR-059) : un filtre
    // relationnel `guardian: { userProfileId }` dans la garde ABAC parent de
    // lessons/list, invisible au matcher racine de CE fichier comme il l'était
    // à trois relectures humaines. Le compteur reste une assertion GELÉE et non
    // une borne inférieure (contrairement à la retraite proposée par PF-251) :
    // la borne inférieure accepterait silencieusement une 39ᵉ entrée, et une
    // entrée EN TROP rend `refused_unusable`, donc un 503 sur les quatre
    // portails. C'est désormais le contrôle d'égalité d'ensembles du gate qui
    // porte la charge de preuve ; ce littéral n'est plus que la sonde de
    // non-vacuité qui refuse un ajout muet.
    expect(APP_ROLE_REQUIRED_PRIVILEGES).toHaveLength(38);
    // …et chaque entrée porte SA raison, jamais une chaîne partagée ni le verbe
    // répété. La garde tourne sur la liste ENTIÈRE : une raison mince ajoutée
    // par un module futur vire au rouge ici aussi.
    for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
      expect(requirement.why.trim().length).toBeGreaterThan(10);
    }
  });

  it('LA MOITIÉ RELATIONNELLE — les tables que le matcher ne PEUT PAS voir sont déclarées', () => {
    // PF-246 / ADR-057 §D1 : une relation traversée par un `include`, un `select`
    // imbriqué ou un FILTRE de `where` est une table LUE sous RLS, et le matcher
    // `tx.<modèle>.<verbe>(` ci-dessus n'en voit AUCUNE. Sans cette liste nommée,
    // retirer `academic_year` de la clôture laisserait ce fichier vert et
    // casserait chaque réservation liée à un enseignant à l'exécution.
    for (const key of [
      'student.SELECT', //          PLAN_INCLUDE, sur chaque DTO de plan
      'subject.SELECT', //          PLAN_INCLUDE (et racine du catalogue)
      'assessment.SELECT', //       filtre `assessment: { teachingAssignment }` + select maxScore
      'teaching_assignment.SELECT', // le même filtre, un niveau plus bas + isTeacherOfStudent
      'teacher_profile.SELECT', //  `teacherProfile: { userProfileId }`
      'academic_year.SELECT', //    `academicYear: { status: 'active' }`
      'enrollment.SELECT', //       racine du findFirst du mur enseignant
      'student_subject_snapshot.SELECT', // le point-read de readSubjectAverage
      'grade.SELECT', //            la retombée live
    ]) {
      expect(declared.has(key)).toBe(true);
    }
    // Les traversées sont VRAIMENT dans la source (sinon la liste ci-dessus
    // deviendrait une incantation qu'aucun code n'exerce).
    expect(SOURCE).toContain('assessment: { teachingAssignment: { subjectId: args.subjectId } }');
    expect(SOURCE).toContain("academicYear: { status: 'active' }");
    expect(SOURCE).toContain('teacherProfile: { userProfileId: args.teacherUserProfileId }');
    expect(SOURCE).toContain('student: { select: { firstName: true, lastName: true } }');
  });

  it('GARDE INVERSE — aucun DELETE, aucune écriture de booking, aucune mutation d’alerte', () => {
    // Ce service n'a AUCUN chemin de suppression, et `app_user` détient pourtant
    // les quatre verbes sur les cinq tables : une entrée DELETE démarrerait donc
    // au VERT et serait MORTE — or une entrée morte ne peut plus faire échouer le
    // contrôle d'égalité d'ensembles que PF-246 / PF-219 existent pour acheter.
    for (const key of [
      'remediation_plan.DELETE',
      'booking.DELETE',
      'booking.INSERT',
      'booking.UPDATE',
      'tutor.DELETE',
      'tutor_availability.DELETE',
      'alert_instance.DELETE',
      'alert_instance.UPDATE',
    ]) {
      expect(declared.has(key)).toBe(false);
    }
    // …et le dérivé ne réclame aucun DELETE non plus (les deux moitiés d'accord).
    const derivedDeletes = sites.filter((s) => VERB_PRIVILEGE[s.verb] === 'DELETE');
    expect(derivedDeletes.map((s) => `${s.model}.${s.verb}`)).toEqual([]);
  });
});
