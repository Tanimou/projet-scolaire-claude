import 'reflect-metadata';

import { BadRequestException, ForbiddenException, NotFoundException, ParseUUIDPipe } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PERMISSIONS_META_KEY } from '../../shared/auth/requires-permission.decorator';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { StudentAccessService } from '../students/student-access.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';
import { teacherOfSectionWhere } from '../teaching/teaching-wall.where';

import {
  EnrollmentsController,
  assertClassRosterReadable,
  isPrivilegedEnrollmentsCaller,
} from './enrollments.controller';

/**
 * S-E05-14 / PF-278 / ADR-063 — `GET /enrollments/roster/:classSectionId`
 * gagne l'ABAC et la projection que la liste d'appel d'`attendance` avait déjà.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI N'A PAS ÉTÉ EXÉCUTÉ — ÉCRIT PLUTÔT QU'AFFIRMÉ                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Cet agent n'exécute NI jest, NI `pnpm typecheck`, NI aucun build (budget CPU :
 * seul le test-architect lance la chaîne). Les preuves de ce fichier n'ont donc
 * JAMAIS ÉTÉ EXÉCUTÉES par leur auteur. Ce qui a réellement tourné dans cette
 * tranche est la LECTURE du schéma (`ClassSection.academicYearId` +
 * `@@unique([academicYearId, gradeLevelId, name])`, `schema.prisma:457`/`:478` ;
 * `TeachingAssignment.@@unique([teacherProfileId, classSectionId, subjectId])`,
 * `:1029`), la lecture du catalogue de permissions, et le RECENSEMENT des
 * appelants : `grep -rn "enrollments/roster" apps/ packages/` → code de sortie
 * 1, ZÉRO appelant de première partie.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE FICHIER ASSERTE LA REQUÊTE, PAS LE CORPS — ET `PF-275` EST POURQUOI   │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `makeDb()` ENREGISTRE `where` / `select` / `include` et rend ses fixtures
 * SANS LES APPLIQUER : un double Prisma n'est pas le moteur de requêtes de
 * Prisma. Une assertion sur le CORPS de la réponse (« `medicalNotes` est
 * absent du JSON rendu ») serait donc verte quoi que le contrôleur demande —
 * elle prouverait le harnais, pas le code. La seule preuve honnête de la
 * projection est la FORME DE LA REQUÊTE : que l'appel `enrollment.findMany`
 * porte `include.student.select` égal aux quatre champs, et JAMAIS le
 * `include: { student: true }` nu. Les tests de projection le disent dans leur
 * nom, et la liste NÉGATIVE (les dix colonnes `Student` exclues) est assertée
 * CLÉ PAR CLÉ, pas par égalité de forme : c'est elle qui protège réellement.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX PRISMA EST DÉLIBÉRÉMENT NON FILTRANT                             │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Il n'applique AUCUN filtre tenant ambiant : il honore EXACTEMENT le `where`
 * SCALAIRE qu'on lui passe. C'est la simulation du chemin `degraded_no_app_url`
 * — la connexion du PROPRIÉTAIRE, qui échappe à ses propres policies RLS
 * (`ADR-032 §D5`), c'est-à-dire TOUS les déploiements d'aujourd'hui. Un faux
 * qui filtrerait par tenant de lui-même rendrait ces tests verts sans que le
 * code ait la moindre clause `tenantId`, c'est-à-dire prouverait le faux.
 *
 * Le mur d'enseignement de cette tranche est ENTIÈREMENT SCALAIRE
 * (`{ tenantId, classSectionId, teacherProfileId }`, sans membre relationnel),
 * donc le faux le filtre RÉELLEMENT et les cellules négatives d'`AC-3`
 * atterrissent dessus pour de bon.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ME = '33333333-3333-3333-3333-333333333333';

const MY_TP = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_TP = 'aaaaaaaa-0000-0000-0000-00000000000b';

/** Classe du tenant, enseignée par l'appelant. */
const CS_MINE = 'eeeeeeee-0000-0000-0000-000000000001';
/** Classe du tenant, enseignée par QUELQU'UN D'AUTRE. */
const CS_OTHERS = 'eeeeeeee-0000-0000-0000-000000000002';
/** Classe d'un AUTRE tenant — doit rendre 404, jamais 403 (`AC-1`). */
const CS_FOREIGN = 'eeeeeeee-0000-0000-0000-000000000003';
/** Id bien formé qui n'existe dans AUCUNE table. */
const CS_ABSENT = 'eeeeeeee-0000-0000-0000-0000000000ff';

