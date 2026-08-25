import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { PrismaService } from '../../shared/prisma/prisma.service';
import {
  APP_ROLE_REQUIRED_PRIVILEGES,
  currentTenantScopeFrame,
  privilegeKey,
  runInTenantScope,
} from '../../shared/prisma/tenant-scope';
import type { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { StudentAccessService } from '../students/student-access.service';
import type { TeacherProfileService } from '../teaching/teacher-profile.service';

import { assertOwnedByTeacher, LessonsController } from './lessons.controller';

/**
 * S-E01-1e — le module `lessons` entre dans la portée tenant (ADR-048), sa clé
 * étrangère de portée est vérifiée pour la PROPRIÉTÉ (ADR-049 / PF-217), et
 * `assertOwnership` se scinde en résolution DEHORS + comparaison PURE DEDANS
 * (ADR-051 §D1).
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ CE QUI N'A PAS ÉTÉ EXÉCUTÉ — ÉCRIT PLUTÔT QU'AFFIRMÉ                     │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * Cet agent n'exécute NI jest, NI typecheck, NI `scripts/tenant-scope-check.js`
 * (budget CPU : seul le test-architect lance la chaîne). Les preuves de ce
 * fichier n'ont donc JAMAIS ÉTÉ EXÉCUTÉES par l'auteur. Ce qui a réellement
 * tourné dans cette tranche est l'ATTRIBUTION (les matchers purs livrés de
 * `scripts/tenant-adversarial-check.js`, re-dérivée avant et après le diff) et
 * la DÉMONSTRATION DU CLIQUET PF-199 sur une source réellement mutée puis
 * restaurée. Les contrôles AC-3/4/5/6 contre un vrai PostgreSQL en `app_user`
 * appartiennent à `scripts/tenant-adversarial-check.js` et à l'orchestrateur.
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ LE FAUX `tx` EST DÉLIBÉRÉMENT NON FILTRANT — c'est la moitié qui prouve  │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `makeDb()` n'applique AUCUN filtre tenant ambiant : il honore EXACTEMENT le
 * `where` qu'on lui passe. C'est la simulation du chemin `degraded_no_app_url`
 * — la connexion du PROPRIÉTAIRE, où le propriétaire échappe à ses propres
 * policies (ADR-032 §D5) et où RLS ne filtre RIEN, c'est-à-dire TOUS les
 * déploiements d'aujourd'hui. Un faux qui filtrerait par tenant de lui-même
 * rendrait ces tests verts sans que le code ait la moindre clause `tenantId`,
 * c'est-à-dire prouverait le faux.
 */

const TENANT = '11111111-1111-1111-1111-111111111111';
const OTHER_TENANT = '22222222-2222-2222-2222-222222222222';
const ME = '33333333-3333-3333-3333-333333333333';

const MY_TP = 'aaaaaaaa-0000-0000-0000-00000000000a';
const OTHER_TP = 'aaaaaaaa-0000-0000-0000-00000000000b';

const OWN_ASSIGNMENT = 'bbbbbbbb-0000-0000-0000-000000000001';
const FOREIGN_ASSIGNMENT = 'bbbbbbbb-0000-0000-0000-000000000002';
const OTHERS_ASSIGNMENT = 'bbbbbbbb-0000-0000-0000-000000000003';

const OWN_SESSION = 'cccccccc-0000-0000-0000-000000000001';
const FOREIGN_SESSION = 'cccccccc-0000-0000-0000-000000000002';

const OWN_LESSON = 'dddddddd-0000-0000-0000-000000000001';
const FOREIGN_LESSON = 'dddddddd-0000-0000-0000-000000000002';
const OTHERS_LESSON = 'dddddddd-0000-0000-0000-000000000003';

type Row = Record<string, unknown>;

const jwt = (roles: string[]): KeycloakJwtPayload =>
  ({ sub: ME, realm_access: { roles } }) as unknown as KeycloakJwtPayload;

/**
 * Un faux client de transaction : il honore le `where` SCALAIRE qu'on lui passe
 * et rien d'autre. Les conditions relationnelles (`guardian: { … }`) sont
 * ENREGISTRÉES et considérées satisfaites — ce fichier prouve l'ORDRE, la
 * PORTÉE et le REFUS, pas le moteur de requêtes de Prisma.
 */
function makeDb(seed?: Partial<Record<string, Row[]>>) {
  const tables: Record<string, Row[]> = {
    lessonEntry: [
      { id: OWN_LESSON, tenantId: TENANT, teacherProfileId: MY_TP, teachingAssignmentId: OWN_ASSIGNMENT, status: 'published', title: 't' },
      { id: FOREIGN_LESSON, tenantId: OTHER_TENANT, teacherProfileId: OTHER_TP, teachingAssignmentId: FOREIGN_ASSIGNMENT, status: 'published', title: 't' },
      { id: OTHERS_LESSON, tenantId: TENANT, teacherProfileId: OTHER_TP, teachingAssignmentId: OTHERS_ASSIGNMENT, status: 'draft', title: 't' },
    ],
    teachingAssignment: [
      { id: OWN_ASSIGNMENT, tenantId: TENANT, teacherProfileId: MY_TP },
      { id: FOREIGN_ASSIGNMENT, tenantId: OTHER_TENANT, teacherProfileId: OTHER_TP },
      { id: OTHERS_ASSIGNMENT, tenantId: TENANT, teacherProfileId: OTHER_TP },
    ],
    classSession: [
      { id: OWN_SESSION, tenantId: TENANT },
      { id: FOREIGN_SESSION, tenantId: OTHER_TENANT },
    ],
    guardianship: [{ id: 'g1', tenantId: TENANT, studentId: 's1', status: 'active' }],
    enrollment: [{ id: 'e1', tenantId: TENANT, studentId: 's1', classSectionId: 'cs1' }],
    ...seed,
  };

  /** Journal de TOUTES les instructions émises sur ce client, dans l'ordre. */
  const statements: { model: string; verb: string; where?: Row }[] = [];
  const scopeAtStatement: (string | undefined)[] = [];

  const matches = (row: Row, where: Row | undefined): boolean =>
    Object.entries(where ?? {}).every(([key, value]) =>
      value !== null && typeof value === 'object' ? true : row[key] === value,
    );

  /**
   * `tables` est indexé par nom de modèle, et `noUncheckedIndexedAccess` a
   * raison de rendre `Row[] | undefined`. On LÈVE plutôt que de poser un `!` :
   * dans un double, un modèle non déclaré est un défaut DU TEST, et le silencer
   * produirait un `TypeError` plus loin, à l'intérieur d'une assertion qui n'a
   * rien à voir avec la cause.
   */
  const rowsOf = (name: string): Row[] => {
    const rows = tables[name];
    if (rows === undefined) {
      throw new Error(`double Prisma : le modèle « ${name} » n’est pas déclaré dans ce harnais`);
    }
    return rows;
  };

  const model = (name: string) => ({
    findFirst: async ({ where }: { where?: Row } = {}) => {
      statements.push({ model: name, verb: 'findFirst', where });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      return rowsOf(name).find((row) => matches(row, where)) ?? null;
    },
    findUnique: async ({ where }: { where?: Row } = {}) => {
      statements.push({ model: name, verb: 'findUnique', where });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      // `findUnique` par CLÉ PRIMAIRE, comme en production : il ne connaît pas
      // le tenant, ce qui est précisément pourquoi la garde applicative reste.
      return rowsOf(name).find((row) => row.id === where?.id) ?? null;
    },
    findMany: async ({ where }: { where?: Row } = {}) => {
      statements.push({ model: name, verb: 'findMany', where });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      return rowsOf(name).filter((row) => matches(row, where));
    },
    create: async ({ data }: { data: Row }) => {
      statements.push({ model: name, verb: 'create' });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      const row = { id: 'new-' + name, ...data };
      rowsOf(name).push(row);
      return row;
    },
    update: async ({ where, data }: { where: Row; data: Row }) => {
      statements.push({ model: name, verb: 'update', where });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      const row = rowsOf(name).find((r) => r.id === where.id);
      if (!row) throw new Error('P2025');
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }: { where: Row }) => {
      statements.push({ model: name, verb: 'delete', where });
      scopeAtStatement.push(currentTenantScopeFrame()?.tenantId);
      const index = rowsOf(name).findIndex((r) => r.id === where.id);
      if (index < 0) throw new Error('P2025');
      rowsOf(name).splice(index, 1);
      return { id: where.id };
    },
  });

  return {
    tables,
    statements,
    scopeAtStatement,
    /** Les sondes de propriété PF-217 réellement émises. */
    sessionProbes: () => statements.filter((s) => s.model === 'classSession'),
    tx: {
      lessonEntry: model('lessonEntry'),
      teachingAssignment: model('teachingAssignment'),
      classSession: model('classSession'),
      guardianship: model('guardianship'),
      enrollment: model('enrollment'),
    },
  };
}

