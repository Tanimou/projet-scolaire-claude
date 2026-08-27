import {
  CLASS_ROSTER_SIZE_DEFINITION,
  ROSTER_ALL_STATUSES,
  ROSTER_AWAITING_STATUSES,
  ROSTER_EXIT_STATUSES,
  ROSTER_ON_THE_BOOKS_STATUSES,
  ROSTER_SEATED_STATUSES,
  ROSTER_YEAR_IMPLIED_BY_SECTION,
  classRosterSize,
  countDistinctStudents,
  countDistinctStudentsByKey,
  distinctStudentsWhere,
  readDistinctStudentsAcrossSections,
  rosterCountArg,
  rosterStatusesFor,
  sumRosterSizes,
  type ClassRosterSize,
  type DistinctStudentCount,
  type RosterReader,
  type SummedRosterSizes,
} from '@pilotage/contracts';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { prismaRosterReader } from './prisma-roster-reader';

/**
 * S-E03-7 / PF-36 / ADR-079 — la spec du module canonique.
 *
 * Elle vit ICI et non dans `packages/contracts/src/` parce que ce paquet ne
 * porte AUCUN `*.spec.ts` (mesuré : zéro) — même forme que le frère
 * `apps/api/src/shared/academic-year/resolve-academic-year.spec.ts`.
 *
 * Elle prouve QUATRE choses, et rien d'autre :
 *   1. les listes de populations sont DÉRIVÉES de l'énum du schéma, pas devinées ;
 *   2. la SOMME est inexprimable là où des TÊTES sont attendues (test de TYPE) ;
 *   3. `tenantId` est exigé par le TYPE et vérifié à l'exécution ;
 *   4. la QUESTION 2 dé-duplique TOUJOURS — donc PF-361 lui est sans effet.
 */

const REPO_ROOT = resolve(__dirname, '..', '..', '..', '..', '..');
const SCHEMA = readFileSync(join(REPO_ROOT, 'apps', 'api', 'prisma', 'schema.prisma'), 'utf8');

/** L'énum tel qu'il est ÉCRIT dans le schéma — lu, jamais recopié (FR-4). */
function enumMembersFromSchema(name: string): string[] {
  const start = SCHEMA.indexOf(`enum ${name} {`);
  if (start < 0) throw new Error(`enum ${name} introuvable dans schema.prisma`);
  const end = SCHEMA.indexOf('}', start);
  if (end < 0) throw new Error(`enum ${name} non refermé dans schema.prisma`);
  return SCHEMA.slice(SCHEMA.indexOf('{', start) + 1, end)
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line.length > 0);
}

describe('FR-4 — les populations sont DÉRIVÉES de `enum EnrollmentStatus`', () => {
  it('`ROSTER_ALL_STATUSES` est le miroir EXACT de l’énum, dans l’ordre de déclaration', () => {
    // Un septième membre FAIT ROUGIR ce test au lieu de se ranger en silence.
    expect([...ROSTER_ALL_STATUSES]).toEqual(enumMembersFromSchema('EnrollmentStatus'));
  });

  it('SEATED ∪ AWAITING ∪ {transferred_in} ∪ EXIT === l’énum, byte à byte', () => {
    const partition = [
      ...ROSTER_SEATED_STATUSES,
      ...ROSTER_AWAITING_STATUSES,
      'transferred_in',
      ...ROSTER_EXIT_STATUSES,
    ].sort();
    expect(partition).toEqual([...ROSTER_ALL_STATUSES].sort());
  });

  it('`ON_THE_BOOKS` est DÉRIVÉE (tous \\ sortis), jamais une seconde liste écrite à la main', () => {
    expect([...ROSTER_ON_THE_BOOKS_STATUSES]).toEqual(['pending', 'active', 'transferred_in']);
    for (const exited of ROSTER_EXIT_STATUSES) {
      expect(ROSTER_ON_THE_BOOKS_STATUSES).not.toContain(exited);
    }
  });

  it('les listes POSITIVES ne se recouvrent pas — un statut appartient à UNE famille', () => {
    const seated = new Set<string>(ROSTER_SEATED_STATUSES);
    for (const status of [...ROSTER_AWAITING_STATUSES, ...ROSTER_EXIT_STATUSES]) {
      expect(seated.has(status)).toBe(false);
    }
  });

  it('`rosterStatusesFor` couvre les quatre populations et rend les mêmes listes', () => {
    expect(rosterStatusesFor('seated')).toEqual([...ROSTER_SEATED_STATUSES]);
    expect(rosterStatusesFor('onTheBooks')).toEqual([...ROSTER_ON_THE_BOOKS_STATUSES]);
    expect(rosterStatusesFor('awaiting')).toEqual([...ROSTER_AWAITING_STATUSES]);
    expect(rosterStatusesFor('everRegistered')).toEqual([...ROSTER_ALL_STATUSES]);
  });
});