const STUDENT_A = 'dddddddd-0000-0000-0000-000000000001';

/** Une année RÉVOLUE : l'affectation y survit (`academicYearId` hors clé d'unicité). */
const AY_LAPSED = 'ffffffff-0000-0000-0000-000000000002';
const AY_ACTIVE = 'ffffffff-0000-0000-0000-000000000001';

/** La clé de métadonnées de Nest pour les paramètres de route (`ROUTE_ARGS_METADATA`), en LITTÉRAL — même convention que l'assertion `'__guards__'` de `register-throttle.supertest.spec.ts:264`. */
const ROUTE_ARGS_METADATA_KEY = '__routeArguments__';

const REFUSAL = 'Vous ne pouvez consulter que la liste des élèves de vos classes.';

/**
 * Les DIX colonnes `Student` que `include: { student: true }` faisait partir
 * sur le fil, et qui doivent être ABSENTES du `select` demandé. Assertées CLÉ
 * PAR CLÉ : une égalité de forme passerait aussi si le `select` était `{}`.
 */
const FORBIDDEN_STUDENT_COLUMNS = [
  'medicalNotes',
  'address',
  'phone',
  'email',
  'birthDate',
  'gender',
  'nationality',
  'notes',
  'customFields',
  'photoUrl',
] as const;

type Row = Record<string, unknown>;

const jwt = (roles: string[]): KeycloakJwtPayload =>
  ({ sub: ME, realm_access: { roles } }) as unknown as KeycloakJwtPayload;

/** Un jeton SANS `realm_access` : doit produire un 403, jamais un 500 (`FM-6`). */
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

/** Une ligne `ClassSection` COMPLÈTE — c'est la charge que `PF-280` exposait. */
const sectionRow = (id: string, tenantId: string): Row => ({
  id,
  tenantId,
  academicYearId: AY_ACTIVE,
  gradeLevelId: 'gl-1',
  name: '6ème B',
  maxStudents: 30,
  room: 'B12',
  options: { transport: true },
  internalNotes: 'CLASSE DIFFICILE — note interne de direction',
  status: 'active',
});

/** Une ligne `Student` COMPLÈTE — c'est la charge que `PF-278` exposait. */
const studentRow = (id: string): Row => ({
  id,
  tenantId: TENANT,
  firstName: 'Prénom',
  lastName: 'Nom',
  externalRef: 'EXT-1',
  medicalNotes: 'ALLERGIE ARACHIDE',
  address: { street: '1 rue des Écoles' },
  phone: '0600000000',
  email: 'eleve@example.test',
  birthDate: new Date('2014-05-02T00:00:00.000Z'),
  gender: 'F',
  nationality: 'FR',
  notes: 'note interne',
  customFields: {},
  photoUrl: 'https://cdn.example.test/photo.jpg',
});

