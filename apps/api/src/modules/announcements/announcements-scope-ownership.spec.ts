import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { BadRequestException, NotFoundException } from '@nestjs/common';

import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { scopeOwnershipPlan } from '../../shared/prisma/scope-fk';
import {
  APP_ROLE_REQUIRED_PRIVILEGES,
  currentTenantScopeFrame,
  privilegeKey,
  runInTenantScope,
} from '../../shared/prisma/tenant-scope';
import type { TenantScopeService } from '../../shared/prisma/tenant-scope.service';

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

/** Les annonces : celles du tenant appelant, et celles qu'il ne doit jamais voir. */
const ANN_A = 'ann-a';
const ANN_OTHER = 'ann-b';
const ANN_PUBLISHED = 'ann-a-pub';
const ANN_OTHER_PUBLISHED = 'ann-b-pub';

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
    // S-E01-1g — les deux tables que la conversion fait entrer dans la portée.
    // `ann-b` appartient au tenant B : c'est le CONTRÔLE NÉGATIF des gardes
    // applicatives, qui doivent survivre à la conversion (ADR-042 §D1).
    announcement: [
      {
        id: ANN_A,
        tenantId: TENANT,
        authorId: UP_ADMIN_A,
        publishedAt: null,
        title: 'Titre A',
        body: 'Corps A',
      },
      {
        id: ANN_OTHER,
        tenantId: OTHER_TENANT,
        authorId: 'up-admin-b',
        publishedAt: null,
        title: 'Titre B',
        body: 'Corps B',
      },
      {
        id: ANN_PUBLISHED,
        tenantId: TENANT,
        authorId: UP_ADMIN_A,
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        title: 'Publiée',
        body: 'Corps publié',
      },
      // Le PIÈGE du compteur de non-lus : une annonce PUBLIÉE d'un AUTRE tenant
      // pour laquelle l'appelant porte un reçu (la forme des lignes sombres de
      // PF-208). Le filtre de jointure `announcement: { tenantId }` doit
      // l'écarter — sinon le badge du portail parent compte des annonces
      // étrangères.
      {
        id: ANN_OTHER_PUBLISHED,
        tenantId: OTHER_TENANT,
        authorId: 'up-admin-b',
        publishedAt: new Date('2026-01-01T00:00:00.000Z'),
        title: 'Publiée ailleurs',
        body: 'Corps',
      },
    ] as Row[],
    announcementReceipt: [
      { id: 'rec-a', announcementId: ANN_A, userProfileId: UP_ADMIN_A, readAt: null },
      { id: 'rec-b', announcementId: ANN_OTHER, userProfileId: UP_GUARDIAN_B, readAt: null },
      { id: 'rec-pub', announcementId: ANN_PUBLISHED, userProfileId: UP_ADMIN_A, readAt: null },
      { id: 'rec-cross', announcementId: ANN_OTHER_PUBLISHED, userProfileId: UP_ADMIN_A, readAt: null },
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
    // S-E01-1g — le filtre de JOINTURE du compteur de non-lus. Il est ÉVALUÉ,
    // pas ignoré : c'est lui qui prouve que `announcement.SELECT` est bien dû.
    if (key === 'announcement') {
      const parent = db.announcement.find((a) => a.id === row.announcementId);
      if (!parent) return false;
      if (!matches(db, parent, cond as Record<string, unknown>)) return false;
      continue;
    }
    if (key === 'OR') {
      const branches = cond as Record<string, unknown>[];
      if (!branches.some((branch) => matches(db, row, branch))) return false;
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
      if ('gte' in (operators as { gte?: unknown })) {
        const bound = (operators as { gte: Date }).gte;
        if (!(value instanceof Date) || value < bound) return false;
        continue;
      }
      throw new Error(`fausse base : opérateur non supporté sur \`${key}\` — ${JSON.stringify(cond)}`);
    }
    if (value !== cond) return false;
  }
  return true;
}

/**
 * S-E01-1g — CHAQUE instruction enregistre le CADRE `AsyncLocalStorage` RÉEL
 * observé au moment où elle est émise (`scopeTenant`). C'est ce qui rend AC-6
 * MESURABLE au lieu de déclaratif : un handler « converti » dont une
 * instruction voit `undefined` est un demi-handler (PF-217), et le test le dit
 * par son nom au lieu de le laisser au compteur du script.
 */
type Statement = {
  model: string;
  verb: string;
  where: Record<string, unknown>;
  scopeTenant: string | undefined;
};