/**
 * Le double de `TenantScopeService` installe le VRAI cadre `AsyncLocalStorage`
 * (`runInTenantScope`, importé de la couture) plutôt qu'un booléen : c'est ce
 * qui rend l'assertion d'ORDRE d'AC-2 mesurable au lieu de déclarative.
 */
function makeHarness(options: { roles: string[]; teacherProfileId?: string | null; db?: ReturnType<typeof makeDb> }) {
  const db = options.db ?? makeDb();
  /** Le tenant vu à l'ENTRÉE de chaque callback de portée. */
  const scopeAtCallbackEntry: (string | undefined)[] = [];
  /** Le tenant vu par CHAQUE résolveur d'identité au moment de son appel. */
  const scopeAtIdentityCall: { who: string; tenant: string | undefined }[] = [];
  const runs: string[] = [];

  const scope = {
    run: async <T>(tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      runs.push(tenantId);
      return runInTenantScope({ tenantId, tx: db.tx }, async () => {
        scopeAtCallbackEntry.push(currentTenantScopeFrame()?.tenantId);
        return fn(db.tx);
      });
    },
    current: () => {
      const frame = currentTenantScopeFrame();
      return frame === undefined ? undefined : { tenantId: frame.tenantId };
    },
  } as unknown as TenantScopeService;

  const users = {
    ensureUser: async () => {
      scopeAtIdentityCall.push({ who: 'users.ensureUser', tenant: currentTenantScopeFrame()?.tenantId });
      return { id: ME, tenantId: TENANT };
    },
  } as unknown as UserSyncService;

  const ensureForUserCalls: number[] = [];
  const teachers = {
    findForUser: async () => {
      scopeAtIdentityCall.push({ who: 'teachers.findForUser', tenant: currentTenantScopeFrame()?.tenantId });
      return options.teacherProfileId === undefined
        ? { id: MY_TP }
        : options.teacherProfileId === null
          ? null
          : { id: options.teacherProfileId };
    },
    ensureForUser: async () => {
      ensureForUserCalls.push(1);
      scopeAtIdentityCall.push({ who: 'teachers.ensureForUser', tenant: currentTenantScopeFrame()?.tenantId });
      return { id: MY_TP, tenantId: TENANT, schoolId: 'sc', userProfileId: ME, active: true };
    },
  } as unknown as TeacherProfileService;

  const notifyCalls: unknown[] = [];
  /**
   * S-E03-2 / `ADR-071 §D2` — la portée vue par CHAQUE lecture ABAC élève.
   *
   * `StudentAccessService` lit sur la connexion du PROPRIÉTAIRE (`this.prisma`),
   * et `list` l'appelle désormais AU-DESSUS de `this.scope.run`. Ce journal est
   * ce qui rend ce hissage mesurable au lieu de déclaratif : il doit être
   * `[undefined]` — aucune portée active — là où `db.scopeAtStatement` (le
   * journal de `tx`) est plein de `TENANT`.
   */
  const scopeAtOwnerAbacRead: (string | undefined)[] = [];
  const prisma = {
    teachingAssignment: {
      findFirst: async (args: unknown) => {
        notifyCalls.push(args);
        return null; // le fan-out sort tôt : ce fichier prouve OÙ il tourne, pas ce qu'il envoie
      },
    },
    /**
     * Le MÊME jeu de lignes que `db.tx` (`db.tables.guardianship`), lu par la
     * connexion du PROPRIÉTAIRE : c'est exactement ce que « hors portée, sur le
     * client propriétaire » signifie. Il n'écrit RIEN dans `db.statements`, ce
     * qui est précisément pourquoi le budget de la portée redevient mesurable.
     *
     * `guardian: { userProfileId }` est une condition RELATIONNELLE : comme le
     * double de `tx`, on l'ENREGISTRE comme satisfaite et on filtre sur les
     * colonnes scalaires — ce fichier prouve l'ORDRE, la PORTÉE et le REFUS,
     * pas le moteur de requêtes de Prisma.
     */
    guardianship: {
      findMany: async ({ where }: { where: Row }) => {
        scopeAtOwnerAbacRead.push(currentTenantScopeFrame()?.tenantId);
        return (db.tables['guardianship'] ?? [])
          .filter((row) => row['tenantId'] === where['tenantId'] && row['status'] === where['status'])
          .map((row) => ({ studentId: row['studentId'] as string }));
      },
    },
  } as unknown as PrismaService;

  /**
   * L'ABAC élève CANONIQUE, pas un double permissif : un `canAccessStudent`
   * factice rendant `true` viderait de son sens le cas « sans tutelle active,
   * 403 » plus bas, qui est le contrôle négatif de tout ce fichier sur la
   * branche parent.
   */
  const studentAccess = new StudentAccessService(prisma, teachers);

  const notifications = { createMany: async () => undefined } as unknown as NotificationsService;

  return {
    db,
    runs,
    scopeAtCallbackEntry,
    scopeAtIdentityCall,
    scopeAtOwnerAbacRead,
    ensureForUserCalls,
    notifyCalls,
    controller: new LessonsController(prisma, scope, users, teachers, notifications, studentAccess),
    jwt: jwt(options.roles),
  };
}