describe('QUESTION 1 — l’effectif d’UNE section', () => {
  it('`rosterCountArg` porte la population NOMMÉE, jamais un `status:` écrit à la main', () => {
    expect(
      rosterCountArg({ population: 'seated', yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION }),
    ).toEqual({ where: { status: { in: ['active'] } } });
  });

  it('la portée d’année EXPLICITE est émise ; l’IMPLICITE n’ajoute AUCUNE clause (FR-5)', () => {
    const explicite = rosterCountArg({
      population: 'seated',
      yearScope: { academicYearId: 'y-1' },
    });
    expect(explicite.where.academicYearId).toBe('y-1');

    // ⚠ Le marqueur DÉCLARE l'hypothèse de PF-409 ; il ne FILTRE pas. Ajouter une
    // clause à un site qui n'en avait pas changerait un nombre sans mesure (AC-7).
    const implicite = rosterCountArg({
      population: 'seated',
      yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,
    });
    expect(Object.prototype.hasOwnProperty.call(implicite.where, 'academicYearId')).toBe(false);
  });

  it('`everRegistered` reste NOMMABLE — les sept sites ancrés sur l’ÉLÈVE sont délibérés (AC-3)', () => {
    const arg = rosterCountArg({
      population: 'everRegistered',
      yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,
    });
    expect(arg.where.status.in).toEqual([...ROSTER_ALL_STATUSES]);
  });

  it('un compte non entier ou négatif est REFUSÉ — un « 0 » rendu sans avoir lu est DNC-08', () => {
    expect(() => classRosterSize(-1)).toThrow(/entier >= 0/);
    expect(() => classRosterSize(Number.NaN)).toThrow(/entier >= 0/);
    expect(classRosterSize(0)).toBe(0);
  });
});

describe('AC-2 — la SOMME est INEXPRIMABLE là où des TÊTES sont attendues', () => {
  it('`sumRosterSizes` rend des PLACES, et le type refuse de les faire passer pour des élèves', () => {
    const sizes: ClassRosterSize[] = [classRosterSize(24), classRosterSize(7)];
    const places: SummedRosterSizes = sumRosterSizes(sizes);
    expect(places).toBe(31);

    // LE test de type de l'AC-2. `SummedRosterSizes` n'est PAS assignable à
    // `DistinctStudentCount` : c'est ce qui rend `+=` sur des effectifs
    // impossible à faire passer pour un nombre d'élèves.
    // @ts-expect-error — une somme d'effectifs n'est pas un nombre d'élèves (PF-36).
    const heads: DistinctStudentCount = places;
    // La valeur est bien celle qu'on attend — 31 PLACES pour 30 TÊTES.
    expect(heads).toBe(31);
  });

  it('un effectif brut n’est pas non plus un nombre d’élèves', () => {
    // @ts-expect-error — l'effectif d'UNE section reste une PLACE.
    const heads: DistinctStudentCount = classRosterSize(24);
    expect(heads).toBe(24);
  });
});

