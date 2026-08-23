import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  type ArgumentMetadata,
  BadRequestException,
  ForbiddenException,
  ParseEnumPipe,
  ParseUUIDPipe,
} from '@nestjs/common';
import { EnrollmentStatus } from '@prisma/client';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StudentAccessService } from '../students/student-access.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';
import { teacherSectionsWhere } from '../teaching/teaching-wall.where';

import {
  EnrollmentsController,
  buildEnrollmentListWhere,
  classifyEnrollmentListCaller,
  type EnrollmentListScope,
} from './enrollments.controller';

/**
 * S-E05-15 / PF-283 / PF-51 (b) / ADR-065 — `GET /api/v1/enrollments` gagne
 * l'ABAC, la projection et la validation de paramètre que
 * `GET /enrollments/roster/:classSectionId` avait déjà.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI N'A PAS ÉTÉ EXÉCUTÉ — ÉCRIT PLUTÔT QU'AFFIRMÉ (`DNC-06`)          │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Cet agent n'exécute NI jest, NI `pnpm typecheck`, NI aucun build (budget CPU :
 * seul le test-architect lance la chaîne). Les preuves de ce fichier n'ont donc
 * JAMAIS ÉTÉ EXÉCUTÉES par leur auteur, et AUCUNE requête HTTP n'a été émise :
 * aucun `where` écrit dans cette tranche n'a atteint le moteur PostgreSQL.
 *
 * CE QUI A RÉELLEMENT TOURNÉ ce run, et qui est donc citable comme mesure :
 *  • le RECENSEMENT des appelants :
 *    `grep -rn "v1/enrollments" apps/web/src apps/web/e2e apps/worker/src` → TROIS
 *    occurrences, toutes dans `apps/web/src/app/admin/students/actions.ts`
 *    (`:55` POST, `:74` POST `/transfer`, `:92` PATCH). ZÉRO consommateur GET
 *    sur les quatre portails ;
 *  • la lecture du catalogue de permissions : `enrollments.read` est en
 *    `permissions.constants.ts:168` (school_admin), `:225` (teacher), `:259`
 *    (parent), et ABSENT du bloc `student:` (`:291-299`, sept permissions) ;
 *  • la lecture des DEUX pipes du build épinglé `@nestjs/common@10.4.22` dans
 *    `node_modules` : `parse-uuid.pipe.js` ET `parse-enum.pipe.js` ouvrent leur
 *    `transform` sur `if (isNil(value) && this.options?.optional) return value`.
 *    C'est ce qui autorise `{ optional: true }` sur les deux ;
 *  • la lecture de `schema.prisma` (`model ClassSection`, `model GradeLevel`,
 *    `model TeachingAssignment`, `enum EnrollmentStatus`).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE FICHIER ASSERTE LA REQUÊTE, PAS LE CORPS                              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Le double Prisma ENREGISTRE le `where` / `select` / `include` reçu. Une
 * assertion sur le CORPS de la réponse (« `internalNotes` est absent du JSON »)
 * serait verte quoi que le contrôleur demande — elle prouverait le harnais. La
 * seule preuve honnête d'une projection est la FORME DE LA REQUÊTE, et la liste
 * NÉGATIVE est assertée CLÉ PAR CLÉ (`not.toHaveProperty`), jamais par égalité
 * de forme : une égalité passerait aussi si le `select` était `{}`.
 *
 * Symétriquement, TOUTE assertion négative d'ABAC vise le `where` ARGUMENT, pas
 * la réponse : un fail-open sur une table vide rend `rows === 0` et passerait un
 * test formulé sur le nombre de lignes tout en fuyant en production.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX PRISMA EST DÉLIBÉRÉMENT NON FILTRANT PAR TENANT                  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Il n'applique AUCUN filtre tenant ambiant : il honore EXACTEMENT le `where`
 * qu'on lui passe (égalités scalaires, `{ in: [...] }` et membres `AND`). C'est
 * la simulation du chemin `degraded_no_app_url` — la connexion du PROPRIÉTAIRE,
 * qui échappe à ses propres policies RLS (`ADR-032 §D5`), c'est-à-dire TOUS les
 * déploiements d'aujourd'hui. Un faux qui filtrerait par tenant de lui-même
 * rendrait ces tests verts sans que le code ait la moindre clause `tenantId`.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ME = '33333333-3333-3333-3333-333333333333';

const MY_TP = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_TP = 'aaaaaaaa-0000-0000-0000-00000000000b';

/** Section du tenant, ENSEIGNÉE par l'appelant (sur DEUX matières — preuve de déduplication). */
const CS_MINE = 'eeeeeeee-0000-0000-0000-000000000001';
/** Section du tenant, enseignée par QUELQU'UN D'AUTRE. */
const CS_OTHERS = 'eeeeeeee-0000-0000-0000-000000000002';
/** Section d'un AUTRE tenant. */
const CS_FOREIGN = 'eeeeeeee-0000-0000-0000-000000000003';

