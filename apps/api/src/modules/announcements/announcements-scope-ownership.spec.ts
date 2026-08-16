import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { scopeOwnershipPlan } from '../../shared/prisma/scope-fk';

import { AnnouncementsController, assertScopeCoherence } from './announcements.controller';
import { AnnouncementRecipientsService } from './announcements.service';

/**
 * ════════════════════════════════════════════════════════════════════════════
 * S-E01-1f / PF-208 — `announcements` : les CINQ FK de portée sont prouvées
 * PROPRIÉTÉ du tenant appelant, et `computeRecipients` est INCAPABLE de rendre
 * un `userProfileId` hors du tenant de l'annonce.
 * ════════════════════════════════════════════════════════════════════════════
 *
 * ┌──────────────────────────────────────────────────────────────────────────┐
 * │ POURQUOI CE FICHIER EXISTE PLUTÔT QU'UN AJOUT À `announcements.service.  │
 * │ spec.ts` — LE MOCK DE CE DERNIER NE PEUT PAS ÉCHOUER (PM-1)              │
 * └──────────────────────────────────────────────────────────────────────────┘
 *
 * `announcements.service.spec.ts` rend les lignes configurées SANS regarder le
 * `where` reçu. Un test « id étranger → ensemble vide » écrit sur ce mock
 * passerait AVANT le correctif comme après : il serait INFALSIFIABLE, et donc
 * une preuve de rien. Run 61 a livré des assertions qui ne pouvaient pas
 * passer ; le défaut miroir — des assertions qui ne peuvent pas échouer — est
 * pire, parce qu'il est VERT.
 *
 * La fausse base ci-dessous FILTRE réellement sur le `where` qu'on lui passe
 * (`tenantId`, `in`, `not: null`, relation `gradeLevel`), et elle contient les
 * lignes des DEUX tenants. Un opérateur qu'elle ne connaît pas la fait
 * ÉCHOUER BRUYAMMENT plutôt que de rendre `[]` en silence — un `where` mal lu
 * qui rend un ensemble vide serait un vert accidentel.
 *
 * Le CONTRÔLE NÉGATIF vit dans le premier `describe` : on émet contre la MÊME
 * fausse base la requête TELLE QU'ELLE ÉTAIT à `bc4e590` (sans `tenantId`) et
 * on montre qu'elle rend bien les lignes du tenant VICTIME. C'est ce qui
 * prouve que le vide observé ensuite vient du prédicat, et non d'un mock inerte.
 *
 * LIMITE NOMMÉE (DNC-06) : rien ici ne touche PostgreSQL. Ces tests prouvent la
 * FORME des requêtes et le comportement du code, pas le comportement de RLS.
 * L'application se connecte toujours en PROPRIÉTAIRE des tables, qui échappe à
 * ses propres policies faute de `FORCE ROW LEVEL SECURITY` : le prédicat
 * `tenantId` explicite fait TOUT le travail, RLS ne le double pas.
 */

const TENANT = 'tenant-a';
const OTHER_TENANT = 'tenant-b';
const SCHOOL = 'school-a';

/** Les profils du tenant A. */
const UP_GUARDIAN_A = 'up-guardian-a';
const UP_TEACHER_A = 'up-teacher-a';
const UP_STUDENT_A = 'up-student-a';
const UP_ADMIN_A = 'up-admin-a';
/** Les profils du tenant B — AUCUN ne doit jamais apparaître dans un résultat. */
const UP_GUARDIAN_B = 'up-guardian-b';
const UP_TEACHER_B = 'up-teacher-b';
const UP_STUDENT_B = 'up-student-b';

const FOREIGN_IDS = [UP_GUARDIAN_B, UP_TEACHER_B, UP_STUDENT_B];

type Row = Record<string, unknown>;

