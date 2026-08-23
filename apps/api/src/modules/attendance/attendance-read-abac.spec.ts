import 'reflect-metadata';

import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';

import {
  AttendanceController,
  assertEstablishmentOverviewReadable,
  assertSessionReadable,
  assertStudentAttendanceReadable,
  isPrivilegedAttendanceCaller,
  teacherOfStudentAssignmentWhere,
  teacherOfStudentWhere,
} from './attendance.controller';

/**
 * S-E05-5 / PF-07 / ADR-061 — les QUATRE handlers de LECTURE de
 * `attendance.controller.ts` gagnent l'ABAC que leurs frères d'ÉCRITURE
 * appliquaient déjà.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI N'A PAS ÉTÉ EXÉCUTÉ — ÉCRIT PLUTÔT QU'AFFIRMÉ                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Cet agent n'exécute NI jest, NI `pnpm typecheck`, NI aucun build (budget CPU :
 * seul le test-architect lance la chaîne). Les preuves de ce fichier n'ont donc
 * JAMAIS ÉTÉ EXÉCUTÉES par leur auteur. Ce qui a réellement tourné dans cette
 * tranche est la LECTURE du schéma (`Enrollment.academicYear`,
 * `TeachingAssignment.academicYearId`, `@@unique([teacherProfileId,
 * classSectionId, subjectId])`) et le recensement des appelants.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX PRISMA EST DÉLIBÉRÉMENT NON FILTRANT — c'est la moitié qui prouve │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `makeDb()` n'applique AUCUN filtre tenant ambiant : il honore EXACTEMENT le
 * `where` SCALAIRE qu'on lui passe. C'est la simulation du chemin
 * `degraded_no_app_url` — la connexion du PROPRIÉTAIRE, où le propriétaire
 * échappe à ses propres policies (`ADR-032 §D5`), c'est-à-dire TOUS les
 * déploiements d'aujourd'hui. Un faux qui filtrerait par tenant de lui-même
 * rendrait ces tests verts sans que le code ait la moindre clause `tenantId`,
 * c'est-à-dire prouverait le faux (`AC-8`).
 *
 * Les membres RELATIONNELS d'un `where` (`academicYear: { … }`,
 * `classSection: { … }`) sont ENREGISTRÉS et considérés satisfaits : ce fichier
 * prouve l'ORDRE, la PORTÉE et le REFUS, pas le moteur de requêtes de Prisma.
 * C'est précisément pourquoi le mur d'enseignement est en DEUX instructions —
 * la seconde (`teachingAssignment.findFirst`) est entièrement SCALAIRE, donc le
 * faux la filtre réellement et les cellules négatives d'`AC-3` atterrissent
 * dessus.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ME = '33333333-3333-3333-3333-333333333333';

const MY_TP = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_TP = 'aaaaaaaa-0000-0000-0000-00000000000b';

/** Séance du tenant, appartenant à l'appelant. */
const MY_SESSION = 'cccccccc-0000-0000-0000-000000000001';
/** Séance du tenant, appartenant à un AUTRE professeur. */
const OTHERS_SESSION = 'cccccccc-0000-0000-0000-000000000002';
/** Séance d'un AUTRE tenant — doit rendre 404, jamais 403 (`AC-10`). */
const FOREIGN_SESSION = 'cccccccc-0000-0000-0000-000000000003';

const MY_STUDENT = 'dddddddd-0000-0000-0000-000000000001';
const OTHER_STUDENT = 'dddddddd-0000-0000-0000-000000000002';
const FOREIGN_STUDENT = 'dddddddd-0000-0000-0000-000000000003';

const CS_MINE = 'eeeeeeee-0000-0000-0000-000000000001';
const CS_OTHER = 'eeeeeeee-0000-0000-0000-000000000002';
const AY_ACTIVE = 'ffffffff-0000-0000-0000-000000000001';
/** Une année RÉVOLUE : l'affectation y survit (pas d'`academicYearId` dans la clé). */
const AY_LAPSED = 'ffffffff-0000-0000-0000-000000000002';

type Row = Record<string, unknown>;