/** L'enfant du parent appelant. */
const STUDENT_MINE = 'dddddddd-0000-0000-0000-000000000001';
/** Un PAIR — l'enfant de quelqu'un d'autre. C'est la donnée que `PF-283` exposait. */
const STUDENT_PEER = 'dddddddd-0000-0000-0000-000000000002';

const AY_ACTIVE = 'ffffffff-0000-0000-0000-000000000001';

/** Un uuid bien formé qui n'existe dans aucune table. */
const UUID_ABSENT = 'cccccccc-0000-0000-0000-0000000000ff';

/** La clé de métadonnées de Nest pour les paramètres de route (`ROUTE_ARGS_METADATA`), en LITTÉRAL — même convention que `enrollments-roster-abac.spec.ts:92`. */
const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

const TEACHER = ['teacher'];
const PARENT = ['parent'];
const STUDENT = ['student'];
const SCHOOL_ADMIN = ['school_admin'];
const SUPER_ADMIN = ['super_admin'];

/**
 * `AC-6` — les ONZE colonnes `ClassSection` et les QUATRE colonnes `GradeLevel`
 * que `include: { classSection: { include: { gradeLevel: true } } }` faisait
 * partir sur le fil. Énumérées depuis `schema.prisma`, pas devinées.
 */
const FORBIDDEN_CLASS_SECTION_COLUMNS = [
  'tenantId',
  'academicYearId',
  'gradeLevelId',
  'maxStudents',
  'room',
  'color',
  'icon',
  'options',
  'internalNotes',
  'status',
  'createdAt',
  'updatedAt',
] as const;

const FORBIDDEN_GRADE_LEVEL_COLUMNS = ['tenantId', 'schoolId', 'cycleId', 'createdAt'] as const;

type Row = Record<string, unknown>;

const jwt = (roles: string[]): KeycloakJwtPayload =>
  ({ sub: ME, realm_access: { roles } }) as unknown as KeycloakJwtPayload;

/** Un jeton SANS `realm_access` : doit produire un 403, jamais un 500. */
const jwtWithoutRealmAccess = { sub: ME } as unknown as KeycloakJwtPayload;

// ---------------------------------------------------------------------------
// Le double Prisma
// ---------------------------------------------------------------------------

interface Statement {
  model: string;
  verb: string;
  where?: Row;
  select?: Row;
  include?: Row;
  orderBy?: unknown;
}

const enrollmentRow = (args: {
  id: string;
  tenantId: string;
  studentId: string;
  classSectionId: string;
}): Row => ({
  ...args,
  academicYearId: AY_ACTIVE,
  status: 'active',
  enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
  endReason: null,
});

function makeDb() {
  const tables: Record<string, Row[]> = {
    enrollment: [
      enrollmentRow({
        id: 'enr-mine',
        tenantId: TENANT,
        studentId: STUDENT_MINE,
        classSectionId: CS_MINE,
      }),
      enrollmentRow({
        id: 'enr-peer',
        tenantId: TENANT,
        studentId: STUDENT_PEER,
        classSectionId: CS_OTHERS,
      }),
      enrollmentRow({
        id: 'enr-foreign',
        tenantId: OTHER_TENANT,
        studentId: STUDENT_PEER,
        classSectionId: CS_FOREIGN,
      }),
    ],
    teachingAssignment: [
      // DEUX affectations sur la MÊME section (matières différentes) : la clé
      // d'unicité est `[teacherProfileId, classSectionId, subjectId]`, donc le
      // doublon est NORMAL et la portée doit le dédupliquer.
      { id: 'ta-a', tenantId: TENANT, teacherProfileId: MY_TP, classSectionId: CS_MINE },
      { id: 'ta-b', tenantId: TENANT, teacherProfileId: MY_TP, classSectionId: CS_MINE },
      { id: 'ta-other', tenantId: TENANT, teacherProfileId: OTHER_TP, classSectionId: CS_OTHERS },
      // Une ligne DÉRIVÉE d'un autre tenant portant NOTRE profil : elle
      // élargirait la portée à une section étrangère si le `where` de la portée
      // n'était pas tenant-clé (`G-TENANT`).
      {
        id: 'ta-drifted',
        tenantId: OTHER_TENANT,
        teacherProfileId: MY_TP,
        classSectionId: CS_FOREIGN,
      },
    ],
  };

  const statements: Statement[] = [];

  /**
   * Honore les égalités SCALAIRES, les filtres `{ in: [...] }` et les membres
   * `AND`. Un autre membre relationnel (objet) est considéré satisfait, jamais
   * inventé — le faux ne doit pas prouver plus que le code ne demande.
   */
  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, value]) => {
      if (key === 'AND') {
        return (value as Row[]).every((member) => matches(row, member));
      }
      if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
        const filter = value as Row;
        if (Array.isArray(filter.in)) return (filter.in as unknown[]).includes(row[key]);
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

  type Args = { where?: Row; select?: Row; include?: Row; orderBy?: unknown };

  const model = (name: string) => ({
    findMany: async ({ where, select, include, orderBy }: Args = {}) => {
      statements.push({ model: name, verb: 'findMany', where, select, include, orderBy });
      return rowsOf(name).filter((row) => matches(row, where));
    },
  });

  return {
    statements,
    of: (name: string) => statements.filter((s) => s.model === name),
    client: {
      enrollment: model('enrollment'),
      teachingAssignment: model('teachingAssignment'),
    } as unknown as PrismaService,
  };
}