function seed() {
  return {
    cycle: [
      { id: 'cyc-a', tenantId: TENANT },
      { id: 'cyc-b', tenantId: OTHER_TENANT },
    ] as Row[],
    gradeLevel: [
      { id: 'lvl-a', tenantId: TENANT, cycleId: 'cyc-a' },
      { id: 'lvl-b', tenantId: OTHER_TENANT, cycleId: 'cyc-b' },
    ] as Row[],
    classSection: [
      { id: 'cls-a', tenantId: TENANT, gradeLevelId: 'lvl-a' },
      { id: 'cls-b', tenantId: OTHER_TENANT, gradeLevelId: 'lvl-b' },
    ] as Row[],
    student: [
      { id: 'stu-a', tenantId: TENANT, userProfileId: UP_STUDENT_A },
      { id: 'stu-b', tenantId: OTHER_TENANT, userProfileId: UP_STUDENT_B },
    ] as Row[],
    enrollment: [
      { tenantId: TENANT, classSectionId: 'cls-a', studentId: 'stu-a', status: 'active' },
      { tenantId: OTHER_TENANT, classSectionId: 'cls-b', studentId: 'stu-b', status: 'active' },
    ] as Row[],
    guardianship: [
      {
        tenantId: TENANT,
        studentId: 'stu-a',
        status: 'active',
        guardian: { userProfileId: UP_GUARDIAN_A },
      },
      {
        tenantId: OTHER_TENANT,
        studentId: 'stu-b',
        status: 'active',
        guardian: { userProfileId: UP_GUARDIAN_B },
      },
    ] as Row[],
    teachingAssignment: [
      {
        tenantId: TENANT,
        classSectionId: 'cls-a',
        teacherProfile: { userProfileId: UP_TEACHER_A },
      },
      {
        tenantId: OTHER_TENANT,
        classSectionId: 'cls-b',
        teacherProfile: { userProfileId: UP_TEACHER_B },
      },
    ] as Row[],
    // `userRoles: []` : le preview projette `p.userRoles` pour bâtir sa
    // ventilation par rôle. La fausse base ignore `select`, donc les lignes
    // portent la relation vide — la ventilation tombe alors dans `other`, ce
    // qui n'est pas la propriété testée ici (c'est `count` qui l'est).
    userProfile: [
      { id: UP_GUARDIAN_A, tenantId: TENANT, status: 'active', userRoles: [] },
      { id: UP_TEACHER_A, tenantId: TENANT, status: 'active', userRoles: [] },
      { id: UP_STUDENT_A, tenantId: TENANT, status: 'active', userRoles: [] },
      { id: UP_ADMIN_A, tenantId: TENANT, status: 'active', userRoles: [] },
      { id: UP_GUARDIAN_B, tenantId: OTHER_TENANT, status: 'active', userRoles: [] },
      { id: UP_TEACHER_B, tenantId: OTHER_TENANT, status: 'active', userRoles: [] },
      { id: UP_STUDENT_B, tenantId: OTHER_TENANT, status: 'active', userRoles: [] },
    ] as Row[],
  };
}

type Db = ReturnType<typeof seed>;

/**
 * Applique un `where` Prisma minimal, mais RÉELLEMENT. Tout opérateur inconnu
 * LÈVE : un `where` non compris qui rendrait `[]` en silence transformerait
 * chaque test d'isolation en vert accidentel.
 */
function matches(db: Db, row: Row, where: Record<string, unknown> | undefined): boolean {
  for (const [key, cond] of Object.entries(where ?? {})) {
    if (key === 'gradeLevel') {
      const level = db.gradeLevel.find((l) => l.id === row.gradeLevelId);
      if (!level) return false;
      if (!matches(db, level, cond as Record<string, unknown>)) return false;
      continue;
    }
    const value = row[key];
    if (cond === null) {
      if (value !== null && value !== undefined) return false;
      continue;
    }
    if (typeof cond === 'object') {
      const operators = cond as { in?: unknown[]; not?: unknown };
      if ('in' in operators) {
        if (!(operators.in ?? []).includes(value)) return false;
        continue;
      }
      if ('not' in operators) {
        if (operators.not === null) {
          if (value === null || value === undefined) return false;
          continue;
        }
        if (value === operators.not) return false;
        continue;
      }
      throw new Error(`fausse base : opérateur non supporté sur \`${key}\` — ${JSON.stringify(cond)}`);
    }
    if (value !== cond) return false;
  }
  return true;
}

