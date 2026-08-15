import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import type { SchoolContextService } from '../school-structure/school-context.service';
import type { StudentAccessService } from '../students/student-access.service';

import type { CalendarSeedService } from './calendar-seed.service';
import {
  assertSingleScopeId,
  CalendarController,
  CREATE_OWNED_SCOPE_FIELDS,
  SCOPE_ID_FIELDS,
  scopeOwnershipPlan,
  unknownScopeRef,
} from './calendar.controller';

/**
 * S-E01-5 / PF-204 — les clés étrangères de portée de `calendar_event` sont
 * vérifiées pour la PROPRIÉTÉ, pas seulement pour la cohérence (ADR-049).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ COMMENT LE ROUGE D'AVANT-CORRECTIF A ÉTÉ ÉTABLI (AC-4) — À LIRE          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Le rouge d'avant-correctif est une ABSENCE, et il a été établi par LECTURE de
 * l'arbre à `HEAD`, pas par exécution. Sur `HEAD` :
 *
 *  - `createEvent` n'émettait qu'UNE instruction dans la portée — le `create` —
 *    et AUCUN `tx.cycle.*` / `tx.gradeLevel.*` / `tx.classSection.*` /
 *    `tx.academicYear.*` n'apparaissait nulle part dans `calendar.controller.ts`
 *    (le fichier ne référençait aucun de ces quatre modèles) ;
 *  - `update` n'émettait que la lecture de garde `calendarEvent.findUnique` puis
 *    l'`update`.
 *
 * Donc AUCUN refus de propriété n'était atteignable : les cas N1..N7 ci-dessous
 * auraient tous vu leur `create` / `update` RÉUSSIR avec l'id étranger persisté.
 * C'est pour cela que chaque négatif assère LE REFUS (et la non-écriture), et
 * NON la présence de la sonde : assérer la sonde serait vert pour la mauvaise
 * raison le jour où quelqu'un ajoute un `findFirst` sans refuser dessus.
 *
 * **CE QUI N'A PAS ÉTÉ EXÉCUTÉ, écrit plutôt qu'affirmé** : cet agent ne lance
 * ni jest, ni typecheck, ni `scripts/tenant-adversarial-check.js` (budget CPU —
 * seul le test-architect exécute la chaîne). Le rouge d'avant-correctif n'a donc
 * PAS été capturé par un run ; il est démontré statiquement ci-dessus, et le
 * triple `[LIMIT] N scoped + M enumerated / T` du checker adversarial n'est pas
 * reporté par cet agent.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX `tx` EST DÉLIBÉRÉMENT NON FILTRANT — c'est la moitié qui prouve  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `makeDb()` n'applique AUCUN filtre tenant ambiant : il honore EXACTEMENT le
 * `where` qu'on lui passe, et rien d'autre. C'est la simulation du chemin
 * `degraded_no_app_url` — la connexion du PROPRIÉTAIRE, où le propriétaire
 * échappe à ses propres policies (ADR-032 §D5) et où RLS ne filtre RIEN. Un
 * faux qui filtrerait par tenant de lui-même rendrait ces tests verts sans que
 * le code ait la moindre clause `tenantId`, c'est-à-dire prouverait le faux.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const SCHOOL = '33333333-3333-3333-3333-333333333333';
const ACTOR = '44444444-4444-4444-4444-444444444444';

const OWN_YEAR = 'aaaaaaaa-0000-0000-0000-000000000001';
const OWN_CYCLE = 'aaaaaaaa-0000-0000-0000-000000000002';
const OWN_LEVEL = 'aaaaaaaa-0000-0000-0000-000000000003';
const OWN_CLASS = 'aaaaaaaa-0000-0000-0000-000000000004';

const FOREIGN_YEAR = 'bbbbbbbb-0000-0000-0000-000000000001';
const FOREIGN_CYCLE = 'bbbbbbbb-0000-0000-0000-000000000002';
const FOREIGN_LEVEL = 'bbbbbbbb-0000-0000-0000-000000000003';
const FOREIGN_CLASS = 'bbbbbbbb-0000-0000-0000-000000000004';

/** Un id qui n'a JAMAIS existé, dans aucun tenant. */
const NEVER_EXISTED = 'cccccccc-0000-0000-0000-00000000ffff';

