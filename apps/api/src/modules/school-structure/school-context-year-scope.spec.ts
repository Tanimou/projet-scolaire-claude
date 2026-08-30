import 'reflect-metadata';

import { type ResolvedAcademicYear, resolveActiveAcademicYear } from '@pilotage/contracts';

import type { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * S-E03-16 / `PF-15` / `ADR-090` — la PORTÉE d'année cesse d'être CALCULÉE PUIS
 * JETÉE au point d'étranglement des quatre portails.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * CE QUE CE FICHIER PROUVE, ET CE QU'AUCUN AUTRE NE PROUVAIT
 * -----------------------------------------------------------
 * `resolve-academic-year.spec.ts` prouve que le RÉSOLVEUR décore (`name`,
 * `isStale`, `staleByDays`, `containsReferenceDate`, `viaFallback`,
 * `activeCount`). `school-context-tenant-scope.spec.ts` prouve que
 * `SchoolContextService` lui remet le bon `tenantId`. NI L'UN NI L'AUTRE ne
 * prouvait que la décoration SURVIT au service : avant cette tranche, elle était
 * calculée à chaque requête authentifiée des quatre portails puis abandonnée sur
 * `ay?.id ?? null`.
 *
 * ROUGE-AVANT / VERTE-APRÈS — comment le contrôle a été exécuté
 * -------------------------------------------------------------
 * Restaurer le service pré-correctif :
 *     git checkout origin/main -- \
 *       apps/api/src/modules/school-structure/school-context.service.ts
 * Tous les cas de la section « AC-1 » ci-dessous rougissent (`activeAcademicYear`
 * est `undefined` : le champ n'existe pas). Restaurer le correctif, tout repasse
 * au vert. Le contrôle NÉGATIF ci-dessous ouvre le fichier pour la même raison
 * qu'il ouvre `school-context-tenant-scope.spec.ts` : une fausse base qui ne
 * FILTRE pas rendrait vrai n'importe quoi.
 *
 * `staleByDays` N'EST JAMAIS COMPARÉ À UN LITTÉRAL RECOPIÉ
 * --------------------------------------------------------
 * Leçon du run 105 : un littéral correctement recopié rend une valeur ÉGALE au
 * contrat, donc aucune comparaison de VALEUR ne distingue « la copie a disparu »
 * de « la copie est juste ». La valeur attendue est donc DÉRIVÉE en rappelant
 * `resolveActiveAcademicYear` sur la MÊME fausse base — et, parce que le service
 * injecte `new Date()` (délibérément : y injecter une horloge serait du scope
 * creep et casserait la propriété « révertible en une commande »), elle est
 * dérivée DEUX FOIS, avec les instants encadrant l'appel. L'assertion est
 * l'appartenance à ce couple : déterministe, dérivée, et insensible au seul
 * franchissement de minuit possible.
 */

const TENANT_STALE = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_CURRENT = 'bbbbbbbb-0000-4000-8000-000000000002';
const TENANT_NONE = 'cccccccc-0000-4000-8000-000000000003';

const SCHOOL_STALE = 'aaaaaaaa-1111-4000-8000-000000000001';
/** Même tenant, AUCUNE année : la branche « préférence vide → repli » de `forUser`. */
const SCHOOL_STALE_EMPTY = 'aaaaaaaa-1111-4000-8000-000000000009';
const SCHOOL_CURRENT = 'bbbbbbbb-1111-4000-8000-000000000002';
const SCHOOL_NONE = 'cccccccc-1111-4000-8000-000000000003';

interface SeededSchool {
  id: string;
  tenantId: string;
  createdAt: Date;
  students: number;
}

interface SeededYear {
  id: string;
  tenantId: string;
  schoolId: string;
  name: string;
  startDate: Date;
  endDate: Date;
  status: string;
}

const SCHOOLS: SeededSchool[] = [
  {
    id: SCHOOL_STALE,
    tenantId: TENANT_STALE,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    students: 10,
  },
  {
    id: SCHOOL_STALE_EMPTY,
    tenantId: TENANT_STALE,
    createdAt: new Date('2024-02-01T00:00:00.000Z'),
    students: 0,
  },
  {
    id: SCHOOL_CURRENT,
    tenantId: TENANT_CURRENT,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    students: 5,
  },
  {
    id: SCHOOL_NONE,
    tenantId: TENANT_NONE,
    createdAt: new Date('2024-01-01T00:00:00.000Z'),
    students: 0,
  },
];

/**
 * L'année VÉTUSTE. Ses bornes sont volontairement très antérieures à toute date
 * d'exécution plausible : `isStale` ne doit pas dépendre du jour où la suite
 * tourne. Le chiffre RÉEL de la pile (56 jours, mesuré le 2026-08-30) appartient
 * à la sonde live d'AC-6, pas à un test unitaire.
 */
const STALE_YEAR: SeededYear = {
  id: 'ay-stale',
  tenantId: TENANT_STALE,
  schoolId: SCHOOL_STALE,
  name: '2019-2020',
  startDate: new Date('2019-09-01T00:00:00.000Z'),
  endDate: new Date('2020-07-05T00:00:00.000Z'),
  status: 'active',
};

/** L'année qui CONTIENT toute date d'exécution plausible : `isStale === false`. */
const CURRENT_YEAR: SeededYear = {
  id: 'ay-current',
  tenantId: TENANT_CURRENT,
  schoolId: SCHOOL_CURRENT,
  name: '2000-2999',
  startDate: new Date('2000-09-01T00:00:00.000Z'),
  endDate: new Date('2999-07-05T00:00:00.000Z'),
  status: 'active',
};

const YEARS: SeededYear[] = [STALE_YEAR, CURRENT_YEAR];

type AcademicYearWhere = { tenantId?: string; schoolId?: string; status?: string };

function makePrisma() {
  const academicYearCalls: Array<{ where: AcademicYearWhere; orderBy: unknown }> = [];

  const academicYearFindMany = (args: { where: AcademicYearWhere; orderBy?: unknown }) => {
    academicYearCalls.push({ where: args.where, orderBy: args.orderBy });
    for (const key of Object.keys(args.where)) {
      if (!['tenantId', 'schoolId', 'status'].includes(key)) {
        throw new Error(`fausse base: clé de \`where\` inconnue sur academicYear — ${key}`);
      }
    }
    const matched = YEARS.filter((y) => {
      if (args.where.tenantId !== undefined && y.tenantId !== args.where.tenantId) return false;
      if (args.where.schoolId !== undefined && y.schoolId !== args.where.schoolId) return false;
      if (args.where.status !== undefined && y.status !== args.where.status) return false;
      return true;
    });
    return Promise.resolve(
      [...matched].sort(
        (a, b) =>
          b.startDate.getTime() - a.startDate.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      ),
    );
  };

  const countsFor = (schoolId: string) => ({
    academicYears: YEARS.filter((y) => y.schoolId === schoolId).length,
    students: SCHOOLS.find((s) => s.id === schoolId)?.students ?? 0,
  });

  const prisma = {
    academicYear: { findMany: academicYearFindMany },
    school: {
      findFirst: (args: { where: { id: string; tenantId: string } }) => {
        const s = SCHOOLS.find((x) => x.id === args.where.id && x.tenantId === args.where.tenantId);
        if (!s) return Promise.resolve(null);
        return Promise.resolve({ ...s, _count: countsFor(s.id) });
      },
      findMany: (args: { where: { tenantId: string } }) =>
        Promise.resolve(
          SCHOOLS.filter((s) => s.tenantId === args.where.tenantId).map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
            _count: countsFor(s.id),
          })),
        ),
    },
  };

  return { prisma: prisma as unknown as PrismaService, academicYearCalls, academicYearFindMany };
}

