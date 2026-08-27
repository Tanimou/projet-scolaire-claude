import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';

import { studentScopeWhere } from './student-scope-where';
import { StudentsController } from './students.controller';

/**
 * S-E03-3d / `PF-356` / `PF-12` axe 4 / `ADR-076` — LA LISTE PARENT CESSE DE
 * CONTREDIRE LA FICHE PARENT.
 *
 * TIER A, ET CE QUI N'EST PAS PROUVÉ ICI — À LIRE AVANT DE CITER CE FICHIER.
 * ------------------------------------------------------------------------
 * Toute l'évidence de ce fichier est JEST + FIXTURE. **Aucune sonde live n'a
 * été exécutée pour cette tranche et aucune n'est revendiquée** : Docker Desktop
 * a refusé de démarrer ce run, et la base locale `pilotage@5432` porte 0 école,
 * 0 élève, 0 tutelle — il n'y a littéralement pas de tenant multi-écoles à
 * interroger. Ce fichier prouve donc le MÉCANISME (la forme du `where` que le
 * handler remet à Prisma, et l'accord des deux projections sur une même
 * population), pas le DÉPLOIEMENT. La leçon « une preuve sur base scratch ≠ la
 * cible » vaut ici et est énoncée plutôt que contournée.
 *
 * LES SIX CLAIMS, ET POURQUOI CHACUNE EST UN TEST ET NON UN ARGUMENT
 * -----------------------------------------------------------------
 *  T1 `AC-1` — ACCORD. Sur un tenant à DEUX écoles où l'enfant du parent n'est
 *     PAS dans la plus grosse, `list` et `getOne` rendent la même population.
 *     ROUGE-AVANT : avec le `where` pré-tranche (reconstruit ici, cf. plus bas),
 *     `list` rend `[]` pendant que `getOne` rend l'enfant en entier.
 *  T2 `AC-2` — BORNE 1 : un élève d'un AUTRE tenant reste refusé.
 *  T3 `AC-2` — BORNE 2 : un élève du MÊME tenant NON gardé reste refusé.
 *     T2 et T3 sont assertées SÉPARÉMENT : c'est la classe `PF-11` (on retire
 *     une clé d'un `where`), qui exige des négatifs explicites, pas un
 *     raisonnement.
 *  T4 `AC-2b` / `ADR-065 §D5` — le jeu VIDE reste le REFUS : `id: { in: [] }`,
 *     jamais une clé absente, et ce sur la FORME du `where` (un fixture qui rend
 *     zéro ligne satisferait un simple compte).
 *  T5 `AC-3` — l'ADMIN est INCHANGÉ : `where.schoolId === SCHOOL_BIG`, et ce cas
 *     est VERT AVANT comme APRÈS (il est exécuté ci-dessous contre la
 *     construction pré-tranche ET contre le module d'aujourd'hui).
 *  T6 `AC-10` / G-PORTAL — enseignant et élève-lui-même partagent
 *     `scopeForUser` et prennent donc la même branche bornée.
 *
 * POURQUOI LE ROUGE-AVANT EST UNE FIXTURE ET NON `git show origin/main:`
 * ---------------------------------------------------------------------
 * Ce dépôt a déjà tranché la question et l'a écrite : `walk-read-gate.spec.ts`
 * enregistre qu'un contrôle bâti sur `git show HEAD:` S'INVERSE à l'instant où
 * la tranche est committée, et que la CI checkout en profondeur 1. L'idiome
 * maison est donc la CONSTRUCTION PRÉ-TRANCHE reconstruite DANS la spec
 * (`audit-provenance-gate` / `open-redirect-gate`). `preSliceWhere` ci-dessous
 * EST cette construction, copiée telle qu'elle était mesurée le 2026-08-26 —
 * elle rougit contre l'accord attendu, ce qui rend le vert d'après non vacant.
 */

/* ================================================================== *
 * LA CONSTRUCTION PRÉ-TRANCHE — le comparateur du ROUGE-AVANT
 * ================================================================== */

/**
 * `students.controller.ts` tel qu'il était AVANT cette tranche. Reproduit ici
 * MOT POUR MOT dans sa forme (`tenantId`, `schoolId` NU, puis le pli du
 * sentinel) : c'est le seul comparateur honnête disponible sans lire `main`.
 */