function makeDb(seed?: Partial<Record<string, Row[]>>) {
  const tables: Record<string, Row[]> = {
    classSection: [
      sectionRow(CS_MINE, TENANT),
      sectionRow(CS_OTHERS, TENANT),
      sectionRow(CS_FOREIGN, OTHER_TENANT),
    ],
    enrollment: [
      {
        id: 'enr-1',
        tenantId: TENANT,
        studentId: STUDENT_A,
        classSectionId: CS_MINE,
        academicYearId: AY_ACTIVE,
        status: 'active',
        enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
        student: studentRow(STUDENT_A),
      },
    ],
    teachingAssignment: [
      // L'affectation de l'appelant sur SA classe. Son `academicYearId` est
      // DÉLIBÉRÉMENT l'année révolue : le mur ne doit PAS filtrer sur l'année
      // (`ADR-063 §D1`), et cette ligne est ce qui le pinne.
      {
        id: 'ta-mine',
        tenantId: TENANT,
        teacherProfileId: MY_TP,
        classSectionId: CS_MINE,
        academicYearId: AY_LAPSED,
      },
      // L'affectation d'un AUTRE professeur sur une AUTRE classe.
      {
        id: 'ta-others',
        tenantId: TENANT,
        teacherProfileId: OTHER_TP,
        classSectionId: CS_OTHERS,
        academicYearId: AY_ACTIVE,
      },
      // Une ligne DÉRIVÉE d'un autre tenant portant NOTRE profil sur la classe
      // étrangère : elle autoriserait si le `where` n'était pas tenant-clé.
      {
        id: 'ta-drifted',
        tenantId: OTHER_TENANT,
        teacherProfileId: MY_TP,
        classSectionId: CS_FOREIGN,
        academicYearId: AY_ACTIVE,
      },
    ],
    ...seed,
  };

  const statements: Statement[] = [];

  /**
   * NON FILTRANT : seules les égalités SCALAIRES sont honorées. Un membre
   * relationnel (objet) est considéré satisfait, jamais inventé.
   */
  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, value]) =>
      value !== null && typeof value === 'object' && !(value instanceof Date)
        ? true
        : row[key] === value,
    );

  const rowsOf = (name: string): Row[] => {
    const rows = tables[name];
    if (rows === undefined) {
      throw new Error(`double Prisma : le modèle « ${name} » n’est pas déclaré dans ce harnais`);
    }
    return rows;
  };

  type Args = { where?: Row; select?: Row; include?: Row; orderBy?: unknown };

  const model = (name: string) => ({
    findFirst: async ({ where, select, include, orderBy }: Args = {}) => {
      statements.push({ model: name, verb: 'findFirst', where, select, include, orderBy });
      return rowsOf(name).find((row) => matches(row, where)) ?? null;
    },
    /** `findUnique` par CLÉ PRIMAIRE, comme en production : il IGNORE le tenant — c'est précisément pourquoi la garde applicative reste. */
    findUnique: async ({ where, select, include, orderBy }: Args = {}) => {
      statements.push({ model: name, verb: 'findUnique', where, select, include, orderBy });
      return rowsOf(name).find((row) => row.id === where?.id) ?? null;
    },
    findMany: async ({ where, select, include, orderBy }: Args = {}) => {
      statements.push({ model: name, verb: 'findMany', where, select, include, orderBy });
      return rowsOf(name).filter((row) => matches(row, where));
    },
  });

  return {
    statements,
    of: (name: string) => statements.filter((s) => s.model === name),
    client: {
      classSection: model('classSection'),
      enrollment: model('enrollment'),
      teachingAssignment: model('teachingAssignment'),
    } as unknown as PrismaService,
  };
}

function makeHarness(options: { teacherProfileId?: string | null; db?: ReturnType<typeof makeDb> } = {}) {
  const db = options.db ?? makeDb();
  const findForUserCalls: string[] = [];
  const ensureForUserCalls: string[] = [];

  const users = {
    ensureUser: async () => ({ id: ME, tenantId: TENANT }),
  } as unknown as UserSyncService;

  const teachers = {
    findForUser: async () => {
      findForUserCalls.push('findForUser');
      const id = options.teacherProfileId === undefined ? MY_TP : options.teacherProfileId;
      return id === null ? null : { id };
    },
    /** Présent UNIQUEMENT pour prouver qu'AUCUN chemin nouveau ne l'appelle (`PF-265`). */
    ensureForUser: async () => {
      ensureForUserCalls.push('ensureForUser');
      return { id: MY_TP, tenantId: TENANT };
    },
  } as unknown as TeacherProfileService;

  const notifications = { createMany: async () => undefined } as unknown as NotificationsService;

  /**
   * S-E05-15 — 5e argument du constructeur. `roster` ne l'appelle JAMAIS ; le
   * talon LÈVE pour que ce fichier échoue bruyamment si une tranche ultérieure
   * faisait passer le mur de `roster` par `StudentAccessService` sans le dire
   * (`student-access.service.ts:38-40` rend `studentIds: null` — NON RESTREINT —
   * pour `teacher`, donc ce serait un fail-open silencieux).
   */
  const studentAccess = {
    scopeForUser: async () => {
      throw new Error('`roster` ne doit PAS consulter StudentAccessService (S-E05-15)');
    },
  } as unknown as StudentAccessService;

  const controller = new EnrollmentsController(
    db.client,
    users,
    notifications,
    teachers,
    studentAccess,
  );
  return { controller, db, findForUserCalls, ensureForUserCalls };
}