function makeClient() {
  const db = seed();
  const seen: Statement[] = [];
  const record = (model: string, verb: string, where: Record<string, unknown>) => {
    seen.push({ model, verb, where, scopeTenant: currentTenantScopeFrame()?.tenantId });
  };
  /**
   * `findUnique` par CLÉ : soit l'id, soit la clé composite
   * `announcementId_userProfileId`. Il ne connaît PAS le tenant — ce qui est
   * exactement pourquoi les gardes applicatives restent (ADR-042 §D1).
   */
  const byUniqueKey = (name: keyof Db, where: Record<string, unknown>): Row | null => {
    if ('id' in where) return db[name].find((row) => row.id === where.id) ?? null;
    const entries = Object.entries(where);
    if (entries.length !== 1) {
      throw new Error(`fausse base : \`findUnique\` sans clé exploitable — ${JSON.stringify(where)}`);
    }
    const compound = entries[0]![1] as Record<string, unknown>;
    return db[name].find((row) => Object.entries(compound).every(([k, v]) => row[k] === v)) ?? null;
  };
  const model = (name: keyof Db) => ({
    findMany: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      record(name, 'findMany', args?.where ?? {});
      return db[name].filter((row) => matches(db, row, args?.where));
    }),
    findFirst: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      record(name, 'findFirst', args?.where ?? {});
      return db[name].find((row) => matches(db, row, args?.where)) ?? null;
    }),
    findUnique: jest.fn(async (args: { where: Record<string, unknown> }) => {
      record(name, 'findUnique', args.where);
      return byUniqueKey(name, args.where);
    }),
    count: jest.fn(async (args?: { where?: Record<string, unknown> }) => {
      record(name, 'count', args?.where ?? {});
      return db[name].filter((row) => matches(db, row, args?.where)).length;
    }),
    update: jest.fn(async (args: { where: Record<string, unknown>; data: Row }) => {
      record(name, 'update', args.where);
      const row = byUniqueKey(name, args.where);
      if (!row) throw new Error('P2025');
      Object.assign(row, args.data);
      return row;
    }),
  });
  const announcementCreate = jest.fn(async (args: { data: Row }) => {
    record('announcement', 'create', {});
    return { id: 'ann-1', ...args.data };
  });
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
    announcement: { ...model('announcement'), create: announcementCreate },
    announcementReceipt: model('announcementReceipt'),
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

/**
 * S-E01-1g / AC-6 — LE DOUBLE DE `TenantScopeService` INSTALLE LE VRAI CADRE.
 *
 * `runInTenantScope` est importé DE LA COUTURE elle-même, pas réimplémenté :
 * c'est le même `AsyncLocalStorage` que la production, donc `scopeTenant`
 * enregistré par chaque instruction est une MESURE et non une déclaration. Un
 * booléen posé par le double prouverait seulement que le double a été appelé.
 */