function makeClient() {
  const db = seed();
  const seen: { model: string; verb: string; where: Record<string, unknown> }[] = [];
  const model = (name: keyof Db) => ({
    findMany: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      seen.push({ model: name, verb: 'findMany', where: args?.where ?? {} });
      return db[name].filter((row) => matches(db, row, args?.where));
    }),
    findFirst: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      seen.push({ model: name, verb: 'findFirst', where: args?.where ?? {} });
      return db[name].find((row) => matches(db, row, args?.where)) ?? null;
    }),
  });
  const announcementCreate = jest.fn(async (args: { data: Row }) => ({ id: 'ann-1', ...args.data }));
  const client = {
    cycle: model('cycle'),
    gradeLevel: model('gradeLevel'),
    classSection: model('classSection'),
    student: model('student'),
    enrollment: model('enrollment'),
    guardianship: model('guardianship'),
    teachingAssignment: model('teachingAssignment'),
    userProfile: model('userProfile'),
    teacherProfile: { findFirst: jest.fn(async () => null) },
    announcement: { create: announcementCreate },
  };
  return { client, db, seen, announcementCreate };
}

function makeService() {
  const { client, db, seen } = makeClient();
  return {
    service: new AnnouncementRecipientsService(client as never),
    client,
    db,
    seen,
  };
}

type AnnouncementInput = Parameters<AnnouncementRecipientsService['computeRecipients']>[0];

const announcement = (
  over: Partial<AnnouncementInput> & Pick<AnnouncementInput, 'scope'>,
): AnnouncementInput => ({
  tenantId: TENANT,
  schoolId: SCHOOL,
  cycleId: null,
  gradeLevelId: null,
  classSectionId: null,
  studentId: null,
  userProfileId: null,
  ...over,
});

// ═══════════════════════════════════════════════════════════════════════════
// 0 — LE CONTRÔLE NÉGATIF : cette fausse base PEUT rendre des lignes étrangères
// ═══════════════════════════════════════════════════════════════════════════