// ---------------------------------------------------------------------------
// PINNER une requête enregistrée — et pourquoi ce n'est PAS un `?.`
// ---------------------------------------------------------------------------

/**
 * `noUncheckedIndexedAccess` (`tsconfig.base.json:14`) type `statements[i]` en
 * `Statement | undefined`. Le réflexe — `statements[0]?.where` — est SÛR sur une
 * assertion POSITIVE (`expect(undefined).toEqual({…})` échoue bruyamment) mais
 * rend VIDE toute assertion NÉGATIVE : `expect(undefined).not.toHaveProperty('internalNotes')`
 * est VERT. Or ce sont précisément les cellules négatives qui portent la preuve
 * de cette tranche (`PF-278` / `PF-280` : les colonnes qui ne doivent PAS être
 * demandées). On PINNE donc l'élément d'abord : s'il manque, l'échec tombe ICI,
 * nommé, avant que la négation n'ait la moindre chance de passer pour vraie.
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

/**
 * Le `select` relationnel `student` de la requête de charge utile, PINNÉ pour la
 * même raison : sans ce pinnage, un `include: { student: true }` (exactement la
 * régression que `PF-278` décrit) ferait de `…select` un `undefined`, et les dix
 * cellules négatives de `FORBIDDEN_STUDENT_COLUMNS` passeraient toutes au VERT
 * en prouvant le contraire de ce qu'elles annoncent.
 */
const studentSelectOf = (call: Statement): Row => {
  const student = call.include?.student;
  expect(student).toBeDefined();
  expect(student).not.toBe(true);
  const select = (student as Row).select;
  expect(select).toBeDefined();
  return select as Row;
};

const TEACHER = ['teacher'];
const PARENT = ['parent'];
const SCHOOL_ADMIN = ['school_admin'];
const SUPER_ADMIN = ['super_admin'];

// ===========================================================================
// COUCHE 1 — les fonctions PURES, testées directement (`AC-7`)
// ===========================================================================