// ---------------------------------------------------------------------------
// Le harnais
// ---------------------------------------------------------------------------

function makeHarness(
  options: {
    teacherProfileId?: string | null;
    /** Ce que rend `scopeForUser` pour la branche PARENT. `null` = sentinel NON RESTREINT. */
    guardianStudentIds?: string[] | null;
  } = {},
) {
  const db = makeDb();
  const findForUserCalls: string[] = [];
  const ensureForUserCalls: string[] = [];
  const scopeForUserCalls: unknown[][] = [];

  const users = { ensureUser: async () => ({ id: ME, tenantId: TENANT }) } as unknown as UserSyncService;

  const teachers = {
    findForUser: async () => {
      findForUserCalls.push('findForUser');
      const id = options.teacherProfileId === undefined ? MY_TP : options.teacherProfileId;
      return id === null ? null : { id };
    },
    /** Présent UNIQUEMENT pour prouver qu'AUCUN chemin ne l'appelle (`PF-265` / `ADR-051 §D1`). */
    ensureForUser: async () => {
      ensureForUserCalls.push('ensureForUser');
      return { id: MY_TP, tenantId: TENANT };
    },
  } as unknown as TeacherProfileService;

  const studentAccess = {
    scopeForUser: async (...args: unknown[]) => {
      scopeForUserCalls.push(args);
      const ids =
        options.guardianStudentIds === undefined ? [STUDENT_MINE] : options.guardianStudentIds;
      return { studentIds: ids, reason: 'parent' };
    },
  } as unknown as StudentAccessService;

  const notifications = { createMany: async () => undefined } as unknown as NotificationsService;

  const controller = new EnrollmentsController(db.client, users, notifications, teachers, studentAccess);
  return { controller, db, findForUserCalls, ensureForUserCalls, scopeForUserCalls };
}

/**
 * PINNER une requête enregistrée. `noUncheckedIndexedAccess`
 * (`tsconfig.base.json:14`) type `statements[i]` en `Statement | undefined`, et
 * le réflexe `statements[0]?.where` rend VIDE toute assertion NÉGATIVE :
 * `expect(undefined).not.toHaveProperty('internalNotes')` est VERT. Ce sont
 * précisément les cellules négatives qui portent la preuve de cette tranche.
 */
const stmtAt = (statements: Statement[], index = 0): Statement => {
  const statement = statements[index];
  if (statement === undefined) {
    throw new Error(
      `aucune requête enregistrée à l’index ${index} — ${statements.length} enregistrée(s)`,
    );
  }
  return statement;
};

/** Le `where` de la requête de charge utile, PINNÉ. */
const enrollmentWhereOf = (db: ReturnType<typeof makeDb>): Row => {
  const call = stmtAt(db.of('enrollment'));
  expect(call.where).toBeDefined();
  return call.where as Row;
};

/** Les membres `AND` du `where` de charge utile, PINNÉS : leur absence est un fail-open. */
const andMembersOf = (where: Row): Row[] => {
  expect(Array.isArray(where.AND)).toBe(true);
  return where.AND as Row[];
};

/** Le filtre `{ in: [...] }` émis sur `key` par la clause de PORTÉE, PINNÉ. */
const scopeInOf = (where: Row, key: 'classSectionId' | 'studentId'): unknown[] => {
  const member = andMembersOf(where).find((m) => m[key] !== undefined && typeof m[key] === 'object');
  if (member === undefined) {
    throw new Error(
      `aucun membre AND ne porte un filtre sur « ${key} » — la clé ABSENTE est le fail-open (AC-4)`,
    );
  }
  const filter = member[key] as Row;
  expect(Array.isArray(filter.in)).toBe(true);
  return filter.in as unknown[];
};

const idsOf = (rows: { data: Row[] }): unknown[] => rows.data.map((r) => r.id);

// ===========================================================================
// AC-3 — la classification, PURE et testée directement
// ===========================================================================

describe('S-E05-15 — classifyEnrollmentListCaller (AC-3, FR-1, FR-2)', () => {
  it('super_admin et school_admin sont PRIVILÉGIÉS, via la fonction existante (PF-270)', () => {
    expect(classifyEnrollmentListCaller(SUPER_ADMIN)).toBe('privileged');
    expect(classifyEnrollmentListCaller(SCHOOL_ADMIN)).toBe('privileged');
  });

  it('teacher est ENSEIGNANT, parent est TUTEUR', () => {
    expect(classifyEnrollmentListCaller(TEACHER)).toBe('teacher');
    expect(classifyEnrollmentListCaller(PARENT)).toBe('guardian');
  });

  it('student et le jeu de rôles VIDE sont REFUSÉS — deny-by-default', () => {
    expect(classifyEnrollmentListCaller(STUDENT)).toBe('denied');
    expect(classifyEnrollmentListCaller([])).toBe('denied');
    expect(classifyEnrollmentListCaller(['vie_scolaire'])).toBe('denied');
  });

  it('le plus privilégié gagne — même ordre que student-access.service.ts:33-63', () => {
    expect(classifyEnrollmentListCaller(['parent', 'school_admin'])).toBe('privileged');
    expect(classifyEnrollmentListCaller(['parent', 'teacher'])).toBe('teacher');
  });
});