function makeController(over: { me?: { id: string; tenantId: string } } = {}) {
  const { client, announcementCreate, seen } = makeClient();
  const me = over.me ?? { id: UP_ADMIN_A, tenantId: TENANT };

  /** Les tenants passés à la couture, dans l'ordre — une portée par requête. */
  const runs: string[] = [];
  /** Le cadre observé À L'ENTRÉE de chaque callback. */
  const scopeAtCallbackEntry: (string | undefined)[] = [];
  /** Le cadre observé par CHAQUE résolveur d'identité (PF-199 : doit être `undefined`). */
  const scopeAtIdentityCall: { who: string; tenant: string | undefined }[] = [];

  const scope = {
    run: async <T>(tenantId: string, fn: (tx: unknown) => Promise<T>): Promise<T> => {
      runs.push(tenantId);
      return runInTenantScope({ tenantId, tx: client }, async () => {
        scopeAtCallbackEntry.push(currentTenantScopeFrame()?.tenantId);
        return fn(client);
      });
    },
  } as unknown as TenantScopeService;

  const users = {
    ensureUser: async () => {
      scopeAtIdentityCall.push({
        who: 'users.ensureUser',
        tenant: currentTenantScopeFrame()?.tenantId,
      });
      return me;
    },
  };
  const ctx = {
    forUser: async () => {
      scopeAtIdentityCall.push({
        who: 'ctx.forUser',
        tenant: currentTenantScopeFrame()?.tenantId,
      });
      return { schoolId: SCHOOL };
    },
  };

  const notifications = { createMany: jest.fn() };
  const controller = new AnnouncementsController(
    client as never,
    scope,
    users as never,
    ctx as never,
    new AnnouncementRecipientsService(client as never),
    notifications as never,
  );
  return {
    controller,
    client,
    announcementCreate,
    notifications,
    seen,
    runs,
    scopeAtCallbackEntry,
    scopeAtIdentityCall,
  };
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
// S-E01-1g / AC-6 — LA PREUVE DE CADRE : ce qui tourne DANS la portée, et ce
// qui n'y tourne PAS. La moitié NÉGATIVE est celle qui prouve quelque chose.
// ═══════════════════════════════════════════════════════════════════════════

describe('AC-6 — les cinq handlers convertis émettent CHAQUE instruction sous un cadre de portée', () => {
  /** Le cadre observé par chaque instruction émise pendant l'appel. */
  const frames = (h: ReturnType<typeof makeController>) => h.seen.map((s) => s.scopeTenant);

  it('`unread-count` — une instruction, une portée, et le filtre de jointure ÉCARTE l’annonce étrangère', async () => {
    const h = makeController();
    const result = await h.controller.unreadCount(ADMIN_JWT);
    // `rec-pub` (publiée, tenant A) compte ; `rec-cross` (publiée, tenant B)
    // NON, et `rec-a` non plus (jamais publiée). Le badge ne compte pas les
    // lignes sombres.
    expect(result).toEqual({ unread: 1 });
    expect(h.runs).toEqual([TENANT]);
    expect(h.scopeAtCallbackEntry).toEqual([TENANT]);
    expect(frames(h)).toEqual([TENANT]);
  });

  it('`create` — les DEUX moitiés (sonde de propriété + écriture) voient le cadre', async () => {
    const h = makeController();
    await h.controller.create(
      body({ scope: 'class_section_scope', classSectionId: 'cls-a' }),
      ADMIN_JWT,
    );
    // UNE portée par requête : deux portées successives seraient deux
    // transactions, donc une fenêtre TOCTOU entre la sonde et l'écriture.
    expect(h.runs).toEqual([TENANT]);
    expect(h.seen.map((s) => `${s.model}.${s.verb}`)).toEqual([
      'classSection.findFirst',
      'announcement.create',
    ]);
    expect(frames(h)).toEqual([TENANT, TENANT]);
  });

  it('`update` — garde ET écriture dans la MÊME portée (le TOCTOU est fermé, pas déplacé)', async () => {
    const h = makeController();
    await h.controller.update(ANN_A, { title: 'Nouveau' } as never, ADMIN_JWT);
    expect(h.runs).toEqual([TENANT]);
    expect(h.seen.map((s) => `${s.model}.${s.verb}`)).toEqual([
      'announcement.findUnique',
      'announcement.update',
    ]);
    expect(frames(h)).toEqual([TENANT, TENANT]);
  });

  it('`publish` — la lecture de garde est dans la portée, et le fan-out n’y est PAS', async () => {
    const h = makeController();
    const result = await h.controller.publish(ANN_PUBLISHED, ADMIN_JWT);
    // Déjà publiée : on sort AVANT `publishInternal`, donc la seule instruction
    // du handler est sa garde — et elle a bien vu le cadre.
    expect(result).toEqual({
      ok: true,
      alreadyPublished: true,
      publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    expect(h.runs).toEqual([TENANT]);
    expect(frames(h)).toEqual([TENANT]);
    expect(h.notifications.createMany).not.toHaveBeenCalled();
  });

  it('`markRead` — les deux instructions sous le cadre, puis l’idempotence n’en coûte qu’une', async () => {
    const h = makeController();
    expect(await h.controller.markRead(ANN_PUBLISHED, ADMIN_JWT)).toEqual({ ok: true });
    expect(h.seen.map((s) => `${s.model}.${s.verb}`)).toEqual([
      'announcementReceipt.findUnique',
      'announcementReceipt.update',
    ]);
    expect(frames(h)).toEqual([TENANT, TENANT]);

    // Deuxième appel : déjà lu → une seule lecture, pas de seconde écriture.
    expect(await h.controller.markRead(ANN_PUBLISHED, ADMIN_JWT)).toEqual({
      ok: true,
      alreadyRead: true,
    });
    expect(h.seen.filter((s) => s.verb === 'update')).toHaveLength(1);
    expect(h.runs).toEqual([TENANT, TENANT]);
  });

  it('PF-199 (la moitié NÉGATIVE) — `ensureUser` et `forUser` ne voient JAMAIS de cadre', async () => {
    const h = makeController();
    await h.controller.create(
      body({ scope: 'class_section_scope', classSectionId: 'cls-a' }),
      ADMIN_JWT,
    );
    expect(h.scopeAtIdentityCall.map((c) => c.who)).toEqual(['users.ensureUser', 'ctx.forUser']);
    // LA propriété : la résolution d'identité PRODUIT le tenantId, elle ne peut
    // pas le consommer. Un cadre observé ici signifierait qu'elle tourne dans
    // une transaction ouverte sur une clé qu'elle n'a pas encore résolue.
    expect(h.scopeAtIdentityCall.every((c) => c.tenant === undefined)).toBe(true);
  });

  it('CONTRÔLE NÉGATIF — `preview-recipients`, NON converti, n’ouvre AUCUNE portée et chaque instruction voit `undefined`', async () => {
    // Sans ce cas, les assertions ci-dessus pourraient être vertes à vide : un
    // harnais qui installerait un cadre en permanence les satisferait toutes.
    const h = makeController();
    const result = await h.controller.previewRecipients(
      { scope: 'class_section_scope', classSectionId: 'cls-a' } as never,
      ADMIN_JWT,
    );
    expect(result.count).toBe(3);
    expect(h.runs).toEqual([]);
    expect(h.seen.length).toBeGreaterThan(1);
    expect(frames(h).every((f) => f === undefined)).toBe(true);
  });

  it('CONTRÔLE NÉGATIF — `assertTeacherScope` refuse AVANT toute portée (G-AUTHZ : l’ordre est la propriété)', async () => {
    const h = makeController({ me: { id: UP_TEACHER_A, tenantId: TENANT } });
    await expect(
      h.controller.create(body({ scope: 'school_wide' }), TEACHER_JWT),
    ).rejects.toThrow(BadRequestException);
    // Un corps refusé pour cause de RÔLE n'a coûté AUCUNE transaction.
    expect(h.runs).toEqual([]);
    expect(h.announcementCreate).not.toHaveBeenCalled();
  });

  it('G-AUTHZ — les gardes survivent à la reliaison : annonce d’un AUTRE tenant → 404, et rien n’est écrit', async () => {
    for (const run of [
      (h: ReturnType<typeof makeController>) =>
        h.controller.update(ANN_OTHER, { title: 'x' } as never, ADMIN_JWT),
      (h: ReturnType<typeof makeController>) => h.controller.publish(ANN_OTHER, ADMIN_JWT),
      (h: ReturnType<typeof makeController>) => h.controller.markRead(ANN_OTHER, ADMIN_JWT),
    ]) {
      const h = makeController();
      await expect(run(h)).rejects.toThrow(NotFoundException);
      expect(h.seen.filter((s) => s.verb === 'update')).toHaveLength(0);
    }
  });

  it('G-AUTHZ — un non-auteur non-administrateur ne peut pas modifier, et le refus est DANS la portée déjà ouverte', async () => {
    const h = makeController({ me: { id: UP_TEACHER_A, tenantId: TENANT } });
    await expect(
      h.controller.update(ANN_A, { title: 'x' } as never, TEACHER_JWT),
    ).rejects.toThrow(BadRequestException);
    expect(h.seen.filter((s) => s.verb === 'update')).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// S-E01-1g / AC-6 (2) — LE CLIQUET DE CLÔTURE : les sites d'appel de portée
// dérivés de la SOURCE ⊆ `APP_ROLE_REQUIRED_PRIVILEGES`, et rien de plus.
// ═══════════════════════════════════════════════════════════════════════════

describe('AC-6 — les sites d’appel de portée d’announcements ⊆ la clôture déclarée', () => {
  const SOURCE = readFileSync(join(__dirname, 'announcements.controller.ts'), 'utf8');

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

  /** `announcementReceipt` -> `announcement_receipt`, la convention `@@map`. */
  const toTable = (model: string): string => model.replace(/[A-Z]/g, (c) => '_' + c.toLowerCase());

  const sites = [...SOURCE.matchAll(/\btx\s*\.\s*(\w+)\s*\.\s*(\w+)\s*\(/g)].map(([, model, verb]) => ({
    model: String(model),
    verb: String(verb),
    table: toTable(String(model)),
  }));

  it('le corpus de sites est NON VIDE et n’utilise que des verbes connus', () => {
    // Une regex qui ne matche plus rien rendrait les tests suivants verts à vide.
    // DOUZE à cette tranche (unreadCount 1, create 6, update 2, publish 1,
    // markRead 2) ; une tranche ultérieure qui en convertit d'autres fait
    // MONTER ce nombre, jamais descendre.
    expect(sites.length).toBeGreaterThanOrEqual(12);
    expect(sites.filter((s) => VERB_PRIVILEGE[s.verb] === undefined)).toEqual([]);
  });

  it('chaque (table, privilège) émis DANS une portée est DÉCLARÉ', () => {
    const declared = new Set(
      APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)),
    );
    const missing = [
      ...new Set(
        sites
          .map((s) => privilegeKey(s.table, VERB_PRIVILEGE[s.verb] ?? 'UNKNOWN'))
          .filter((key) => !declared.has(key)),
      ),
    ].sort();
    expect(missing).toEqual([]);
  });

  it('les tables NOUVELLES de cette tranche sont présentes, verbe par verbe (garde anti-vacuité)', () => {
    const declared = new Set(
      APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)),
    );
    for (const key of [
      'announcement.SELECT',
      'announcement.INSERT',
      'announcement.UPDATE',
      'announcement_receipt.SELECT',
      'announcement_receipt.UPDATE',
      'student.SELECT',
      'cycle.SELECT',
      'grade_level.SELECT',
      'class_section.SELECT',
      'user_profile.SELECT',
    ]) {
      expect(declared.has(key)).toBe(true);
    }
    for (const requirement of APP_ROLE_REQUIRED_PRIVILEGES) {
      expect(requirement.why.trim().length).toBeGreaterThan(10);
    }
  });

  it('GARDE INVERSE — la clôture ne DÉCLARE PAS un privilège que `app_user` ne détient pas, ni une table qu’aucune portée n’atteint', () => {
    // `announcement_receipt` n'a QUE `SELECT, INSERT, UPDATE` (migration dérivée
    // :371, ensemble CLOS). Déclarer `DELETE` rendrait `refused_unusable` au
    // démarrage — donc un 503 sur calendar ET lessons aussi, cette liste étant
    // GLOBALE. C'est la faute la plus coûteuse que cette tranche pouvait commettre.
    const declared = new Set(
      APP_ROLE_REQUIRED_PRIVILEGES.map((r) => privilegeKey(r.table, r.privilege)),
    );
    expect(declared.has('announcement_receipt.DELETE')).toBe(false);
    // Et le DÉRIVÉ ne les réclame pas non plus : `remove` et `publishInternal`
    // sont exclus, donc aucun `tx.` ne porte DELETE ni ne touche `notification`.
    const derived = new Set(
      sites.map((s) => privilegeKey(s.table, VERB_PRIVILEGE[s.verb] ?? 'UNKNOWN')),
    );
    expect([...derived].filter((k) => k.endsWith('.DELETE'))).toEqual([]);
    expect([...derived].filter((k) => k.startsWith('notification'))).toEqual([]);
    expect([...derived].filter((k) => k.startsWith('user_role'))).toEqual([]);
    // `notification` n'est atteint que par `publishInternal`, exclu : aucune
    // entrée de clôture ne doit le certifier (la vacuité de PF-219).
    expect(declared.has('notification.INSERT')).toBe(false);
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

  it('S-E01-1g / DNC-06 — le module est dit PARTIELLEMENT converti, jamais « isolé »', () => {
    expect(CONTROLLER).toContain('PARTIELLEMENT');
    // Le service, lui, n'est converti sur AUCUN site : sa limite doit rester
    // vraie de CE fichier-là après que le contrôleur a changé (FM-9).
    expect(SERVICE).toContain('CE SERVICE ne l');
  });

  it('S-E01-1g / AC-3 — chaque handler NON converti porte un docblock d’exclusion', () => {
    // Non pas « il existe un commentaire », mais « le MÉCANISME est nommé » :
    // chacune de ces chaînes désigne la cause structurelle, pas l'inconvénient.
    for (const mechanism of [
      'NON CONVERTI',
      'PROPRE `PrismaService`',
      'HORS PORTÉE',
      'onDelete: Cascade',
      'transaction interactive',
    ]) {
      expect(CONTROLLER).toContain(mechanism);
    }
  });

  it('S-E01-1g / C-1 — `announcements.module.ts` ne câble RIEN pour la couture (PrismaModule est @Global)', () => {
    const MODULE = readFileSync(join(__dirname, 'announcements.module.ts'), 'utf8');
    expect(MODULE).not.toContain('TenantScopeService');
    expect(MODULE).not.toContain('PrismaModule');
  });

  it('S-E01-1g / AC-9 (G-DNC) — aucun plancher de ratio sur le compteur de bascule', () => {
    // DNC-10 : un plancher est un bouton, et un bouton ici est un drapeau de
    // contournement déguisé. Le compteur se lit, il ne se garantit pas.
    for (const source of [CONTROLLER, SERVICE]) {
      expect(source).not.toMatch(/MIN_(SCOPED|COVERAGE|RATIO)/);
      expect(source).not.toMatch(/coverageFloor|ratioFloor/);
    }
  });
});