function preSliceWhere(input: {
  tenantId: string;
  schoolId: string;
  studentIds: readonly string[] | null;
}): Record<string, unknown> {
  return {
    tenantId: input.tenantId,
    schoolId: input.schoolId,
    ...(input.studentIds === null ? {} : { id: { in: [...input.studentIds] } }),
  };
}

/* ================================================================== *
 * LE PRÉDICAT SEUL — la forme du `where`, sans base
 * ================================================================== */

const TENANT = 't-1';
const OTHER_TENANT = 't-2';
const SCHOOL_BIG = 'school-big';
const SCHOOL_SMALL = 'school-small';

describe('studentScopeWhere — `schoolId` et `id: { in: … }` ne CO-OCCURRENT jamais (ADR-076)', () => {
  it('T5 / AC-3 — sentinel `null` (admins) : l’école de travail est PRÉSERVÉE, aucune clé `id`', () => {
    const where = studentScopeWhere({
      tenantId: TENANT,
      schoolId: SCHOOL_BIG,
      studentIds: null,
    });

    expect(where).toEqual({ tenantId: TENANT, schoolId: SCHOOL_BIG });
    expect(where).not.toHaveProperty('id');
  });

  it('T5 / AC-3 — le cas ADMIN est VERT AVANT ET APRÈS : la construction pré-tranche rend le MÊME objet', () => {
    // Sans cette assertion, « l'admin est inchangé » resterait une intention.
    // Ici c'est une ÉGALITÉ entre l'ancienne construction et la nouvelle, sur la
    // seule branche que la tranche promet de ne pas toucher.
    const args = { tenantId: TENANT, schoolId: SCHOOL_BIG, studentIds: null } as const;
    expect(studentScopeWhere(args)).toEqual(preSliceWhere(args));
  });

  it('jeu d’ids EXPLICITE : `tenantId` RESTE, `schoolId` PART, `id: { in: … }` porte l’autorité', () => {
    const where = studentScopeWhere({
      tenantId: TENANT,
      schoolId: SCHOOL_BIG,
      studentIds: ['s-1', 's-2'],
    });

    expect(where).toEqual({ tenantId: TENANT, id: { in: ['s-1', 's-2'] } });
    // G-TENANT : la clé de tenant n'est PAS celle qui a été retirée.
    expect(where.tenantId).toBe(TENANT);
    expect(where).not.toHaveProperty('schoolId');
  });

  it('T4 / AC-2b / ADR-065 §D5 — le jeu VIDE est le REFUS : `id: { in: [] }`, jamais une clé absente', () => {
    const where = studentScopeWhere({
      tenantId: TENANT,
      schoolId: SCHOOL_BIG,
      studentIds: [],
    });

    // La FORME, pas un compte de lignes : un fixture vide satisferait un compte.
    expect(where).toEqual({ tenantId: TENANT, id: { in: [] } });
    expect(where.id).toEqual({ in: [] });
  });

  it('LE ROUGE-AVANT DU PRÉDICAT — la construction pré-tranche FAIT co-occurrer les deux clés', () => {
    // Si cette assertion devenait verte, `preSliceWhere` aurait cessé d'être le
    // défaut et le comparateur serait devenu décoratif.
    const before = preSliceWhere({
      tenantId: TENANT,
      schoolId: SCHOOL_BIG,
      studentIds: ['s-1'],
    });
    expect(before).toHaveProperty('schoolId');
    expect(before).toHaveProperty('id');

    const after = studentScopeWhere({
      tenantId: TENANT,
      schoolId: SCHOOL_BIG,
      studentIds: ['s-1'],
    });
    expect(Object.keys(after).sort()).toEqual(['id', 'tenantId']);
  });

  it('le jeu d’ids est COPIÉ, pas aliasé — une mutation de l’appelant ne peut pas élargir un `where` déjà bâti', () => {
    const ids = ['s-1'];
    const where = studentScopeWhere({ tenantId: TENANT, schoolId: SCHOOL_BIG, studentIds: ids });
    ids.push('s-intrus');
    expect(where.id).toEqual({ in: ['s-1'] });
  });
});

/* ================================================================== *
 * LE TENANT MULTI-ÉCOLES — un fixture, deux projections
 * ================================================================== */

type Row = {
  id: string;
  tenantId: string;
  schoolId: string;
  firstName: string;
  lastName: string;
  status: string;
};

/**
 * LE FIXTURE, ET SA PROPRIÉTÉ PORTEUSE : l'enfant du parent est dans
 * `SCHOOL_SMALL`, PAS dans `SCHOOL_BIG` — or `SchoolContextService.forUser`
 * rend `SCHOOL_BIG` (« l'école qui porte le plus de données »). C'est
 * exactement la configuration où les deux projections divergeaient.
 */