/** Le résolveur CANONIQUE, appelé sur la même fausse base — la source du attendu. */
function resolveDirect(
  findMany: ReturnType<typeof makePrisma>['academicYearFindMany'],
  tenantId: string,
  schoolId: string,
  referenceDate: Date,
): Promise<ResolvedAcademicYear | null> {
  return resolveActiveAcademicYear(
    { findMany: (args) => findMany(args as { where: AcademicYearWhere }) },
    { tenantId, schoolId, referenceDate, onAbsent: 'nullWhenNoActiveYear' },
  );
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * CONTRÔLE NÉGATIF — la fausse base PEUT rendre autre chose
 * ══════════════════════════════════════════════════════════════════════════ */

describe('CONTRÔLE NÉGATIF — la fausse base filtre vraiment', () => {
  it('un autre tenant rend une AUTRE année ; zéro ligne rend une liste VIDE', async () => {
    const { academicYearFindMany } = makePrisma();

    const stale = await academicYearFindMany({
      where: { tenantId: TENANT_STALE, schoolId: SCHOOL_STALE, status: 'active' },
    });
    const current = await academicYearFindMany({
      where: { tenantId: TENANT_CURRENT, schoolId: SCHOOL_CURRENT, status: 'active' },
    });
    const none = await academicYearFindMany({
      where: { tenantId: TENANT_NONE, schoolId: SCHOOL_NONE, status: 'active' },
    });

    expect(stale.map((r) => r.id)).toEqual(['ay-stale']);
    expect(current.map((r) => r.id)).toEqual(['ay-current']);
    expect(none).toEqual([]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC-1 — le point d'étranglement transporte la PORTÉE
 * ══════════════════════════════════════════════════════════════════════════ */

describe('AC-1 — `forTenant` rend la PORTÉE à côté de l’id', () => {
  it('(1) année VÉTUSTE : la portée arrive, décorée, avec son NOM', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);

    expect(ctx.activeAcademicYear).not.toBeNull();
    expect(ctx.activeAcademicYear!.name).toBe(STALE_YEAR.name);
    expect(ctx.activeAcademicYear!.isStale).toBe(true);
    expect(ctx.activeAcademicYear!.containsReferenceDate).toBe(false);
    expect(ctx.activeAcademicYear!.viaFallback).toBe(false);
    expect(ctx.activeAcademicYear!.activeCount).toBe(1);
    expect(ctx.activeAcademicYear!.status).toBe('active');
  });

  it('(2) `staleByDays` est celui du RÉSOLVEUR — dérivé, jamais un littéral recopié', async () => {
    const { prisma, academicYearFindMany } = makePrisma();

    // Les deux instants qui ENCADRENT l'appel. Le service injecte `new Date()`
    // en interne ; l'attendu est donc un couple, pas un point.
    const before = new Date();
    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);
    const after = new Date();

    const lower = await resolveDirect(
      academicYearFindMany,
      TENANT_STALE,
      SCHOOL_STALE,
      before,
    );
    const upper = await resolveDirect(academicYearFindMany, TENANT_STALE, SCHOOL_STALE, after);

    expect(lower).not.toBeNull();
    expect(upper).not.toBeNull();
    // Si cette assertion tombait sur un `0`, ce serait la décoration REVENUE À
    // ZÉRO, pas un arrondi : les bornes ci-dessus sont calculées par le même
    // code que celui dont on vérifie la survie.
    expect(lower!.staleByDays).toBeGreaterThan(0);
    expect([lower!.staleByDays, upper!.staleByDays]).toContain(
      ctx.activeAcademicYear!.staleByDays,
    );
  });

  it('(3) ABSENCE TOTALE : les DEUX champs sont `null`, jamais l’un sans l’autre', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_NONE, SCHOOL_NONE);

    expect(ctx.activeAcademicYearId).toBeNull();
    expect(ctx.activeAcademicYear).toBeNull();
  });

  it('(4) année NON VÉTUSTE : `isStale` faux, `staleByDays` nul, containment VRAI', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_CURRENT, SCHOOL_CURRENT);

    expect(ctx.activeAcademicYear!.isStale).toBe(false);
    expect(ctx.activeAcademicYear!.staleByDays).toBe(0);
    expect(ctx.activeAcademicYear!.containsReferenceDate).toBe(true);
  });

  it('(5) `activeAcademicYearId` est PRÉSERVÉ À L’IDENTIQUE et d’accord avec la portée', async () => {
    const { prisma, academicYearFindMany } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);
    const canonical = await resolveDirect(
      academicYearFindMany,
      TENANT_STALE,
      SCHOOL_STALE,
      new Date(),
    );

    // Le champ que lisent les 45 sites de filtrage : inchangé, et c'est bien
    // celui que le résolveur canonique choisit.
    expect(ctx.activeAcademicYearId).toBe(canonical!.id);
    expect(ctx.activeAcademicYear!.id).toBe(ctx.activeAcademicYearId);
  });

  it('(6) `startDate` / `endDate` sont des CHAÎNES ISO — la forme du FIL, pas des `Date`', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);
    const scope = ctx.activeAcademicYear!;

    expect(typeof scope.startDate).toBe('string');
    expect(typeof scope.endDate).toBe('string');
    // Ce que Nest sérialiserait de toute façon : le type et l'octet coïncident.
    expect(scope.startDate).toBe(STALE_YEAR.startDate.toISOString());
    expect(scope.endDate).toBe(STALE_YEAR.endDate.toISOString());
    // Et surtout : la valeur SURVIT à `JSON.parse(JSON.stringify(...))`, ce que
    // ne ferait pas une `Date` typée `Date` côté consommateur.
    expect(JSON.parse(JSON.stringify(scope))).toEqual(scope);
  });

  it('(7) la portée ne coûte AUCUNE requête de plus : une seule lecture `academicYear`', async () => {
    const { prisma, academicYearCalls } = makePrisma();

    await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);

    // `ay` était déjà en main ; seul `.id` en sortait. Un appelant qui
    // ré-appellerait le résolveur pour obtenir l'objet fabriquerait un N+1.
    expect(academicYearCalls).toHaveLength(1);
  });

  it('(8) `schoolId` ne fuit PAS dans la projection — la portée décrit une ANNÉE', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);

    expect(Object.keys(ctx.activeAcademicYear!).sort()).toEqual([
      'activeCount',
      'containsReferenceDate',
      'endDate',
      'id',
      'isStale',
      'name',
      'staleByDays',
      'startDate',
      'status',
      'viaFallback',
    ]);
  });
});