describe('S-E05-14 — couche pure', () => {
  describe('isPrivilegedEnrollmentsCaller', () => {
    it.each([
      [['super_admin'], true],
      [['school_admin'], true],
      [['teacher'], false],
      [['parent'], false],
      [['student'], false],
      [[], false],
      [['teacher', 'school_admin'], true],
      [['parent', 'super_admin'], true],
    ] as [string[], boolean][])('%j → %s', (roles, expected) => {
      expect(isPrivilegedEnrollmentsCaller(roles)).toBe(expected);
    });

    it('ne prend AUCUN second paramètre — un contrôle qu’on peut éteindre n’est pas un contrôle (DNC-10)', () => {
      expect(isPrivilegedEnrollmentsCaller).toHaveLength(1);
    });
  });

  /**
   * `AC-7` — les HUIT combinaisons, exhaustivement. La cellule
   * `{ isPrivileged: false, teacherProfileId: null, teachesSection: true }` est
   * IMPOSSIBLE en production (le contrôleur ne consulte pas le mur sans profil)
   * et doit néanmoins LEVER : c'est elle qui distingue la forme fail-closed
   * retenue de la forme inversée qui fail-open sur un profil nul.
   */
  describe('assertClassRosterReadable — les 8 combinaisons', () => {
    it.each([
      [true, MY_TP, true, 'passe'],
      [true, MY_TP, false, 'passe'],
      [true, null, true, 'passe'],
      [true, null, false, 'passe'],
      [false, MY_TP, true, 'passe'],
      [false, MY_TP, false, 'lève'],
      [false, null, true, 'lève'],
      [false, null, false, 'lève'],
    ] as [boolean, string | null, boolean, 'passe' | 'lève'][])(
      'isPrivileged=%s teacherProfileId=%s teachesSection=%s → %s',
      (isPrivileged, teacherProfileId, teachesSection, outcome) => {
        const call = () =>
          assertClassRosterReadable({ isPrivileged, teacherProfileId, teachesSection });
        if (outcome === 'passe') {
          expect(call).not.toThrow();
        } else {
          expect(call).toThrow(ForbiddenException);
        }
      },
    );

    it('le message est de forme LECTURE et ne nomme ni tenant, ni table, ni id (ADR-048 §D9)', () => {
      try {
        assertClassRosterReadable({ isPrivileged: false, teacherProfileId: null, teachesSection: false });
        throw new Error('aurait dû lever');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        const body = (err as ForbiddenException).getResponse() as { message?: string };
        expect(body.message).toBe(REFUSAL);
        expect(body.message).not.toMatch(/tenant|prisma|class_section|uuid|P20/i);
      }
    });

    it('le profil nul et le non-enseignement rendent le MÊME message — aucun oracle de distinction', () => {
      const grab = (teacherProfileId: string | null, teachesSection: boolean) => {
        try {
          assertClassRosterReadable({ isPrivileged: false, teacherProfileId, teachesSection });
          return null;
        } catch (err) {
          return ((err as ForbiddenException).getResponse() as { message?: string }).message;
        }
      };
      expect(grab(null, false)).toBe(grab(MY_TP, false));
    });

    it('ne prend AUCUN paramètre de contournement — un seul objet de décision (DNC-10)', () => {
      expect(assertClassRosterReadable).toHaveLength(1);
      expect(String(assertClassRosterReadable)).not.toMatch(/SKIP_|ALLOW_|BYPASS|NODE_ENV|process\.env/);
    });
  });

  /**
   * `FM-1` d'ADR-063 §D2 — le type est le contrôle. `teacherProfileId` est NON
   * OPTIONNEL : Prisma retire les clés `undefined` d'un `where`, donc un
   * `tp?.id` passé ici transformerait le mur en « la première affectation de
   * cette classe, à qui que ce soit » et ACCORDERAIT l'appelant sans profil.
   */
  describe('teacherOfSectionWhere', () => {
    it('rend les TROIS clés scalaires, et rien d’autre', () => {
      expect(
        teacherOfSectionWhere({ tenantId: TENANT, classSectionId: CS_MINE, teacherProfileId: MY_TP }),
      ).toEqual({ tenantId: TENANT, classSectionId: CS_MINE, teacherProfileId: MY_TP });
    });

    it('n’emporte AUCUNE clause d’année scolaire (ADR-063 §D1)', () => {
      const where = teacherOfSectionWhere({
        tenantId: TENANT,
        classSectionId: CS_MINE,
        teacherProfileId: MY_TP,
      }) as Record<string, unknown>;
      expect(Object.keys(where).sort()).toEqual(['classSectionId', 'teacherProfileId', 'tenantId']);
      expect(where).not.toHaveProperty('academicYearId');
      expect(where).not.toHaveProperty('academicYear');
    });

    it('est tenant-clé — sans quoi une ligne d’affectation dérivée autoriserait (G-TENANT)', () => {
      expect(
        teacherOfSectionWhere({ tenantId: TENANT, classSectionId: CS_MINE, teacherProfileId: MY_TP }).tenantId,
      ).toBe(TENANT);
    });
  });
});

// ===========================================================================
// COUCHE 2 — la matrice G-AUTHZ à travers le contrôleur (`AC-11`)
// ===========================================================================

