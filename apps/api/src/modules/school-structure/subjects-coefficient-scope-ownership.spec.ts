import 'reflect-metadata';

import { BadRequestException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import { distinctScopeIdPlan, unknownScopeRef } from '../../shared/prisma/scope-fk';

import type { SchoolContextService } from './school-context.service';
import { SubjectsController } from './subjects.controller';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * S-E05-3 / PF-10 — la matrice de coefficients n'accepte plus un identifiant
 * d'un AUTRE tenant (ni d'une autre école du même tenant).
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI UNE FAUSSE BASE QUI FILTRE VRAIMENT — UN MOCK QUI NE PEUT PAS   │
 * │ ÉCHOUER EST UN VERT ACCIDENTEL                                           │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Un double qui rendrait `[{ id: 'gl-1' }]` quel que soit le `where` ferait
 * passer le contrôle de faux positif À VIDE ; un double qui rendrait toujours
 * `[]` ferait passer le refus à vide. Les deux seraient VERTS et ne prouveraient
 * rien. La fausse base ci-dessous applique RÉELLEMENT le `where` reçu, contient
 * les lignes des DEUX tenants (et d'une SECONDE école du tenant appelant), et
 * LÈVE bruyamment sur un opérateur qu'elle ne connaît pas.
 *
 * Le CONTRÔLE NÉGATIF ouvre le fichier : on émet contre la MÊME fausse base la
 * requête TELLE QU'ELLE ÉTAIT avant ce correctif — la clé composite
 * `(gradeLevelId, subjectId)` sans aucune colonne de tenant — et on montre
 * qu'elle atteint bien la ligne de la VICTIME. C'est ce qui prouve que le refus
 * observé ensuite vient du prédicat et non d'un double inerte.
 *
 * LA CASSE DES UUID EST TESTÉE, PAS SUPPOSÉE : `@IsUUID()` accepte un uuid en
 * majuscules, Postgres l'accepte aussi et le rend en minuscules. La fausse base
 * reproduit cette normalisation — sinon ces cas prouveraient une propriété de
 * l'égalité de chaînes JavaScript, pas une propriété du prédicat.
 *
 * LIMITE NOMMÉE (DNC-06) : rien ici ne touche PostgreSQL. Ces cas prouvent la
 * FORME des requêtes émises et le comportement du handler, jamais celui de RLS —
 * l'application se connecte en PROPRIÉTAIRE des tables et échappe à ses propres
 * policies (ADR-032 §D5), donc c'est bien le prédicat applicatif qui fait tout
 * le travail.
 *
 * G-AUTHZ n'est PAS ré-assené ici : `provenance-callsites.spec.ts` cliquette
 * déjà `SubjectsController.prototype.upsertCoefficients → ['subjects.write']`.
 * Une seconde copie de cette assertion serait une deuxième liste tenue à la
 * main.
 */

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const SCHOOL_A = 'aaaaaaaa-1111-4000-8000-000000000001';
/** La SECONDE école du tenant appelant — la limite assumée d'ADR-055 §D3. */
const SCHOOL_A2 = 'aaaaaaaa-1111-4000-8000-000000000002';
const SCHOOL_B = 'bbbbbbbb-1111-4000-8000-000000000002';

const ACTOR_ID = 'aaaaaaaa-2222-4000-8000-000000000001';

/** Cinq niveaux et six matières de l'école appelante : la vraie matrice, 30 entrées. */
const GL_A = [
  'aaaaaaaa-3333-4000-8000-000000000001',
  'aaaaaaaa-3333-4000-8000-000000000002',
  'aaaaaaaa-3333-4000-8000-000000000003',
  'aaaaaaaa-3333-4000-8000-000000000004',
  'aaaaaaaa-3333-4000-8000-000000000005',
];
const S_A = [
  'aaaaaaaa-4444-4000-8000-000000000001',
  'aaaaaaaa-4444-4000-8000-000000000002',
  'aaaaaaaa-4444-4000-8000-000000000003',
  'aaaaaaaa-4444-4000-8000-000000000004',
  'aaaaaaaa-4444-4000-8000-000000000005',
  'aaaaaaaa-4444-4000-8000-000000000006',
];

/** Le niveau et la matière de la VICTIME — ceux que PF-10 laissait ré-pondérer. */
const GL_B = 'bbbbbbbb-3333-4000-8000-000000000001';
const S_B = 'bbbbbbbb-4444-4000-8000-000000000001';

/** Le niveau de l'AUTRE école du MÊME tenant. */
const GL_A_OTHER_SCHOOL = 'aaaaaaaa-3333-4000-8000-000000000099';

/** Les cycles ne sont jamais sondés ; ils existent parce que le GET les PROJETTE. */
const CYCLE_A = 'aaaaaaaa-5555-4000-8000-000000000001';
const CYCLE_B = 'bbbbbbbb-5555-4000-8000-000000000002';

/** Un id qui n'existe NULLE PART — l'autre moitié de l'indiscernabilité. */
const GL_NOWHERE = 'cccccccc-3333-4000-8000-000000000000';

type Row = Record<string, unknown>;

function seed() {
  return {
    /**
     * Les colonnes d'affichage existent parce que le GET frère les PROJETTE.
     * Sans elles le cas d'aller-retour ci-dessous passerait sur des axes vides,
     * ce qui est exactement le vert accidentel que ce fichier refuse ailleurs.
     */
    gradeLevel: [
      ...GL_A.map((id, index) => ({
        id,
        tenantId: TENANT_A,
        schoolId: SCHOOL_A,
        code: 'N' + String(index + 1),
        name: 'Niveau ' + String(index + 1),
        orderIndex: index,
        cycleId: CYCLE_A,
      })),
      {
        id: GL_A_OTHER_SCHOOL,
        tenantId: TENANT_A,
        schoolId: SCHOOL_A2,
        code: 'N99',
        name: 'Niveau autre école',
        orderIndex: 99,
        cycleId: CYCLE_A,
      },
      {
        id: GL_B,
        tenantId: TENANT_B,
        schoolId: SCHOOL_B,
        code: 'N1',
        name: 'Niveau victime',
        orderIndex: 0,
        cycleId: CYCLE_B,
      },
    ] as Row[],
    subject: [
      ...S_A.map((id, index) => ({
        id,
        tenantId: TENANT_A,
        schoolId: SCHOOL_A,
        active: true,
        code: 'M' + String(index + 1),
        name: 'Matière ' + String(index + 1),
        defaultCoefficient: 1,
        color: null,
        icon: null,
      })),
      {
        id: S_B,
        tenantId: TENANT_B,
        schoolId: SCHOOL_B,
        active: true,
        code: 'M1',
        name: 'Matière victime',
        defaultCoefficient: 1,
        color: null,
        icon: null,
      },
    ] as Row[],
    /**
     * La ligne de la victime existe DÉJÀ : c'est la branche `update` de PF-10,
     * celle qui réécrit un coefficient d'un autre tenant au lieu d'en créer un.
     */
    subjectCoefficient: [
      { tenantId: TENANT_A, gradeLevelId: GL_A[0], subjectId: S_A[0], coefficient: 1 },
      { tenantId: TENANT_B, gradeLevelId: GL_B, subjectId: S_B, coefficient: 3 },
    ] as Row[],
    auditLog: [] as Row[],
  };
}

/** Postgres normalise les littéraux `uuid` ; la fausse base fait de même. */
function sameId(a: unknown, b: unknown): boolean {
  if (typeof a === 'string' && typeof b === 'string') return a.toLowerCase() === b.toLowerCase();
  return a === b;
}

/**
 * Applique un `where` Prisma minimal, mais RÉELLEMENT. Tout opérateur inconnu
 * LÈVE : un `where` mal lu qui rendrait `[]` en silence transformerait chaque
 * cas d'isolation en vert accidentel.
 */
function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (cond !== null && typeof cond === 'object') {
      const operators = cond as { in?: unknown[] };
      if ('in' in operators) {
        if (!(operators.in ?? []).some((candidate) => sameId(candidate, value))) return false;
        continue;
      }
      throw new Error(
        'fausse base : opérateur non supporté sur ' + key + ' — ' + JSON.stringify(cond),
      );
    }
    if (!sameId(value, cond)) return false;
  }
  return true;
}