const OWN_EVENT = 'dddddddd-0000-0000-0000-000000000001';
const FOREIGN_EVENT = 'dddddddd-0000-0000-0000-000000000002';

type Row = Record<string, unknown>;

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

/** Le corps que l'UI admin envoie RÉELLEMENT (`CalendarManager.tsx:429-442`). */
function adminPayload(overrides: Row = {}): Row {
  return {
    title: 'Conseil de classe',
    type: 'meeting',
    startsAt: '2026-09-01T08:00:00.000Z',
    endsAt: '2026-09-01T10:00:00.000Z',
    academicYearId: OWN_YEAR,
    gradeLevelId: null,
    classSectionId: null,
    ...overrides,
  };
}

/**
 * Une base en mémoire qui applique le `where` REÇU, littéralement, et rien de
 * plus. Chaque appel est journalisé avec le modèle, la méthode, le `where` et
 * un drapeau `insideScope` : c'est ce drapeau qui prouve AC-1/AC-2 (la sonde
 * tourne SUR LE `tx` de la portée, jamais sur `this.prisma`).
 */
function makeDb() {
  const calls: { model: string; method: string; where?: Row; insideScope: boolean }[] = [];
  let insideScope = false;
  let scopeGeneration = 0;
  const scopeOfCall: number[] = [];

  const tables: Record<string, Row[]> = {
    academicYear: [
      { id: OWN_YEAR, tenantId: TENANT },
      { id: FOREIGN_YEAR, tenantId: OTHER_TENANT },
    ],
    cycle: [
      { id: OWN_CYCLE, tenantId: TENANT },
      { id: FOREIGN_CYCLE, tenantId: OTHER_TENANT },
    ],
    gradeLevel: [
      { id: OWN_LEVEL, tenantId: TENANT },
      { id: FOREIGN_LEVEL, tenantId: OTHER_TENANT },
    ],
    classSection: [
      { id: OWN_CLASS, tenantId: TENANT },
      { id: FOREIGN_CLASS, tenantId: OTHER_TENANT },
    ],
    calendarEvent: [
      { id: OWN_EVENT, tenantId: TENANT, schoolId: SCHOOL, startsAt: new Date(0), endsAt: new Date(1) },
      {
        id: FOREIGN_EVENT,
        tenantId: OTHER_TENANT,
        schoolId: SCHOOL,
        startsAt: new Date(0),
        endsAt: new Date(1),
      },
    ],
    enrollment: [],
  };

  /**
   * Accès indexé sûr (`noUncheckedIndexedAccess`) : un nom de modèle inconnu rend
   * une table VIDE plutôt que de faire planter le faux. Un test qui se tromperait
   * de modèle échouerait alors sur son assertion — pas sur un `TypeError`.
   */
  const table = (model: string): Row[] => tables[model] ?? [];

  /** AUCUN filtre ambiant : seules les clés PRÉSENTES dans le `where` excluent. */
  const matches = (row: Row, where: Row | undefined): boolean => {
    if (!where) return true;
    return Object.entries(where).every(([key, value]) => row[key] === value);
  };

  const record = (model: string, method: string, where?: Row) => {
    calls.push({ model, method, where, insideScope });
    scopeOfCall.push(scopeGeneration);
  };

  const delegate = (model: string) => ({
    findFirst: jest.fn(async ({ where }: { where?: Row } = {}) => {
      record(model, 'findFirst', where);
      return table(model).find((row) => matches(row, where)) ?? null;
    }),
    findUnique: jest.fn(async ({ where }: { where?: Row } = {}) => {
      record(model, 'findUnique', where);
      return table(model).find((row) => matches(row, where)) ?? null;
    }),
    // Le `where` d'une lecture de liste porte des opérateurs imbriqués (`gte`,
    // `in`, `not`) que ce faux ne modélise pas : il journalise le `where` et rend
    // toutes les lignes. Aucun test ci-dessous ne dépend de son filtrage — ils
    // comptent des INSTRUCTIONS et des SONDES.
    findMany: jest.fn(async ({ where }: { where?: Row } = {}) => {
      record(model, 'findMany', where);
      return [...table(model)];
    }),
    create: jest.fn(async ({ data }: { data: Row }) => {
      record(model, 'create');
      const row = { id: 'new-row', ...data };
      table(model).push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: { where: Row; data: Row }) => {
      record(model, 'update', where);
      return { ...(table(model).find((row) => matches(row, where)) ?? {}), ...data };
    }),
    delete: jest.fn(async ({ where }: { where: Row }) => {
      record(model, 'delete', where);
      return { id: where.id };
    }),
  });

  const tx = {
    academicYear: delegate('academicYear'),
    cycle: delegate('cycle'),
    gradeLevel: delegate('gradeLevel'),
    classSection: delegate('classSection'),
    calendarEvent: delegate('calendarEvent'),
    enrollment: delegate('enrollment'),
  };

  const scope = {
    run: jest.fn(async (tenantId: string, fn: (t: unknown) => Promise<unknown>) => {
      insideScope = true;
      scopeGeneration += 1;
      try {
        return await fn(tx);
      } finally {
        insideScope = false;
      }
    }),
  } as unknown as TenantScopeService;

  return {
    tx,
    scope,
    calls,
    tables,
    /** Le nombre d'instructions émises dans LA portée `n` (budget AC-8 / §D4). */
    statementsInScope: (generation = 1) =>
      calls.filter((c, i) => scopeOfCall[i] === generation && c.insideScope).length,
    scopeOpenings: () => scopeGeneration,
    ownershipProbes: () =>
      calls.filter(
        (c) =>
          c.method === 'findFirst' &&
          ['academicYear', 'cycle', 'gradeLevel', 'classSection'].includes(c.model),
      ),
  };
}