const jwt = (roles: string[]): KeycloakJwtPayload =>
  ({ sub: ME, realm_access: { roles } }) as unknown as KeycloakJwtPayload;

/** Une ligne `Student` COMPLÈTE — c'est la charge que `PF-07` exposait. */
const studentRow = (id: string, tenantId: string): Row => ({
  id,
  tenantId,
  firstName: 'Prénom',
  lastName: 'Nom',
  medicalNotes: 'ALLERGIE ARACHIDE',
  address: { street: '1 rue des Écoles' },
  notes: 'note interne',
  customFields: {},
});

// ---------------------------------------------------------------------------
// Le double Prisma
// ---------------------------------------------------------------------------

interface Statement {
  model: string;
  verb: string;
  where?: Row;
  select?: Row;
  include?: Row;
}

/** Une ligne `AttendanceRecord` avec les relations que `overview` PROJETTE. */
const recordShape = (id: string, studentId: string, status: string): Row => ({
  id,
  tenantId: TENANT,
  studentId,
  status,
  justification: null,
  recordedAt: new Date('2026-08-23T09:00:00.000Z'),
  student: { id: studentId, firstName: 'Prénom', lastName: 'Nom' },
  classSession: {
    id: MY_SESSION,
    date: new Date('2026-08-23T08:00:00.000Z'),
    teachingAssignment: {
      classSection: { id: CS_MINE, name: '6ème B' },
      subject: { name: 'Mathématiques' },
    },
  },
});