describe('S-E05-14 — roster, matrice G-AUTHZ', () => {
  // ---- Les LAISSER-PASSER légitimes ------------------------------------

  it('super_admin : reçoit la liste', async () => {
    const h = makeHarness();
    const out = await h.controller.roster(CS_MINE, jwt(SUPER_ADMIN));
    expect(out.enrollments).toHaveLength(1);
  });

  it('school_admin : reçoit la liste', async () => {
    const h = makeHarness();
    const out = await h.controller.roster(CS_MINE, jwt(SCHOOL_ADMIN));
    expect(out.enrollments).toHaveLength(1);
  });

  it('le court-circuit privilégié saute les DEUX recherches de propriété', async () => {
    const h = makeHarness();
    await h.controller.roster(CS_MINE, jwt(SCHOOL_ADMIN));
    expect(h.findForUserCalls).toHaveLength(0);
    expect(h.db.of('teachingAssignment')).toHaveLength(0);
  });

  it('professeur AFFECTÉ à cette section : reçoit la liste', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.roster(CS_MINE, jwt(TEACHER));
    expect(out.enrollments).toHaveLength(1);
    expect(h.db.of('teachingAssignment')).toHaveLength(1);
  });

  it('ADR-063 §D1 — l’affectation porte une année RÉVOLUE et le professeur passe quand même', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(CS_MINE, jwt(TEACHER))).resolves.toBeDefined();
    const wall = stmtAt(h.db.of('teachingAssignment'));
    // Le `where` est pinné AVANT la négation : un mur sans clause du tout
    // satisferait `not.toHaveProperty` sans rien prouver.
    expect(wall.where).toBeDefined();
    expect(wall.where).not.toHaveProperty('academicYearId');
  });

  // ---- Les REFUS -------------------------------------------------------

  it('parent : 403 — une liste d’appel est de la donnée de PAIRS (AC-4)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(CS_MINE, jwt(PARENT))).rejects.toThrow(ForbiddenException);
  });

  it('professeur NON affecté à cette section : 403', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(CS_OTHERS, jwt(TEACHER))).rejects.toThrow(ForbiddenException);
  });

  it('appelant SANS profil professeur : 403, et le mur n’est JAMAIS interrogé (fail-closed, C1)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(CS_MINE, jwt(TEACHER))).rejects.toThrow(ForbiddenException);
    expect(h.findForUserCalls).toHaveLength(1);
    // LE point de C1 : un `where` construit avec `teacherProfileId: undefined`
    // aurait rendu la première affectation de la classe et ACCORDÉ l’appelant.
    expect(h.db.of('teachingAssignment')).toHaveLength(0);
  });

  it('jeton SANS realm_access : 403, jamais 500 (FM-6)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(CS_MINE, jwtWithoutRealmAccess)).rejects.toThrow(ForbiddenException);
  });

  it('aucun chemin de refus n’appelle ensureForUser — un refus ne PROVISIONNE rien (PF-265)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(CS_MINE, jwt(PARENT))).rejects.toThrow(ForbiddenException);
    expect(h.ensureForUserCalls).toHaveLength(0);
  });

  it('un appelant refusé ne matérialise AUCUNE donnée d’enfant (AC-15)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(CS_MINE, jwt(PARENT))).rejects.toThrow(ForbiddenException);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  it('un professeur non affecté ne matérialise AUCUNE donnée d’enfant non plus', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(CS_OTHERS, jwt(TEACHER))).rejects.toThrow(ForbiddenException);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  // ---- L'ORDRE DU REFUS (`AC-1`) ---------------------------------------

  it('id INEXISTANT : 404', async () => {
    const h = makeHarness();
    await expect(h.controller.roster(CS_ABSENT, jwt(SCHOOL_ADMIN))).rejects.toThrow(NotFoundException);
  });

  it.each([
    ['parent', PARENT, null as string | null],
    ['professeur', TEACHER, MY_TP],
    ['school_admin', SCHOOL_ADMIN, null as string | null],
    ['super_admin', SUPER_ADMIN, null as string | null],
  ])(
    'classe d’un AUTRE tenant, %s : 404 et JAMAIS 403 — sinon le 403 est un oracle d’existence (AC-1, FM-5)',
    async (_label, roles, tp) => {
      const h = makeHarness({ teacherProfileId: tp });
      await expect(h.controller.roster(CS_FOREIGN, jwt(roles))).rejects.toThrow(NotFoundException);
      // Le 404 vient AVANT le verdict : aucune recherche de propriété n’a eu lieu…
      expect(h.db.of('teachingAssignment')).toHaveLength(0);
      // …et aucune donnée d’enfant n’a été lue.
      expect(h.db.of('enrollment')).toHaveLength(0);
    },
  );

  it('G-TENANT — la ligne d’affectation DÉRIVÉE du tenant étranger n’autorise rien', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    // `ta-drifted` porte NOTRE profil sur `CS_FOREIGN` : seule la clause
    // `tenantId` du mur (et le 404 qui la précède) empêche l’autorisation.
    await expect(h.controller.roster(CS_FOREIGN, jwt(TEACHER))).rejects.toThrow(NotFoundException);
  });
});