function makeController(db: ReturnType<typeof makeDb>) {
  const users = {
    ensureUser: jest.fn(async () => ({ id: ACTOR, tenantId: TENANT })),
  } as unknown as UserSyncService;
  const ctx = {
    forTenant: jest.fn(async () => ({ schoolId: SCHOOL })),
  } as unknown as SchoolContextService;
  const studentAccess = {
    scopeForUser: jest.fn(async () => ({ studentIds: ['student-1'] })),
  } as unknown as StudentAccessService;
  const seed = {} as unknown as CalendarSeedService;

  return new CalendarController(db.scope, users, ctx, studentAccess, seed);
}

/** Capture l'erreur levée, pour pouvoir comparer DEUX erreurs entre elles. */
async function capture(run: () => Promise<unknown>): Promise<unknown> {
  try {
    await run();
    return null;
  } catch (error) {
    return error;
  }
}

// ---------------------------------------------------------------------------

describe('helpers purs — sans Prisma, testables seuls (ADR-049 §D5)', () => {
  it('SCOPE_ID_FIELDS suit l’ordre d’inférence de `finalScope`, et CREATE ajoute l’année', () => {
    expect([...SCOPE_ID_FIELDS]).toEqual(['classSectionId', 'gradeLevelId', 'cycleId']);
    expect([...CREATE_OWNED_SCOPE_FIELDS]).toEqual([
      'academicYearId',
      'classSectionId',
      'gradeLevelId',
      'cycleId',
    ]);
  });

  it('AC-7 — l’exclusivité est définie sur la VÉRACITÉ, jamais sur la présence de la clé', () => {
    // Le corps RÉEL de l'UI : les deux clés présentes, une seule vraie.
    expect(() =>
      assertSingleScopeId({ gradeLevelId: OWN_LEVEL, classSectionId: null }),
    ).not.toThrow();
    expect(() => assertSingleScopeId({ gradeLevelId: '', classSectionId: OWN_CLASS })).not.toThrow();
    // Deux valeurs vraies : refus.
    expect(() => assertSingleScopeId({ cycleId: OWN_CYCLE, classSectionId: OWN_CLASS })).toThrow(
      BadRequestException,
    );
  });

  it('le plan ne retient QUE les chaînes non vides (PM-1 : `null` n’est pas « fourni »)', () => {
    expect(
      scopeOwnershipPlan({ academicYearId: OWN_YEAR, gradeLevelId: null, classSectionId: '' }, [
        ...CREATE_OWNED_SCOPE_FIELDS,
      ]),
    ).toEqual([{ field: 'academicYearId', id: OWN_YEAR }]);
    expect(scopeOwnershipPlan({}, [...SCOPE_ID_FIELDS])).toEqual([]);
  });

  it('le refus est un 400 qui nomme le CHAMP et jamais un tenant / une table', () => {
    const error = unknownScopeRef('cycleId');
    expect(error).toBeInstanceOf(BadRequestException);
    const message = String((error.getResponse() as { message?: string }).message);
    expect(message).toContain('cycleId');
    expect(message).not.toContain(TENANT);
    expect(message).not.toContain(OTHER_TENANT);
    expect(message.toLowerCase()).not.toContain('tenant');
  });
});

