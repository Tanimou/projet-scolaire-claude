import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import {
  listActiveAcademicYears,
  resolveActiveAcademicYear,
  type AcademicYearFindManyArgs,
  type AcademicYearReader,
  type AcademicYearRecord,
} from '@pilotage/contracts';

/**
 * S-E03-4 / PF-15 / ADR-070 — la preuve du résolveur canonique.
 *
 * POURQUOI LE FAKE **ÉVALUE** AU LIEU DE RENDRE UN TABLEAU FIGÉ
 * -------------------------------------------------------------
 * Un faux lecteur qui rend une liste constante prouve seulement que la clé de
 * tri a été ÉCRITE, jamais qu'elle SÉLECTIONNE la bonne ligne : la même suite
 * serait verte avec `orderBy` inversé, ou absent. Le lecteur ci-dessous
 * APPLIQUE le `where` et le `orderBy` qu'on lui passe à un jeu de lignes semé —
 * c'est-à-dire qu'il joue le rôle de Postgres — et il ENREGISTRE chaque
 * argument reçu.
 *
 * Deux conséquences voulues :
 *   • la portée tenant se prouve sur l'ARGUMENT REMIS À PRISMA (précédent T8 de
 *     `S-E06-6`), pas sur un résultat — la RLS n'est PAS acceptée comme preuve
 *     ici, et ne le pourrait pas : tout ce chemin tourne sur la connexion
 *     PROPRIÉTAIRE, où elle est contournée ;
 *   • le nombre d'APPELS est asserté, pas seulement les valeurs — une
 *     canonicalisation qui transforme 1 requête en N est une régression que des
 *     assertions de valeur laisseraient passer.
 *
 * CE QUE CETTE SUITE NE PROUVE PAS
 * --------------------------------
 * Que Postgres honore réellement `ORDER BY start_date DESC, id DESC`. C'est
 * porté par la sonde SQL exécutée contre la pile vivante, pas par un fake.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const RESOLVER_MODULE = join(
  REPO_ROOT,
  'packages',
  'contracts',
  'src',
  'academic-year',
  'resolve-academic-year.ts',
);
const CONTRACTS_PACKAGE_JSON = join(REPO_ROOT, 'packages', 'contracts', 'package.json');

const TENANT_A = 'tenant-a';
const TENANT_B = 'tenant-b';
const SCHOOL_A = 'school-a';
const SCHOOL_B = 'school-b';

/** 2026-08-25 — la date mesurée sur la pile au moment de la tranche. */
const TODAY = new Date('2026-08-25T00:00:00.000Z');

type SeededYear = AcademicYearRecord & { tenantId: string };

function year(overrides: Partial<SeededYear> & { id: string }): SeededYear {
  return {
    tenantId: TENANT_A,
    schoolId: SCHOOL_A,
    name: '2025-2026',
    startDate: new Date('2025-09-01T00:00:00.000Z'),
    endDate: new Date('2026-07-05T00:00:00.000Z'),
    status: 'active',
    ...overrides,
  };
}

type Harness = {
  reader: AcademicYearReader;
  calls: AcademicYearFindManyArgs[];
};

/**
 * Le faux lecteur — il FILTRE et TRIE réellement d'après les arguments reçus.
 *
 * Le tri lit la même structure `orderBy` que celle envoyée à Prisma : si le
 * résolveur oubliait le départage sur `id`, deux lignes de même `startDate`
 * resteraient dans l'ordre de semis et le test de déterminisme le verrait.
 */
