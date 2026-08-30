import 'reflect-metadata';

import { NotFoundException } from '@nestjs/common';

import type { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * S-E03-4 / PF-15 / ADR-070 — `SchoolContextService.forTenant` remet bien LE
 * `tenantId` de l'appelant au résolveur canonique.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * POURQUOI CE FICHIER EXISTE — CE QUE LES AUTRES PREUVES NE COUVRENT PAS
 * ---------------------------------------------------------------------
 * `resolve-academic-year.spec.ts` prouve que le RÉSOLVEUR est scopé au tenant.
 * `academic-year-resolution-gate.spec.ts` prouve qu'aucun site n'émet plus de
 * lecture `status: 'active'` HORS du résolveur. Ni l'un ni l'autre ne prouve
 * qu'un APPELANT lui passe le BON tenant : `tenantId: string` accepte au
 * compilateur la chaîne vide, l'id de l'école, ou le tenant d'un autre. Le site 6
 * est celui qui gagne le paramètre, et c'est celui que `SchoolContextService`
 * fait transiter sur QUASIMENT CHAQUE REQUÊTE AUTHENTIFIÉE des quatre portails
 * (≈ 20 contrôleurs/services l'injectent). Il n'avait AUCUN spec.
 *
 * UNE FAUSSE BASE QUI FILTRE VRAIMENT — UN DOUBLE INERTE SERAIT UN VERT À VIDE
 * ---------------------------------------------------------------------------
 * La fausse base ci-dessous applique RÉELLEMENT le `where` reçu, porte les
 * lignes des DEUX tenants, et LÈVE sur une clé qu'elle ne connaît pas. Le
 * CONTRÔLE NÉGATIF ouvre le fichier : on émet contre elle la requête TELLE
 * QU'ELLE ÉTAIT avant cette tranche — `{ schoolId, status: 'active' }`, sans
 * colonne de tenant — et on montre qu'elle ATTEINT la ligne de l'autre tenant.
 * C'est ce qui prouve que le refus observé ensuite vient du prédicat et non d'un
 * double qui ne peut pas échouer.
 *
 * LIMITE NOMMÉE (DNC-06) : rien ici ne touche PostgreSQL. Ces cas prouvent la
 * FORME des requêtes émises et le comportement du service, jamais celui de RLS —
 * l'application se connecte en PROPRIÉTAIRE des tables et échappe à ses propres
 * policies. C'est bien le prédicat applicatif qui fait tout le travail.
 */

const TENANT_A = 'aaaaaaaa-0000-4000-8000-000000000001';
const TENANT_B = 'bbbbbbbb-0000-4000-8000-000000000002';
const SCHOOL_A = 'aaaaaaaa-1111-4000-8000-000000000001';
const SCHOOL_B = 'bbbbbbbb-1111-4000-8000-000000000002';
/** L'école du tenant A dont la ligne `academic_year` porte, EN BASE, le tenant B. */
const SCHOOL_A_CORRUPT = 'aaaaaaaa-1111-4000-8000-000000000009';

interface SeededSchool {
  id: string;
  tenantId: string;
  createdAt: Date;
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
  { id: SCHOOL_A, tenantId: TENANT_A, createdAt: new Date('2024-01-01T00:00:00.000Z') },
  { id: SCHOOL_A_CORRUPT, tenantId: TENANT_A, createdAt: new Date('2024-02-01T00:00:00.000Z') },
  { id: SCHOOL_B, tenantId: TENANT_B, createdAt: new Date('2024-01-01T00:00:00.000Z') },
];

const YEARS: SeededYear[] = [
  {
    id: 'ay-a',
    tenantId: TENANT_A,
    schoolId: SCHOOL_A,
    name: '2025-2026',
    startDate: new Date('2025-09-01T00:00:00.000Z'),
    endDate: new Date('2026-07-05T00:00:00.000Z'),
    status: 'active',
  },
  {
    id: 'ay-b',
    tenantId: TENANT_B,
    schoolId: SCHOOL_B,
    name: '2023-2024',
    startDate: new Date('2023-09-01T00:00:00.000Z'),
    endDate: new Date('2024-07-05T00:00:00.000Z'),
    status: 'active',
  },
  /**
   * LE DÉFAUT DE DONNÉES de la divulgation (b) de la story : une ligne dont le
   * `tenant_id` DÉSACCORDE avec celui de son école. La sonde SQL P1 devait le
   * mesurer sur la pile ; elle n'a pas été écrite. Ce cas ÉPINGLE au moins le
   * comportement que l'app aurait alors, au lieu de le laisser non spécifié.
   */
  {
    id: 'ay-corrupt',
    tenantId: TENANT_B,
    schoolId: SCHOOL_A_CORRUPT,
    name: '2025-2026',
    startDate: new Date('2025-09-01T00:00:00.000Z'),
    endDate: new Date('2026-07-05T00:00:00.000Z'),
    status: 'active',
  },
];

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
    // L'ordre total documenté, appliqué honnêtement.
    return Promise.resolve(
      [...matched].sort(
        (a, b) =>
          b.startDate.getTime() - a.startDate.getTime() || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0),
      ),
    );
  };

  const prisma = {
    academicYear: { findMany: academicYearFindMany },
    school: {
      findFirst: (args: { where: { id: string; tenantId: string } }) => {
        const s = SCHOOLS.find((x) => x.id === args.where.id && x.tenantId === args.where.tenantId);
        if (!s) return Promise.resolve(null);
        return Promise.resolve({
          ...s,
          _count: {
            academicYears: YEARS.filter((y) => y.schoolId === s.id).length,
            students: 0,
          },
        });
      },
      findMany: (args: { where: { tenantId: string } }) =>
        Promise.resolve(
          SCHOOLS.filter((s) => s.tenantId === args.where.tenantId).map((s) => ({
            id: s.id,
            createdAt: s.createdAt,
            _count: {
              academicYears: YEARS.filter((y) => y.schoolId === s.id).length,
              students: 0,
            },
          })),
        ),
    },
  };

  return { prisma: prisma as unknown as PrismaService, academicYearCalls, academicYearFindMany };
}