type Statement = { model: string; verb: string; where: Record<string, unknown> };

/**
 * S-E03-4 / ADR-070 — `listActiveAcademicYears` calcule la vétusté et la
 * couverture de la date de référence sur CHAQUE ligne rendue : un `{ id }` nu ne
 * suffit plus, la ligne doit porter `schoolId` / `name` / `startDate` /
 * `endDate` / `status`. Ce complément préserve les identifiants attendus par les
 * assertions existantes.
 */
function academicYearRow(id: string) {
  return {
    id,
    schoolId: SCHOOL_A,
    name: '2025-2026',
    startDate: new Date('2025-09-01T00:00:00.000Z'),
    endDate: new Date('2026-07-05T00:00:00.000Z'),
    status: 'active',
  };
}

function makeHarness(options?: { activeYears?: { id: string }[] }) {
  const db = seed();
  const seen: Statement[] = [];
  const record = (model: string, verb: string, where: Record<string, unknown>) => {
    seen.push({ model, verb, where });
  };

  const readModel = (name: 'gradeLevel' | 'subject') => ({
    findMany: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      record(name, 'findMany', args?.where ?? {});
      return db[name].filter((row) => matches(row, args?.where));
    }),
  });

  const coefficientUpsert = jest.fn(
    async (args: {
      where: { gradeLevelId_subjectId: { gradeLevelId: string; subjectId: string } };
      update: Row;
      create: Row;
    }) => {
      record('subjectCoefficient', 'upsert', args.where as unknown as Record<string, unknown>);
      const key = args.where.gradeLevelId_subjectId;
      const existing = db.subjectCoefficient.find(
        (row) => sameId(row.gradeLevelId, key.gradeLevelId) && sameId(row.subjectId, key.subjectId),
      );
      if (existing) {
        Object.assign(existing, args.update);
        return existing;
      }
      const created = { ...args.create };
      db.subjectCoefficient.push(created);
      return created;
    },
  );

  const auditCreate = jest.fn(async (args: { data: Row }) => {
    record('auditLog', 'create', {});
    db.auditLog.push(args.data);
    return args.data;
  });

  const tx = {
    gradeLevel: readModel('gradeLevel'),
    subject: readModel('subject'),
    subjectCoefficient: { upsert: coefficientUpsert },
    auditLog: { create: auditCreate },
  };

  const triggerUpsert = jest.fn(async (args: { create: Row }) => args.create);

  /**
   * ADR-055 §D3 — le GET frère lit le tableau des coefficients par une relation
   * IMBRIQUÉE (`{ subject: { schoolId } }`), là où le PUT sonde ses axes par
   * `{ id: { in }, tenantId, schoolId }`. Cette asymétrie EST le risque de
   * faux refus, donc la fausse base la résout explicitement — par une jointure
   * réelle à travers `db.subject` — au lieu de la masquer. Toute AUTRE forme
   * imbriquée LÈVE, comme partout ailleurs dans ce fichier.
   */
  const coefficientFindMany = jest.fn(async (args?: { where?: Record<string, unknown> }) => {
    record('subjectCoefficient', 'findMany', args?.where ?? {});
    const where = args?.where ?? {};
    const nested = where.subject as { schoolId?: unknown } | undefined;
    if (nested === undefined) return db.subjectCoefficient.filter((row) => matches(row, where));
    if (typeof nested !== 'object' || nested === null || !('schoolId' in nested)) {
      throw new Error(
        'fausse base : relation imbriquée non supportée — ' + JSON.stringify(where.subject),
      );
    }
    const { subject: _relation, ...flat } = where;
    return db.subjectCoefficient.filter((row) => {
      if (!matches(row, flat)) return false;
      const parent = db.subject.find((candidate) => sameId(candidate.id, row.subjectId));
      return parent !== undefined && sameId(parent.schoolId, nested.schoolId);
    });
  });

  const prisma = {
    $transaction: jest.fn(async (cb: (t: typeof tx) => Promise<unknown>) => cb(tx)),
    gradeLevel: readModel('gradeLevel'),
    subject: readModel('subject'),
    subjectCoefficient: { findMany: coefficientFindMany },
    academicYear: {
      findMany: jest.fn(async () => (options?.activeYears ?? []).map((y) => academicYearRow(y.id))),
    },
    snapshotRecomputeTrigger: { upsert: triggerUpsert },
  };

  const forTenant = jest.fn().mockResolvedValue({
    tenantId: TENANT_A,
    schoolId: SCHOOL_A,
    activeAcademicYearId: null,
  });

  const controller = new SubjectsController(
    prisma as unknown as PrismaService,
    {
      ensureUser: jest.fn().mockResolvedValue({ id: ACTOR_ID, tenantId: TENANT_A }),
    } as unknown as UserSyncService,
    { forTenant } as unknown as SchoolContextService,
  );

  return {
    controller,
    prisma,
    tx,
    db,
    seen,
    coefficientUpsert,
    auditCreate,
    triggerUpsert,
    forTenant,
    coefficientFindMany,
  };
}

