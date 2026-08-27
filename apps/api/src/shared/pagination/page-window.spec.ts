import { BadRequestException } from '@nestjs/common';
import {
  type PageWindowBounds,
  distinctGroupCount,
  pageSizeOf,
  pageWindow,
  pageWindowOf,
  resultTotal,
} from '@pilotage/contracts';

import { NotificationsController } from '../../modules/notifications/notifications.controller';
import { TeachingAssignmentsController } from '../../modules/teaching/teaching-assignments.controller';

/**
 * S-E03-9 / PF-50 / ADR-080 / AC-3 — LA PREUVE ROUGE-AVANT / VERT-APRÈS.
 *
 * CE QUE CETTE SUITE PROUVE, ET CE QU'ELLE NE PROUVE PAS
 * ------------------------------------------------------
 * Elle prouve, EXÉCUTÉE : (1) que l'ancien idiome produisait bien les valeurs
 * que l'audit lui reproche — il est recopié VERBATIM ci-dessous et mis sous
 * test, ce qui est la seule façon d'avoir un « rouge avant » qui veuille dire
 * quelque chose ; (2) que la fenêtre canonique REJETTE ces mêmes entrées ; (3)
 * que les onze paires de bornes livrées font l'aller-retour ; (4) qu'aucun
 * `take` ni `skip` ne peut sortir négatif d'un balayage exhaustif ; (5) qu'un
 * contrôleur RÉEL rend un `BadRequestException`, pas un nombre écrêté ; (6) que
 * les agrégats de `/teaching-assignments` sont DÉRIVÉS des agrégats et non de
 * la page.
 *
 * Elle NE prouve PAS qu'une base réelle rend ces nombres : aucune sonde vivante
 * n'a été lancée (Docker Desktop refuse de démarrer, 5ᵉ run consécutif ; la base
 * locale `pilotage@5432` est vide). Confondre les deux serait `DNC-06`.
 *
 * ⚠ `@pilotage/contracts` est mappé vers la SOURCE par `apps/api/jest.config.js`.
 * Le vert d'ici ne dit RIEN du démarrage de l'API : `main` pointe sur le CJS
 * `dist/`, git-ignoré, que ce runner ne reconstruit pas. `pnpm --filter
 * @pilotage/contracts build` est un PRÉ-REQUIS DE LAND (ADR-080 §6.2) — c'est le
 * piège `landed ≠ ran` du run 93 dans un costume neuf.
 */

/* ================================================================== *
 * (i) LE ROUGE-AVANT — l'ancien idiome, RECOPIÉ VERBATIM et mis sous test
 * ================================================================== */

/**
 * `analytics.controller.ts:277` / `students.controller.ts:233` /
 * `guardians.controller.ts:105` avant cette tranche, à l'octet près.
 * `lessons.controller.ts:370` est le même avec (100, 500).
 */
const legacyLimit = (raw: string | undefined, def: number, max: number): number =>
  Math.min(parseInt(raw ?? String(def), 10) || def, max);

/** `analytics.controller.ts:278` / `students.controller.ts:234`, verbatim. */
const legacyOffset = (raw: string | undefined): number => parseInt(raw ?? '0', 10) || 0;

/** `notifications.controller.ts:39` / `teachers.controller.ts:335`, verbatim. */
const legacyClampedLimit = (raw: string | undefined, def: number, max: number): number =>
  Math.min(max, Math.max(1, parseInt(raw ?? String(def), 10) || def));