function makeReader(rows: SeededYear[]): Harness {
  const calls: AcademicYearFindManyArgs[] = [];

  const compare = (a: SeededYear, b: SeededYear, orderBy: AcademicYearFindManyArgs['orderBy']) => {
    for (const key of orderBy) {
      if ('startDate' in key && key.startDate !== undefined) {
        const delta = b.startDate.getTime() - a.startDate.getTime();
        if (delta !== 0) return delta;
      }
      if ('id' in key && key.id !== undefined) {
        if (a.id !== b.id) return a.id < b.id ? 1 : -1;
      }
    }
    return 0;
  };

  return {
    calls,
    reader: {
      findMany: (args) => {
        calls.push(args);
        const matched = rows.filter((row) => {
          if (row.tenantId !== args.where.tenantId) return false;
          if (args.where.schoolId !== undefined && row.schoolId !== args.where.schoolId) return false;
          if (args.where.status !== undefined && row.status !== args.where.status) return false;
          return true;
        });
        return Promise.resolve([...matched].sort((a, b) => compare(a, b, args.orderBy)));
      },
    },
  };
}

/* ================================================================== *
 * AC-1 — le module reste framework-free et sans horloge
 * ================================================================== */

describe('AC-1 — le module canonique n’importe ni Prisma ni Nest, et ne lit aucune horloge', () => {
  // Chemin NOMMÉ, lu sans tolérance : s'il disparaît, cette suite doit mourir
  // au chargement plutôt que dégénérer en « rien à vérifier » (DNC-08).
  const SOURCE = readFileSync(RESOLVER_MODULE, 'utf8');

  /**
   * La sanction « aucune horloge » porte sur le CODE, pas sur la prose.
   *
   * Le premier jet scannait `SOURCE` brut, et la seule occurrence de
   * `new Date(` dans le module est la ligne du cartouche qui PROMET qu'il n'y
   * en a aucune. La sanction se déclenchait donc sur la propre note d'honnêteté
   * du module : rouge sur un fichier conforme, et rouge de manière insidieuse,
   * puisque la seule façon de la verdir aurait été d'effacer la documentation
   * qui la justifie. Les commentaires sont retirés avant d'assermenter.
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('n’importe pas `@prisma/client` — `apps/web` consomme aussi ce paquet', () => {
    expect(SOURCE).not.toMatch(/from\s+'@prisma\/client'/);
  });

  it('n’importe aucun symbole `@nestjs/*` — c’est une fonction pure, pas un provider', () => {
    expect(SOURCE).not.toMatch(/from\s+'@nestjs\//);
  });

  it('ne contient ni `new Date(` ni `Date.now(` — la date de référence est INJECTÉE', () => {
    expect(CODE).not.toContain('new Date(');
    expect(CODE).not.toContain('Date.now(');
    // Anti-vacuité : le décommentage doit laisser du CODE, sinon la sanction
    // ci-dessus passerait sur une chaîne vide.
    expect(CODE).toContain('export async function resolveActiveAcademicYear');
  });

  it('n’ajoute AUCUNE dépendance à `packages/contracts/package.json`', () => {
    const pkg = JSON.parse(readFileSync(CONTRACTS_PACKAGE_JSON, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(Object.keys(pkg.dependencies).sort()).toEqual(['zod']);
  });

  it('nomme, dans le code, la raison pour laquelle `startDate desc` seul n’est pas un ordre total', () => {
    // Le commentaire est une exigence de la story (AC-3) : sans lui, le prochain
    // auteur « simplifie » le départage sur `id` et rouvre PF-04.
    expect(SOURCE).toMatch(/N'EST PAS un ordre total/);
  });
});

/* ================================================================== *
 * AC-2 / AC-C9 — `tenantId` est dans CHAQUE `where`
 * ================================================================== */

describe('AC-2 — `tenantId` figure dans CHAQUE `where` construit, repli inclus', () => {
  it('résolution nominale : le `where` remis au lecteur porte le tenant', async () => {
    const h = makeReader([year({ id: 'ay-1' })]);
    await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(h.calls).toHaveLength(1);
    expect(h.calls[0]!.where).toEqual({
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      status: 'active',
    });
  });

  it('la requête de REPLI porte le tenant elle aussi — c’est la moitié qu’on oublie', async () => {
    const h = makeReader([year({ id: 'ay-old', status: 'closed' })]);
    await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) expect(call.where.tenantId).toBe(TENANT_A);
    // Le repli ne filtre plus sur le statut, mais garde tenant + école.
    expect(h.calls[1]!.where).toEqual({ tenantId: TENANT_A, schoolId: SCHOOL_A });
  });

  it('`listActiveAcademicYears` porte le tenant', async () => {
    const h = makeReader([year({ id: 'ay-1' })]);
    await listActiveAcademicYears(h.reader, { tenantId: TENANT_A, referenceDate: TODAY });
    expect(h.calls[0]!.where).toEqual({ tenantId: TENANT_A, status: 'active' });
  });

  it('un `tenantId` vide est REFUSÉ plutôt que d’émettre une lecture non scopée', async () => {
    const h = makeReader([year({ id: 'ay-1' })]);
    await expect(
      resolveActiveAcademicYear(h.reader, {
        tenantId: '',
        referenceDate: TODAY,
        onAbsent: 'nullWhenNoActiveYear',
      }),
    ).rejects.toThrow(/tenantId/);
    expect(h.calls).toHaveLength(0);
  });
});

/* ================================================================== *
 * AC-8 (ii) — la régression de `school-context.service.ts:32`
 * ================================================================== */

describe('AC-8 — l’année d’un AUTRE tenant n’est jamais rendue, même par son `schoolId`', () => {
  it('résoudre pour le tenant A en passant le `schoolId` du tenant B rend `null`', async () => {
    // Le défaut d'origine — `where: { schoolId, status: 'active' }`, sans
    // `tenantId` — aurait rendu ici l'année du tenant B. La condition est
    // CONSTRUITE délibérément : elle ne se produit pas naturellement sur les
    // données mesurées, et c'est justement pourquoi elle a survécu si longtemps.
    const h = makeReader([year({ id: 'ay-b', tenantId: TENANT_B, schoolId: SCHOOL_B })]);

    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      schoolId: SCHOOL_B,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });

    expect(resolved).toBeNull();
    expect(h.calls[0]!.where.tenantId).toBe(TENANT_A);
  });

  it('le repli non plus ne franchit pas la frontière de tenant', async () => {
    const h = makeReader([
      year({ id: 'ay-b', tenantId: TENANT_B, schoolId: SCHOOL_B, status: 'closed' }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      schoolId: SCHOOL_B,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(resolved).toBeNull();
  });
});

/* ================================================================== *
 * AC-3 / AC-8 (i) — DÉTERMINISME
 * ================================================================== */

describe('AC-3 — l’ordre est TOTAL, sur toutes les branches', () => {
  it('deux années actives de `startDate` DIFFÉRENTE : la plus récente gagne, deux fois de suite', async () => {
    const h = makeReader([
      year({ id: 'ay-old', startDate: new Date('2024-09-01T00:00:00.000Z') }),
      year({ id: 'ay-new', startDate: new Date('2025-09-01T00:00:00.000Z') }),
    ]);
    const opts = {
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear' as const,
    };
    const first = await resolveActiveAcademicYear(h.reader, opts);
    const second = await resolveActiveAcademicYear(h.reader, opts);
    expect(first?.id).toBe('ay-new');
    expect(second?.id).toBe(first?.id);
  });

  it('deux années actives de MÊME `startDate` : le départage sur `id` tranche — le cas que `startDate desc` seul laisse ouvert', async () => {
    // C'est LE cas qui rend `orderBy: { startDate: 'desc' }` non déterministe :
    // `@@unique([schoolId, name])` n'interdit pas deux années de même date de
    // début, et Postgres est alors libre de rendre l'une OU l'autre.
    const sameStart = new Date('2025-09-01T00:00:00.000Z');
    const h = makeReader([
      year({ id: 'ay-aaa', startDate: sameStart }),
      year({ id: 'ay-zzz', startDate: sameStart }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      schoolId: SCHOOL_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    // `id desc` ⇒ 'ay-zzz'. Sans le second critère, le fake rendrait 'ay-aaa'
    // (ordre de semis) et cette assertion serait rouge.
    expect(resolved?.id).toBe('ay-zzz');
    expect(resolved?.activeCount).toBe(2);
  });

  it('l’ordre total est envoyé à CHAQUE requête, repli compris', async () => {
    const h = makeReader([year({ id: 'ay-old', status: 'closed' })]);
    await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(h.calls).toHaveLength(2);
    for (const call of h.calls) {
      expect(call.orderBy).toEqual([{ startDate: 'desc' }, { id: 'desc' }]);
    }
  });

  it('le repli est déterministe LUI AUSSI — deux années closes de même `startDate`', async () => {
    const sameStart = new Date('2023-09-01T00:00:00.000Z');
    const h = makeReader([
      year({ id: 'ay-aaa', status: 'closed', startDate: sameStart }),
      year({ id: 'ay-zzz', status: 'closed', startDate: sameStart }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(resolved?.id).toBe('ay-zzz');
    expect(resolved?.viaFallback).toBe(true);
  });
});

/* ================================================================== *
 * AC-4 — les DEUX politiques d'absence
 * ================================================================== */

describe('AC-4 — l’absence est une décision de l’appelant, et il y a DEUX politiques', () => {
  it('`nullWhenNoActiveYear` rend `null` et n’émet AUCUNE seconde requête', async () => {
    const h = makeReader([year({ id: 'ay-closed', status: 'closed' })]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved).toBeNull();
    expect(h.calls).toHaveLength(1);
  });

  it('`mostRecentOfAnyStatus` replie sur la plus récente, tous statuts confondus', async () => {
    const h = makeReader([
      year({ id: 'ay-2022', status: 'closed', startDate: new Date('2022-09-01T00:00:00.000Z') }),
      year({ id: 'ay-2023', status: 'archived', startDate: new Date('2023-09-01T00:00:00.000Z') }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(resolved?.id).toBe('ay-2023');
    expect(resolved?.viaFallback).toBe(true);
    // Aucune année ACTIVE n'a été vue : le compteur le dit honnêtement.
    expect(resolved?.activeCount).toBe(0);
  });

  it('`mostRecentOfAnyStatus` rend `null` quand le tenant n’a AUCUNE année', async () => {
    const h = makeReader([]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(resolved).toBeNull();
    expect(h.calls).toHaveLength(2);
  });
});

/* ================================================================== *
 * AC-6 / AC-8 (iii) — la VÉTUSTÉ (PF-15)
 * ================================================================== */

describe('AC-6 — la vétusté est calculée et remontée, jamais masquée', () => {
  it('l’année 2023-2024 finie le 2024-07-05 est VÉTUSTE au 2026-08-25 — la ligne réelle du tenant B', async () => {
    const h = makeReader([
      year({
        id: 'ay-2023',
        name: '2023–2024',
        startDate: new Date('2023-09-01T00:00:00.000Z'),
        endDate: new Date('2024-07-05T00:00:00.000Z'),
      }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved?.isStale).toBe(true);
    // 2024-07-05 → 2026-08-25 : 781 jours pleins.
    expect(resolved?.staleByDays).toBe(781);
    expect(resolved?.containsReferenceDate).toBe(false);
  });

  it('`endDate === referenceDate` n’est PAS vétuste — la borne est inclusive', async () => {
    const h = makeReader([year({ id: 'ay-edge', endDate: TODAY })]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved?.isStale).toBe(false);
    expect(resolved?.staleByDays).toBe(0);
    expect(resolved?.containsReferenceDate).toBe(true);
  });

  it('`startDate === referenceDate` est CONTENU — même inclusivité que `calendar-seed.service.ts:86`', async () => {
    // La `endDate` par DEFAUT du gabarit est 2026-07-05, ANTERIEURE a TODAY :
    // n-overrider que `startDate` fabriquait une annee qui se TERMINE avant de
    // COMMENCER, pour laquelle `containsReferenceDate: false` est la BONNE
    // reponse. Le rouge etait dans le gabarit, pas dans le resolveur.
    const h = makeReader([
      year({ id: 'ay-edge', startDate: TODAY, endDate: new Date('2027-07-05T00:00:00.000Z') }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved?.containsReferenceDate).toBe(true);
  });

  it('une année à venir n’est ni vétuste ni contenante', async () => {
    const h = makeReader([
      year({
        id: 'ay-future',
        startDate: new Date('2026-09-01T00:00:00.000Z'),
        endDate: new Date('2027-07-05T00:00:00.000Z'),
      }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved?.isStale).toBe(false);
    expect(resolved?.containsReferenceDate).toBe(false);
  });
});

/* ================================================================== *
 * AC-C8 — le NOMBRE d'appels, pas seulement les valeurs
 * ================================================================== */

describe('AC-C8 — la canonicalisation ne convertit pas 1 requête en N', () => {
  it('une résolution = UNE requête quand une année active existe', async () => {
    const h = makeReader([year({ id: 'ay-1' })]);
    await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(h.calls).toHaveLength(1);
  });

  it('le chemin de repli plafonne à DEUX requêtes, jamais plus', async () => {
    const h = makeReader([year({ id: 'ay-closed', status: 'closed' })]);
    await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'mostRecentOfAnyStatus',
    });
    expect(h.calls.length).toBeLessThanOrEqual(2);
  });

  it('`listActiveAcademicYears` rend N années en UNE requête — le site `subjects.controller.ts:381`', async () => {
    const h = makeReader([
      year({ id: 'ay-a', startDate: new Date('2025-09-01T00:00:00.000Z') }),
      year({ id: 'ay-b', schoolId: SCHOOL_B, startDate: new Date('2024-09-01T00:00:00.000Z') }),
      year({ id: 'ay-closed', status: 'closed' }),
    ]);
    const years = await listActiveAcademicYears(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
    });
    expect(h.calls).toHaveLength(1);
    expect(years.map((y) => y.id)).toEqual(['ay-a', 'ay-b']);
    // La multiplicité est RAPPORTÉE : rien ne garantit une seule année active.
    expect(years.every((y) => y.activeCount === 2)).toBe(true);
  });
});

/* ================================================================== *
 * AC-8 (FR8) — la containment n'est JAMAIS un critère de sélection
 * ================================================================== */

describe('FR8 — `containsReferenceDate` est rapporté, jamais sélectionné', () => {
  it('l’année contenant la date de référence NE PASSE PAS devant l’ordre total', async () => {
    // Sur les données mesurées, l'année active des DEUX tenants est terminée.
    // Sélectionner sur `containsReferenceDate` viderait les quatre portails :
    // le résolveur le SIGNALE et rend quand même l'année que l'ordre désigne.
    const h = makeReader([
      year({
        id: 'ay-contains',
        startDate: new Date('2024-09-01T00:00:00.000Z'),
        endDate: new Date('2027-07-05T00:00:00.000Z'),
      }),
      year({
        id: 'ay-recent-but-stale',
        startDate: new Date('2025-09-01T00:00:00.000Z'),
        endDate: new Date('2026-07-05T00:00:00.000Z'),
      }),
    ]);
    const resolved = await resolveActiveAcademicYear(h.reader, {
      tenantId: TENANT_A,
      referenceDate: TODAY,
      onAbsent: 'nullWhenNoActiveYear',
    });
    expect(resolved?.id).toBe('ay-recent-but-stale');
    expect(resolved?.isStale).toBe(true);
    expect(resolved?.containsReferenceDate).toBe(false);
  });
});