const ROWS: Row[] = [
  {
    id: 'child-of-parent',
    tenantId: TENANT,
    schoolId: SCHOOL_SMALL,
    firstName: 'Awa',
    lastName: 'Diallo',
    status: 'active',
  },
  {
    id: 'not-guarded-same-tenant',
    tenantId: TENANT,
    schoolId: SCHOOL_BIG,
    firstName: 'Boris',
    lastName: 'Kone',
    status: 'active',
  },
  {
    id: 'foreign-tenant-child',
    tenantId: OTHER_TENANT,
    schoolId: SCHOOL_SMALL,
    firstName: 'Chloe',
    lastName: 'Traore',
    status: 'active',
  },
];

/**
 * L'ÉVALUATEUR DE `where` — DÉLIBÉRÉMENT INTOLÉRANT. Toute clé qu'il ne modélise
 * pas fait ÉCHOUER le cas au lieu d'être ignorée en silence : un évaluateur
 * permissif rendrait « aucun filtre » indiscernable de « filtre satisfait », et
 * c'est précisément la confusion que cette tranche ferme.
 */
function matches(row: Row, where: Record<string, unknown>): boolean {
  for (const [key, value] of Object.entries(where)) {
    switch (key) {
      case 'tenantId':
        if (row.tenantId !== value) return false;
        break;
      case 'schoolId':
        if (row.schoolId !== value) return false;
        break;
      case 'status':
        if (row.status !== value) return false;
        break;
      case 'id': {
        const ids = (value as { in?: readonly string[] }).in;
        if (!Array.isArray(ids)) throw new Error(`clé \`id\` non modélisée : ${JSON.stringify(value)}`);
        if (!ids.includes(row.id)) return false;
        break;
      }
      case 'AND': {
        // INTERSECTION des filtres appelant (`ADR-065 §D5`). Chaque entrée doit
        // matcher — c'est ce qui fait qu'un filtre appelant ne peut ni élargir
        // ni écraser la portée.
        const clauses = value as Array<Record<string, unknown>>;
        for (const clause of clauses) if (!matches(row, clause)) return false;
        break;
      }
      case 'enrollments': {
        // Le fixture ne porte AUCUNE inscription : `none` est satisfait, `some`
        // ne l'est jamais. Modélisé explicitement plutôt qu'ignoré.
        const rel = value as { some?: unknown; none?: unknown };
        if ('some' in rel) return false;
        if ('none' in rel) break;
        throw new Error(`relation \`enrollments\` non modélisée : ${JSON.stringify(value)}`);
      }
      default:
        throw new Error(`clé de \`where\` non modélisée par ce fixture : ${key}`);
    }
  }
  return true;
}

/** La forme de ligne que `list` attend de son `include` — vide, mais présente. */
const decorate = (row: Row) => ({
  ...row,
  enrollments: [],
  guardianships: [],
  _count: { guardianships: 0, enrollments: 0 },
});

function buildController(scopeStudentIds: string[] | null) {
  const academicYearFindMany = jest.fn().mockResolvedValue([]);
  const findMany = jest.fn(async (args: { where: Record<string, unknown> }) =>
    ROWS.filter((r) => matches(r, args.where)).map(decorate),
  );
  const count = jest.fn(async (args: { where: Record<string, unknown> }) =>
    ROWS.filter((r) => matches(r, args.where)).length,
  );
  const findUnique = jest.fn(async (args: { where: { id: string } }) => {
    // LA FICHE N'A AUCUN FILTRE D'ÉCOLE — c'est la moitié « non contradictoire »
    // de la contradiction, et elle est reproduite telle quelle : `getOne` lit par
    // id, refuse hors tenant, puis gate sur `canAccessStudent`.
    const row = ROWS.find((r) => r.id === args.where.id);
    return row === undefined ? null : decorate(row);
  });

  const canAccessStudent = jest.fn(
    async (_me: unknown, _jwt: unknown, studentId: string) =>
      scopeStudentIds === null || scopeStudentIds.includes(studentId),
  );

  const controller = new StudentsController(
    {
      student: { findMany, count, findUnique },
      academicYear: { findMany: academicYearFindMany },
    } as never,
    { ensureUser: jest.fn().mockResolvedValue({ id: 'u-1', tenantId: TENANT }) } as never,
    {
      // `forUser` rend LA PLUS GROSSE ÉCOLE — c'est le comportement réel de
      // `SchoolContextService.resolveDefaultSchoolId`, pas une caricature.
      forUser: jest
        .fn()
        .mockResolvedValue({ schoolId: SCHOOL_BIG, activeAcademicYearId: 'year-1' }),
    } as never,
    {
      scopeForUser: jest
        .fn()
        .mockResolvedValue({ studentIds: scopeStudentIds, reason: 'test' }),
      canAccessStudent,
    } as never,
  );

  const jwt = { sub: 'kc' } as unknown as KeycloakJwtPayload;
  const whereOf = (): Record<string, unknown> => findMany.mock.calls[0]![0].where;

  /** La liste PRÉ-TRANCHE, jouée sur le MÊME fixture — le comparateur ROUGE-AVANT. */
  const listBefore = () =>
    ROWS.filter((r) =>
      matches(
        r,
        preSliceWhere({ tenantId: TENANT, schoolId: SCHOOL_BIG, studentIds: scopeStudentIds }),
      ),
    ).map((r) => r.id);

  return { controller, jwt, findMany, count, findUnique, whereOf, listBefore, academicYearFindMany };
}