// ===========================================================================
// AC-3 / AC-4 / AC-13 — le constructeur de `where`, PUR et testé directement
// ===========================================================================

describe('S-E05-15 — buildEnrollmentListWhere (AC-3, AC-4, FR-4)', () => {
  const noFilters = {};

  it('G-TENANT — `tenantId` est la PREMIÈRE clé des TROIS branches', () => {
    const scopes: EnrollmentListScope[] = [
      { kind: 'tenant' },
      { kind: 'sections', classSectionIds: [CS_MINE] },
      { kind: 'students', studentIds: [STUDENT_MINE] },
    ];
    for (const scope of scopes) {
      const where = buildEnrollmentListWhere({ tenantId: TENANT, scope, filters: noFilters });
      expect(Object.keys(where)[0]).toBe('tenantId');
      expect(where.tenantId).toBe(TENANT);
    }
  });

  it('AC-4 — une portée VIDE émet `{ in: [] }`, une clé DÉFINIE, jamais une clé absente', () => {
    const sections = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'sections', classSectionIds: [] },
      filters: noFilters,
    }) as unknown as Row;
    expect(scopeInOf(sections, 'classSectionId')).toEqual([]);

    const students = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'students', studentIds: [] },
      filters: noFilters,
    }) as unknown as Row;
    expect(scopeInOf(students, 'studentId')).toEqual([]);
  });

  it('AC-13 — le filtre de l’APPELANT et la clause de PORTÉE survivent TOUS LES DEUX', () => {
    const where = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'sections', classSectionIds: [CS_MINE] },
      filters: { classSectionId: CS_OTHERS },
    }) as unknown as Row;
    const members = andMembersOf(where);
    // Le filtre de l'appelant, en SCALAIRE.
    expect(members.some((m) => m.classSectionId === CS_OTHERS)).toBe(true);
    // La portée, en `{ in: [...] }`. Aucune des deux n'écrase l'autre : c'est
    // une INTERSECTION, et elle est VIDE ici.
    expect(scopeInOf(where, 'classSectionId')).toEqual([CS_MINE]);
  });

  it('AC-13 — même preuve sur l’axe `studentId` (parent visant un PAIR)', () => {
    const where = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'students', studentIds: [STUDENT_MINE] },
      filters: { studentId: STUDENT_PEER },
    }) as unknown as Row;
    expect(andMembersOf(where).some((m) => m.studentId === STUDENT_PEER)).toBe(true);
    expect(scopeInOf(where, 'studentId')).toEqual([STUDENT_MINE]);
  });

  it('les quatre filtres de l’appelant se replient inchangés, et les absents restent ABSENTS', () => {
    const where = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'tenant' },
      filters: { academicYearId: AY_ACTIVE, status: EnrollmentStatus.active },
    }) as unknown as Row;
    const caller = andMembersOf(where)[0] as Row;
    expect(caller).toEqual({ academicYearId: AY_ACTIVE, status: 'active' });
    expect(caller).not.toHaveProperty('studentId');
    expect(caller).not.toHaveProperty('classSectionId');
  });

  it('AC-4 — la chaîne VIDE n’est PAS repliée en filtre (elle est refusée par le pipe, pas ici)', () => {
    const where = buildEnrollmentListWhere({
      tenantId: TENANT,
      scope: { kind: 'tenant' },
      filters: { studentId: '' },
    }) as unknown as Row;
    expect(andMembersOf(where)[0]).not.toHaveProperty('studentId');
  });
});

// ===========================================================================
// AC-12 — le mur d'enseignement, et le type qui rend le fail-open inexprimable
// ===========================================================================

describe('S-E05-15 — teacherSectionsWhere (AC-12, G-TENANT)', () => {
  it('les DEUX clés sont émises, `tenantId` en premier', () => {
    expect(teacherSectionsWhere({ tenantId: TENANT, teacherProfileId: MY_TP })).toEqual({
      tenantId: TENANT,
      teacherProfileId: MY_TP,
    });
  });

  it('`teacherProfileId` est NON OPTIONNEL — le fail-open est inexprimable', () => {
    // Prisma retire les clés `undefined` d'un `where` : `{ tenantId }` seul
    // rendrait TOUTES les affectations du tenant, donc la portée de
    // l'établissement entier, en HTTP 200. Le type l'interdit ; cette assertion
    // pinne la FORME émise pour qu'un « ?. » ajouté plus tard soit visible.
    const where = teacherSectionsWhere({ tenantId: TENANT, teacherProfileId: MY_TP });
    expect(where.teacherProfileId).toBeDefined();
    expect(Object.keys(where)).toEqual(['tenantId', 'teacherProfileId']);
  });
});