// ---------------------------------------------------------------------------

describe('AC-2 — la résolution d’identité tourne HORS de la portée, PROUVÉ par l’ordre et non par un commentaire', () => {
  const identityCalls = (h: ReturnType<typeof makeHarness>) => h.scopeAtIdentityCall;

  it('`list` — `ensureUser` ET `ensureForUser` (branche mine=true) voient ZÉRO portée active', async () => {
    const h = makeHarness({ roles: ['teacher'] });
    await h.controller.list(h.jwt, undefined, undefined, undefined, undefined, undefined, 'true');
    expect(identityCalls(h).map((c) => c.who)).toEqual(['users.ensureUser', 'teachers.ensureForUser']);
    // LA propriété : aucun résolveur d'identité n'observe de portée active.
    expect(identityCalls(h).every((c) => c.tenant === undefined)).toBe(true);
    // …et la portée, elle, EST bien installée à l'entrée du callback.
    expect(h.scopeAtCallbackEntry).toEqual([TENANT]);
  });

  it('`getOne` — `ensureUser` hors portée, requête dedans', async () => {
    const h = makeHarness({ roles: ['school_admin'] });
    await h.controller.getOne(OWN_LESSON, h.jwt);
    expect(identityCalls(h).every((c) => c.tenant === undefined)).toBe(true);
    expect(h.scopeAtCallbackEntry).toEqual([TENANT]);
    // Chaque instruction émise l'a été SOUS le GUC.
    expect(h.db.scopeAtStatement).toEqual([TENANT]);
  });

  it('`create` — les DEUX résolveurs (ensureUser + findForUser) hors portée, et UNE seule portée', async () => {
    const h = makeHarness({ roles: ['teacher'] });
    await h.controller.create(
      { teachingAssignmentId: OWN_ASSIGNMENT, date: '2026-01-01', title: 'x', content: 'y' } as never,
      h.jwt,
    );
    expect(identityCalls(h).map((c) => c.who)).toEqual(['users.ensureUser', 'teachers.findForUser']);
    expect(identityCalls(h).every((c) => c.tenant === undefined)).toBe(true);
    // UNE portée par requête : deux portées successives seraient deux
    // transactions, donc une fenêtre TOCTOU sur la garde qui autorise l'écriture.
    expect(h.runs).toEqual([TENANT]);
    expect(h.db.scopeAtStatement.every((t) => t === TENANT)).toBe(true);
  });

  it('`update` et `remove` — même ordre, une seule portée, aucune provision automatique', async () => {
    for (const run of [
      (h: ReturnType<typeof makeHarness>) => h.controller.update(OWN_LESSON, { title: 'z' } as never, h.jwt),
      (h: ReturnType<typeof makeHarness>) => h.controller.remove(OWN_LESSON, h.jwt),
    ]) {
      const h = makeHarness({ roles: ['teacher'] });
      await run(h);
      expect(identityCalls(h).map((c) => c.who)).toEqual(['users.ensureUser', 'teachers.findForUser']);
      expect(identityCalls(h).every((c) => c.tenant === undefined)).toBe(true);
      expect(h.runs).toEqual([TENANT]);
      // ADR-051 §D1 — `ensureForUser` ÉCRIT (upsert). Il ne doit JAMAIS être
      // appelé depuis un chemin d'autorisation, sans quoi une requête REFUSÉE
      // provisionne un `teacher_profile` non audité.
      expect(h.ensureForUserCalls).toEqual([]);
    }
  });

  it('un ADMINISTRATEUR ne déclenche AUCUNE résolution de profil professeur (le court-circuit de rôle est une propriété de sécurité)', async () => {
    for (const role of ['super_admin', 'school_admin']) {
      const h = makeHarness({ roles: [role] });
      await h.controller.update(OWN_LESSON, { title: 'z' } as never, h.jwt);
      expect(identityCalls(h).map((c) => c.who)).toEqual(['users.ensureUser']);
      expect(h.ensureForUserCalls).toEqual([]);
    }
  });

  it('le fan-out de notifications tourne HORS de la portée, sur la connexion du PROPRIÉTAIRE (et on le dit)', async () => {
    const h = makeHarness({ roles: ['teacher'] });
    await h.controller.create(
      { teachingAssignmentId: OWN_ASSIGNMENT, date: '2026-01-01', title: 'x', content: 'y' } as never,
      h.jwt,
    );
    // Il a bien tourné (statut `published` par défaut)…
    expect(h.notifyCalls).toHaveLength(1);
    // …et AUCUNE de ses instructions n'est passée par le client de portée.
    expect(h.db.statements.some((s) => s.model === 'teachingAssignment' && s.verb === 'findUnique')).toBe(false);
  });
});