function jwt(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub-1', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

const REQ = { ip: '203.0.113.7', headers: {} };

/**
 * Le refus, RÉIFIÉ : la forme `rejects.toThrow` ne rend pas l'objet, or
 * l'indiscernabilité d'ADR-049 §D2 se prouve en COMPARANT deux messages.
 */
async function refusalOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (err) {
    return err as Error;
  }
  throw new Error('la requête a été ACCEPTÉE alors qu’elle devait être refusée');
}

/** La matrice complète de l'école appelante : 5 niveaux × 6 matières = 30 entrées. */
function fullMatrix(): { gradeLevelId: string; subjectId: string; coefficient: number }[] {
  const entries: { gradeLevelId: string; subjectId: string; coefficient: number }[] = [];
  for (const gradeLevelId of GL_A) {
    for (const subjectId of S_A) entries.push({ gradeLevelId, subjectId, coefficient: 2 });
  }
  return entries;
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * CONTRÔLE NÉGATIF — la fausse base PEUT échouer
 * ══════════════════════════════════════════════════════════════════════════ */

describe('contrôle négatif — la requête d’AVANT le correctif atteint bien la victime', () => {
  it('la clé composite `(gradeLevelId, subjectId)` ne porte aucune colonne de tenant', () => {
    const { db } = makeHarness();
    // La forme EXACTE du `where` que le handler émettait (et émet toujours) pour
    // écrire : elle identifie une ligne sans jamais nommer un tenant ni une
    // école. Elle atteint donc la ligne du tenant B depuis un appelant du
    // tenant A — c'est PF-10, reproduit ici, contre la même fausse base.
    const victim = db.subjectCoefficient.find(
      (row) => sameId(row.gradeLevelId, GL_B) && sameId(row.subjectId, S_B),
    );
    expect(victim).toBeDefined();
    expect(victim?.tenantId).toBe(TENANT_B);
  });

  it('la fausse base contient bien les lignes des deux tenants et des deux écoles', () => {
    const { db } = makeHarness();
    expect(db.gradeLevel.filter((r) => r.tenantId === TENANT_B)).toHaveLength(1);
    expect(db.gradeLevel.filter((r) => r.schoolId === SCHOOL_A2)).toHaveLength(1);
    expect(db.subject.filter((r) => r.tenantId === TENANT_B)).toHaveLength(1);
  });

  it('un opérateur inconnu fait ÉCHOUER la fausse base au lieu de rendre le vide', () => {
    expect(() => matches({ id: 'x' }, { id: { startsWith: 'x' } })).toThrow(
      /opérateur non supporté/,
    );
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC-1 / AC-4 / AC-5 — le chemin heureux, et DEUX sondes pour 30 entrées
 * ══════════════════════════════════════════════════════════════════════════ */

describe('AC-1 / AC-5 — la preuve de propriété est émise par id DISTINCT, pas par entrée', () => {
  it('30 entrées → exactement 2 requêtes de propriété, sur les ensembles distincts', async () => {
    const { controller, seen, coefficientUpsert, forTenant } = makeHarness();

    await controller.upsertCoefficients({ entries: fullMatrix() }, jwt(['school_admin']), REQ);

    const probes = seen.filter((s) => s.verb === 'findMany');
    // La CADENCE, pas seulement la forme : une refonte vers une sonde par
    // entrée en émettrait 60 et ce cas deviendrait rouge.
    expect(probes).toHaveLength(2);
    expect(probes.map((p) => p.model)).toEqual(['gradeLevel', 'subject']);
    expect(probes[0]?.where).toEqual({
      id: { in: GL_A },
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
    });
    expect(probes[1]?.where).toEqual({
      id: { in: S_A },
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
    });
    // AC-1 — l'école vient de `forTenant(tenantId)` sans école explicite, la
    // MÊME forme d'appel que le GET frère. Une « amélioration » vers `forUser`
    // (qui honore `preferences.activeSchoolId`) divergerait du GET et rendrait
    // ce cas rouge.
    expect(forTenant).toHaveBeenCalledWith(TENANT_A);
    expect(coefficientUpsert).toHaveBeenCalledTimes(30);
  });

  it('AC-1 — les DEUX sondes précèdent la première écriture, dans la même transaction', async () => {
    const { controller, seen, prisma } = makeHarness();

    await controller.upsertCoefficients({ entries: fullMatrix() }, jwt(['school_admin']), REQ);

    const firstWrite = seen.findIndex((s) => s.verb === 'upsert');
    const lastProbe = seen.map((s) => s.verb).lastIndexOf('findMany');
    expect(lastProbe).toBeGreaterThanOrEqual(0);
    expect(lastProbe).toBeLessThan(firstWrite);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('AC-4 / G-TRUTH — les lignes écrites, leur ORDRE et la réponse sont inchangés', async () => {
    const { controller, coefficientUpsert, auditCreate, triggerUpsert, db } = makeHarness({
      activeYears: [{ id: 'aaaaaaaa-5555-4000-8000-000000000001' }],
    });
    const entries = fullMatrix();

    const result = await controller.upsertCoefficients(
      { entries },
      jwt(['school_admin']),
      REQ,
    );

    expect(result).toEqual({ ok: true, count: 30 });
    // Même ordre, mêmes valeurs, même forme de `where` qu'avant le correctif.
    for (const [index, entry] of entries.entries()) {
      expect(coefficientUpsert).toHaveBeenNthCalledWith(index + 1, {
        where: {
          gradeLevelId_subjectId: {
            gradeLevelId: entry.gradeLevelId,
            subjectId: entry.subjectId,
          },
        },
        update: { coefficient: entry.coefficient },
        create: {
          tenantId: TENANT_A,
          gradeLevelId: entry.gradeLevelId,
          subjectId: entry.subjectId,
          coefficient: entry.coefficient,
        },
      });
    }
    // G-AUDIT — la MÊME ligne, dans la MÊME transaction, avec sa provenance.
    expect(auditCreate).toHaveBeenCalledTimes(1);
    expect(db.auditLog[0]).toMatchObject({
      tenantId: TENANT_A,
      actorId: ACTOR_ID,
      action: 'coefficient.upsert',
      resourceType: 'subject_coefficient',
      actorRole: 'school_admin',
      portal: 'admin',
      ipAddress: '203.0.113.7',
      after: { count: 30 },
    });
    // La mise en file de recalcul reste un FRÈRE d'après-commit : une entrée par
    // matière distincte × année active.
    expect(triggerUpsert).toHaveBeenCalledTimes(S_A.length);
  });

  it('la ligne de la VICTIME n’est jamais touchée par une sauvegarde ordinaire', async () => {
    const { controller, db } = makeHarness();

    await controller.upsertCoefficients({ entries: fullMatrix() }, jwt(['school_admin']), REQ);

    const victim = db.subjectCoefficient.find((row) => row.tenantId === TENANT_B);
    expect(victim?.coefficient).toBe(3);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC-2 / AC-3 — le refus, indiscernable et TOUT-OU-RIEN
 * ══════════════════════════════════════════════════════════════════════════ */

describe('AC-2 / AC-3 — un seul id étranger refuse le corps ENTIER', () => {
  /** 30 entrées dont UNE seule nomme le niveau de la victime. */
  function poisoned(id: string) {
    const entries = fullMatrix();
    entries[7] = { gradeLevelId: id, subjectId: S_A[0] as string, coefficient: 4 };
    return entries;
  }

  it('AC-3 — ZÉRO coefficient, ZÉRO ligne d’audit, ZÉRO déclencheur de recalcul', async () => {
    const { controller, coefficientUpsert, auditCreate, triggerUpsert, db } = makeHarness({
      activeYears: [{ id: 'aaaaaaaa-5555-4000-8000-000000000001' }],
    });

    await expect(
      controller.upsertCoefficients({ entries: poisoned(GL_B) }, jwt(['school_admin']), REQ),
    ).rejects.toBeInstanceOf(BadRequestException);

    // La promesse rejetée ne suffirait pas : elle ne distingue pas « refusé »
    // de « refusé après douze écritures ».
    expect(coefficientUpsert).toHaveBeenCalledTimes(0);
    expect(auditCreate).toHaveBeenCalledTimes(0);
    expect(triggerUpsert).toHaveBeenCalledTimes(0);
    expect(db.auditLog).toHaveLength(0);
    // Et la ligne de la victime est intacte : c'est PF-10, fermé.
    expect(db.subjectCoefficient.find((r) => r.tenantId === TENANT_B)?.coefficient).toBe(3);
  });

  it('AC-2 — le message est celui d’`unknownScopeRef`, VERBATIM, et nomme le CHAMP', async () => {
    const { controller } = makeHarness();

    await expect(
      controller.upsertCoefficients({ entries: poisoned(GL_B) }, jwt(['school_admin']), REQ),
    ).rejects.toThrow(unknownScopeRef('gradeLevelId').message);
  });

  it('AC-2 — « étranger » et « inexistant » produisent le MÊME message, à l’octet près', async () => {
    const foreign = makeHarness();
    const unknown = makeHarness();

    const foreignError = await refusalOf(
      foreign.controller.upsertCoefficients({ entries: poisoned(GL_B) }, jwt(['school_admin']), REQ),
    );
    const unknownError = await refusalOf(
      unknown.controller.upsertCoefficients(
        { entries: poisoned(GL_NOWHERE) },
        jwt(['school_admin']),
        REQ,
      ),
    );

    expect(foreignError).toBeInstanceOf(BadRequestException);
    expect(unknownError).toBeInstanceOf(BadRequestException);
    // Distinguer les deux serait un oracle d'existence inter-tenant.
    expect(foreignError.message).toBe(unknownError.message);
    // Et le message ne nomme ni tenant, ni école, ni table, ni compte de lignes.
    for (const token of [TENANT_A, TENANT_B, SCHOOL_A, SCHOOL_B, 'grade_level', 'subject_coefficient']) {
      expect(foreignError.message).not.toContain(token);
    }
  });

  it('une MATIÈRE étrangère nomme `subjectId`, et le niveau reste prouvé d’abord', async () => {
    const { controller, seen, coefficientUpsert } = makeHarness();
    const entries = fullMatrix();
    entries[3] = { gradeLevelId: GL_A[0] as string, subjectId: S_B, coefficient: 4 };

    await expect(
      controller.upsertCoefficients({ entries }, jwt(['school_admin']), REQ),
    ).rejects.toThrow(unknownScopeRef('subjectId').message);

    // Les deux sondes ont bien été émises (le niveau passe, la matière échoue),
    // et rien n'a été écrit.
    expect(seen.filter((s) => s.verb === 'findMany')).toHaveLength(2);
    expect(coefficientUpsert).toHaveBeenCalledTimes(0);
  });

  it('ADR-055 §D3 — un niveau d’une AUTRE école du MÊME tenant est refusé (limite assumée)', async () => {
    const { controller, coefficientUpsert } = makeHarness();

    await expect(
      controller.upsertCoefficients(
        { entries: poisoned(GL_A_OTHER_SCHOOL) },
        jwt(['school_admin']),
        REQ,
      ),
    ).rejects.toThrow(unknownScopeRef('gradeLevelId').message);
    expect(coefficientUpsert).toHaveBeenCalledTimes(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * Le chemin VACUOUS — un id vide ne doit jamais passer « à vide »
 * ══════════════════════════════════════════════════════════════════════════ */

describe('chemin vacuous — un id vide REFUSE, et n’émet AUCUNE sonde sans filtre', () => {
  it('un `gradeLevelId` vide est refusé avec le MÊME message, sans ouvrir de transaction', async () => {
    const { controller, tx, prisma, coefficientUpsert } = makeHarness();
    const entries = fullMatrix();
    entries[2] = { gradeLevelId: '', subjectId: S_A[0] as string, coefficient: 4 };

    await expect(
      controller.upsertCoefficients({ entries }, jwt(['school_admin']), REQ),
    ).rejects.toThrow(unknownScopeRef('gradeLevelId').message);

    // Le point du contrôle : PAS de sonde émise avec un filtre amputé.
    // `findMany({ where: { id: { in: [] } } })` rendrait 0 ligne pour 0 id
    // attendu, `0 === 0` passerait, et la vérification ne prouverait rien.
    expect(tx.gradeLevel.findMany).toHaveBeenCalledTimes(0);
    expect(tx.subject.findMany).toHaveBeenCalledTimes(0);
    expect(prisma.$transaction).toHaveBeenCalledTimes(0);
    expect(coefficientUpsert).toHaveBeenCalledTimes(0);
  });

  it('le planificateur pur LÈVE sur un id nul plutôt que de raccourcir l’ensemble', () => {
    expect(() =>
      distinctScopeIdPlan([{ gradeLevelId: null, subjectId: S_A[0] }], [
        'gradeLevelId',
        'subjectId',
      ] as const),
    ).toThrow(unknownScopeRef('gradeLevelId').message);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC-7 — le contrôle de FAUX POSITIF : une sauvegarde ordinaire passe encore
 * ══════════════════════════════════════════════════════════════════════════ */

describe('AC-7 — un couple déjà existant et PROPRE est toujours mis à jour', () => {
  it('la ligne existante de l’appelant est mise à jour, pas refusée', async () => {
    const { controller, db, coefficientUpsert } = makeHarness();

    const result = await controller.upsertCoefficients(
      { entries: [{ gradeLevelId: GL_A[0] as string, subjectId: S_A[0] as string, coefficient: 7 }] },
      jwt(['school_admin']),
      REQ,
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(coefficientUpsert).toHaveBeenCalledTimes(1);
    const row = db.subjectCoefficient.find(
      (r) => sameId(r.gradeLevelId, GL_A[0]) && sameId(r.subjectId, S_A[0]),
    );
    expect(row?.coefficient).toBe(7);
    expect(row?.tenantId).toBe(TENANT_A);
  });

  it('un uuid en MAJUSCULES appartenant bien à l’appelant est accepté (PM-2)', async () => {
    const { controller, seen, coefficientUpsert } = makeHarness();

    const result = await controller.upsertCoefficients(
      {
        entries: [
          {
            gradeLevelId: (GL_A[0] as string).toUpperCase(),
            subjectId: (S_A[0] as string).toUpperCase(),
            coefficient: 5,
          },
        ],
      },
      jwt(['school_admin']),
      REQ,
    );

    expect(result).toEqual({ ok: true, count: 1 });
    expect(coefficientUpsert).toHaveBeenCalledTimes(1);
    expect(seen.filter((s) => s.verb === 'findMany')).toHaveLength(2);
  });

  it('le MÊME uuid écrit dans deux casses ne compte que pour un id distinct', async () => {
    const { controller, seen, coefficientUpsert } = makeHarness();

    await controller.upsertCoefficients(
      {
        entries: [
          { gradeLevelId: GL_A[0] as string, subjectId: S_A[0] as string, coefficient: 5 },
          {
            gradeLevelId: (GL_A[0] as string).toUpperCase(),
            subjectId: S_A[1] as string,
            coefficient: 6,
          },
        ],
      },
      jwt(['school_admin']),
      REQ,
    );

    // Un ensemble « distinct » sensible à la casse en aurait compté DEUX là où
    // la base ne rend qu'une ligne : `owned.length !== ids.length` aurait refusé
    // une sauvegarde parfaitement légitime.
    const probes = seen.filter((s) => s.verb === 'findMany');
    expect((probes[0]?.where as { id: { in: string[] } }).id.in).toHaveLength(1);
    expect(coefficientUpsert).toHaveBeenCalledTimes(2);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * ALLER-RETOUR — la matrice que le GET REND est acceptée VERBATIM par le PUT
 *
 * Ce bloc est la condition de fusion posée par le panneau d'escalade, et il
 * couvre le défaut que ce correctif INTRODUIT plutôt que celui qu'il ferme.
 *
 * Tous les autres cas de ce fichier acceptent des ids venus de constantes que
 * le fichier a lui-même déclarées (`GL_A`, `S_A`). Ils prouvent donc que le PUT
 * accepte les ids que le TEST a inventés — jamais ceux que la surface SŒUR
 * émet. C'est une deuxième liste tenue à la main, et c'est la classe de défaut
 * que ce dépôt ré-atteint le plus souvent.
 *
 * L'asymétrie est réelle et mesurée : le GET filtre ses axes par `schoolId`
 * SEUL (`subjects.controller.ts`), tandis que la sonde du PUT exige
 * `{ id: { in }, tenantId, schoolId }`. `subject.tenant_id` et
 * `grade_level.tenant_id` sont dénormalisés à côté de `school_id` sans
 * contrainte qui les lie, donc toute ligne où ils divergent est RENDUE par le
 * GET et REFUSÉE par le PUT — et le refus est tout-ou-rien, sur le bouton
 * « Enregistrer » d'une administratrice qui n'a rien fait de mal.
 *
 * ADR-055 §D3 nomme ce risque en prose. Ce cas le MESURE.
 * ══════════════════════════════════════════════════════════════════════════ */

describe('aller-retour GET → PUT — les ids viennent de la surface sœur, pas du test', () => {
  it('la matrice rendue par le GET est acceptée en entier par le PUT', async () => {
    const { controller, coefficientUpsert, forTenant } = makeHarness();

    // 1. Le GET, sur la MÊME fausse base, avec le MÊME jeton.
    const matrix = await controller.coefficientMatrix(jwt(['school_admin']));

    // 2. Les entrées sont DÉRIVÉES des axes rendus — aucune constante locale.
    const entries = matrix.gradeLevels.flatMap((level) =>
      matrix.subjects.map((subject) => ({
        gradeLevelId: level.id,
        subjectId: subject.id,
        coefficient: 2,
      })),
    );
    // Sans cette garde le cas passerait À VIDE si le GET rendait des axes vides.
    expect(entries.length).toBe(GL_A.length * S_A.length);

    // 3. Le PUT accepte le tout, sans exception.
    await expect(
      controller.upsertCoefficients({ entries }, jwt(['school_admin']), REQ),
    ).resolves.toEqual({ ok: true, count: entries.length });
    expect(coefficientUpsert).toHaveBeenCalledTimes(entries.length);

    // 4. Les deux surfaces ont résolu l'école par le MÊME appel, sur le MÊME
    //    argument : un futur passage à `forUser` (qui honore
    //    `preferences.activeSchoolId`) divergerait du GET et rougirait ici.
    expect(forTenant).toHaveBeenCalledTimes(2);
    expect(forTenant).toHaveBeenNthCalledWith(1, TENANT_A);
    expect(forTenant).toHaveBeenNthCalledWith(2, TENANT_A);
  });

  it('le GET ne rend AUCUN axe de la victime, donc l’aller-retour ne peut pas la viser', async () => {
    const { controller } = makeHarness();
    const matrix = await controller.coefficientMatrix(jwt(['school_admin']));

    expect(matrix.gradeLevels.map((level) => level.id)).not.toContain(GL_B);
    expect(matrix.subjects.map((subject) => subject.id)).not.toContain(S_B);
    // Et l'autre école du MÊME tenant est absente elle aussi : le GET filtre par
    // école, exactement comme la sonde du PUT (ADR-055 §D3).
    expect(matrix.gradeLevels.map((level) => level.id)).not.toContain(GL_A_OTHER_SCHOOL);
  });

  it('CONTRÔLE : un axe dont le `tenantId` DÉRIVE de son école est rendu puis REFUSÉ', async () => {
    const { controller, db, coefficientUpsert } = makeHarness();

    // La dérive que rien en base n'empêche : même école, tenant divergent.
    const drifted = db.gradeLevel.find((row) => sameId(row.id, GL_A[0]));
    expect(drifted).toBeDefined();
    (drifted as Row).tenantId = TENANT_B;

    const matrix = await controller.coefficientMatrix(jwt(['school_admin']));
    // Le GET la REND — il ne filtre que par école.
    expect(matrix.gradeLevels.map((level) => level.id)).toContain(GL_A[0]);

    const entries = matrix.gradeLevels.flatMap((level) =>
      matrix.subjects.map((subject) => ({
        gradeLevelId: level.id,
        subjectId: subject.id,
        coefficient: 2,
      })),
    );

    // Le PUT la REFUSE, et refuse le corps ENTIER avec elle.
    const refusal = await refusalOf(
      controller.upsertCoefficients({ entries }, jwt(['school_admin']), REQ),
    );
    expect(refusal.message).toBe(unknownScopeRef('gradeLevelId').message);
    expect(coefficientUpsert).not.toHaveBeenCalled();

    // Ce cas est VERT parce qu'il pin le comportement, pas parce qu'il est
    // souhaitable : c'est `PF-241`, et la seule raison qu'il ne soit pas corrigé
    // ici est qu'un `tenantId` dénormalisé qui ment est une question de SCHÉMA
    // (`PF-239`), pas de prédicat applicatif.
  });
});