// ===========================================================================
// COUCHE 3 — la PROJECTION, assertée sur la REQUÊTE (`AC-15`, `PF-275`)
// ===========================================================================

describe('S-E05-14 — projection (assertions sur la REQUÊTE, pas sur le corps)', () => {
  const payloadQuery = async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await h.controller.roster(CS_MINE, jwt(TEACHER));
    const calls = h.db.of('enrollment');
    expect(calls).toHaveLength(1);
    return { h, call: stmtAt(calls) };
  };

  it('la REQUÊTE de charge utile ne porte JAMAIS le `include: { student: true }` nu', async () => {
    const { call } = await payloadQuery();
    expect(call.include).toBeDefined();
    expect((call.include as Row).student).not.toBe(true);
  });

  it('la REQUÊTE de charge utile porte les QUATRE champs, exactement', async () => {
    const { call } = await payloadQuery();
    const studentSelect = studentSelectOf(call);
    expect(studentSelect).toEqual({ id: true, firstName: true, lastName: true, externalRef: true });
  });

  it.each(FORBIDDEN_STUDENT_COLUMNS)(
    'la REQUÊTE de charge utile ne demande PAS `%s` (assertion clé par clé)',
    async (column) => {
      const { call } = await payloadQuery();
      const studentSelect = studentSelectOf(call);
      expect(studentSelect).not.toHaveProperty(column);
    },
  );

  it('AC-5 — `photoUrl` reste exclu (ADR-062 §D1 : l’avatar enseignant est composé des initiales)', async () => {
    const { call } = await payloadQuery();
    const studentSelect = studentSelectOf(call);
    expect(studentSelect).not.toHaveProperty('photoUrl');
  });

  it('FM-10 — le tri relationnel `student.lastName` ascendant SURVIT au passage au `select`', async () => {
    const { call } = await payloadQuery();
    expect(call.orderBy).toEqual({ student: { lastName: 'asc' } });
  });

  it('G-TENANT — la requête de charge utile reste tenant-clé et filtrée sur `active`', async () => {
    const { call } = await payloadQuery();
    expect(call.where).toEqual({ classSectionId: CS_MINE, status: 'active', tenantId: TENANT });
  });

  /**
   * `PF-280` — la lecture de GARDE est `select`-seulement, et c'est elle qui
   * fournit le `classSection` rendu. Sans `select`, `internalNotes` (texte de
   * direction) et `options` repartaient sur le fil.
   */
  it('AC-10 — la lecture de garde est `select`-seulement : `internalNotes` et `options` ne sont pas demandés', async () => {
    const { h } = await payloadQuery();
    const guard = stmtAt(h.db.of('classSection'));
    expect(guard.verb).toBe('findUnique');
    expect(guard.include).toBeUndefined();
    expect(guard.select).toEqual({ id: true, tenantId: true, name: true, maxStudents: true });
    expect(guard.select).not.toHaveProperty('internalNotes');
    expect(guard.select).not.toHaveProperty('options');
  });

  it('AC-10 — le `classSection` RENDU est exactement { id, name, maxStudents } (pas de `tenantId` sur le fil)', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.roster(CS_MINE, jwt(TEACHER));
    expect(Object.keys(out.classSection).sort()).toEqual(['id', 'maxStudents', 'name']);
    expect(out.classSection).not.toHaveProperty('tenantId');
  });

  it('AC-10 — `capacity` garde sa forme', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.roster(CS_MINE, jwt(TEACHER));
    expect(out.capacity).toEqual({ current: 1, max: 30 });
  });
});

// ===========================================================================
// COUCHE 4 — la validation de paramètre et les métadonnées de garde
// ===========================================================================