describe('AC-9 — la fausse base est FALSIFIABLE (le vide qui suit vient du prédicat)', () => {
  it('la requête TELLE QU’ELLE ÉTAIT à HEAD (sans `tenantId`) rend bien les lignes de la VICTIME', async () => {
    const { client } = makeClient();

    // `guardianship.findMany` de `bc4e590` — mot pour mot, sans `tenantId`.
    const leaked = await client.guardianship.findMany({
      where: { studentId: { in: ['stu-b'] }, status: 'active' },
    });
    expect(leaked).toHaveLength(1);
    expect((leaked[0] as { guardian: { userProfileId: string } }).guardian.userProfileId).toBe(
      UP_GUARDIAN_B,
    );

    // Idem pour les trois autres requêtes non tenantées mesurées à HEAD.
    expect(
      await client.enrollment.findMany({
        where: { classSectionId: { in: ['cls-b'] }, status: 'active' },
      }),
    ).toHaveLength(1);
    expect(
      await client.teachingAssignment.findMany({ where: { classSectionId: { in: ['cls-b'] } } }),
    ).toHaveLength(1);
    expect(
      await client.student.findMany({
        where: { id: { in: ['stu-b'] }, userProfileId: { not: null } },
      }),
    ).toHaveLength(1);

    // ET la MÊME requête avec le prédicat du correctif rend vide.
    expect(
      await client.guardianship.findMany({
        where: { tenantId: TENANT, studentId: { in: ['stu-b'] }, status: 'active' },
      }),
    ).toHaveLength(0);
  });

  it('un opérateur non supporté LÈVE au lieu de rendre `[]` (pas de vert accidentel)', async () => {
    const { client } = makeClient();
    await expect(
      client.userProfile.findMany({ where: { id: { startsWith: 'up-' } } as never }),
    ).rejects.toThrow(/opérateur non supporté/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-2 — LES CINQ BRANCHES, exécutées : id étranger → ensemble VIDE
// ═══════════════════════════════════════════════════════════════════════════

describe('AC-2 — `computeRecipients` ne peut pas rendre un profil hors tenant', () => {
  it('individual_user : un `userProfileId` ÉTRANGER rend un ensemble VIDE (la branche que PF-208 nommait)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'individual_user' as never, userProfileId: UP_GUARDIAN_B }),
    );
    expect([...recipients]).toEqual([]);
  });

  it('individual_user : un `userProfileId` DU TENANT reste un destinataire (non-régression)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'individual_user' as never, userProfileId: UP_ADMIN_A }),
    );
    expect(recipients).toEqual(new Set([UP_ADMIN_A]));
  });

  it('individual_student : un `studentId` ÉTRANGER rend un ensemble VIDE (branche omise par le brief)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'individual_student' as never, studentId: 'stu-b' }),
    );
    expect([...recipients]).toEqual([]);
  });

  it('individual_student : le tuteur ET le compte lié de l’élève DU TENANT sont conservés (E8-S3)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'individual_student' as never, studentId: 'stu-a' }),
    );
    expect(recipients).toEqual(new Set([UP_GUARDIAN_A, UP_STUDENT_A]));
  });

  it('class_section_scope : une classe ÉTRANGÈRE rend un ensemble VIDE (l’énumération en bloc)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'class_section_scope' as never, classSectionId: 'cls-b' }),
    );
    expect([...recipients]).toEqual([]);
  });

  it('class_section_scope : tuteurs + enseignants + élève lié DU TENANT inchangés (G-PORTAL élève)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'class_section_scope' as never, classSectionId: 'cls-a' }),
    );
    expect(recipients).toEqual(new Set([UP_GUARDIAN_A, UP_TEACHER_A, UP_STUDENT_A]));
    // E8-S3 / FR-S3-7 : le compte lié de l'élève DOIT survivre aux nouveaux
    // prédicats — le portail élève est dans le rayon du CORRECTIF.
    expect(recipients.has(UP_STUDENT_A)).toBe(true);
  });

  it('grade_level_scope : un niveau ÉTRANGER rend VIDE — et ce n’est plus INCIDENT', async () => {
    // La protection d'avant venait UNIQUEMENT du `classSection.findMany({ tenantId })`
    // en amont (zéro classe → zéro destinataire). Rien ne l'épinglait : un
    // refactor déplaçant ce filtre rouvrait la fuite en silence. Ce test est le
    // VERROU de non-régression sur une propriété qui n'était vraie que par
    // dérivation.
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'grade_level_scope' as never, gradeLevelId: 'lvl-b' }),
    );
    expect([...recipients]).toEqual([]);
  });

  it('grade_level_scope : le niveau DU TENANT rend toujours la classe et ses destinataires', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'grade_level_scope' as never, gradeLevelId: 'lvl-a' }),
    );
    expect(recipients).toEqual(new Set([UP_GUARDIAN_A, UP_TEACHER_A, UP_STUDENT_A]));
  });

  it('cycle_scope : un cycle ÉTRANGER rend VIDE (même verrou de dérivation)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'cycle_scope' as never, cycleId: 'cyc-b' }),
    );
    expect([...recipients]).toEqual([]);
  });

  it('cycle_scope : le cycle DU TENANT rend toujours ses destinataires', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(
      announcement({ scope: 'cycle_scope' as never, cycleId: 'cyc-a' }),
    );
    expect(recipients).toEqual(new Set([UP_GUARDIAN_A, UP_TEACHER_A, UP_STUDENT_A]));
  });

  it('school_wide ne rend que les profils du tenant (non-régression)', async () => {
    const { service } = makeService();
    const recipients = await service.computeRecipients(announcement({ scope: 'school_wide' as never }));
    expect(recipients).toEqual(
      new Set([UP_GUARDIAN_A, UP_TEACHER_A, UP_STUDENT_A, UP_ADMIN_A]),
    );
    for (const foreign of FOREIGN_IDS) expect(recipients.has(foreign)).toBe(false);
  });

  it('CHAQUE requête émise par `computeRecipients` porte un `tenantId` EXPLICITE', async () => {
    const { service, seen } = makeService();
    for (const scope of [
      'class_section_scope',
      'grade_level_scope',
      'cycle_scope',
      'individual_student',
      'individual_user',
      'school_wide',
    ] as const) {
      await service.computeRecipients(
        announcement({
          scope: scope as never,
          classSectionId: 'cls-a',
          gradeLevelId: 'lvl-a',
          cycleId: 'cyc-a',
          studentId: 'stu-a',
          userProfileId: UP_ADMIN_A,
        }),
      );
    }
    expect(seen.length).toBeGreaterThan(0);
    for (const call of seen) {
      expect({ ...call, hasTenant: 'tenantId' in call.where }).toMatchObject({ hasTenant: true });
    }
  });

  it('la résolution finale rend la propriété VRAIE même si une colonne amont pointe hors tenant', async () => {
    // `guardian.userProfileId` et `student.userProfileId` sont des UUID NUS,
    // écrits sans preuve de propriété par un AUTRE module (finding séparé). Une
    // `guardianship` parfaitement intra-tenant peut donc pointer un profil
    // étranger. On le SIMULE ici : le prédicat sur la jointure ne suffit pas,
    // c'est la résolution finale qui doit tenir.
    const { service, db } = makeService();
    (db.guardianship[0] as unknown as { guardian: { userProfileId: string } }).guardian.userProfileId =
      UP_GUARDIAN_B;
    const recipients = await service.computeRecipients(
      announcement({ scope: 'individual_student' as never, studentId: 'stu-a' }),
    );
    // Le tuteur empoisonné est ÉCARTÉ ; l'élève lié légitime reste.
    expect(recipients).toEqual(new Set([UP_STUDENT_A]));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-1 — LES SONDES DU CONTRÔLEUR, exécutées à travers `create`
// ═══════════════════════════════════════════════════════════════════════════

function makeController() {
  const { client, announcementCreate, seen } = makeClient();
  const notifications = { createMany: jest.fn() };
  const controller = new AnnouncementsController(
    client as never,
    { ensureUser: async () => ({ id: UP_ADMIN_A, tenantId: TENANT }) } as never,
    { forUser: async () => ({ schoolId: SCHOOL }) } as never,
    new AnnouncementRecipientsService(client as never),
    notifications as never,
  );
  return { controller, client, announcementCreate, notifications, seen };
}

const ADMIN_JWT = { realm_access: { roles: ['school_admin'] } } as KeycloakJwtPayload;
const TEACHER_JWT = { realm_access: { roles: ['teacher'] } } as KeycloakJwtPayload;

const body = (over: Record<string, unknown>) =>
  ({ title: 'Titre', body: 'Corps', ...over }) as never;

describe('AC-1 — `POST /announcements` prouve la PROPRIÉTÉ avant d’écrire', () => {
  it('une classe d’un AUTRE tenant est refusée, et RIEN n’est écrit', async () => {
    const { controller, announcementCreate } = makeController();
    await expect(
      controller.create(body({ scope: 'class_section_scope', classSectionId: 'cls-b' }), ADMIN_JWT),
    ).rejects.toThrow(BadRequestException);
    expect(announcementCreate).not.toHaveBeenCalled();
  });

  it('« autre tenant » et « n’existe pas » produisent le MÊME message, à l’octet près', async () => {
    const { controller } = makeController();
    const foreign = await controller
      .create(body({ scope: 'class_section_scope', classSectionId: 'cls-b' }), ADMIN_JWT)
      .catch((e: BadRequestException) => e);
    const absent = await controller
      .create(
        body({ scope: 'class_section_scope', classSectionId: 'cls-inexistante' }),
        ADMIN_JWT,
      )
      .catch((e: BadRequestException) => e);

    expect(foreign).toBeInstanceOf(BadRequestException);
    expect(absent).toBeInstanceOf(BadRequestException);
    expect(String((foreign as BadRequestException).message)).toBe(
      String((absent as BadRequestException).message),
    );
    const message = String((foreign as BadRequestException).message);
    expect(message).toContain('classSectionId');
    expect(message.toLowerCase()).not.toContain('tenant');
    expect(message).not.toContain(OTHER_TENANT);
    expect(message).not.toContain(TENANT);
  });

  it('les CINQ champs sont sondés — un id étranger est refusé pour chacun', async () => {
    const cases = [
      { scope: 'cycle_scope', field: 'cycleId', id: 'cyc-b' },
      { scope: 'grade_level_scope', field: 'gradeLevelId', id: 'lvl-b' },
      { scope: 'class_section_scope', field: 'classSectionId', id: 'cls-b' },
      { scope: 'individual_student', field: 'studentId', id: 'stu-b' },
      { scope: 'individual_user', field: 'userProfileId', id: UP_GUARDIAN_B },
    ] as const;

    for (const c of cases) {
      const { controller, announcementCreate } = makeController();
      const error = await controller
        .create(body({ scope: c.scope, [c.field]: c.id }), ADMIN_JWT)
        .catch((e: BadRequestException) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(String((error as BadRequestException).message)).toContain(c.field);
      expect(announcementCreate).not.toHaveBeenCalled();
    }
  });

  it('les CINQ champs DU TENANT passent et l’annonce est écrite (non-régression)', async () => {
    const cases = [
      { scope: 'cycle_scope', field: 'cycleId', id: 'cyc-a' },
      { scope: 'grade_level_scope', field: 'gradeLevelId', id: 'lvl-a' },
      { scope: 'class_section_scope', field: 'classSectionId', id: 'cls-a' },
      { scope: 'individual_student', field: 'studentId', id: 'stu-a' },
      { scope: 'individual_user', field: 'userProfileId', id: UP_ADMIN_A },
      { scope: 'school_wide', field: 'title', id: 'Titre' },
    ] as const;

    for (const c of cases) {
      const { controller, announcementCreate } = makeController();
      await controller.create(body({ scope: c.scope, [c.field]: c.id }), ADMIN_JWT);
      expect(announcementCreate).toHaveBeenCalledTimes(1);
    }
  });

  it('la sonde est un `findFirst` avec `tenantId` explicite, et elle précède l’écriture', async () => {
    const { controller, seen, announcementCreate } = makeController();
    await controller.create(
      body({ scope: 'class_section_scope', classSectionId: 'cls-a', publishNow: false }),
      ADMIN_JWT,
    );
    const probe = seen.find((s) => s.model === 'classSection' && s.verb === 'findFirst');
    expect(probe).toBeDefined();
    expect(probe!.where).toEqual({ id: 'cls-a', tenantId: TENANT });
    expect(announcementCreate).toHaveBeenCalledTimes(1);
  });

  it('ORDRE — le refus de RÔLE passe AVANT la sonde : l’enseignant n’apprend rien sur le corps', async () => {
    const { controller, seen } = makeController();
    const error = await controller
      .create(body({ scope: 'individual_user', userProfileId: UP_GUARDIAN_B }), TEACHER_JWT)
      .catch((e: BadRequestException) => e);
    expect(String((error as BadRequestException).message)).toContain(
      "réservée à l'administration",
    );
    // Aucune sonde de propriété n'a été émise : rien n'a été appris.
    expect(seen.filter((s) => s.verb === 'findFirst' && s.model === 'userProfile')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// ADR-053 §D3 — la portée déclarée explique EXACTEMENT les ids fournis
// ═══════════════════════════════════════════════════════════════════════════

describe('ADR-053 §D3 — aucun id de portée persisté que la portée n’explique pas', () => {
  it('`class_section_scope` + `userProfileId` est REFUSÉ (le trou de cohérence de PF-206)', () => {
    expect(() =>
      assertScopeCoherence({
        scope: 'class_section_scope' as never,
        classSectionId: 'cls-a',
        userProfileId: UP_GUARDIAN_B,
      }),
    ).toThrow(BadRequestException);
  });

  it('`school_wide` + n’importe quel id est REFUSÉ (aucune portée ne l’explique)', () => {
    expect(() =>
      assertScopeCoherence({ scope: 'school_wide' as never, studentId: 'stu-a' }),
    ).toThrow(BadRequestException);
  });

  it('la VÉRACITÉ, jamais la présence de la clé : `null` et la chaîne vide ne sont pas « fournis »', () => {
    // Le corps réel des deux composeurs livrés : un seul id, les autres absents
    // ou nuls. Ce refus ne doit casser AUCUN appelant existant.
    expect(() =>
      assertScopeCoherence({
        scope: 'class_section_scope' as never,
        classSectionId: 'cls-a',
        userProfileId: null,
        studentId: '',
      }),
    ).not.toThrow();
    expect(() =>
      assertScopeCoherence({ scope: 'school_wide' as never, cycleId: null }),
    ).not.toThrow();
  });

  it('le refus nomme les CHAMPS en trop et jamais un tenant', () => {
    const error = (() => {
      try {
        assertScopeCoherence({
          scope: 'cycle_scope' as never,
          cycleId: 'cyc-a',
          studentId: 'stu-a',
        });
        return null;
      } catch (e) {
        return e as BadRequestException;
      }
    })();
    expect(error).toBeInstanceOf(BadRequestException);
    expect(String(error!.message)).toContain('studentId');
    expect(String(error!.message).toLowerCase()).not.toContain('tenant');
  });

  it('le plan de propriété est bâti sur les CINQ champs, dans l’ordre, sur la véracité', () => {
    expect(
      scopeOwnershipPlan({ classSectionId: 'cls-a', studentId: null, userProfileId: '' }, [
        'cycleId',
        'gradeLevelId',
        'classSectionId',
        'studentId',
        'userProfileId',
      ]),
    ).toEqual([{ field: 'classSectionId', id: 'cls-a' }]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// AC-3 — le preview reçoit LE MÊME traitement
// ═══════════════════════════════════════════════════════════════════════════

describe('AC-3 — `GET /announcements/preview-recipients`', () => {
  it('une classe ÉTRANGÈRE est refusée AVANT tout calcul de roster', async () => {
    const { controller, seen } = makeController();
    await expect(
      controller.previewRecipients({ scope: 'class_section_scope', classSectionId: 'cls-b' } as never, ADMIN_JWT),
    ).rejects.toThrow(BadRequestException);
    // Aucune requête de roster n'a été émise contre l'id étranger.
    expect(seen.filter((s) => s.model === 'enrollment')).toHaveLength(0);
  });

  it('la classe DU TENANT rend le compte réel (non-régression du panneau d’estimation)', async () => {
    const { controller } = makeController();
    const result = await controller.previewRecipients(
      { scope: 'class_section_scope', classSectionId: 'cls-a' } as never,
      ADMIN_JWT,
    );
    expect(result.count).toBe(3);
  });

  it('AVANT/APRÈS mesuré : le preview ne fuitait PAS de compte — il rendait déjà 0 (le brief se trompait)', async () => {
    // `count` vaut `profiles.length`, issu d'un `userProfile.findMany({ tenantId })` :
    // un id étranger rendait `0`, à l'octet près comme un id inexistant. La
    // sécurité était ACCIDENTELLE ; elle est désormais INTENTIONNELLE (refus),
    // et ce test fige la différence pour que personne n'écrive « fuite de compte
    // fermée » dans le journal.
    const { controller } = makeController();
    const foreign = await controller
      .previewRecipients({ scope: 'class_section_scope', classSectionId: 'cls-b' } as never, ADMIN_JWT)
      .catch((e: BadRequestException) => e);
    const absent = await controller
      .previewRecipients(
        { scope: 'class_section_scope', classSectionId: 'cls-inexistante' } as never,
        ADMIN_JWT,
      )
      .catch((e: BadRequestException) => e);
    expect(String((foreign as BadRequestException).message)).toBe(
      String((absent as BadRequestException).message),
    );
  });

  it('PM-5 — le preview applique désormais l’empreinte d’enseignement que son docblock promettait', async () => {
    const { controller, client } = makeController();
    // Un enseignant existe, mais n'a AUCUNE affectation sur `cls-a`.
    client.teacherProfile.findFirst = jest.fn(async () => ({ id: 'tp-1' })) as never;
    const error = await controller
      .previewRecipients({ scope: 'class_section_scope', classSectionId: 'cls-a' } as never, TEACHER_JWT)
      .catch((e: BadRequestException) => e);
    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as BadRequestException).message)).toContain(
      'que vous enseignez',
    );
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// G-DNC — assertions de SOURCE
// ═══════════════════════════════════════════════════════════════════════════

describe('G-DNC / AC-11 — assertions de source', () => {
  const CONTROLLER = readFileSync(join(__dirname, 'announcements.controller.ts'), 'utf8');
  const SERVICE = readFileSync(join(__dirname, 'announcements.service.ts'), 'utf8');

  it('DNC-10 — aucun drapeau de contournement, aucun id allow-listé, aucun bouton d’env', () => {
    for (const source of [CONTROLLER, SERVICE]) {
      expect(source).not.toContain('process.env');
      expect(source).not.toContain('NODE_ENV');
      expect(source).not.toContain('SKIP_');
      expect(source).not.toContain('ALLOW_');
    }
  });

  it('les sondes sont des `findFirst` avec `tenantId` EXPLICITE — 5 dans `create`, 5 dans le preview', () => {
    const probe =
      /\.findFirst\(\s*\{\s*where:\s*\{\s*id:\s*ref\.id\s*,\s*tenantId\s*,?\s*\}\s*,\s*select:\s*\{\s*id:\s*true\s*,?\s*\}\s*,?\s*\}\s*\)/g;
    expect(CONTROLLER.match(probe)).toHaveLength(10);
    // Jamais un `findUnique` par id seul : il distinguerait « autre tenant » de
    // « n'existe pas » par le simple fait de trouver la ligne.
    expect(CONTROLLER).not.toContain('findUnique({ where: { id: ref.id');
  });

  it('les deux `switch` de propriété sont CLOS par un `never` (échec fermé)', () => {
    expect(CONTROLLER.split('const exhaustive: never = ref.field;').length - 1).toBe(2);
  });

  it('les sondes sont SÉQUENTIELLES — jamais `Promise.all` dans la boucle de propriété', () => {
    const loops = [...CONTROLLER.matchAll(/for \(const ref of scopeOwnershipPlan\(/g)];
    expect(loops).toHaveLength(2);
    for (const loop of loops) {
      const start = loop.index!;
      const end = CONTROLLER.indexOf('if (owned === null) throw unknownScopeRef(ref.field);', start);
      expect(end).toBeGreaterThan(start);
      expect(CONTROLLER.slice(start, end)).not.toContain('Promise.all');
    }
  });

  it('la boucle est écrite EN LIGNE dans les deux handlers (PF-200 — attribution lexicale)', () => {
    // Pas de `this.<méthode>()` qui cacherait les sondes : le compteur de
    // `tenant-adversarial-check.js` ne traverse pas `this`.
    expect(CONTROLLER).not.toMatch(/private\s+async\s+\w*[Oo]wnership\w*\s*\(/);
  });

  it('AUCUNE lecture de destinataires du service n’est sans `tenantId`', () => {
    const reads = [...SERVICE.matchAll(/this\.prisma\.(\w+)\.(findMany|findFirst)\(\{/g)];
    // 9 lectures : userProfile ×3 (individual_user, résolution finale,
    // allTenantUsers), classSection ×2, guardianship, student,
    // teachingAssignment, enrollment. `announcementReceipt.createMany` n'en est
    // pas une (la table ne porte PAS de `tenant_id` — c'est un finding, pas un
    // oubli de ce diff).
    expect(reads.length).toBeGreaterThanOrEqual(9);
    for (const read of reads) {
      const start = read.index!;
      const block = SERVICE.slice(start, SERVICE.indexOf('});', start) + 3);
      expect({ model: read[1], verb: read[2], hasTenant: block.includes('tenantId') }).toMatchObject(
        { hasTenant: true },
      );
    }
  });

  it('DNC-06 — la source dit que la connexion est celle du PROPRIÉTAIRE et que RLS ne double rien', () => {
    expect(SERVICE).toContain('FORCE ROW LEVEL SECURITY');
    expect(CONTROLLER).toContain('FORCE ROW LEVEL SECURITY');
  });
});