// ===========================================================================
// AC-2 / G-AUTHZ — l'axe (a) : le `GET /enrollments` NU
// ===========================================================================

describe('S-E05-15 — AXE (a) : la liste NUE, sans aucun paramètre (AC-2)', () => {
  it('un ENSEIGNANT reçoit `classSectionId: { in: [ses sections] }`, PAS le tenant', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(TEACHER))) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(where.tenantId).toBe(TENANT);
    expect(scopeInOf(where, 'classSectionId')).toEqual([CS_MINE]);
    expect(idsOf(out)).toEqual(['enr-mine']);
    // La preuve NÉGATIVE : l'inscription du PAIR n'est pas rendue.
    expect(idsOf(out)).not.toContain('enr-peer');
  });

  it('un PARENT reçoit `studentId: { in: [ses enfants] }`, PAS le tenant', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(PARENT))) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(where.tenantId).toBe(TENANT);
    expect(scopeInOf(where, 'studentId')).toEqual([STUDENT_MINE]);
    expect(idsOf(out)).toEqual(['enr-mine']);
    expect(idsOf(out)).not.toContain('enr-peer');
  });

  it('un appelant REFUSÉ (`student`) reçoit 403, et AUCUNE requête n’est émise', async () => {
    const h = makeHarness();
    await expect(h.controller.list(jwt(STUDENT))).rejects.toThrow(ForbiddenException);
    expect(h.db.statements).toHaveLength(0);
  });
});

// ===========================================================================
// G-AUTHZ — les huit négatives et les quatre positives
// ===========================================================================

describe('S-E05-15 — G-AUTHZ, les négatives', () => {
  it('parent + `?classSectionId=` : la portée ÉLÈVE survit et l’intersection est vide', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(PARENT), undefined, CS_OTHERS)) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(andMembersOf(where).some((m) => m.classSectionId === CS_OTHERS)).toBe(true);
    expect(scopeInOf(where, 'studentId')).toEqual([STUDENT_MINE]);
    expect(out.data).toHaveLength(0);
  });

  it('parent + `?studentId=<pair>` : le filtre de l’appelant n’ÉCRASE PAS l’ABAC', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(PARENT), STUDENT_PEER)) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(andMembersOf(where).some((m) => m.studentId === STUDENT_PEER)).toBe(true);
    expect(scopeInOf(where, 'studentId')).toEqual([STUDENT_MINE]);
    expect(out.data).toHaveLength(0);
  });

  it('parent SANS AUCUNE tutelle : `{ in: [] }` émis — jamais une clé absente (AC-14)', async () => {
    const h = makeHarness({ guardianStudentIds: [] });
    const out = (await h.controller.list(jwt(PARENT))) as unknown as { data: Row[] };
    expect(scopeInOf(enrollmentWhereOf(h.db), 'studentId')).toEqual([]);
    expect(out.data).toHaveLength(0);
  });

  it('AC-11 — le sentinel NON RESTREINT (`studentIds: null`) est REFUSÉ, jamais consommé', async () => {
    const h = makeHarness({ guardianStudentIds: null });
    await expect(h.controller.list(jwt(PARENT))).rejects.toThrow(ForbiddenException);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  it('enseignant sur une section qu’il N’ENSEIGNE PAS : intersection vide', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(TEACHER), undefined, CS_OTHERS)) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(andMembersOf(where).some((m) => m.classSectionId === CS_OTHERS)).toBe(true);
    expect(scopeInOf(where, 'classSectionId')).toEqual([CS_MINE]);
    expect(out.data).toHaveLength(0);
  });

  it('AC-4 — enseignant SANS PROFIL : 403, et la requête d’affectations n’est JAMAIS émise', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.list(jwt(TEACHER))).rejects.toThrow(ForbiddenException);
    // L'assertion qui porte la preuve : pas « un 403 est revenu », mais « le
    // `where` d'appartenance n'a jamais existé ».
    expect(h.db.of('teachingAssignment')).toHaveLength(0);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  it('AC-17/AC-14 — enseignant AVEC profil mais ZÉRO affectation utile : `{ in: [] }`, pas 403', async () => {
    // On force la portée à vide en faisant résoudre un AUTRE profil : les
    // affectations de `MY_TP` ne lui appartiennent pas.
    const h = makeHarness({ teacherProfileId: 'aaaaaaaa-0000-0000-0000-00000000000c' });
    const out = (await h.controller.list(jwt(TEACHER))) as unknown as { data: Row[] };
    expect(scopeInOf(enrollmentWhereOf(h.db), 'classSectionId')).toEqual([]);
    expect(out.data).toHaveLength(0);
  });

  it('un jeton SANS `realm_access` est REFUSÉ — 403, jamais 500', async () => {
    const h = makeHarness();
    await expect(h.controller.list(jwtWithoutRealmAccess)).rejects.toThrow(ForbiddenException);
    expect(h.db.statements).toHaveLength(0);
  });
});