describe('AC-3 (i) — le défaut mesuré existe bien dans l’ancien idiome', () => {
  it('rend un `take` NÉGATIF pour `?limit=-5` — Prisma lirait alors depuis la FIN, à l’envers', () => {
    expect(legacyLimit('-5', 50, 200)).toBe(-5);
    expect(legacyLimit('-5', 100, 500)).toBe(-5);
  });

  it('rend le DÉFAUT pour `?limit=0` au lieu de rejeter — `0 || 50` vaut `50`', () => {
    expect(legacyLimit('0', 50, 200)).toBe(50);
    expect(legacyLimit('0', 100, 500)).toBe(100);
  });

  it('rend le DÉFAUT pour du déchet non numérique, au lieu de rejeter', () => {
    expect(legacyLimit('abc', 50, 200)).toBe(50);
  });

  it('mésinterprète la notation exponentielle : `?limit=1e9` rendait UNE ligne (PF-423)', () => {
    expect(legacyLimit('1e9', 50, 200)).toBe(1);
    expect(legacyLimit('50abc', 50, 200)).toBe(50);
    expect(legacyLimit('5.9', 50, 200)).toBe(5);
  });

  it('rend un `skip` NÉGATIF pour `?offset=-3` — donc une erreur d’exécution Prisma, donc un 500', () => {
    expect(legacyOffset('-3')).toBe(-3);
    expect(legacyOffset('-1')).toBe(-1);
  });

  it('CONTRÔLE POSITIF : quatre des sites clampaient déjà par le bas, et ne portaient donc PAS l’inversion', () => {
    expect(legacyClampedLimit('-5', 20, 100)).toBe(1);
    expect(legacyClampedLimit('-5', 50, 100)).toBe(1);
    // Le troisième, `attendance.controller.ts:325-328`, avec sa garde `isFinite`.
    const parsed = parseInt('-5', 10);
    expect(Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 500) : 200).toBe(1);
  });
});

/* ================================================================== *
 * (ii) LE VERT-APRÈS — la fenêtre canonique REJETTE, elle ne coerce pas
 * ================================================================== */

const AUDIT_WINDOW = pageWindow({ def: 50, max: 200 });

const reject = (raw: unknown) => {
  const parsed = AUDIT_WINDOW.safeParse(raw);
  expect(parsed.success).toBe(false);
  return parsed;
};