// ---------------------------------------------------------------------------

describe('AC-1 — `createEvent` refuse tout id de portée qui n’appartient pas au tenant', () => {
  const cases: [string, string, Row][] = [
    ['N1 academicYearId', 'academicYearId', { academicYearId: FOREIGN_YEAR }],
    ['N2 cycleId', 'cycleId', { academicYearId: OWN_YEAR, cycleId: FOREIGN_CYCLE, scope: 'cycle_scope' }],
    [
      'N3 gradeLevelId',
      'gradeLevelId',
      { academicYearId: OWN_YEAR, gradeLevelId: FOREIGN_LEVEL, scope: 'grade_level_scope' },
    ],
    [
      'N4 classSectionId',
      'classSectionId',
      { academicYearId: OWN_YEAR, classSectionId: FOREIGN_CLASS, scope: 'class_section_scope' },
    ],
  ];

  it.each(cases)('%s — 400, et le `create` n’a JAMAIS lieu', async (_name, field, overrides) => {
    const db = makeDb();
    const controller = makeController(db);

    const error = await capture(() =>
      controller.create(adminPayload(overrides) as never, jwt(['school_admin'])),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as BadRequestException).message)).toContain(field);
    // La moitié qui compte : rien n'a été écrit.
    expect(db.tx.calendarEvent.create).not.toHaveBeenCalled();
  });

  it('S1 — chaque sonde tourne DANS la portée, sur le `tx`, avec un `tenantId` EXPLICITE', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await capture(() =>
      controller.create(
        adminPayload({ cycleId: FOREIGN_CYCLE, scope: 'cycle_scope' }) as never,
        jwt(['school_admin']),
      ),
    );

    const probes = db.ownershipProbes();
    expect(probes.length).toBeGreaterThan(0);
    for (const probe of probes) {
      expect(probe.insideScope).toBe(true);
      // PM-3 : la clause tenant est DANS le `where`, elle n'est pas héritée d'un
      // RLS que ce déploiement n'a pas.
      expect(probe.where?.tenantId).toBe(TENANT);
    }
    // Et jamais `findUnique` par id seul, qui aurait besoin d'une comparaison JS.
    expect(db.tx.cycle.findUnique).not.toHaveBeenCalled();
  });

  it('positif — un corps entièrement possédé passe, et l’id est bien persisté', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await controller.create(
      adminPayload({ cycleId: OWN_CYCLE, scope: 'cycle_scope' }) as never,
      jwt(['school_admin']),
    );

    expect(db.tx.calendarEvent.create).toHaveBeenCalledTimes(1);
    const [createCall] = db.tx.calendarEvent.create.mock.calls;
    const data = createCall![0].data as Row;
    expect(data.cycleId).toBe(OWN_CYCLE);
    expect(data.tenantId).toBe(TENANT);
  });
});

// ---------------------------------------------------------------------------