// ---------------------------------------------------------------------------

describe('AC-12 / G-AUTHZ — la sémantique de refus est INCHANGÉE, rôle par rôle', () => {
  const MESSAGE = 'Vous ne pouvez modifier que vos propres entrées.';

  it('le comparateur PUR : privilégié passe, propriétaire passe, tout le reste est le MÊME 403', () => {
    expect(() => assertOwnedByTeacher({ isPrivileged: true, teacherProfileId: null }, OTHER_TP)).not.toThrow();
    expect(() => assertOwnedByTeacher({ isPrivileged: false, teacherProfileId: MY_TP }, MY_TP)).not.toThrow();
    for (const context of [
      { isPrivileged: false, teacherProfileId: MY_TP },
      // AUCUN profil professeur : il ne possède aucune ligne, par construction
      // de la clé étrangère. Même 403, jamais un 404 ni un 500.
      { isPrivileged: false, teacherProfileId: null },
    ]) {
      try {
        assertOwnedByTeacher(context, OTHER_TP);
        throw new Error('aurait dû refuser');
      } catch (error) {
        expect(error).toBeInstanceOf(ForbiddenException);
        expect((error as ForbiddenException).message).toBe(MESSAGE);
      }
    }
  });

  it.each(['super_admin', 'school_admin'])(
    '%s modifie l’entrée d’un AUTRE professeur (rôles court-circuités, inchangé)',
    async (role) => {
      const h = makeHarness({ roles: [role] });
      await expect(h.controller.update(OTHERS_LESSON, { title: 'z' } as never, h.jwt)).resolves.toBeDefined();
    },
  );

  it('un professeur qui n’est PAS le propriétaire reçoit 403, avec le message EXACT', async () => {
    const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    const error = await h.controller
      .update(OTHERS_LESSON, { title: 'z' } as never, h.jwt)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).message).toBe(MESSAGE);
  });

  it('un porteur de `lessons.write` SANS profil professeur reçoit le MÊME 403 (pas un 404 « aucune école »)', async () => {
    // AVANT : `ensureForUser` levait `NotFoundException('Aucune école dans le
    // tenant…')` pour ce cas. La résolution en LECTURE SEULE le ramène sur la
    // branche de refus normale.
    const h = makeHarness({ roles: ['teacher'], teacherProfileId: null });
    const error = await h.controller
      .update(OTHERS_LESSON, { title: 'z' } as never, h.jwt)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ForbiddenException);
    expect((error as ForbiddenException).getStatus()).toBe(403);
    expect((error as ForbiddenException).message).toBe(MESSAGE);
  });

  it('ORDRE DES REFUS : 404 (ligne absente ou étrangère) AVANT 403 (pas le propriétaire)', async () => {
    // Le comparateur reste APRÈS la garde, DANS le callback. Un professeur qui
    // demande une entrée d'un autre tenant obtient 404 — jamais 403, qui
    // confirmerait l'existence de la ligne.
    for (const id of [FOREIGN_LESSON, 'ffffffff-0000-0000-0000-00000000ffff']) {
      const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
      await expect(h.controller.update(id, { title: 'z' } as never, h.jwt)).rejects.toBeInstanceOf(
        NotFoundException,
      );
    }
  });

  it('`getOne` — la garde 404 tenant et le 403 « brouillon » du parent sont intacts', async () => {
    const foreign = makeHarness({ roles: ['parent'] });
    await expect(foreign.controller.getOne(FOREIGN_LESSON, foreign.jwt)).rejects.toBeInstanceOf(
      NotFoundException,
    );
    const draft = makeHarness({ roles: ['parent'] });
    await expect(draft.controller.getOne(OTHERS_LESSON, draft.jwt)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    const published = makeHarness({ roles: ['parent'] });
    await expect(published.controller.getOne(OWN_LESSON, published.jwt)).resolves.toMatchObject({
      id: OWN_LESSON,
    });
  });

  it('`create` — une affectation d’un AUTRE tenant reste un 404, jamais un 403', async () => {
    const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    await expect(
      h.controller.create(
        { teachingAssignmentId: FOREIGN_ASSIGNMENT, date: '2026-01-01', title: 'x', content: 'y' } as never,
        h.jwt,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    // …et RIEN n'a été écrit.
    expect(h.db.statements.some((s) => s.verb === 'create')).toBe(false);
  });

  it('les CINQ décorateurs @RequiresPermission sont intacts', () => {
    const SOURCE = readFileSync(join(__dirname, 'lessons.controller.ts'), 'utf8');
    expect(SOURCE.match(/@RequiresPermission\('lessons\.read'\)/g)).toHaveLength(2);
    expect(SOURCE.match(/@RequiresPermission\('lessons\.write'\)/g)).toHaveLength(2);
    expect(SOURCE.match(/@RequiresPermission\('lessons\.delete'\)/g)).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------

describe('AC-6 / PF-217 — la séance fournie est prouvée POSSÉDÉE, avant l’écriture', () => {
  const body = (classSessionId?: string | null) =>
    ({
      teachingAssignmentId: OWN_ASSIGNMENT,
      date: '2026-01-01',
      title: 'x',
      content: 'y',
      ...(classSessionId === undefined ? {} : { classSessionId }),
    }) as never;

  it('POSITIF D’ABORD — une séance du PROPRE tenant passe, et la leçon est créée', async () => {
    const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    await expect(h.controller.create(body(OWN_SESSION), h.jwt)).resolves.toMatchObject({
      classSessionId: OWN_SESSION,
    });
    expect(h.db.sessionProbes()).toHaveLength(1);
  });

  it('NÉGATIF — une séance d’un AUTRE tenant est REFUSÉE, et AUCUNE ligne n’est écrite', async () => {
    const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    await expect(h.controller.create(body(FOREIGN_SESSION), h.jwt)).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(h.db.statements.some((s) => s.verb === 'create')).toBe(false);
    // La sonde a bien été émise AVANT l'écriture (elle est la dernière instruction).
    expect(h.db.statements.map((s) => `${s.model}.${s.verb}`)).toEqual([
      'teachingAssignment.findFirst',
      'classSession.findFirst',
    ]);
  });

  it('« autre tenant » et « inexistante » sont indiscernables À L’OCTET PRÈS (ADR-049 §D2)', async () => {
    const foreign = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    const absent = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    const a = await foreign.controller.create(body(FOREIGN_SESSION), foreign.jwt).catch((e) => e);
    const b = await absent.controller
      .create(body('eeeeeeee-0000-0000-0000-00000000eeee'), absent.jwt)
      .catch((e) => e);
    expect(a.message).toBe(b.message);
    expect(a.status).toBe(b.status);
    // Le message ne fuit NI tenant, NI table, NI code Prisma : `toError` le
    // remonte VERBATIM à l'écran du professeur.
    expect(a.message).toBe('La séance sélectionnée est introuvable dans votre établissement.');
    for (const leak of ['tenant', 'class_session', 'P20', 'Prisma', 'lesson_entry']) {
      expect(a.message).not.toContain(leak);
    }
  });

  it.each([
    ['ABSENTE', undefined],
    ['NULL', null],
    ['CHAÎNE VIDE', ''],
  ])(
    'CONTRÔLE NÉGATIF — une séance %s réussit ET N’ÉMET AUCUNE SONDE (le mutant `where: { id: undefined }`)',
    async (_label, value) => {
      // LE mutant que ce cas tue : `findFirst({ where: { id: undefined, tenantId } })`
      // fait OMETTRE le filtre à Prisma, rend la PREMIÈRE séance du tenant, et la
      // vérification passe À VIDE sur chaque requête qui ne fournit pas d'id.
      // Assérer un 2xx ne suffit donc pas — il faut assérer l'ABSENCE de sonde.
      const h = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
      await expect(h.controller.create(body(value), h.jwt)).resolves.toBeDefined();
      expect(h.db.sessionProbes()).toHaveLength(0);
    },
  );

  it('BUDGET — au plus TROIS instructions dans la portée de `create`, bornées par le SCHÉMA', async () => {
    const worst = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    await worst.controller.create(body(OWN_SESSION), worst.jwt);
    expect(worst.db.statements).toHaveLength(3);

    const best = makeHarness({ roles: ['teacher'], teacherProfileId: MY_TP });
    await best.controller.create(body(undefined), best.jwt);
    expect(best.db.statements).toHaveLength(2);
  });

  it('BUDGET — `getOne` 1, `update` 2, `remove` 2, `list` 1 (admin) / 2 (parent + studentId)', async () => {
    const one = makeHarness({ roles: ['school_admin'] });
    await one.controller.getOne(OWN_LESSON, one.jwt);
    expect(one.db.statements).toHaveLength(1);

    const upd = makeHarness({ roles: ['school_admin'] });
    await upd.controller.update(OWN_LESSON, { title: 'z' } as never, upd.jwt);
    expect(upd.db.statements).toHaveLength(2);

    const del = makeHarness({ roles: ['school_admin'] });
    await del.controller.remove(OWN_LESSON, del.jwt);
    expect(del.db.statements).toHaveLength(2);

    const admin = makeHarness({ roles: ['school_admin'] });
    await admin.controller.list(admin.jwt);
    expect(admin.db.statements).toHaveLength(1);

    const parent = makeHarness({ roles: ['parent'] });
    await parent.controller.list(parent.jwt, undefined, undefined, 's1');
    // S-E03-2 / `ADR-071 §D2` — le budget de la portée BAISSE de 3 à 2, et ce
    // n'est pas une optimisation : la garde de tutelle n'est plus un
    // `guardianship.findFirst` privé émis DANS la transaction interactive, elle
    // est passée à l'ABAC élève canonique, qui tourne sur la connexion du
    // PROPRIÉTAIRE au-dessus de `scope.run`. Ce qui reste dans la portée est de
    // la DONNÉE (l'inscription → sections) et la lecture elle-même.
    expect(parent.db.statements.map((s) => `${s.model}.${s.verb}`)).toEqual([
      'enrollment.findMany',
      'lessonEntry.findMany',
    ]);
  });
});

// ---------------------------------------------------------------------------

describe('AC-11 / G-PORTAL — les trois portails qui LISENT, et l’ABAC parent DANS la portée', () => {
  it('PARENT — le filtre `status=published` et la jointure d’inscription sont DANS la portée ; la garde de tutelle, elle, est HISSÉE DEHORS', async () => {
    const h = makeHarness({ roles: ['parent'] });
    const result = (await h.controller.list(h.jwt, undefined, undefined, 's1')) as { data: Row[] };
    // Les deux instructions restantes ont vu le GUC.
    expect(h.db.scopeAtStatement).toEqual([TENANT, TENANT]);
    // L'INVARIANT QUE LE HISSAGE ACHÈTE, et que rien n'épinglait jusqu'ici : la
    // résolution de tutelle a bien eu lieu (non-vacuité), sur la connexion du
    // PROPRIÉTAIRE, avec ZÉRO cadre de portée actif. C'est la moitié qui
    // interdit de la re-glisser dans la transaction interactive au prochain
    // refactor — un budget « ≤ 2 instructions » (`tenant-scope.service.ts:133`)
    // ne se défend pas par un commentaire.
    expect(h.scopeAtOwnerAbacRead).toEqual([undefined]);
    // …et le filtre de publication est bien posé (le parent n'est pas `isStaff`).
    const listWhere = h.db.statements.find((s) => s.model === 'lessonEntry')?.where as Row;
    expect(listWhere.status).toBe('published');
    expect(listWhere.tenantId).toBe(TENANT);
    expect(result.data.every((row) => row.status === 'published')).toBe(true);
  });

  it('PARENT — sans tutelle active sur l’élève, 403, et AUCUNE lecture de leçon n’est émise', async () => {
    const db = makeDb({ guardianship: [] });
    const h = makeHarness({ roles: ['parent'], db });
    await expect(h.controller.list(h.jwt, undefined, undefined, 's1')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.statements.some((s) => s.model === 'lessonEntry')).toBe(false);
  });

  it('TEACHER — `mine=true` filtre sur le profil résolu DEHORS ; ADMIN — aucun filtre de publication', async () => {
    const teacher = makeHarness({ roles: ['teacher'] });
    await teacher.controller.list(teacher.jwt, undefined, undefined, undefined, undefined, undefined, 'true');
    // « une PREMIÈRE instruction a été émise » fait PARTIE de ce que ce test
    // affirme : sans elle, lire `[0]` sur un journal vide passerait pour une
    // absence de filtre. On l'assied donc, au lieu de l'assener avec un `!`.
    const teacherFirst = teacher.db.statements[0];
    expect(teacherFirst).toBeDefined();
    const teacherWhere = teacherFirst?.where as Row;
    expect(teacherWhere.teacherProfileId).toBe(MY_TP);
    expect(teacherWhere.status).toBeUndefined();

    const admin = makeHarness({ roles: ['school_admin'] });
    await admin.controller.list(admin.jwt);
    const adminFirst = admin.db.statements[0];
    expect(adminFirst).toBeDefined();
    expect((adminFirst?.where as Row).status).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------

describe('AC-14 / G-DNC / les PRÉMISSES épinglées dans la SOURCE', () => {
  const SOURCE = readFileSync(join(__dirname, 'lessons.controller.ts'), 'utf8');

  it('G-DNC — aucun drapeau de contournement, aucune branche `NODE_ENV`', () => {
    expect(SOURCE).not.toContain('process.env');
    expect(SOURCE).not.toContain('NODE_ENV');
    expect(SOURCE).not.toContain('SKIP_');
    expect(SOURCE).not.toContain('ALLOW_');
  });

  it('AUCUN `this.prisma.` ne tombe DANS une portée — le repli propriétaire est structurellement absent', () => {
    // Le compteur d'attribution est POSITIONNEL : un `this.prisma.` à
    // l'intérieur d'un callback partirait sur la connexion du PROPRIÉTAIRE
    // pendant qu'un compteur lexical le créditerait. On mesure donc les plages,
    // on ne relit pas.
    const ranges: { start: number; end: number }[] = [];
    for (const match of SOURCE.matchAll(/this\.scope\.run\s*\(/g)) {
      const open = match.index! + match[0].length - 1;
      let depth = 0;
      let close = -1;
      for (let i = open; i < SOURCE.length; i += 1) {
        if (SOURCE[i] === '(') depth += 1;
        else if (SOURCE[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            close = i;
            break;
          }
        }
      }
      expect(close).toBeGreaterThan(open);
      ranges.push({ start: open, end: close });
    }
    // NON VACUITÉ : cinq handlers convertis, cinq portées.
    expect(ranges).toHaveLength(5);

    const inside = [...SOURCE.matchAll(/this\.prisma\.\w+\.\w+/g)].filter((m) =>
      ranges.some((r) => m.index! > r.start && m.index! < r.end),
    );
    expect(inside.map((m) => m[0])).toEqual([]);
    // …et il reste EXACTEMENT un site propriétaire, le fan-out, nommé et assumé.
    expect(SOURCE.match(/this\.prisma\.\w+\.\w+/g)).toHaveLength(1);

    // Les résolveurs d'identité, eux, sont TOUS hors des plages (AC-2, moitié source).
    const identityInside = [...SOURCE.matchAll(/this\.(users|teachers)\.\w+/g)].filter((m) =>
      ranges.some((r) => m.index! > r.start && m.index! < r.end),
    );
    expect(identityInside.map((m) => m[0])).toEqual([]);
  });

  it('PF-217 / M-4 — `UpdateLessonDto` n’a PAS de `classSessionId`, et `update` ne l’écrit pas', () => {
    const start = SOURCE.indexOf('class UpdateLessonDto {');
    const end = SOURCE.indexOf('}', start);
    expect(start).toBeGreaterThan(-1);
    // La prémisse épinglée : ajouter le champ ici rend ce test ROUGE, ce qui
    // transforme un trou silencieux en échec visible (technique de PF-206).
    expect(SOURCE.slice(start, end)).not.toContain('classSessionId');

    const dataStart = SOURCE.indexOf('const row = await tx.lessonEntry.update({');
    const dataEnd = SOURCE.indexOf('return { updated: row', dataStart);
    expect(dataStart).toBeGreaterThan(-1);
    expect(SOURCE.slice(dataStart, dataEnd)).not.toContain('classSessionId');
  });

  it('la sonde PF-217 est un `findFirst` avec `tenantId` EXPLICITE — jamais un `findUnique` par id seul', () => {
    expect(SOURCE).toMatch(
      /tx\.classSession\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*body\.classSessionId\s*,\s*tenantId\s*,?\s*\}/,
    );
    expect(SOURCE).not.toContain('tx.classSession.findUnique');
    // Et elle est gardée par la VÉRACITÉ, jamais par la présence de la clé.
    expect(SOURCE).toContain('isSuppliedScopeId(body.classSessionId)');
  });

  it('les gardes `tenantId` explicites survivent à la conversion (ADR-042 §D1)', () => {
    expect(SOURCE.match(/lesson\.tenantId !== tenantId/g)).toHaveLength(3);
    expect(SOURCE).toContain('where: { id: body.teachingAssignmentId, tenantId }');
  });

  it('G-MIGRATION — cette tranche n’écrit aucun SQL et ne touche à aucun schéma', () => {
    expect(SOURCE).not.toMatch(/\$queryRaw|\$executeRaw/);
  });
});

// ---------------------------------------------------------------------------

/**
 * AC-9 — LA CLÔTURE RELATIONNELLE DÉCLARÉE DOIT SUIVRE LES SITES D'APPEL.
 *
 * Miroir de `calendar-scope-ownership.spec.ts` (AC-10), pour le DEUXIÈME module.
 * `APP_ROLE_REQUIRED_PRIVILEGES` est parcourue par `appRoleVerdict` AU
 * DÉMARRAGE : une entrée manquante ne fait pas échouer la sonde, elle fait
 * certifier `enforcing: true` sur une clôture jamais vérifiée, et chaque requête
 * leçon des trois portails rend alors `permission denied`. C'est exactement le
 * défaut qu'`academic_year` a infligé à S-E01-5.
 */
describe('AC-9 — les sites d’appel Prisma de lessons ⊆ la clôture déclarée', () => {
  const SOURCE = readFileSync(join(__dirname, 'lessons.controller.ts'), 'utf8');

  /** `verbe Prisma -> privilège SQL`. Un verbe inconnu ÉCHOUE, il n'est pas ignoré. */
  const VERB_PRIVILEGE: Record<string, string> = {
    aggregate: 'SELECT',
    count: 'SELECT',
    findFirst: 'SELECT',
    findMany: 'SELECT',
    findUnique: 'SELECT',
    groupBy: 'SELECT',
    create: 'INSERT',
    createMany: 'INSERT',
    update: 'UPDATE',
    updateMany: 'UPDATE',
    delete: 'DELETE',
    deleteMany: 'DELETE',
  };

  /** `lessonEntry` -> `lesson_entry`, la convention `@@map` de tout le schéma. */
  const toTable = (model: string): string => model.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

  /**
   * Les CIBLES D'`include`, et pourquoi elles ne se dérivent PAS du même
   * matcher : un `include: { subject: true }` imbriqué ne porte NI récepteur NI
   * verbe, donc `tx.<modèle>.<verbe>(` ne peut pas le voir. Elles sont donc
   * dérivées d'un second matcher — les CLÉS des blocs `include:` — croisées avec
   * cette table de correspondance NOMMÉE. Une clé de relation absente de la
   * table ÉCHOUE (fail-closed) : c'est ce qui fait virer au rouge l'ajout d'une
   * jointure dont personne n'a accordé la table.
   */
  const RELATION_TO_TABLE: Record<string, string> = {
    teachingAssignment: 'teaching_assignment',
    classSection: 'class_section',
    subject: 'subject',
    teacherProfile: 'teacher_profile',
    userProfile: 'user_profile',
    gradeLevel: 'grade_level',
    cycle: 'cycle',
  };

  /** Les clés NON relationnelles qu'un bloc `include:` porte légitimement. */
  const NON_RELATION_KEYS = new Set([
    'include',
    'select',
    'where',
    'id',
    'name',
    'color',
    'firstName',
    'lastName',
  ]);

  /** Chaque `tx.<modèle>.<verbe>(` — donc chaque instruction émise DANS une portée. */
  const sites = [...SOURCE.matchAll(/\btx\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g)].map(([, model, verb]) => ({
    model: String(model),
    verb: String(verb),
    table: toTable(String(model)),
  }));

  /** Les plages des callbacks de portée — la même mesure qu'au bloc G-DNC. */
  const scopeRanges = (): { start: number; end: number }[] => {
    const ranges: { start: number; end: number }[] = [];
    for (const match of SOURCE.matchAll(/this\.scope\.run\s*\(/g)) {
      const open = match.index! + match[0].length - 1;
      let depth = 0;
      for (let i = open; i < SOURCE.length; i += 1) {
        if (SOURCE[i] === '(') depth += 1;
        else if (SOURCE[i] === ')') {
          depth -= 1;
          if (depth === 0) {
            ranges.push({ start: open, end: i });
            break;
          }
        }
      }
    }
    return ranges;
  };

  /**
   * Les blocs `include: { … }` émis DANS une portée — appariement d'accolades,
   * puis filtrage par les plages.
   *
   * Le filtrage n'est pas cosmétique : `notifyOnLessonPublished` porte un
   * `include` profond de cinq niveaux (`enrollments`, `student`,
   * `guardianships`, `guardian`) qui tourne DÉLIBÉRÉMENT sur la connexion du
   * PROPRIÉTAIRE. Le compter ici exigerait des privilèges `app_user` que le
   * module converti n'a PAS besoin — et gonfler la clôture déclarée avec des
   * tables qu'aucune instruction de portée ne touche est exactement la
   * sur-déclaration qui rend une liste illisible, donc non maintenue.
   */
  const includeBlocks = (): string[] => {
    const ranges = scopeRanges();
    const blocks: string[] = [];
    for (const match of SOURCE.matchAll(/include:\s*\{/g)) {
      const open = match.index! + match[0].length - 1;
      if (!ranges.some((r) => open > r.start && open < r.end)) continue;
      let depth = 0;
      for (let i = open; i < SOURCE.length; i += 1) {
        if (SOURCE[i] === '{') depth += 1;
        else if (SOURCE[i] === '}') {
          depth -= 1;
          if (depth === 0) {
            blocks.push(SOURCE.slice(open, i + 1));
            break;
          }
        }
      }
    }
    return blocks;
  };

  it('le corpus de sites d’appel est NON VIDE et n’utilise que des verbes connus', () => {
    // Une regex qui ne matche plus rien rendrait le test ci-dessous vert à vide :
    // c'est le mode de défaillance normal d'une assertion dérivée.
    //
    // PLANCHER RE-DÉRIVÉ 11 -> 10 PAR `S-E03-2`, ET CE N'EST PAS UN CLIQUET
    // RELÂCHÉ. Mesuré sur les deux arbres :
    //   HEAD~ : 11 sites `tx.<modèle>.<verbe>(` ; ici : 10.
    //   Le delta est EXACTEMENT UN site, `tx.guardianship.findFirst(`, que
    //   `AC-2` a HISSÉ hors de `this.scope.run` vers la connexion du
    //   PROPRIÉTAIRE (`StudentAccessService`, cf. `ADR-071 §D2`). Le site n'a
    //   pas été masqué : il a été SUPPRIMÉ de la portée, ce que le journal
    //   `scopeAtOwnerAbacRead` de ce même fichier prouve indépendamment.
    // La propriété À SENS UNIQUE de ce fichier — « chaque (table, privilège)
    // émis DANS une portée est DÉCLARÉ » — est INCHANGÉE. Seul bouge le
    // plancher anti-vacuité, et il bouge parce qu'une instruction réelle a
    // disparu de la portée, pas parce qu'une assertion gênait.
    expect(sites.length).toBeGreaterThanOrEqual(10);
    const unknown = sites.filter((s) => VERB_PRIVILEGE[s.verb] === undefined);
    expect(unknown.map((s) => `${s.model}.${s.verb}`)).toEqual([]);
  });

  it('chaque (table, privilège) émis DANS une portée est DÉCLARÉ dans APP_ROLE_REQUIRED_PRIVILEGES', () => {
    const declared = new Set(APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)));
    const missing = [
      ...new Set(
        sites
          .map((s) => privilegeKey(s.table, VERB_PRIVILEGE[s.verb] ?? 'UNKNOWN'))
          .filter((key) => !declared.has(key)),
      ),
    ].sort();
    // Le message NOMME ce qui manque : un rouge ici se corrige en une ligne dans
    // `tenant-scope.ts`, pas en une enquête.
    expect(missing).toEqual([]);
  });

  it('chaque CIBLE D’INCLUDE est classée, et son SELECT est déclaré (la clôture relationnelle)', () => {
    const blocks = includeBlocks();
    // NON VACUITÉ dans les deux directions : `list` et `getOne` en portent.
    expect(blocks.length).toBeGreaterThanOrEqual(2);

    const keys = new Set<string>();
    for (const block of blocks) {
      for (const [, key] of block.matchAll(/(\w+)\s*:\s*(?:\{|true)/g)) keys.add(String(key));
    }
    // FAIL-CLOSED : une clé qui n'est ni une relation connue ni une clé
    // structurelle/scalaire connue est INCLASSABLE, donc refusée (DNC-08). C'est
    // la moitié qui rend rouge l'ajout d'une jointure non accordée.
    const unclassified = [...keys].filter(
      (key) => RELATION_TO_TABLE[key] === undefined && !NON_RELATION_KEYS.has(key),
    );
    expect(unclassified).toEqual([]);

    // UNE seule résolution par clé, portée jusqu'à l'assertion : l'ancienne
    // forme cherchait `RELATION_TO_TABLE[key]` DEUX fois — une pour filtrer, une
    // pour construire la clé de privilège — et deux lectures de la même table
    // peuvent diverger. Ici la table résolue voyage avec sa clé.
    const relations = [...keys].flatMap((key) => {
      const table = RELATION_TO_TABLE[key];
      return table === undefined ? [] : [{ key, table }];
    });
    expect(relations.length).toBeGreaterThanOrEqual(6);

    const declared = new Set(APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)));
    const missing = relations
      .map(({ table }) => privilegeKey(table, 'SELECT'))
      .filter((key) => !declared.has(key))
      .sort();
    expect(missing).toEqual([]);
  });

  it('les tables NOUVELLES de cette tranche sont bien présentes, verbe par verbe (garde anti-vacuité)', () => {
    // Sans ce cas, une régression qui viderait `sites` rendrait les deux tests
    // ci-dessus verts. Ici la liste est nommée : elle ne peut pas se vider.
    const declared = new Set(APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)));
    for (const key of [
      'lesson_entry.SELECT',
      'lesson_entry.INSERT',
      'lesson_entry.UPDATE',
      'lesson_entry.DELETE',
      'teaching_assignment.SELECT',
      'class_session.SELECT',
      'guardianship.SELECT',
      'subject.SELECT',
      'teacher_profile.SELECT',
      'user_profile.SELECT',
      'enrollment.SELECT',
    ]) {
      expect(declared.has(key)).toBe(true);
    }
    // …et chaque entrée porte SA raison, jamais une chaîne partagée.
    for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
      expect(requirement.why.trim().length).toBeGreaterThan(10);
    }
  });
});