function makeDb(seed?: Partial<Record<string, Row[]>>) {
  const sessionShape = (id: string, tenantId: string, teacherProfileId: string): Row => ({
    id,
    tenantId,
    teacherProfileId,
    date: new Date('2026-08-23T08:00:00.000Z'),
    startTime: '08:00',
    endTime: '09:00',
    topic: 'Fractions',
    cancelled: false,
    attendanceRecords: [],
    teachingAssignment: {
      classSection: {
        enrollments: [
          { id: 'enr-' + id, studentId: MY_STUDENT, student: studentRow(MY_STUDENT, tenantId) },
        ],
      },
    },
  });

  const tables: Record<string, Row[]> = {
    classSession: [
      sessionShape(MY_SESSION, TENANT, MY_TP),
      sessionShape(OTHERS_SESSION, TENANT, OTHER_TP),
      sessionShape(FOREIGN_SESSION, OTHER_TENANT, OTHER_TP),
    ],
    student: [
      studentRow(MY_STUDENT, TENANT),
      studentRow(OTHER_STUDENT, TENANT),
      studentRow(FOREIGN_STUDENT, OTHER_TENANT),
    ],
    guardianship: [
      { id: 'g1', tenantId: TENANT, studentId: MY_STUDENT, status: 'active' },
    ],
    enrollment: [
      {
        id: 'e-mine',
        tenantId: TENANT,
        studentId: MY_STUDENT,
        status: 'active',
        classSectionId: CS_MINE,
        academicYearId: AY_ACTIVE,
        enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
      },
      {
        id: 'e-other',
        tenantId: TENANT,
        studentId: OTHER_STUDENT,
        status: 'active',
        classSectionId: CS_OTHER,
        academicYearId: AY_ACTIVE,
        enrolledAt: new Date('2026-09-01T00:00:00.000Z'),
      },
    ],
    teachingAssignment: [
      { id: 'ta-mine', tenantId: TENANT, teacherProfileId: MY_TP, classSectionId: CS_MINE, academicYearId: AY_ACTIVE },
      { id: 'ta-other', tenantId: TENANT, teacherProfileId: OTHER_TP, classSectionId: CS_OTHER, academicYearId: AY_ACTIVE },
    ],
    attendanceRecord: [
      recordShape('ar1', MY_STUDENT, 'present'),
      recordShape('ar2', OTHER_STUDENT, 'absent'),
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

  const model = (name: string) => ({
    findFirst: async ({ where, select, include }: { where?: Row; select?: Row; include?: Row } = {}) => {
      statements.push({ model: name, verb: 'findFirst', where, select, include });
      return rowsOf(name).find((row) => matches(row, where)) ?? null;
    },
    /** `findUnique` par CLÉ PRIMAIRE, comme en production : il ignore le tenant — c'est précisément pourquoi la garde applicative reste. */
    findUnique: async ({ where, select, include }: { where?: Row; select?: Row; include?: Row } = {}) => {
      statements.push({ model: name, verb: 'findUnique', where, select, include });
      return rowsOf(name).find((row) => row.id === where?.id) ?? null;
    },
    findMany: async ({ where, select, include }: { where?: Row; select?: Row; include?: Row } = {}) => {
      statements.push({ model: name, verb: 'findMany', where, select, include });
      return rowsOf(name).filter((row) => matches(row, where));
    },
  });

  return {
    tables,
    statements,
    of: (name: string) => statements.filter((s) => s.model === name),
    client: {
      classSession: model('classSession'),
      student: model('student'),
      guardianship: model('guardianship'),
      enrollment: model('enrollment'),
      teachingAssignment: model('teachingAssignment'),
      attendanceRecord: model('attendanceRecord'),
    } as unknown as PrismaService,
  };
}

function makeHarness(options: {
  teacherProfileId?: string | null;
  db?: ReturnType<typeof makeDb>;
}) {
  const db = options.db ?? makeDb();
  const ensureForUserCalls: string[] = [];
  const findForUserCalls: string[] = [];
  const ensureUserCalls: string[] = [];

  const users = {
    ensureUser: async () => {
      ensureUserCalls.push('ensureUser');
      return { id: ME, tenantId: TENANT };
    },
  } as unknown as UserSyncService;

  const teachers = {
    findForUser: async () => {
      findForUserCalls.push('findForUser');
      const id = options.teacherProfileId === undefined ? MY_TP : options.teacherProfileId;
      return id === null ? null : { id };
    },
    /** Présent UNIQUEMENT pour prouver qu'aucun chemin nouveau ne l'appelle (`AC-6`). */
    ensureForUser: async () => {
      ensureForUserCalls.push('ensureForUser');
      return { id: MY_TP, tenantId: TENANT, schoolId: 'sc', userProfileId: ME, active: true };
    },
  } as unknown as TeacherProfileService;

  const controller = new AttendanceController(db.client, users, teachers);
  return { controller, db, ensureForUserCalls, findForUserCalls, ensureUserCalls };
}

const TEACHER = ['teacher'];
const PARENT = ['parent'];
const ADMIN = ['school_admin'];

const SESSION_REFUSAL = 'Vous ne pouvez consulter que les séances de vos affectations.';
const OVERVIEW_REFUSAL =
  "La vue d'ensemble de l'assiduité est réservée à l'administration de l'établissement.";

// ===========================================================================
// COUCHE 1 — les fonctions PURES, testées directement (`AC-7`)
// ===========================================================================

describe('S-E05-5 — couche pure', () => {
  describe('isPrivilegedAttendanceCaller', () => {
    it.each([
      [['super_admin'], true],
      [['school_admin'], true],
      [['teacher'], false],
      [['parent'], false],
      [['student'], false],
      [[], false],
      [['teacher', 'school_admin'], true],
    ] as [string[], boolean][])('%j → %s', (roles, expected) => {
      expect(isPrivilegedAttendanceCaller(roles)).toBe(expected);
    });

    it('ne prend AUCUN second paramètre — un contrôle qu’on peut éteindre n’est pas un contrôle (DNC-10)', () => {
      expect(isPrivilegedAttendanceCaller).toHaveLength(1);
    });
  });

  describe('assertSessionReadable', () => {
    it('privilégié : passe, même sur la séance d’un autre', () => {
      expect(() =>
        assertSessionReadable({ isPrivileged: true, teacherProfileId: null }, OTHER_TP),
      ).not.toThrow();
    });

    it('professeur propriétaire : passe', () => {
      expect(() =>
        assertSessionReadable({ isPrivileged: false, teacherProfileId: MY_TP }, MY_TP),
      ).not.toThrow();
    });

    it('professeur NON propriétaire : 403, message exact', () => {
      expect(() =>
        assertSessionReadable({ isPrivileged: false, teacherProfileId: MY_TP }, OTHER_TP),
      ).toThrow(ForbiddenException);
      try {
        assertSessionReadable({ isPrivileged: false, teacherProfileId: MY_TP }, OTHER_TP);
        throw new Error('aurait dû lever');
      } catch (err) {
        expect((err as ForbiddenException).message).toBe(SESSION_REFUSAL);
      }
    });

    it('AUCUN profil professeur (null) : REFUSE — pas de fail-open', () => {
      expect(() =>
        assertSessionReadable({ isPrivileged: false, teacherProfileId: null }, MY_TP),
      ).toThrow(ForbiddenException);
    });

    it('le message ne réutilise PAS la chaîne d’ÉCRITURE d’assertOwnership', () => {
      expect(SESSION_REFUSAL).not.toContain('ouvrir');
    });

    it('le message ne nomme ni tenant, ni table, ni id (ADR-048 §D9)', () => {
      expect(SESSION_REFUSAL).not.toMatch(/tenant|class_session|prisma|[0-9a-f]{8}-/i);
    });
  });

  describe('assertEstablishmentOverviewReadable', () => {
    it('privilégié : passe', () => {
      expect(() => assertEstablishmentOverviewReadable({ isPrivileged: true })).not.toThrow();
    });
    it('non privilégié : 403, message exact', () => {
      try {
        assertEstablishmentOverviewReadable({ isPrivileged: false });
        throw new Error('aurait dû lever');
      } catch (err) {
        expect(err).toBeInstanceOf(ForbiddenException);
        expect((err as ForbiddenException).message).toBe(OVERVIEW_REFUSAL);
      }
    });
  });

  describe('assertStudentAttendanceReadable — les HUIT triplets', () => {
    const triples: [boolean, boolean, boolean, boolean][] = [
      // isPrivileged, isGuardian, teachesStudent, autorisé
      [false, false, false, false],
      [false, false, true, true],
      [false, true, false, true],
      [false, true, true, true],
      [true, false, false, true],
      [true, false, true, true],
      [true, true, false, true],
      [true, true, true, true],
    ];

    it.each(triples)(
      'privilégié=%s tuteur=%s enseigne=%s → autorisé=%s',
      (isPrivileged, isGuardian, teachesStudent, allowed) => {
        const call = () =>
          assertStudentAttendanceReadable({ isPrivileged, isGuardian, teachesStudent });
        if (allowed) expect(call).not.toThrow();
        else expect(call).toThrow(ForbiddenException);
      },
    );

    it('le refus est NU — aucun message (byte-identique au refus parent pré-existant, AC-4)', () => {
      try {
        assertStudentAttendanceReadable({
          isPrivileged: false,
          isGuardian: false,
          teachesStudent: false,
        });
        throw new Error('aurait dû lever');
      } catch (err) {
        const naked = new ForbiddenException();
        expect((err as ForbiddenException).message).toBe(naked.message);
        expect((err as ForbiddenException).getResponse()).toEqual(naked.getResponse());
      }
    });
  });

  // -------------------------------------------------------------------------
  // G-TENANT : la clause est dans le CODE, pas dans la fixture
  // -------------------------------------------------------------------------
  describe('teacherOfStudentWhere / teacherOfStudentAssignmentWhere', () => {
    const where = teacherOfStudentWhere({
      tenantId: TENANT,
      studentId: MY_STUDENT,
      teacherProfileId: MY_TP,
    });

    it('porte le tenantId de l’inscription ET celui de l’affectation imbriquée', () => {
      expect(where.tenantId).toBe(TENANT);
      expect(
        (where.classSection as { teachingAssignments: { some: { tenantId: string } } })
          .teachingAssignments.some.tenantId,
      ).toBe(TENANT);
    });

    it('exige une inscription ACTIVE dans l’année ACTIVE (ADR-061 §D1)', () => {
      expect(where.status).toBe('active');
      expect(where.academicYear).toEqual({ status: 'active' });
    });

    it('épingle l’élève et le professeur', () => {
      expect(where.studentId).toBe(MY_STUDENT);
      expect(
        (where.classSection as { teachingAssignments: { some: { teacherProfileId: string } } })
          .teachingAssignments.some.teacherProfileId,
      ).toBe(MY_TP);
    });

    it('le second where ferme le couple (classSectionId, academicYearId) — la faille du professeur d’une année révolue', () => {
      expect(
        teacherOfStudentAssignmentWhere({
          tenantId: TENANT,
          classSectionId: CS_MINE,
          academicYearId: AY_ACTIVE,
          teacherProfileId: MY_TP,
        }),
      ).toEqual({
        tenantId: TENANT,
        classSectionId: CS_MINE,
        academicYearId: AY_ACTIVE,
        teacherProfileId: MY_TP,
      });
    });
  });
});

// ===========================================================================
// COUCHE 2 — les handlers, pilotés à travers le faux NON FILTRANT (`AC-8`)
// ===========================================================================

describe('S-E05-5 — sessionDetail (AC-1)', () => {
  it('professeur PROPRIÉTAIRE : 200', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.sessionDetail(MY_SESSION, jwt(TEACHER));
    expect((out as unknown as Row).id).toBe(MY_SESSION);
  });

  it('school_admin : 200, et AUCUNE résolution de profil professeur n’est demandée', async () => {
    const h = makeHarness({});
    const out = await h.controller.sessionDetail(OTHERS_SESSION, jwt(ADMIN));
    expect((out as unknown as Row).id).toBe(OTHERS_SESSION);
    expect(h.findForUserCalls).toHaveLength(0);
  });

  it('professeur NON propriétaire : 403 avec le message partagé', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.sessionDetail(OTHERS_SESSION, jwt(TEACHER))).rejects.toThrow(
      SESSION_REFUSAL,
    );
  });

  it('parent : 403 — le sur-octroi de catalogue (PF-264) devient INERTE ici', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.sessionDetail(MY_SESSION, jwt(PARENT))).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('appelant SANS profil professeur : 403, pas de fail-open', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.sessionDetail(MY_SESSION, jwt(TEACHER))).rejects.toThrow(
      ForbiddenException,
    );
  });

  // ---- AC-1 : la charge n'est JAMAIS émise pour un appelant refusé ---------
  it('sur un refus, la requête profonde n’a JAMAIS été émise', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.sessionDetail(OTHERS_SESSION, jwt(TEACHER))).rejects.toThrow();
    const probes = h.db.of('classSession');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.select).toEqual({ id: true, tenantId: true, teacherProfileId: true });
    expect(probes[0]?.include).toBeUndefined();
    expect(h.db.statements.some((s) => s.include !== undefined)).toBe(false);
  });

  it('sur un succès, la garde SCALAIRE précède la charge PROFONDE, dans cet ordre', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await h.controller.sessionDetail(MY_SESSION, jwt(TEACHER));
    const probes = h.db.of('classSession');
    expect(probes).toHaveLength(2);
    expect(probes[0]?.select).toEqual({ id: true, tenantId: true, teacherProfileId: true });
    expect(probes[1]?.include).toBeDefined();
  });

  // ---- AC-10 : 404 AVANT 403, jamais l'inverse ----------------------------
  it('séance d’un AUTRE tenant : 404 nu, jamais 403 (pas d’oracle d’existence)', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.sessionDetail(FOREIGN_SESSION, jwt(TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('séance INEXISTANTE : le même 404', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.sessionDetail('no-such-id', jwt(TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('AC-6 — aucun chemin de lecture n’appelle ensureForUser', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await h.controller.sessionDetail(MY_SESSION, jwt(TEACHER));
    await expect(h.controller.sessionDetail(OTHERS_SESSION, jwt(TEACHER))).rejects.toThrow();
    expect(h.ensureForUserCalls).toHaveLength(0);
    expect(h.findForUserCalls.length).toBeGreaterThan(0);
  });
});

describe('S-E05-5 — roster (AC-2)', () => {
  it('professeur PROPRIÉTAIRE : 200 avec la liste d’appel', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.roster(MY_SESSION, jwt(TEACHER));
    expect(out.session.id).toBe(MY_SESSION);
    expect(out.roster).toHaveLength(1);
  });

  it('school_admin : 200', async () => {
    const h = makeHarness({});
    const out = await h.controller.roster(OTHERS_SESSION, jwt(ADMIN));
    expect(out.session.id).toBe(OTHERS_SESSION);
    expect(h.findForUserCalls).toHaveLength(0);
  });

  it('professeur NON propriétaire : 403, MÊME message que sessionDetail (AC-2)', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(OTHERS_SESSION, jwt(TEACHER))).rejects.toThrow(
      SESSION_REFUSAL,
    );
  });

  it('parent : 403 — plus de ligne Student complète d’une autre famille', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(MY_SESSION, jwt(PARENT))).rejects.toThrow(ForbiddenException);
  });

  it('appelant SANS profil professeur : 403', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(h.controller.roster(MY_SESSION, jwt(TEACHER))).rejects.toThrow(ForbiddenException);
  });

  it('sur un refus, la requête profonde n’a JAMAIS été émise', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(OTHERS_SESSION, jwt(TEACHER))).rejects.toThrow();
    const probes = h.db.of('classSession');
    expect(probes).toHaveLength(1);
    expect(probes[0]?.include).toBeUndefined();
  });

  it('séance d’un AUTRE tenant : 404, jamais 403 (AC-10)', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.roster(FOREIGN_SESSION, jwt(TEACHER))).rejects.toThrow(
      NotFoundException,
    );
  });

  it('AC-6 — ensureForUser jamais appelé', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await h.controller.roster(MY_SESSION, jwt(TEACHER));
    expect(h.ensureForUserCalls).toHaveLength(0);
  });
});