describe('AC-1 — dans un tenant MULTI-ÉCOLES, la LISTE et la FICHE s’accordent sur la population', () => {
  const PARENT_SCOPE = ['child-of-parent'];

  it('ROUGE-AVANT : la construction pré-tranche rend `[]` à la liste pendant que la fiche rend l’enfant', async () => {
    const { controller, jwt, listBefore } = buildController(PARENT_SCOPE);

    // La liste, AVANT : l'enfant est dans SCHOOL_SMALL, `forUser` rend
    // SCHOOL_BIG, l'intersection est VIDE.
    expect(listBefore()).toEqual([]);

    // La fiche, AVANT comme APRÈS (elle n'a jamais eu de filtre d'école) :
    // l'enfant est rendu en entier.
    const detail = (await controller.getOne('child-of-parent', jwt)) as { id: string };
    expect(detail.id).toBe('child-of-parent');

    // LA CONTRADICTION, mise à plat : deux réponses, un même tenant, un même
    // parent, une même seconde.
    expect(listBefore()).not.toContain(detail.id);
  });

  it('VERT-APRÈS : la liste rend l’enfant que la fiche rend — MÊME population', async () => {
    const { controller, jwt } = buildController(PARENT_SCOPE);

    const list = (await controller.list(jwt)) as { data: Array<{ id: string }>; total: number };
    const detail = (await controller.getOne('child-of-parent', jwt)) as { id: string };

    expect(list.data.map((s) => s.id)).toEqual(['child-of-parent']);
    expect(list.data.map((s) => s.id)).toContain(detail.id);
    expect(list.total).toBe(1);
  });

  it('AC-8 — le `count` reçoit le MÊME objet `where` que le `findMany`', async () => {
    const { controller, jwt, whereOf, count } = buildController(PARENT_SCOPE);

    await controller.list(jwt);

    // Un total calculé sur un AUTRE prédicat divulgue la taille d'une école et
    // rouvre la contradiction À L'INTÉRIEUR d'une seule réponse.
    expect(count).toHaveBeenCalledWith({ where: whereOf() });
  });

  it('T2 / AC-2 — BORNE 1 : un élève d’un AUTRE tenant reste refusé (G-TENANT)', async () => {
    // La portée ABAC est élargie de force à l'élève étranger : SEUL `tenantId`
    // peut encore le refuser. C'est la borne que le retrait de `schoolId` ne
    // doit pas avoir emportée.
    const { controller, jwt, whereOf } = buildController([
      'child-of-parent',
      'foreign-tenant-child',
    ]);

    const list = (await controller.list(jwt)) as { data: Array<{ id: string }> };

    expect(whereOf().tenantId).toBe(TENANT);
    expect(list.data.map((s) => s.id)).toEqual(['child-of-parent']);
    expect(list.data.map((s) => s.id)).not.toContain('foreign-tenant-child');
  });

  it('T3 / AC-2 — BORNE 2 : un élève du MÊME tenant NON gardé reste refusé (le jeu d’ids borne)', async () => {
    const { controller, jwt, whereOf } = buildController(PARENT_SCOPE);

    const list = (await controller.list(jwt)) as { data: Array<{ id: string }> };

    expect(whereOf().id).toEqual({ in: ['child-of-parent'] });
    expect(list.data.map((s) => s.id)).not.toContain('not-guarded-same-tenant');
  });

  it('T4 — un parent dont la tutelle est RÉVOQUÉE (portée `[]`) ne lit RIEN, école ou pas', async () => {
    const { controller, jwt, whereOf } = buildController([]);

    const list = (await controller.list(jwt)) as { data: unknown[]; total: number };

    // DNC-11 : l'élargissement n'admet que des ids DÉJÀ dans `scope.studentIds`,
    // lequel dérive de `guardianshipLiveWhere()` — un lien révoqué ou refusé ne
    // peut pas entrer par cette porte.
    expect(whereOf()).toHaveProperty('id');
    expect(whereOf().id).toEqual({ in: [] });
    expect(list.data).toEqual([]);
    expect(list.total).toBe(0);
  });

  it('T5 / AC-3 — l’ADMIN garde son école de travail : `where.schoolId === SCHOOL_BIG`, positivement', async () => {
    const { controller, jwt, whereOf } = buildController(null);

    const list = (await controller.list(jwt)) as { data: Array<{ id: string }> };

    expect(whereOf().schoolId).toBe(SCHOOL_BIG);
    expect(whereOf()).not.toHaveProperty('id');
    // Et le résultat est celui de l'école de travail : l'enfant de SCHOOL_SMALL
    // n'y est PAS, ce qui est le comportement admin d'avant la tranche.
    expect(list.data.map((s) => s.id)).toEqual(['not-guarded-same-tenant']);
  });

  it('T6 / G-PORTAL — enseignant et élève-lui-même partagent `scopeForUser` : même branche, même borne', async () => {
    // Un enseignant affecté dans DEUX écoles voit désormais tous ses élèves,
    // et non plus « ses élèves ∩ la plus grosse école ». C'est un changement de
    // comportement RÉEL, voulu, et énoncé dans `ADR-076 §D9`.
    const teacher = buildController(['child-of-parent', 'not-guarded-same-tenant']);
    const teacherList = (await teacher.controller.list(teacher.jwt)) as {
      data: Array<{ id: string }>;
    };
    expect(teacher.whereOf()).not.toHaveProperty('schoolId');
    expect(teacherList.data.map((s) => s.id).sort()).toEqual([
      'child-of-parent',
      'not-guarded-same-tenant',
    ]);

    // Élève-lui-même : la portée est EXACTEMENT `[ownStudentId]` — le mur le
    // plus strict de la plateforme (ADR-021) — et il reste strict.
    const self = buildController(['child-of-parent']);
    const selfList = (await self.controller.list(self.jwt)) as { data: Array<{ id: string }> };
    expect(self.whereOf().tenantId).toBe(TENANT);
    expect(selfList.data.map((s) => s.id)).toEqual(['child-of-parent']);
  });

  it('AC-9 — les filtres APPELANT restent une INTERSECTION que la portée ne peut pas perdre', async () => {
    const { controller, jwt, whereOf } = buildController(['child-of-parent']);

    // `?unenrolled=true` — le seul filtre appelant qui lit
    // `activeAcademicYearId`, lui-même resté keyé sur `forUser` (résidu
    // ENREGISTRÉ `PF-390`, non corrigé ici).
    await controller.list(jwt, undefined, undefined, undefined, undefined, 'true');

    expect(whereOf().id).toEqual({ in: ['child-of-parent'] });
    expect(whereOf().AND).toEqual([
      { enrollments: { none: { academicYearId: 'year-1', status: 'active' } } },
    ]);
  });

  it('AC-9 / borne N+1 — l’année canonique est résolue ≤ 1 fois PAR ÉCOLE DISTINCTE, jamais par ligne', async () => {
    // La liste s'étend maintenant sur K écoles. La borne qui remplace la
    // prémisse tombée (« en pratique une seule école ») est celle-ci, et elle
    // est ASSERTÉE plutôt que promise.
    const { controller, jwt, academicYearFindMany } = buildController([
      'child-of-parent',
      'not-guarded-same-tenant',
    ]);

    const list = (await controller.list(jwt)) as { data: Array<{ id: string }> };
    const distinctSchools = new Set(
      ROWS.filter((r) => list.data.some((d) => d.id === r.id)).map((r) => r.schoolId),
    );

    // La page S'ÉTEND bien sur deux écoles — sans cela l'assertion suivante
    // serait vacante, puisque la liste pré-tranche n'en portait jamais qu'une.
    expect(distinctSchools.size).toBe(2);

    // LA CLAIM : une résolution par ÉCOLE DISTINCTE, jamais par ligne. Elle est
    // assertée sur l'ENSEMBLE des écoles demandées, pas seulement sur un compte
    // d'appels — un compte égal obtenu en résolvant deux fois la même école
    // passerait un simple `toBeLessThanOrEqual`.
    const schoolsAsked = new Set(
      academicYearFindMany.mock.calls.map(
        (call) => (call[0] as { where: { schoolId?: string } }).where.schoolId,
      ),
    );
    expect(schoolsAsked).toEqual(distinctSchools);
    expect(academicYearFindMany.mock.calls.length).toBe(distinctSchools.size);
  });
});