describe('AC-2 — `update` fait de même pour les ids qu’il ÉCRIT, dans LA MÊME portée', () => {
  const cases: [string, string, Row][] = [
    ['N5 cycleId', 'cycleId', { cycleId: FOREIGN_CYCLE }],
    ['N6 gradeLevelId', 'gradeLevelId', { gradeLevelId: FOREIGN_LEVEL }],
    ['N7 classSectionId', 'classSectionId', { classSectionId: FOREIGN_CLASS }],
  ];

  it.each(cases)('%s — 400, et l’`update` n’a JAMAIS lieu', async (_name, field, overrides) => {
    const db = makeDb();
    const controller = makeController(db);

    const error = await capture(() =>
      controller.update(OWN_EVENT, overrides as never, jwt(['school_admin'])),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as BadRequestException).message)).toContain(field);
    expect(db.tx.calendarEvent.update).not.toHaveBeenCalled();
  });

  it('S2 — UNE SEULE portée est ouverte : garde, sondes et écriture partagent le `tx`', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await controller.update(OWN_EVENT, { cycleId: OWN_CYCLE } as never, jwt(['school_admin']));

    expect(db.scopeOpenings()).toBe(1);
    for (const call of db.calls) expect(call.insideScope).toBe(true);
    expect(db.tx.calendarEvent.update).toHaveBeenCalledTimes(1);
  });

  it('ORDRE — sur un événement d’un AUTRE tenant : 404, sans jamais sonder le corps', async () => {
    const db = makeDb();
    const controller = makeController(db);

    const error = await capture(() =>
      controller.update(FOREIGN_EVENT, { cycleId: FOREIGN_CYCLE } as never, jwt(['school_admin'])),
    );

    expect(error).toBeInstanceOf(NotFoundException);
    // L'appelant n'apprend RIEN sur son corps tant qu'il ne possède pas la ligne
    // nommée dans le chemin (ADR-049 §D1).
    expect(db.ownershipProbes()).toHaveLength(0);
  });

  it('PM-1 — `PATCH { cycleId: null }` efface la colonne SANS aucune sonde', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await controller.update(OWN_EVENT, { cycleId: null } as never, jwt(['school_admin']));

    expect(db.ownershipProbes()).toHaveLength(0);
    expect(db.tx.calendarEvent.update).toHaveBeenCalledTimes(1);
    const [updateCall] = db.tx.calendarEvent.update.mock.calls;
    const data = updateCall![0].data as Row;
    expect(data.cycleId).toBeNull();
  });

  it('AC-9 / PF-206 — `academicYearId` n’est pas sondé par `update`, parce qu’il n’est pas écrit', async () => {
    const db = makeDb();
    const controller = makeController(db);

    // Un id d'année ÉTRANGER passe ici, et c'est CONFORME : `update` ne le
    // persiste pas (PF-206), donc le sonder dépenserait une instruction dans la
    // portée pour valider une valeur jetée.
    await controller.update(
      OWN_EVENT,
      { academicYearId: FOREIGN_YEAR } as never,
      jwt(['school_admin']),
    );

    expect(db.tx.academicYear.findFirst).not.toHaveBeenCalled();
    expect(db.tx.calendarEvent.update).toHaveBeenCalledTimes(1);
    const [updateCall] = db.tx.calendarEvent.update.mock.calls;
    const data = updateCall![0].data as Row;
    expect(data.academicYearId).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('AC-3 — aucun oracle d’existence : les deux refus sont IDENTIQUES', () => {
  it('X1 — id étranger et id jamais existant produisent la MÊME erreur, comparée à elle-même', async () => {
    const foreignDb = makeDb();
    const foreign = await capture(() =>
      makeController(foreignDb).create(
        adminPayload({ cycleId: FOREIGN_CYCLE, scope: 'cycle_scope' }) as never,
        jwt(['school_admin']),
      ),
    );

    const absentDb = makeDb();
    const absent = await capture(() =>
      makeController(absentDb).create(
        adminPayload({ cycleId: NEVER_EXISTED, scope: 'cycle_scope' }) as never,
        jwt(['school_admin']),
      ),
    );

    // Comparaison des deux erreurs ENTRE ELLES — et non deux `toThrow` séparés,
    // qui passeraient tout aussi bien sur deux messages différents.
    expect((foreign as BadRequestException).getStatus()).toBe(
      (absent as BadRequestException).getStatus(),
    );
    expect((foreign as BadRequestException).getResponse()).toEqual(
      (absent as BadRequestException).getResponse(),
    );
    expect(String((foreign as BadRequestException).message)).toBe(
      String((absent as BadRequestException).message),
    );
  });

  it('la même indiscernabilité tient sur `update`', async () => {
    const a = await capture(() =>
      makeController(makeDb()).update(
        OWN_EVENT,
        { gradeLevelId: FOREIGN_LEVEL } as never,
        jwt(['school_admin']),
      ),
    );
    const b = await capture(() =>
      makeController(makeDb()).update(
        OWN_EVENT,
        { gradeLevelId: NEVER_EXISTED } as never,
        jwt(['school_admin']),
      ),
    );
    expect((a as BadRequestException).getResponse()).toEqual((b as BadRequestException).getResponse());
  });
});

// ---------------------------------------------------------------------------

describe('AC-7 — exclusivité mutuelle, et la charge utile réelle de l’UI reste acceptée', () => {
  it('M1 — deux ids de portée VRAIS : 400, et rien n’entre dans la portée', async () => {
    const db = makeDb();
    const controller = makeController(db);

    // PM-5, exactement : sans `scope`, les trois gardes de cohérence sont inertes
    // et le `cycleId` étranger montait dans la ligne sans jamais être vu.
    const error = await capture(() =>
      controller.create(
        adminPayload({ classSectionId: OWN_CLASS, cycleId: FOREIGN_CYCLE }) as never,
        jwt(['school_admin']),
      ),
    );

    expect(error).toBeInstanceOf(BadRequestException);
    // Refus PUR : la transaction n'a jamais été ouverte.
    expect(db.scopeOpenings()).toBe(0);
  });

  it('M1b — la même règle s’applique à `update`', async () => {
    const db = makeDb();
    const error = await capture(() =>
      makeController(db).update(
        OWN_EVENT,
        { gradeLevelId: OWN_LEVEL, classSectionId: OWN_CLASS } as never,
        jwt(['school_admin']),
      ),
    );
    expect(error).toBeInstanceOf(BadRequestException);
    expect(db.scopeOpenings()).toBe(0);
  });

  it('M2 — la charge utile RÉELLE de l’admin (un id vrai, l’autre `null`) est ACCEPTÉE', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await controller.create(
      adminPayload({ gradeLevelId: OWN_LEVEL, classSectionId: null, scope: 'grade_level_scope' }) as never,
      jwt(['school_admin']),
    );

    expect(db.tx.calendarEvent.create).toHaveBeenCalledTimes(1);
    // DEUX sondes seulement : l'année et le niveau. Pas trois, pas quatre.
    expect(db.ownershipProbes()).toHaveLength(2);
  });

  it('M3 / PM-1 — un `school_wide` (les deux ids `null`) ne sonde QUE l’année scolaire', async () => {
    const db = makeDb();
    const controller = makeController(db);

    await controller.create(adminPayload({ scope: 'school_wide' }) as never, jwt(['school_admin']));

    expect(db.tx.calendarEvent.create).toHaveBeenCalledTimes(1);
    const probes = db.ownershipProbes();
    expect(probes).toHaveLength(1);
    expect(probes[0]?.model).toBe('academicYear');
  });
});

// ---------------------------------------------------------------------------

describe('AC-8 / ADR-049 §D4 — le budget d’instructions dans la portée, MESURÉ', () => {
  it('B1 `create` — 3 au pire (année + portée + write), 1 au mieux', async () => {
    const worst = makeDb();
    await makeController(worst).create(
      adminPayload({ cycleId: OWN_CYCLE, scope: 'cycle_scope' }) as never,
      jwt(['school_admin']),
    );
    expect(worst.statementsInScope(1)).toBe(3);

    const best = makeDb();
    await makeController(best).create(
      adminPayload({ academicYearId: null, scope: 'school_wide' }) as never,
      jwt(['school_admin']),
    );
    expect(best.statementsInScope(1)).toBe(1);
  });

  it('B1 `update` — 3 au pire (garde + portée + write), 2 au mieux', async () => {
    const worst = makeDb();
    await makeController(worst).update(
      OWN_EVENT,
      { classSectionId: OWN_CLASS } as never,
      jwt(['school_admin']),
    );
    expect(worst.statementsInScope(1)).toBe(3);

    const best = makeDb();
    await makeController(best).update(OWN_EVENT, { title: 'x' } as never, jwt(['school_admin']));
    expect(best.statementsInScope(1)).toBe(2);
  });

  it('B1 `remove` — 2, INCHANGÉ par cette story', async () => {
    const db = makeDb();
    await makeController(db).remove(OWN_EVENT, jwt(['school_admin']));
    expect(db.statementsInScope(1)).toBe(2);
    expect(db.ownershipProbes()).toHaveLength(0);
  });

  it('B1 `list` — 1 pour un admin, 2 pour un parent, et AUCUNE sonde ajoutée', async () => {
    const admin = makeDb();
    await makeController(admin).list(jwt(['school_admin']));
    expect(admin.statementsInScope(1)).toBe(1);

    const parent = makeDb();
    await makeController(parent).list(jwt(['parent']));
    expect(parent.statementsInScope(1)).toBe(2);
    // AC-5 : le chemin de LECTURE ne gagne pas une instruction.
    expect(parent.ownershipProbes()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------

describe('AC-5 / AC-6 / AC-9 — assertions de SOURCE (G-PORTAL, G-DNC, la prémisse PF-206)', () => {
  const SOURCE = readFileSync(join(__dirname, 'calendar.controller.ts'), 'utf8');

  it('D1 / G-DNC — aucun drapeau de contournement, aucune variable d’environnement', () => {
    expect(SOURCE).not.toContain('process.env');
    expect(SOURCE).not.toContain('NODE_ENV');
    expect(SOURCE).not.toContain('SKIP_');
    expect(SOURCE).not.toContain('ALLOW_');
  });

  it('G-DNC — aucun repli sur la connexion du PROPRIÉTAIRE : le contrôleur n’en a pas', () => {
    // Le contrôleur ne se fait PAS injecter `PrismaService` : il ne peut donc pas
    // se replier dessus, même par inattention. La seule occurrence textuelle de
    // `this.prisma` dans le fichier est dans le commentaire d'exclusion nommée de
    // `seedFrenchHolidays` (PF-198), qui décrit le service de seed — pas ce
    // contrôleur. On assère donc l'ABSENCE DE LA DÉPENDANCE, pas l'absence de la
    // chaîne, parce que la chaîne a une occurrence légitime et documentée.
    expect(SOURCE).not.toContain('private readonly prisma');
    expect(SOURCE.split('this.prisma.').length - 1).toBe(1);
    // Et les sondes de propriété tournent toutes sur `tx.`, jamais sur `this.`.
    expect(SOURCE).not.toMatch(/this\.prisma\.\w+\.findFirst/);
  });

  it('la sonde est un `findFirst` avec `tenantId` EXPLICITE — jamais un `findUnique` par id seul', () => {
    // Tolérant à l'espacement : un reflow prettier de `calendar.controller.ts` ne
    // doit PAS rendre cette assertion rouge pour une raison qui n'est pas un défaut.
    const probe =
      /\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*ref\.id\s*,\s*tenantId\s*,?\s*\}\s*,\s*select:\s*\{\s*id:\s*true\s*,?\s*\}\s*,?\s*\}\s*\)/g;
    // 4 branches dans `createEvent` + 3 dans `update`.
    expect(SOURCE.match(probe)).toHaveLength(7);
    expect(SOURCE).not.toContain('findUnique({ where: { id: ref.id');
  });

  it('G1 / PF-206 — le bloc `data` d’`update` NE persiste PAS `academicYearId`', () => {
    const start = SOURCE.indexOf('return await tx.calendarEvent.update({');
    expect(start).toBeGreaterThan(-1);
    const end = SOURCE.indexOf('} catch (error)', start);
    expect(end).toBeGreaterThan(start);
    const dataBlock = SOURCE.slice(start, end);

    // La prémisse épinglée : ajouter le champ ici rend ce test ROUGE, ce qui
    // transforme un trou silencieux (PF-206) en échec visible.
    expect(dataBlock).not.toContain('academicYearId');
    // …et la direction qui échoue échoue bien : les trois ids qu'il écrit VRAIMENT.
    expect(dataBlock).toContain('cycleId');
    expect(dataBlock).toContain('gradeLevelId');
    expect(dataBlock).toContain('classSectionId');
  });

  it('AC-5 — le chemin de LECTURE est intact : `include` inchangé, aucun `tenantId` ajouté', () => {
    const start = SOURCE.indexOf('const events = await tx.calendarEvent.findMany({');
    const end = SOURCE.indexOf('return { data: events };', start);
    const listBlock = SOURCE.slice(start, end);

    expect(listBlock).toContain("cycle: { select: { name: true, code: true } }");
    expect(listBlock).toContain("gradeLevel: { select: { name: true, code: true } }");
    expect(listBlock).toContain("classSection: { select: { name: true } }");
    // Cette story ne remédie AUCUNE ligne existante : la moitié rétroactive est
    // PF-205 (le FK composite valide les lignes déjà écrites en les créant).
    expect(listBlock).not.toContain('tenantId: true');
  });
});