describe('S-E05-15 — G-AUTHZ, les positives (AC-17 : la tranche ne doit pas être un mur)', () => {
  it('school_admin lit le TENANT — portée `tenant`, aucune clause `in`', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(SCHOOL_ADMIN))) as unknown as { data: Row[] };
    const where = enrollmentWhereOf(h.db);
    expect(where.tenantId).toBe(TENANT);
    expect(andMembersOf(where)).toEqual([{}]);
    expect(idsOf(out).sort()).toEqual(['enr-mine', 'enr-peer']);
  });

  it('super_admin idem, et NI le profil professeur NI la portée élève ne sont demandés', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(SUPER_ADMIN));
    expect(h.findForUserCalls).toHaveLength(0);
    expect(h.scopeForUserCalls).toHaveLength(0);
    expect(h.db.of('teachingAssignment')).toHaveLength(0);
  });

  it('AC-17 — un enseignant sur SA section reçoit RÉELLEMENT les lignes', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(TEACHER), undefined, CS_MINE)) as unknown as { data: Row[] };
    expect(idsOf(out)).toEqual(['enr-mine']);
  });

  it('AC-17 — un parent sur SON enfant reçoit RÉELLEMENT la ligne', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(PARENT), STUDENT_MINE)) as unknown as { data: Row[] };
    expect(idsOf(out)).toEqual(['enr-mine']);
  });

  it('AC-18 — `ensureForUser` n’est appelé sur AUCUNE branche (PF-265 / ADR-051 §D1)', async () => {
    for (const roles of [TEACHER, PARENT, SCHOOL_ADMIN]) {
      const h = makeHarness();
      await h.controller.list(jwt(roles));
      expect(h.ensureForUserCalls).toHaveLength(0);
    }
    const denied = makeHarness();
    await expect(denied.controller.list(jwt(STUDENT))).rejects.toThrow(ForbiddenException);
    expect(denied.ensureForUserCalls).toHaveLength(0);

    const noProfile = makeHarness({ teacherProfileId: null });
    await expect(noProfile.controller.list(jwt(TEACHER))).rejects.toThrow(ForbiddenException);
    expect(noProfile.ensureForUserCalls).toHaveLength(0);
  });
});

// ===========================================================================
// G-TENANT
// ===========================================================================

describe('S-E05-15 — G-TENANT (ADR-032 §D5 : degraded_no_app_url)', () => {
  it('la requête d’AFFECTATIONS porte sa PROPRE clause `tenantId`', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(TEACHER));
    const call = stmtAt(h.db.of('teachingAssignment'));
    expect(call.where).toEqual({ tenantId: TENANT, teacherProfileId: MY_TP });
    // Conséquence directe : la ligne `ta-drifted` (autre tenant, NOTRE profil,
    // section étrangère) N'ENTRE PAS dans la portée.
    expect(scopeInOf(enrollmentWhereOf(h.db), 'classSectionId')).not.toContain(CS_FOREIGN);
  });

  it('la portée d’un enseignant est DÉDUPLIQUÉE (deux matières, une section)', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(TEACHER));
    expect(scopeInOf(enrollmentWhereOf(h.db), 'classSectionId')).toEqual([CS_MINE]);
  });

  it('AC-19 — un `classSectionId` d’un AUTRE tenant rend `[]` pour un privilégié, PAS un 404', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(SCHOOL_ADMIN), undefined, CS_FOREIGN)) as {
      data: Row[];
    };
    expect(out.data).toHaveLength(0);
    expect(enrollmentWhereOf(h.db).tenantId).toBe(TENANT);
    // `[]` est indiscernable de « aucune inscription » : la route ne devient pas
    // un oracle d'existence sur les ids d'un autre tenant. Ne PAS « améliorer »
    // ce `[]` en 404.
  });

  it('un enseignant ne peut pas atteindre une section étrangère par `?classSectionId=`', async () => {
    const h = makeHarness();
    const out = (await h.controller.list(jwt(TEACHER), undefined, CS_FOREIGN)) as unknown as { data: Row[] };
    expect(out.data).toHaveLength(0);
  });
});

// ===========================================================================
// AC-6 — la projection
// ===========================================================================