describe('AC-1 — `forUser`, le chemin réel des quatre portails, sur ses DEUX branches', () => {
  it('(9) branche PRÉFÉRENCE VALIDE : la portée arrive', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forUser({
      id: 'user-1',
      tenantId: TENANT_STALE,
      preferences: { activeSchoolId: SCHOOL_STALE },
    });

    expect(ctx.schoolId).toBe(SCHOOL_STALE);
    expect(ctx.activeAcademicYear).not.toBeNull();
    expect(ctx.activeAcademicYear!.id).toBe(ctx.activeAcademicYearId);
    expect(ctx.activeAcademicYear!.isStale).toBe(true);
  });

  it('(10) branche REPLI (préférence sur une école SANS année) : la portée arrive aussi', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forUser({
      id: 'user-2',
      tenantId: TENANT_STALE,
      // École du bon tenant mais à ZÉRO année : `forUser` l'ignore et retombe
      // sur le choix « le plus de données ». C'est la branche que la tranche
      // précédente n'avait aucun test pour couvrir.
      preferences: { activeSchoolId: SCHOOL_STALE_EMPTY },
    });

    expect(ctx.schoolId).toBe(SCHOOL_STALE);
    expect(ctx.activeAcademicYear).not.toBeNull();
    expect(ctx.activeAcademicYear!.name).toBe(STALE_YEAR.name);
    expect(ctx.activeAcademicYear!.id).toBe(ctx.activeAcademicYearId);
  });

  it('(11) aucune préférence du tout : la portée arrive encore', async () => {
    const { prisma } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forUser({
      id: 'user-3',
      tenantId: TENANT_CURRENT,
      preferences: null,
    });

    expect(ctx.activeAcademicYear!.containsReferenceDate).toBe(true);
    expect(ctx.activeAcademicYear!.id).toBe(ctx.activeAcademicYearId);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC-5 / ADR-090 — la vétusté est RAPPORTÉE, jamais CHOISIE
 * ══════════════════════════════════════════════════════════════════════════ */

describe('la vétusté est RAPPORTÉE, jamais un critère de sélection', () => {
  it('une année vétuste est TOUJOURS rendue — sinon les quatre portails se vident', async () => {
    const { prisma } = makePrisma();

    // Les deux tenants de production ont une année active TERMINÉE (56 et 786
    // jours, mesuré le 2026-08-30) : un service qui écarterait les années
    // vétustes rendrait `null` ici, et TOUT le produit tomberait à vide.
    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_STALE, SCHOOL_STALE);

    expect(ctx.activeAcademicYearId).toBe(STALE_YEAR.id);
    expect(ctx.activeAcademicYear!.isStale).toBe(true);
  });
});