describe('S-E05-5 — studentAttendance (AC-3 / AC-4)', () => {
  // ---- AC-4 : la branche PARENT, EXERCÉE, pas inspectée --------------------
  it('parent TUTEUR : 200, et le where de tutelle est INCHANGÉ à l’octet', async () => {
    const h = makeHarness({});
    const out = await h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(PARENT));
    expect(out.summary.total).toBe(1);
    const g = h.db.of('guardianship');
    expect(g).toHaveLength(1);
    expect(g[0]?.where).toEqual({
      tenantId: TENANT,
      studentId: MY_STUDENT,
      status: 'active',
      guardian: { userProfileId: ME },
    });
  });

  it('parent NON tuteur : ForbiddenException NUE, UNE requête de tutelle, ZÉRO requête professeur', async () => {
    const h = makeHarness({});
    let thrown: unknown;
    try {
      await h.controller.studentAttendance(OTHER_STUDENT, undefined, undefined, jwt(PARENT));
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe(new ForbiddenException().message);
    expect(h.db.of('guardianship')).toHaveLength(1);
    expect(h.db.of('enrollment')).toHaveLength(0);
    expect(h.db.of('teachingAssignment')).toHaveLength(0);
    expect(h.findForUserCalls).toHaveLength(0);
  });

  it('parent + teacher (double rôle) : la branche PARENT gagne — refus NU, PF-266', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    let thrown: unknown;
    try {
      await h.controller.studentAttendance(
        OTHER_STUDENT,
        undefined,
        undefined,
        jwt(['parent', 'teacher']),
      );
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(ForbiddenException);
    expect((thrown as ForbiddenException).message).toBe(new ForbiddenException().message);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  it('school_admin + parent : la branche PARENT gagne aussi — l’accès n’est PAS élargi par cette tranche', async () => {
    const h = makeHarness({});
    await expect(
      h.controller.studentAttendance(
        OTHER_STUDENT,
        undefined,
        undefined,
        jwt(['parent', 'school_admin']),
      ),
    ).rejects.toThrow(ForbiddenException);
  });

  // ---- AC-3 : la branche PROFESSEUR ---------------------------------------
  it('professeur de l’élève : 200', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    const out = await h.controller.studentAttendance(
      MY_STUDENT,
      undefined,
      undefined,
      jwt(TEACHER),
    );
    expect(out.summary.total).toBe(1);
  });

  it('professeur d’une AUTRE classe : 403', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(
      h.controller.studentAttendance(OTHER_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('inscription RETIRÉE : 403 — le status active est dans le where', async () => {
    const db = makeDb();
    const enrolment = db.tables.enrollment?.find((r) => r.id === 'e-mine');
    if (enrolment) enrolment.status = 'withdrawn';
    const h = makeHarness({ teacherProfileId: MY_TP, db });
    await expect(
      h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('affectation d’une année RÉVOLUE : 403 — le couple (classSection, academicYear) est fermé (ADR-061 §D1)', async () => {
    const db = makeDb();
    const assignment = db.tables.teachingAssignment?.find((r) => r.id === 'ta-mine');
    if (assignment) assignment.academicYearId = AY_LAPSED;
    const h = makeHarness({ teacherProfileId: MY_TP, db });
    await expect(
      h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('affectation d’un AUTRE tenant : 403 — le tenantId de la sonde travaille', async () => {
    const db = makeDb();
    const assignment = db.tables.teachingAssignment?.find((r) => r.id === 'ta-mine');
    if (assignment) assignment.tenantId = OTHER_TENANT;
    const h = makeHarness({ teacherProfileId: MY_TP, db });
    await expect(
      h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(ForbiddenException);
  });

  it('professeur SANS profil : 403, et rien n’est provisionné (AC-6)', async () => {
    const h = makeHarness({ teacherProfileId: null });
    await expect(
      h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(ForbiddenException);
    expect(h.ensureForUserCalls).toHaveLength(0);
    expect(h.db.of('enrollment')).toHaveLength(0);
  });

  it('school_admin : 200 sans aucune sonde d’enseignement', async () => {
    const h = makeHarness({});
    const out = await h.controller.studentAttendance(
      OTHER_STUDENT,
      undefined,
      undefined,
      jwt(ADMIN),
    );
    expect(out.summary.total).toBe(1);
    expect(h.db.of('enrollment')).toHaveLength(0);
    expect(h.findForUserCalls).toHaveLength(0);
  });

  it('G-TENANT — le where réellement ENREGISTRÉ de l’inscription porte tenantId', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await h.controller.studentAttendance(MY_STUDENT, undefined, undefined, jwt(TEACHER));
    const probe = h.db.of('enrollment')[0];
    expect(probe?.where?.tenantId).toBe(TENANT);
    const assignmentProbe = h.db.of('teachingAssignment')[0];
    expect(assignmentProbe?.where?.tenantId).toBe(TENANT);
  });

  it('élève d’un AUTRE tenant : 404, jamais 403 (AC-10)', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(
      h.controller.studentAttendance(FOREIGN_STUDENT, undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(NotFoundException);
  });

  it('élève INEXISTANT : le même 404', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(
      h.controller.studentAttendance('no-such-student', undefined, undefined, jwt(TEACHER)),
    ).rejects.toThrow(NotFoundException);
  });
});

describe('S-E05-5 — overview (AC-5)', () => {
  it('school_admin : 200, les chiffres sont inchangés (G-TRUTH)', async () => {
    const h = makeHarness({});
    const out = await h.controller.overview(jwt(ADMIN));
    expect(out.records).toHaveLength(2);
    expect(out.kpis.present).toBe(1);
    expect(out.kpis.absent).toBe(1);
    expect(out.kpis.unjustifiedAbsences).toBe(1);
  });

  it('teacher : 403', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.overview(jwt(TEACHER))).rejects.toThrow(OVERVIEW_REFUSAL);
  });

  it('parent : 403 — la vue établissement n’est plus lisible par une famille', async () => {
    const h = makeHarness({});
    await expect(h.controller.overview(jwt(PARENT))).rejects.toThrow(ForbiddenException);
  });

  it('le refus précède ensureUser — aucune adoption d’identité sur un chemin de refus', async () => {
    const h = makeHarness({ teacherProfileId: MY_TP });
    await expect(h.controller.overview(jwt(TEACHER))).rejects.toThrow();
    expect(h.ensureUserCalls).toHaveLength(0);
    expect(h.db.statements).toHaveLength(0);
  });

  it('G-TENANT — les deux lectures de l’admin portent toujours tenantId', async () => {
    const h = makeHarness({});
    await h.controller.overview(jwt(ADMIN));
    for (const s of h.db.of('attendanceRecord')) {
      expect(s.where?.tenantId).toBe(TENANT);
    }
  });
});