describe('S-E05-14 — validation de paramètre et métadonnées (AC-6, AC-11)', () => {
  /**
   * Un appel DIRECT au contrôleur court-circuite la phase PIPE de Nest, donc la
   * seule preuve honnête que « le refus arrive avant toute lecture de base » se
   * fait en deux morceaux : (1) le pipe lui-même refuse l'id malformé, et (2)
   * les métadonnées de route montrent qu'il est bien monté sur CE paramètre. Le
   * test dit lequel des deux il prouve, plutôt que d'en simuler un troisième.
   */
  it('ParseUUIDPipe refuse un id malformé, et AUCUNE instruction Prisma n’a lieu', async () => {
    const h = makeHarness();
    const pipe = new ParseUUIDPipe();
    await expect(
      pipe.transform('pas-un-uuid', { type: 'param', data: 'classSectionId' }),
    ).rejects.toThrow(BadRequestException);
    expect(h.db.statements).toHaveLength(0);
  });

  it('le pipe est monté sur le paramètre `classSectionId` de `roster`', () => {
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA_KEY, EnrollmentsController, 'roster') as
      | Record<string, { data?: unknown; pipes?: unknown[] }>
      | undefined;
    expect(args).toBeDefined();
    const entries = Object.values(args ?? {});
    const param = entries.find((e) => e.data === 'classSectionId');
    expect(param).toBeDefined();
    expect(param?.pipes ?? []).toContain(ParseUUIDPipe);
  });

  it('la permission exigée est INCHANGÉE — cette tranche ne touche pas le catalogue', () => {
    expect(Reflect.getMetadata(PERMISSIONS_META_KEY, EnrollmentsController.prototype.roster)).toEqual([
      'enrollments.read',
    ]);
  });

  it('les gardes de contrôleur sont toujours là', () => {
    const guards = (Reflect.getMetadata('__guards__', EnrollmentsController) ?? []) as unknown[];
    expect(guards.length).toBeGreaterThanOrEqual(2);
    expect(guards.map((g) => (g as { name?: string }).name)).toEqual(
      expect.arrayContaining(['JwtAuthGuard', 'PermissionsGuard']),
    );
  });

  it('DNC-10 — aucune trappe d’échappement dans le contrôleur de propriété', () => {
    const source = String(
      (EnrollmentsController.prototype as unknown as Record<string, unknown>)['assertSectionOwnership'],
    );
    expect(source).not.toMatch(/SKIP_|ALLOW_|BYPASS|NODE_ENV|process\.env/);
  });
});

// ===========================================================================
// COUCHE 5 (SUPPRIMÉE) — `PF-283` EST CLOS, DONC SA CARACTÉRISATION EST PARTIE
//
// Ce fichier portait une COUCHE 5 de tests de CARACTÉRISATION qui ÉPINGLAIENT
// le trou laissé ouvert par `S-E05-14` : `list` (`enrollments.controller.ts:636`) portait la MÊME
// permission `enrollments.read` que `roster`, acceptait le MÊME
// `classSectionId`, n'avait AUCUN mur de propriété, et renvoyait la ligne
// `ClassSection` ENTIÈRE (`internalNotes` compris) au même appelant `parent`.
// Leur en-tête annonçait sa propre péremption : « le jour où `PF-283` est clos
// ils passent au ROUGE, nommément, et doivent être RÉÉCRITS ».
//
// `S-E05-15` (`ADR-065`) clôt `PF-283` sur les DEUX axes. Les deux cas ont donc
// été retirés plutôt que réécrits ici, parce que leur INVERSE existe déjà,
// nommément et plus complètement, dans le fichier qui appartient à ce handler —
// `enrollments-list-abac.spec.ts` :
//
//  • parent + `?classSectionId=<section d'un pair>` → l'intersection est VIDE
//    et la portée ÉLÈVE survit au filtre de l'appelant (« G-AUTHZ, les
//    négatives » : `parent + ?classSectionId=`, `parent + ?studentId=<pair>`) ;
//  • `classSection` est un `select` EXPLICITE dont `internalNotes` et `options`
//    sont absents, prouvé CLÉ PAR CLÉ (« projection `classSection` »).
//
// Rien n'est perdu ; la preuve a simplement rejoint le handler qu'elle décrit.
// Conséquence à ne pas défaire : le talon `studentAccess` de `makeHarness`
// (:301) LÈVE, et son docblock affirme que ce fichier n'atteint JAMAIS
// `scopeForUser`. C'est vrai de `roster`, et ce ne redevient vrai de CE FICHIER
// que parce que les deux appels à `list` qui vivaient ICI ont disparu. Toute
// réintroduction d'un appel à `list` ici doit d'abord traiter ce talon.
// ===========================================================================