/* ================================================================== *
 * DNC-10 — la règle ne peut pas être désarmée, et la prémisse tombée est
 * CORRIGÉE dans le même diff
 * ================================================================== */

describe('S-E03-3d — DNC-10 et l’hygiène de la source', () => {
  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const SCOPE_SRC = readFileSync(join(__dirname, 'student-scope-where.ts'), 'utf8');
  const SCOPE = stripComments(SCOPE_SRC);
  const CTRL_SRC = readFileSync(join(__dirname, 'students.controller.ts'), 'utf8');
  const CTRL = stripComments(CTRL_SRC);

  it('le prédicat discrimine sur `=== null`, JAMAIS sur la truthiness ni sur `.length`', () => {
    expect(SCOPE).toMatch(/studentIds === null/);
    expect(SCOPE).not.toMatch(/studentIds\?\.length/);
    expect(SCOPE).not.toMatch(/studentIds\.length/);
    expect(SCOPE).not.toMatch(/studentIds \? \{/);
  });

  it('aucun drapeau d’environnement ne peut désarmer la règle', () => {
    for (const src of [SCOPE, CTRL]) {
      expect(src).not.toMatch(/process\.env/);
      expect(src).not.toMatch(/SKIP_|ALLOW_|BYPASS|ALLOWLIST/);
    }
  });

  it('le handler de liste ne COMPOSE plus la portée : il la DÉRIVE, en un seul site', () => {
    expect(CTRL).toMatch(/\.\.\.studentScopeWhere\(\{/);
    // La co-occurrence pré-tranche a disparu du handler. Le motif est ANCRÉ sur
    // la DÉCLARATION du `where` : un motif nu `tenantId: me.tenantId, schoolId,`
    // matcherait l'ARGUMENT passé à `studentScopeWhere(…)`, qui est une entrée
    // de dérivation et non une clause — un faux positif qu'on aurait « réparé »
    // en affaiblissant le test.
    expect(CTRL).not.toMatch(
      /const where: Prisma\.StudentWhereInput = \{\s*tenantId: me\.tenantId,\s*schoolId,/,
    );
    expect(CTRL).not.toMatch(/scope\.studentIds === null \? \{\} :/);
    // UN seul site de dérivation dans le contrôleur.
    expect(CTRL.split('studentScopeWhere(').length - 1).toBe(1);
  });

  it('le `where` du handler reste typé `Prisma.StudentWhereInput` (PF-301 ne se rouvre pas)', () => {
    expect(CTRL).toMatch(/const where: Prisma\.StudentWhereInput/);
  });

  it('la PRÉMISSE TOMBÉE est corrigée dans le MÊME diff, pas laissée à mentir', () => {
    // `canonicalYearBySchool` était documenté « en pratique la liste est déjà
    // scopée à une école, donc c'est UNE requête ». Cette phrase devient FAUSSE
    // à l'instant où `ADR-076` retire la clé : la laisser serait un DNC-06
    // fabriqué par le correctif d'un DNC-06.
    expect(CTRL_SRC).not.toContain('liste est déjà scopée à une école, donc');
    expect(CTRL_SRC).toContain('PF-397');
  });

  it('`scopeForUser` garde sa signature — le paramètre mort n’est PAS « rangé » ici (ADR-066 §D6)', () => {
    // Le retirer toucherait ~25 sites d'appel de `canAccessStudent` pour ZÉRO
    // changement de comportement, dans une tranche qui retire une clé de
    // `where`. Enregistré (`PF-394`), hors périmètre.
    const ACCESS = readFileSync(join(__dirname, 'student-access.service.ts'), 'utf8');
    expect(ACCESS).toMatch(/_schoolId: string,/);
  });
});