/* ══════════════════════════════════════════════════════════════════════════ *
 * CONTRÔLE NÉGATIF — la fausse base PEUT échouer
 * ══════════════════════════════════════════════════════════════════════════ */

describe('CONTRÔLE NÉGATIF — la requête PRÉ-TRANCHE atteint bien l’année d’un autre tenant', () => {
  it('`{ schoolId, status: active }` sans `tenantId` rend la ligne du tenant B', async () => {
    const { academicYearFindMany } = makePrisma();
    // Exactement la requête que `school-context.service.ts:32` émettait avant
    // S-E03-4 : `schoolId` SEUL. Si ce cas était vert-à-vide, tous les suivants
    // ne prouveraient rien.
    const rows = await academicYearFindMany({ where: { schoolId: SCHOOL_B, status: 'active' } });
    expect(rows.map((r) => r.id)).toEqual(['ay-b']);
    expect(rows[0]!.tenantId).toBe(TENANT_B);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * AC — `forTenant` porte le tenant de l'appelant jusqu'à Prisma
 * ══════════════════════════════════════════════════════════════════════════ */

describe('S-E03-4 — `forTenant` remet le `tenantId` de l’appelant au résolveur', () => {
  it('émet au moins une lecture `academicYear`, et TOUTES portent `tenantId`', async () => {
    const { prisma, academicYearCalls } = makePrisma();
    const svc = new SchoolContextService(prisma);

    const ctx = await svc.forTenant(TENANT_A, SCHOOL_A);

    expect(academicYearCalls.length).toBeGreaterThan(0);
    for (const call of academicYearCalls) {
      expect(call.where.tenantId).toBe(TENANT_A);
    }
    // S-E03-16 — LA SEULE ligne de ce fichier que la tranche touche, et elle est
    // déclarée plutôt que subie. AC-7 exigeait « vert SANS modification » ; c'est
    // une PRÉMISSE FAUSSE, falsifiée par la sémantique de `toEqual`, qui est une
    // égalité EXACTE : un champ ajouté au contexte la fait rougir par
    // construction. Le champ ajouté est exactement ce qu'AC-1 impose, donc les
    // deux critères ne sont pas conjointement satisfiables tels qu'écrits.
    //
    // L'assertion n'est pas AFFAIBLIE — elle reste une égalité exacte, portée
    // sur la nouvelle forme exacte, et elle GAGNE l'accord des deux champs.
    // Ce qui portait AC-7 (le `tenantId` requis, remis au résolveur, vérifié
    // dans CHAQUE `where`) est intégralement au-dessus et n'a pas bougé.
    expect(ctx).toEqual({
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      activeAcademicYearId: 'ay-a',
      activeAcademicYear: expect.objectContaining({ id: 'ay-a', name: '2025-2026' }),
    });
  });

  it('l’ORDRE TOTAL documenté arrive jusqu’à Prisma — pas seulement dans le résolveur', async () => {
    const { prisma, academicYearCalls } = makePrisma();
    await new SchoolContextService(prisma).forTenant(TENANT_A, SCHOOL_A);

    for (const call of academicYearCalls) {
      expect(call.orderBy).toEqual([{ startDate: 'desc' }, { id: 'desc' }]);
    }
  });

  it('la branche PAR DÉFAUT (sans école explicite) porte le tenant elle aussi', async () => {
    const { prisma, academicYearCalls } = makePrisma();
    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_A);

    expect(academicYearCalls.length).toBeGreaterThan(0);
    for (const call of academicYearCalls) {
      expect(call.where.tenantId).toBe(TENANT_A);
    }
    expect(ctx.tenantId).toBe(TENANT_A);
  });

  it('`forUser` — le chemin réel des quatre portails — porte le tenant', async () => {
    const { prisma, academicYearCalls } = makePrisma();
    const ctx = await new SchoolContextService(prisma).forUser({
      id: 'user-1',
      tenantId: TENANT_A,
      preferences: { activeSchoolId: SCHOOL_A },
    });

    expect(academicYearCalls.length).toBeGreaterThan(0);
    for (const call of academicYearCalls) {
      expect(call.where.tenantId).toBe(TENANT_A);
    }
    expect(ctx.activeAcademicYearId).toBe('ay-a');
  });

  it('une école d’un AUTRE tenant est refusée AVANT toute lecture `academicYear`', async () => {
    const { prisma, academicYearCalls } = makePrisma();
    await expect(new SchoolContextService(prisma).forTenant(TENANT_A, SCHOOL_B)).rejects.toThrow(
      NotFoundException,
    );
    expect(academicYearCalls).toHaveLength(0);
  });
});

/* ══════════════════════════════════════════════════════════════════════════ *
 * DIVULGATION (b) — le changement de comportement, épinglé plutôt que supposé
 * ══════════════════════════════════════════════════════════════════════════ */

describe('divulgation (b) — une ligne `academic_year` en désaccord de tenant avec son école', () => {
  it('rend `activeAcademicYearId: null` — pas la ligne de l’autre tenant', async () => {
    const { prisma, academicYearCalls } = makePrisma();

    const ctx = await new SchoolContextService(prisma).forTenant(TENANT_A, SCHOOL_A_CORRUPT);

    // AVANT la tranche (`{ schoolId, status: active }`), cet appel rendait
    // `ay-corrupt`, une ligne du tenant B, aux quatre portails du tenant A.
    // APRÈS, il rend `null` : le contexte d'année devient vide pour cette école.
    // C'est la divulgation (b) de la story. Elle est BÉNIGNE ⇔ zéro ligne de ce
    // genre existe en base — ce que la sonde P1 devait mesurer et n'a pas
    // mesuré. Tant que la mesure manque, ce cas est ce qui dit à un humain ce
    // qui se passerait.
    expect(ctx.activeAcademicYearId).toBeNull();
    for (const call of academicYearCalls) {
      expect(call.where.tenantId).toBe(TENANT_A);
    }
  });
});