describe('S-E05-15 — projection `classSection` (AC-6, ADR-065 §D3)', () => {
  const classSectionSelectOf = (db: ReturnType<typeof makeDb>): Row => {
    const call = stmtAt(db.of('enrollment'));
    const cs = call.include?.classSection;
    expect(cs).toBeDefined();
    // La régression exacte de `PF-283 (D2)` : `{ include: { gradeLevel: true } }`.
    expect(cs).not.toHaveProperty('include');
    const select = (cs as Row).select;
    expect(select).toBeDefined();
    return select as Row;
  };

  it('`classSection` est un `select` EXPLICITE, pas un `include`', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(SCHOOL_ADMIN));
    expect(classSectionSelectOf(h.db)).toEqual({
      id: true,
      name: true,
      gradeLevel: { select: { id: true, code: true, name: true, orderIndex: true } },
    });
  });

  it('les ONZE colonnes `ClassSection` sont absentes — CLÉ PAR CLÉ', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(SCHOOL_ADMIN));
    const select = classSectionSelectOf(h.db);
    for (const column of FORBIDDEN_CLASS_SECTION_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
    // Les deux que la tranche NOMME.
    expect(select).not.toHaveProperty('internalNotes');
    expect(select).not.toHaveProperty('options');
  });

  it('les QUATRE colonnes `GradeLevel` sont absentes — CLÉ PAR CLÉ', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(SCHOOL_ADMIN));
    const gradeLevel = classSectionSelectOf(h.db).gradeLevel as Row;
    expect(gradeLevel).not.toBe(true);
    const select = gradeLevel.select as Row;
    expect(select).toBeDefined();
    for (const column of FORBIDDEN_GRADE_LEVEL_COLUMNS) {
      expect(select).not.toHaveProperty(column);
    }
  });

  it('`student`, `academicYear` et l’ordre sont INCHANGÉS', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(SCHOOL_ADMIN));
    const call = stmtAt(h.db.of('enrollment'));
    expect(call.include?.student).toEqual({
      select: { id: true, firstName: true, lastName: true, externalRef: true },
    });
    expect(call.include?.academicYear).toEqual({
      select: { id: true, name: true, status: true },
    });
    expect(call.orderBy).toEqual([{ enrolledAt: 'desc' }]);
  });

  it('la projection ne dépend PAS du rôle — un enseignant reçoit la même forme', async () => {
    const h = makeHarness();
    await h.controller.list(jwt(TEACHER));
    expect(classSectionSelectOf(h.db)).not.toHaveProperty('internalNotes');
  });
});

// ===========================================================================
// AC-7 / AC-8 / AC-16 — les pipes
// ===========================================================================