describe('AC-3 (ii) — la fenêtre canonique rejette exactement ce que l’ancien idiome avalait', () => {
  it('`limit=-5` est un REJET, jamais un `-5`', () => {
    reject({ limit: '-5' });
  });

  it('`limit=0` est un REJET, jamais le défaut', () => {
    reject({ limit: '0' });
  });

  it('`offset=-1` est un REJET, jamais un `skip` négatif', () => {
    reject({ offset: '-1' });
    reject({ offset: '-3' });
  });

  it('le déchet non numérique est un REJET', () => {
    reject({ limit: 'abc' });
    reject({ limit: '' });
    reject({ limit: '   ' });
    reject({ limit: '50abc' });
  });

  it('MESURÉ ET DÉCLARÉ : `?limit=0x10` vaut désormais 16, là où il valait le défaut', () => {
    // `z.coerce` délègue à `Number()`, qui lit l'hexadécimal ; `parseInt(x, 10)`
    // ne le lisait pas et retombait sur le défaut. 16 est un entier dans les
    // bornes, donc la fenêtre l'ACCEPTE — c'est un changement d'acceptation de
    // la famille PF-423, et il est écrit ici plutôt que découvert plus tard.
    const parsed = AUDIT_WINDOW.safeParse({ limit: '0x10' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('unreachable');
    expect(parsed.data.limit).toBe(16);
    expect(legacyLimit('0x10', 50, 200)).toBe(50);
  });

  it('un `limit` fractionnaire est un REJET — `5.9` ne vaut plus `5` (PF-423)', () => {
    reject({ limit: '5.9' });
    reject({ limit: '3.5' });
  });

  it('`limit=1e9` ne vaut PLUS `1` : il dépasse le plafond, donc REJET (PF-423)', () => {
    reject({ limit: '1e9' });
    // `1e3` = 1000 > 200 : rejeté, jamais silencieusement réduit à `1`.
    reject({ limit: '1e3' });
    expect(legacyLimit('1e3', 50, 200)).toBe(1);
  });

  it('`Infinity` et `NaN` sont des REJETS (non entiers)', () => {
    reject({ limit: 'Infinity' });
    reject({ limit: '-Infinity' });
    reject({ limit: 'NaN' });
  });

  it('un `?limit=` RÉPÉTÉ arrive en tableau et devient un REJET (ADR-080 §D3)', () => {
    reject({ limit: ['5', '6'] });
  });

  it('un dépassement de plafond est un REJET, PAS un écrêtage — la question posée n’est pas remplacée', () => {
    reject({ limit: '201' });
    reject({ limit: '9999' });
  });

  it('CONTRÔLE POSITIF : une valeur valide traverse, donc l’analyseur est bien ATTEINT', () => {
    const parsed = AUDIT_WINDOW.safeParse({ limit: '7', offset: '3' });
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('unreachable');
    expect(pageWindowOf(parsed.data)).toEqual({ take: 7, skip: 3 });
  });

  it('les bornes elles-mêmes sont validées : un défaut au-dessus du plafond est impossible à construire', () => {
    expect(() => pageWindow({ def: 500, max: 200 })).toThrow(/dépasse/);
    expect(() => pageWindow({ def: 0, max: 200 })).toThrow(/def/);
    expect(() => pageWindow({ def: 50, max: 0 })).toThrow(/max/);
    expect(() => pageWindow({ def: 5.5, max: 200 })).toThrow(/def/);
  });
});

/* ================================================================== *
 * (iii) + (iv) LES ONZE PAIRES LIVRÉES, ET LE BALAYAGE EXHAUSTIF
 * ================================================================== */

/**
 * Les paires TELLES QU'ELLES SONT LIVRÉES par cette tranche. Elles sont ici pour
 * qu'un futur changement de taille de page soit une modification VISIBLE de ce
 * tableau, et non une dérive d'un littéral dans un contrôleur.
 *
 * ⚠ Les huit premières sont INCHANGÉES par rapport à HEAD (AC-2 : la tranche
 * change l'ANALYSEUR, pas les tailles de page du produit). Seule
 * `teaching-assignments` porte des nombres neufs, parce qu'elle n'en avait
 * AUCUN — il n'y a donc pas de défaut observable à y préserver.
 */
const SHIPPED_BOUNDS: ReadonlyArray<readonly [string, PageWindowBounds, 'unchanged' | 'new']> = [
  ['alerts/instances', { def: 50, max: 200 }, 'unchanged'],
  ['analytics/audit', { def: 50, max: 200 }, 'unchanged'],
  ['students', { def: 50, max: 200 }, 'unchanged'],
  ['guardians', { def: 50, max: 200 }, 'unchanged'],
  ['lessons', { def: 100, max: 500 }, 'unchanged'],
  ['notifications', { def: 20, max: 100 }, 'unchanged'],
  ['teachers/me/recent-grades', { def: 50, max: 100 }, 'unchanged'],
  ['attendance/sessions', { def: 200, max: 500 }, 'unchanged'],
  ['messaging (x3, contracts)', { def: 50, max: 200 }, 'unchanged'],
  ['meeting-requests', { def: 50, max: 200 }, 'unchanged'],
  ['exports (x3)', { def: 20, max: 100 }, 'unchanged'],
  ['teaching-assignments', { def: 100, max: 500 }, 'new'],
];

describe('AC-3 (iii) — chaque paire livrée fait l’aller-retour', () => {
  for (const [name, bounds] of SHIPPED_BOUNDS) {
    it(`${name} — absent ⇒ le défaut ; milieu de plage ⇒ lui-même ; plafond ⇒ lui-même`, () => {
      const schema = pageWindow(bounds);

      const empty = schema.safeParse({});
      expect(empty.success).toBe(true);
      if (!empty.success) throw new Error('unreachable');
      expect(pageWindowOf(empty.data)).toEqual({ take: bounds.def, skip: 0 });

      const mid = Math.max(1, Math.floor(bounds.max / 2));
      const midParsed = schema.safeParse({ limit: String(mid), offset: '10' });
      expect(midParsed.success).toBe(true);
      if (!midParsed.success) throw new Error('unreachable');
      expect(pageWindowOf(midParsed.data)).toEqual({ take: mid, skip: 10 });

      expect(schema.safeParse({ limit: String(bounds.max) }).success).toBe(true);

      // Un cran AU-DESSUS du plafond : rejet, jamais écrêtage.
      expect(schema.safeParse({ limit: String(bounds.max + 1) }).success).toBe(false);
      // Un cran EN DESSOUS de la borne basse : rejet, jamais défaut.
      expect(schema.safeParse({ limit: '0' }).success).toBe(false);
    });
  }

  it('AC-2 — huit des paires sont déclarées INCHANGÉES, une seule est neuve, et le tableau le dit', () => {
    const changed = SHIPPED_BOUNDS.filter(([, , kind]) => kind === 'new').map(([name]) => name);
    expect(changed).toEqual(['teaching-assignments']);
  });
});

/**
 * (iv) LE BALAYAGE. Il existe pour que « take et skip ne sont jamais négatifs »
 * soit une propriété MESURÉE sur un produit cartésien, et non une phrase.
 */
const SWEEP_INPUTS = [
  undefined,
  '',
  '-1',
  '-5',
  '0',
  '1',
  '7',
  '1e3',
  'abc',
  'Infinity',
  '3.5',
  '9999',
  '  ',
  '50abc',
] as const;

describe('AC-3 (iv) — balayage exhaustif : aucun `take` ni `skip` négatif n’est atteignable', () => {
  it('sur toutes les paires livrées × toutes les entrées, une valeur acceptée est toujours >= 1 / >= 0', () => {
    let accepted = 0;
    let rejected = 0;
    for (const [, bounds] of SHIPPED_BOUNDS) {
      const schema = pageWindow(bounds);
      for (const limit of SWEEP_INPUTS) {
        for (const offset of SWEEP_INPUTS) {
          const parsed = schema.safeParse({ limit, offset });
          if (!parsed.success) {
            rejected += 1;
            continue;
          }
          accepted += 1;
          const { take, skip } = pageWindowOf(parsed.data);
          expect(take).toBeGreaterThanOrEqual(1);
          expect(take).toBeLessThanOrEqual(bounds.max);
          expect(Number.isInteger(take)).toBe(true);
          expect(skip).toBeGreaterThanOrEqual(0);
          expect(Number.isInteger(skip)).toBe(true);
        }
      }
    }
    // ANTI-VACUITÉ : le balayage doit avoir réellement accepté ET réellement
    // rejeté. « Zéro négatif » sur zéro acceptation ne prouverait rien.
    expect(accepted).toBeGreaterThan(0);
    expect(rejected).toBeGreaterThan(0);
    expect(accepted + rejected).toBe(SHIPPED_BOUNDS.length * SWEEP_INPUTS.length ** 2);
  });

  it('L’ANCIEN idiome, lui, PRODUIT du négatif sur ce même balayage — le rouge-avant, mesuré', () => {
    const negatives = SWEEP_INPUTS.filter((raw) => legacyLimit(raw, 50, 200) < 1);
    expect(negatives).toContain('-1');
    expect(negatives).toContain('-5');
    expect(negatives.length).toBeGreaterThan(0);
  });
});

/* ================================================================== *
 * LES MARQUES (ADR-080 §D2) — une fenêtre cesse d'être une vérité
 * ================================================================== */

describe('ADR-080 §D2 — `PageSize` et `ResultTotal` sont deux questions, donc deux types', () => {
  it('`resultTotal` refuse ce qui n’a pas été lu comme un compte', () => {
    expect(resultTotal(0)).toBe(0);
    expect(resultTotal(290)).toBe(290);
    expect(() => resultTotal(-1)).toThrow(/entier/);
    expect(() => resultTotal(1.5)).toThrow(/entier/);
  });

  it('`distinctGroupCount` est une TÊTE DE COMPTE : la cardinalité d’un `groupBy`, pas la longueur d’une page', () => {
    expect(distinctGroupCount([{ a: 1 }, { a: 2 }, { a: 3 }])).toBe(3);
    expect(distinctGroupCount([])).toBe(0);
  });

  it('`pageSizeOf` n’invente aucun décalage pour un point d’entrée qui n’en accepte pas', () => {
    const parsed = pageWindow({ def: 20, max: 100 }).pick({ limit: true }).safeParse({});
    expect(parsed.success).toBe(true);
    if (!parsed.success) throw new Error('unreachable');
    expect(pageSizeOf(parsed.data)).toBe(20);
  });

  it('COMPILE-TIME : `total: data.length` ne compile pas — un `.length` nu n’est pas un `ResultTotal`', () => {
    const data = [1, 2, 3];
    // @ts-expect-error — c'est TOUT l'intérêt de la marque : DNC-01 devient une
    // erreur de type et non une relecture attentive.
    const wrong: ReturnType<typeof resultTotal> = data.length;
    // `wrong` existe pour que la directive ci-dessus porte sur une VRAIE
    // affectation ; la valeur à l'exécution n'est pas la propriété testée.
    expect(typeof wrong).toBe('number');
  });
});

/* ================================================================== *
 * (v) UN CONTRÔLEUR RÉEL — 400, pas un nombre écrêté
 * ================================================================== */

const JWT = { sub: 'kc-1', realm_access: { roles: ['school_admin'] } } as never;
const ME = { id: 'user-1', tenantId: 'tenant-1' };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asDep = <T>(value: unknown): T => value as any;

describe('AC-3 (v) — un contrôleur CONVERTI rend un BadRequestException, jamais un nombre écrêté', () => {
  it('`GET /notifications?limit=0` → 400 (et non les 20 lignes du défaut)', async () => {
    const listed = jest.fn();
    const controller = new NotificationsController(
      asDep({ list: listed, unreadCount: jest.fn(), markRead: jest.fn() }),
      asDep({ ensureUser: jest.fn().mockResolvedValue(ME) }),
    );

    await expect(controller.list(JWT, '0')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(JWT, '-5')).rejects.toBeInstanceOf(BadRequestException);
    await expect(controller.list(JWT, '101')).rejects.toBeInstanceOf(BadRequestException);
    // Aucune lecture n'a été émise : le rejet précède la base.
    expect(listed).not.toHaveBeenCalled();
  });

  it('`GET /notifications?limit=7` traverse — CONTRÔLE POSITIF prouvant que la couche testée est atteinte', async () => {
    const listed = jest.fn().mockResolvedValue([]);
    const controller = new NotificationsController(
      asDep({ list: listed, unreadCount: jest.fn(), markRead: jest.fn() }),
      asDep({ ensureUser: jest.fn().mockResolvedValue(ME) }),
    );

    await controller.list(JWT, '7');
    expect(listed).toHaveBeenCalledTimes(1);
    expect(listed.mock.calls[0][0]).toMatchObject({ limit: 7, tenantId: 'tenant-1' });
  });
});

/* ================================================================== *
 * AC-4 / AC-5 / AC-11 — les agrégats de `/teaching-assignments`
 * ================================================================== */

/**
 * AC-11 (anti-faux-vert) : le corpus est construit pour que `total` soit
 * STRICTEMENT SUPÉRIEUR à la page. Sur un petit corpus, `data.length === total`
 * et un KPI non converti afficherait ENCORE le bon nombre — la suite doit donc
 * asseoir la DÉRIVATION, jamais la valeur.
 */
const PAGE_ROWS = [{ id: 'a1' }, { id: 'a2' }];
const TOTAL_ROWS = 290;

function buildAssignmentsController() {
  const findMany = jest.fn().mockResolvedValue(PAGE_ROWS);
  const count = jest.fn().mockResolvedValue(TOTAL_ROWS);
  const groupBy = jest.fn().mockImplementation((args: { by: string[]; where: object }) => {
    const key = args.by[0];
    if (key === 'teacherProfileId') {
      return Promise.resolve(Array.from({ length: 41 }, (_, i) => ({ teacherProfileId: `t${i}` })));
    }
    const role = (args.where as { role?: string }).role;
    if (role === 'principal') {
      return Promise.resolve([{ classSectionId: 'c1' }, { classSectionId: 'c2' }]);
    }
    if (role === 'assistant') return Promise.resolve([{ classSectionId: 'c1' }]);
    return Promise.resolve(Array.from({ length: 23 }, (_, i) => ({ classSectionId: `c${i}` })));
  });
  const subjectCount = jest.fn().mockResolvedValue(4);

  const prisma = asDep<ConstructorParameters<typeof TeachingAssignmentsController>[0]>({
    teachingAssignment: { findMany, count, groupBy },
    subject: { count: subjectCount },
  });
  const users = asDep<ConstructorParameters<typeof TeachingAssignmentsController>[1]>({
    ensureUser: jest.fn().mockResolvedValue(ME),
  });
  const ctx = asDep<ConstructorParameters<typeof TeachingAssignmentsController>[2]>({
    forTenant: jest.fn().mockResolvedValue({ schoolId: 'school-1', activeAcademicYearId: null }),
  });

  return {
    controller: new TeachingAssignmentsController(prisma, users, ctx),
    findMany,
    count,
    groupBy,
    subjectCount,
  };
}

describe('AC-4 / AC-5 — `/teaching-assignments` est BORNÉ et ses chiffres sont des agrégats', () => {
  it('la fenêtre par défaut est appliquée : `take` = 100, `skip` = 0', async () => {
    const { controller, findMany } = buildAssignmentsController();
    await controller.list(JWT);
    expect(findMany.mock.calls[0][0]).toMatchObject({ take: 100, skip: 0 });
  });

  it('`?limit=0` et `?offset=-1` sont des 400, et AUCUNE lecture n’est émise', async () => {
    const { controller, findMany, count } = buildAssignmentsController();
    await expect(controller.list(JWT, undefined, undefined, undefined, undefined, '0')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      controller.list(JWT, undefined, undefined, undefined, undefined, undefined, '-1'),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.list(JWT, undefined, undefined, undefined, undefined, '501'),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(findMany).not.toHaveBeenCalled();
    expect(count).not.toHaveBeenCalled();
  });

  it('AC-4 — `total` est COMPTÉ, jamais `data.length`, et le corpus le distingue (AC-11)', async () => {
    const { controller } = buildAssignmentsController();
    const res = await controller.list(JWT);
    expect(res.data).toHaveLength(PAGE_ROWS.length);
    expect(res.total).toBe(TOTAL_ROWS);
    // La garde anti-faux-vert : si le corpus avait `total === data.length`, un
    // KPI non converti passerait ce test.
    expect(res.total).toBeGreaterThan(res.data.length);
    expect(res.limit).toBe(100);
    expect(res.offset).toBe(0);
  });

  it('AC-4 — le `where` de la page et celui du total sont LE MÊME OBJET, pas deux littéraux', async () => {
    const { controller, findMany, count, groupBy } = buildAssignmentsController();
    await controller.list(JWT, 'teacher-9');

    const pageWhere = findMany.mock.calls[0][0].where;
    expect(count.mock.calls[0][0].where).toBe(pageWhere);
    // Les deux `groupBy` du résumé partagent la même référence…
    expect(groupBy.mock.calls[0][0].where).toBe(pageWhere);
    expect(groupBy.mock.calls[1][0].where).toBe(pageWhere);
    expect(pageWhere).toMatchObject({ tenantId: 'tenant-1', teacherProfileId: 'teacher-9' });
  });

  it('AC-5 — les quatre KPI sont des agrégats serveur, aucun n’est la longueur de la page', async () => {
    const { controller } = buildAssignmentsController();
    const res = await controller.list(JWT);
    expect(res.totals).toEqual({
      assignments: TOTAL_ROWS,
      teachers: 41,
      classes: 23,
      subjectsWithoutTeacher: 4,
    });
    for (const value of Object.values(res.totals)) {
      expect(value).not.toBe(res.data.length);
    }
  });

  it('AC-5 — les agrégats sont INVARIANTS sous `limit`/`offset` : seule `data` bouge', async () => {
    const a = buildAssignmentsController();
    const first = await a.controller.list(JWT, undefined, undefined, undefined, undefined, '5', '0');
    const b = buildAssignmentsController();
    const second = await b.controller.list(JWT, undefined, undefined, undefined, undefined, '500', '250');

    expect(second.totals).toEqual(first.totals);
    expect(second.coverage).toEqual(first.coverage);
    expect(a.findMany.mock.calls[0][0]).toMatchObject({ take: 5, skip: 0 });
    expect(b.findMany.mock.calls[0][0]).toMatchObject({ take: 500, skip: 250 });
  });

  it('AC-8 / G-TENANT — TOUTES les lectures du handler portent `tenantId`', async () => {
    const { controller, findMany, count, groupBy, subjectCount } = buildAssignmentsController();
    await controller.list(JWT);

    // Le nombre de lectures est DÉRIVÉ des doubles, jamais figé. Ce test portait
    // `toHaveLength(7)` et il était ROUGE sur l'arbre livré : le handler a gagné
    // un HUITIÈME agrégat (`coverage.subjectIdsWithTeacher`) pendant la tranche,
    // et les huit portent `tenantId`. Un littéral rougissait donc pour une raison
    // qui n'est PAS une fuite — et le remède tentant, écrire `8`, n'aurait fait
    // que rearmer le même piège au neuvième. Le compte n'est pas l'invariant ;
    // l'invariant, c'est que CHAQUE lecture émise porte l'axe tenant.
    const wheres = [
      ...findMany.mock.calls.map((c: [{ where: { tenantId?: string } }]) => c[0].where),
      ...count.mock.calls.map((c: [{ where: { tenantId?: string } }]) => c[0].where),
      ...groupBy.mock.calls.map((c: [{ where: { tenantId?: string } }]) => c[0].where),
      ...subjectCount.mock.calls.map((c: [{ where: { tenantId?: string } }]) => c[0].where),
    ];

    // PLANCHER D'ANTI-VACUITÉ, et c'est la seule chose qui reste chiffrée ici :
    // sans lui, un handler qui cesserait d'émettre TOUTE lecture passerait ce
    // test avec une liste vide. Sept est le nombre que la tranche EXIGE (page,
    // total, quatre `groupBy`, `subject.count`) ; il peut MONTER librement.
    expect(wheres.length).toBeGreaterThanOrEqual(7);
    for (const where of wheres) {
      // Une lecture SANS `where` du tout serait la fuite la plus large possible :
      // `undefined.tenantId` lèverait, mais le message ne dirait pas pourquoi.
      expect(where).toBeDefined();
      expect(where.tenantId).toBe('tenant-1');
    }
  });

  it('AC-5b — la couverture porte sur l’ÉTABLISSEMENT, pas sur les filtres de la page', async () => {
    const { controller, groupBy } = buildAssignmentsController();
    const res = await controller.list(JWT, 'teacher-9', 'class-3');

    expect(res.coverage.scope).toBe('establishment');
    expect(res.coverage.classSectionIdsWithPrincipal).toEqual(['c1', 'c2']);
    expect(res.coverage.classSectionIdsWithAssistant).toEqual(['c1']);

    // Le point du test : les deux `groupBy` de couverture NE portent PAS les
    // filtres de la page. S'ils les portaient, le panneau accuserait de « sans
    // professeur principal » chaque classe que le filtre exclut.
    const coverageCalls = groupBy.mock.calls
      .map((c: [{ where: Record<string, unknown> }]) => c[0].where)
      .filter((w: Record<string, unknown>) => w.role !== undefined);
    expect(coverageCalls).toHaveLength(2);
    for (const where of coverageCalls) {
      expect(where.teacherProfileId).toBeUndefined();
      expect(where.classSectionId).toBeUndefined();
      expect(where.tenantId).toBe('tenant-1');
    }
  });

  it('AC-5 — `subjectsWithoutTeacher` est une différence d’ensembles CÔTÉ SERVEUR, sur les matières de l’école', async () => {
    const { controller, subjectCount, findMany } = buildAssignmentsController();
    await controller.list(JWT);

    const where = subjectCount.mock.calls[0][0].where;
    expect(where).toMatchObject({ tenantId: 'tenant-1', schoolId: 'school-1' });
    // Le second opérande est la MÊME portée que la page — pas une seconde
    // charge utile bornée différemment (le mode de panne de PM-3).
    expect(where.teachingAssignments.none).toBe(findMany.mock.calls[0][0].where);
  });
});