describe('QUESTION 2 — les élèves DISTINCTS, corrects par CONSTRUCTION', () => {
  it('dé-duplique TOUJOURS — donc PF-361 (index partiel absent) lui est sans effet', () => {
    // s24 porte DEUX inscriptions actives la même année, dans deux sections.
    // C'est LÉGAL : `@@unique([studentId, classSectionId, academicYearId])`
    // l'autorise explicitement. La somme dirait 31, la vérité dit 30.
    const rows = [
      ...Array.from({ length: 24 }, (_, i) => ({ studentId: `s${i + 1}` })),
      { studentId: 's24' },
      ...Array.from({ length: 6 }, (_, i) => ({ studentId: `s${i + 25}` })),
    ];
    expect(rows).toHaveLength(31);
    expect(countDistinctStudents(rows)).toBe(30);
  });

  it('ventile par clé sans jamais sommer — un élève sur deux sections d’une matière compte UNE fois', () => {
    const rows = [
      { studentId: 's1', classSectionId: 'A' },
      { studentId: 's2', classSectionId: 'A' },
      { studentId: 's2', classSectionId: 'B' },
      { studentId: 's3', classSectionId: 'B' },
    ];
    const subjectsOfSection: Record<string, string[]> = { A: ['phys', 'chim'], B: ['phys'] };
    const bySubject = countDistinctStudentsByKey(
      rows,
      (r) => subjectsOfSection[r.classSectionId] ?? [],
    );
    expect(bySubject.get('phys')).toBe(3); // s1, s2, s3 — s2 compté UNE fois
    expect(bySubject.get('chim')).toBe(2); // s1, s2
  });

  it('FR-7 — `tenantId` est exigé par le TYPE **et** vérifié à l’exécution', () => {
    const where = distinctStudentsWhere({
      tenantId: 't-1',
      classSectionIds: ['A', 'B'],
      population: 'seated',
      yearScope: { academicYearId: 'y-1' },
    });
    expect(where).toEqual({
      tenantId: 't-1',
      status: { in: ['active'] },
      classSectionId: { in: ['A', 'B'] },
      academicYearId: 'y-1',
    });

    expect(() =>
      distinctStudentsWhere({
        tenantId: '',
        classSectionIds: ['A'],
        population: 'seated',
        yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,
      }),
    ).toThrow(/tenantId/);
  });

  it('LIT (une requête sur `studentId`), elle ne somme pas (FR-6)', async () => {
    const calls: unknown[] = [];
    const reader: RosterReader = {
      findMany: async (args) => {
        calls.push(args);
        return [
          { studentId: 's1', classSectionId: 'A' },
          { studentId: 's1', classSectionId: 'B' },
          { studentId: 's2', classSectionId: 'B' },
        ];
      },
    };
    const out = await readDistinctStudentsAcrossSections(reader, {
      tenantId: 't-1',
      classSectionIds: ['A', 'B'],
      population: 'seated',
      yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,
    });
    expect(calls).toHaveLength(1); // UNE requête, jamais une par section (N+1)
    expect(out.distinctStudents).toBe(2);
  });

  it('l’ensemble VIDE de sections ne déclenche AUCUNE requête et rend un zéro LU', () => {
    const reader: RosterReader = {
      findMany: async () => {
        throw new Error('aucune requête ne doit partir pour un ensemble vide');
      },
    };
    return expect(
      readDistinctStudentsAcrossSections(reader, {
        tenantId: 't-1',
        classSectionIds: [],
        population: 'seated',
        yearScope: ROSTER_YEAR_IMPLIED_BY_SECTION,
      }),
    ).resolves.toEqual({ rows: [], distinctStudents: 0 });
  });
});

describe('l’adaptateur Prisma ne prend AUCUNE décision', () => {
  it('passe le `where` du contrat tel quel, sans ajouter ni retirer de clause', async () => {
    const seen: unknown[] = [];
    const fake = {
      enrollment: {
        findMany: async (args: unknown) => {
          seen.push(args);
          return [{ studentId: 's1', classSectionId: 'A' }];
        },
      },
    } as unknown as Parameters<typeof prismaRosterReader>[0];

    const where = distinctStudentsWhere({
      tenantId: 't-1',
      classSectionIds: ['A'],
      population: 'onTheBooks',
      yearScope: { academicYearId: 'y-1' },
    });
    await prismaRosterReader(fake).findMany({
      where,
      select: { studentId: true, classSectionId: true },
    });
    expect(seen).toEqual([{ where, select: { studentId: true, classSectionId: true } }]);
  });
});

describe('DNC-06 — le module ne paraît pas plus fort qu’il n’est', () => {
  it('la définition n’est PAS ratifiée et NOMME ce qu’elle hérite', () => {
    expect(CLASS_ROSTER_SIZE_DEFINITION.confirmed).toBe(false);
    expect(CLASS_ROSTER_SIZE_DEFINITION.id).toBe('roster.size');
    // PF-361 (index partiel absent) et PF-409 (année non liée) sont HÉRITÉS.
    expect(CLASS_ROSTER_SIZE_DEFINITION.inheritedFindings).toEqual(
      expect.arrayContaining(['PF-361', 'PF-409', 'PF-411', 'PF-415']),
    );
  });
});

describe('PF-361 — la preuve de SCHÉMA, citée comme fait de schéma et rien de plus', () => {
  it('`schema.prisma` PROMET un index partiel que le baseline ne crée pas', () => {
    // ⚠ Aucune affirmation LIVE ici : Docker est à l'arrêt et `enrollment` est
    // vide sur 5432. Ce test lit le SCHÉMA et le SQL de migration — des faits de
    // schéma, exactement ce que l'AC-11 autorise à revendiquer.
    expect(SCHEMA).toContain('via a partial unique index in migration SQL');
    expect(SCHEMA).toContain('@@unique([studentId, classSectionId, academicYearId])');

    const baseline = readFileSync(
      join(REPO_ROOT, 'apps', 'api', 'prisma', 'migrations', '0_baseline', 'migration.sql'),
      'utf8',
    );
    const uniqueOnEnrollment = baseline
      .split('\n')
      .filter((l) => /CREATE UNIQUE INDEX/i.test(l) && /"?enrollment"?/i.test(l));
    // Exactement UN, et il est à TROIS colonnes — donc il AUTORISE deux
    // inscriptions actives d'un même élève dans deux sections la même année.
    expect(uniqueOnEnrollment).toHaveLength(1);
    expect(uniqueOnEnrollment[0]).toContain('class_section_id');
    expect(uniqueOnEnrollment[0]).not.toMatch(/WHERE/i);
  });
});