describe('S-E05-15 — validation des paramètres (AC-7, AC-8, AC-16)', () => {
  /**
   * Un appel DIRECT au contrôleur court-circuite la phase PIPE de Nest. La
   * preuve honnête se fait donc en DEUX morceaux, et chaque test dit lequel il
   * porte : (1) le pipe lui-même, (2) les métadonnées de route qui montrent
   * qu'il est monté sur CE paramètre.
   */
  /**
   * Les deux pipes sont vus à travers un type MINIMAL. `ParseEnumPipe<T>` infère
   * `T` sur l'OBJET d'enum passé au constructeur, donc son `transform` déclaré
   * attend cet objet et non l'une de ses valeurs — un artefact de typage de
   * `@nestjs/common@10.4.22`, pas une propriété d'exécution. On regarde donc les
   * deux pipes par leur seule surface utile ; le comportement testé reste celui
   * du VRAI pipe, jamais d'un talon.
   */
  type OptionalPipe = {
    transform: (value: unknown, metadata: ArgumentMetadata) => Promise<unknown>;
  };
  const uuidPipe = new ParseUUIDPipe({ optional: true }) as unknown as OptionalPipe;
  const enumPipe = new ParseEnumPipe(EnrollmentStatus, {
    optional: true,
  }) as unknown as OptionalPipe;
  const meta: ArgumentMetadata = { type: 'query', data: 'studentId' };
  const statusMeta: ArgumentMetadata = { type: 'query', data: 'status' };

  it('AC-7 — `undefined` PASSE (c’est le piège : sans `{optional:true}` tout appel serait 400)', async () => {
    await expect(uuidPipe.transform(undefined, meta)).resolves.toBeUndefined();
    await expect(uuidPipe.transform(null, meta)).resolves.toBeNull();
  });

  it('AC-7 — un uuid malformé est refusé en 400', async () => {
    await expect(uuidPipe.transform('pas-un-uuid', meta)).rejects.toThrow(BadRequestException);
  });

  it('AC-16 — la chaîne VIDE devient un 400 (changement de sémantique DÉCLARÉ)', async () => {
    // Avant la tranche, `''` tombait dans le garde falsy `...(studentId ? …)` et
    // était IGNORÉ EN SILENCE. C'est le seul changement observable pour un
    // appelant existant — et il n'y en a aucun sur ce verbe.
    await expect(uuidPipe.transform('', meta)).rejects.toThrow(BadRequestException);
  });

  it('AC-16 — un paramètre RÉPÉTÉ (parsé en tableau) est refusé en 400', async () => {
    await expect(uuidPipe.transform(['a', 'b'], meta)).rejects.toThrow(BadRequestException);
  });

  it('AC-7 — un uuid BIEN FORMÉ passe inchangé', async () => {
    await expect(uuidPipe.transform(UUID_ABSENT, meta)).resolves.toBe(UUID_ABSENT);
  });

  it('AC-8 — `status` : `undefined` passe, une valeur bogus est un 400', async () => {
    await expect(enumPipe.transform(undefined, statusMeta)).resolves.toBeUndefined();
    await expect(enumPipe.transform('not_a_status', statusMeta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('AC-8 — un `status` RÉPÉTÉ (tableau) est refusé en 400', async () => {
    await expect(enumPipe.transform(['active', 'x'], statusMeta)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('AC-8 — les SIX valeurs de `EnrollmentStatus` passent (énumérées depuis schema.prisma)', async () => {
    for (const value of [
      'pending',
      'active',
      'transferred_in',
      'transferred_out',
      'graduated',
      'dropped',
    ] as const) {
      await expect(enumPipe.transform(value, statusMeta)).resolves.toBe(value);
    }
  });

  const routeArgs = () =>
    Object.values(
      (Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, EnrollmentsController, 'list') ?? {}) as Record<
        string,
        { data?: unknown; pipes?: unknown[] }
      >,
    );

  it.each(['studentId', 'classSectionId', 'academicYearId'])(
    'AC-7 — un `ParseUUIDPipe` optionnel est MONTÉ sur `%s`',
    (name) => {
      const param = routeArgs().find((e) => e.data === name);
      expect(param).toBeDefined();
      const pipes = param?.pipes ?? [];
      expect(pipes).toHaveLength(1);
      expect(pipes[0]).toBeInstanceOf(ParseUUIDPipe);
      // `{ optional: true }` est ce qui fait passer `undefined` : sans lui, tout
      // appelant qui n'envoie pas le paramètre prendrait un 400.
      expect((pipes[0] as { options?: { optional?: boolean } }).options?.optional).toBe(true);
    },
  );

  it('AC-8 — un `ParseEnumPipe` optionnel est MONTÉ sur `status`', () => {
    const param = routeArgs().find((e) => e.data === 'status');
    expect(param).toBeDefined();
    const pipes = param?.pipes ?? [];
    expect(pipes).toHaveLength(1);
    expect(pipes[0]).toBeInstanceOf(ParseEnumPipe);
    expect((pipes[0] as { options?: { optional?: boolean } }).options?.optional).toBe(true);
  });
});

// ===========================================================================
// Métadonnées de garde, DNC-10 et AC-20
// ===========================================================================

describe('S-E05-15 — métadonnées, DNC-10 et PF-270 (AC-5, AC-20, G-AUTHZ)', () => {
  const SOURCE = readFileSync(join(__dirname, 'enrollments.controller.ts'), 'utf8');

  /**
   * `AC-20` — l'assertion en forme de `grep`. Les COMMENTAIRES sont retirés
   * d'abord : ce fichier est son propre document de conception et cite
   * légitimement les noms de rôle en prose (`:102`, `:271`, `:1139-1140`). Ce
   * que `PF-270` interdit, c'est une seconde IMPLÉMENTATION du test, pas une
   * phrase. Une consigne en prose n'empêche pas une copie ; ceci si.
   */
  const CODE = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');

  const occurrences = (needle: string): number => CODE.split(needle).length - 1;

  it('AC-20 — `school_admin` et `super_admin` n’apparaissent QU’UNE FOIS dans le CODE (PF-270)', () => {
    expect(occurrences("'school_admin'")).toBe(1);
    expect(occurrences("'super_admin'")).toBe(1);
  });

  it('AC-5 / DNC-10 — aucune trappe d’échappement sur le chemin de décision', () => {
    const decisionPath = String(
      (EnrollmentsController.prototype as unknown as Record<string, unknown>)[
        'resolveEnrollmentListScope'
      ],
    );
    expect(decisionPath).not.toMatch(/SKIP_|ALLOW_|BYPASS|NODE_ENV|process\.env/);
    expect(String(classifyEnrollmentListCaller)).not.toMatch(/SKIP_|ALLOW_|BYPASS|process\.env/);
    expect(String(buildEnrollmentListWhere)).not.toMatch(/SKIP_|ALLOW_|BYPASS|process\.env/);
    // Et sur le fichier ENTIER, code seul : aucune lecture d'environnement.
    expect(CODE).not.toMatch(/process\.env/);
  });

  it('AC-4 — `...(ids.length ? … : {})` n’apparaît nulle part (le fail-open nommé)', () => {
    expect(CODE).not.toMatch(/\.length\s*\?\s*\{\s*(studentId|classSectionId)/);
  });

  it('la permission exigée est INCHANGÉE — cette tranche ne fait que RÉTRÉCIR', () => {
    expect(Reflect.getMetadata(PERMISSIONS_META_KEY, EnrollmentsController.prototype.list)).toEqual([
      'enrollments.read',
    ]);
  });

  it('les gardes de contrôleur sont toujours là', () => {
    const guards = (Reflect.getMetadata('__guards__', EnrollmentsController) ?? []) as unknown[];
    expect(guards.map((g) => (g as { name?: string }).name)).toEqual(
      expect.arrayContaining(['JwtAuthGuard', 'PermissionsGuard']),
    );
  });

  it('`ENROLLMENT_ROSTER_CLASS_SECTION_SELECT` n’est PAS réutilisée par `list` (ADR-062 §D3)', () => {
    // Deux projections module-locales, deux décisions révocables séparément.
    // La constante de `roster` porte `maxStudents` (la CAPACITÉ) et pas de
    // `gradeLevel` : sa forme est fausse pour cette route.
    expect(CODE).toContain('ENROLLMENT_LIST_CLASS_SECTION_SELECT');
    expect(occurrences('ENROLLMENT_ROSTER_CLASS_SECTION_SELECT')).toBe(2); // sa déclaration + son seul usage dans `roster`
  });
});
