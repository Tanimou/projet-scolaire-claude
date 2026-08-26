import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ForbiddenException } from '@nestjs/common';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { type UserSyncService } from '../../shared/auth/user-sync.service';
import { type PrismaService } from '../../shared/prisma/prisma.service';
import { type TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import { type NotificationsService } from '../notifications/notifications.service';
import { StudentAccessService } from '../students/student-access.service';
import { type TeacherProfileService } from '../teaching/teacher-profile.service';

import { LessonsController } from './lessons.controller';
import { matchesStatusFilter } from '../../shared/testing/prisma-status-filter';

/**
 * S-E03-2 / `AC-2` / `ADR-071 §D1`+`§D2` — `GET /api/v1/lessons?studentId=…`.
 *
 * DEUX AFFIRMATIONS, ET ELLES ÉCHOUENT TOUTES DEUX SUR L'ARBRE PRÉ-DIFF POUR
 * DEUX RAISONS DIFFÉRENTES
 * ------------------------------------------------------------------------
 *  (1) `AC-2`, LE FAIL-OPEN. Le garde pré-diff s'armait UNIQUEMENT sur
 *      `if (roles.includes('parent'))`. Un enseignant — ou n'importe quel rôle
 *      personnalisé auquel `roles.write` a accordé `lessons.read`
 *      (ADR-013/015) — ne rencontrait AUCUNE vérification d'élève et lisait le
 *      fil de leçons d'un élève arbitraire du tenant. Les deux premiers cas
 *      ci-dessous résolvaient ; ils refusent désormais.
 *
 *  (2) `AC-H1`, L'ORDONNANCEMENT. Le garde vivait DANS `this.scope.run`, une
 *      transaction interactive dont le budget documenté est « ≤ 2
 *      instructions » (`tenant-scope.service.ts:133`), alors que
 *      `StudentAccessService` lit sur la connexion du PROPRIÉTAIRE. Le cas
 *      « le mur se referme AVANT l'ouverture de la portée » assied l'ORDRE,
 *      pas seulement la présence de l'appel : un double de `scope.run` qui
 *      n'exécute jamais son rappel ferait passer une assertion de simple
 *      présence, et un refus levé DANS la portée avorterait une transaction
 *      dont il n'a pas besoin.
 *
 * LE CONTRÔLE NÉGATIF EST OBLIGATOIRE (R-30) : le parent RÉELLEMENT tuteur doit
 * continuer à lire le fil de son enfant. Sans lui, un garde qui refuse tout le
 * monde satisferait cette suite.
 *
 * HERMÉTIQUE : aucun id de seed (`hermetic-spec-writers-gate.spec.ts`).
 */

const TENANT = 'tenant-a';
const STUDENT_TAUGHT = 'student-taught';
const STUDENT_STRANGER = 'student-stranger';
const SECTION_TAUGHT = 'section-taught';
const SECTION_OTHER = 'section-other';
const TEACHER_USER = 'user-teacher';
const TEACHER_PROFILE = 'tp-teacher';
const PARENT_USER = 'user-parent';

type Row = Record<string, unknown>;

const TEACHER_JWT: KeycloakJwtPayload = { sub: 'sub-teacher', realm_access: { roles: ['teacher'] } };
const PARENT_JWT: KeycloakJwtPayload = { sub: 'sub-parent', realm_access: { roles: ['parent'] } };
/** Le rôle personnalisé : porte `lessons.read` sans porter `parent` (ADR-013/015). */
const CUSTOM_JWT: KeycloakJwtPayload = { sub: 'sub-custom', realm_access: { roles: ['librarian'] } };
const ADMIN_JWT: KeycloakJwtPayload = {
  sub: 'sub-admin',
  realm_access: { roles: ['school_admin'] },
};

function makeWorld() {
  const assignments: Row[] = [
    { classSectionId: SECTION_TAUGHT, teacherProfileId: TEACHER_PROFILE, tenantId: TENANT },
  ];
  const enrollments: Row[] = [
    { studentId: STUDENT_TAUGHT, classSectionId: SECTION_TAUGHT, tenantId: TENANT, status: 'active' },
    { studentId: STUDENT_STRANGER, classSectionId: SECTION_OTHER, tenantId: TENANT, status: 'active' },
  ];
  const guardianships: Row[] = [
    { studentId: STUDENT_TAUGHT, tenantId: TENANT, status: 'active', guardianUserProfileId: PARENT_USER },
  ];

  /** Journal d'ORDONNANCEMENT : c'est lui qui porte `AC-H1`. */
  const trace: string[] = [];

  const prisma = {
    student: {
      findFirst: jest.fn(async () => null),
    },
    teachingAssignment: {
      findMany: jest.fn(async (args: { where: { tenantId: string; teacherProfileId: string } }) => {
        trace.push('abac:teachingAssignment');
        return assignments.filter(
          (a) =>
            a['tenantId'] === args.where.tenantId &&
            a['teacherProfileId'] === args.where.teacherProfileId,
        );
      }),
    },
    enrollment: {
      findMany: jest.fn(
        async (args: {
          where: { tenantId: string; status?: string; classSectionId?: { in: string[] } };
        }) => {
          trace.push('abac:enrollment');
          return enrollments.filter(
            (e) =>
              e['tenantId'] === args.where.tenantId &&
              e['status'] === args.where.status &&
              (args.where.classSectionId?.in ?? []).includes(e['classSectionId'] as string),
          );
        },
      ),
    },
    guardianship: {
      findMany: jest.fn(
        async (args: {
          where: { tenantId: string; status: string; guardian: { userProfileId: string } };
        }) => {
          trace.push('abac:guardianship');
          return guardianships.filter(
            (g) =>
              g['tenantId'] === args.where.tenantId &&
              matchesStatusFilter(g['status'] as string, args.where.status) &&
              g['guardianUserProfileId'] === args.where.guardian.userProfileId,
          );
        },
      ),
    },
  };

  const lessonFindMany = jest.fn(async (_args: { where: Row }) => [] as Row[]);
  const txEnrollmentFindMany = jest.fn(async () => [{ classSectionId: SECTION_TAUGHT }]);

  /**
   * `scope.run` EXÉCUTE son rappel — un double qui ne l'exécuterait pas
   * rendrait toute assertion sur ce qui se passe « dans la portée » vacante.
   */
  const scope = {
    run: jest.fn(async (_tenantId: string, fn: (tx: unknown) => Promise<unknown>) => {
      trace.push('scope:open');
      const tx = {
        enrollment: { findMany: txEnrollmentFindMany },
        lessonEntry: { findMany: lessonFindMany },
      };
      const out = await fn(tx);
      trace.push('scope:close');
      return out;
    }),
  };

  const teachers = {
    findForUser: jest.fn(async (user: { id: string }) =>
      user.id === TEACHER_USER ? { id: TEACHER_PROFILE } : null,
    ),
    ensureForUser: jest.fn(async () => {
      throw new Error('ensureForUser is an UPSERT and must never be reached on a read path');
    }),
  };

  const access = new StudentAccessService(
    prisma as unknown as PrismaService,
    teachers as unknown as TeacherProfileService,
  );

  const users = {
    ensureUser: jest.fn(async (jwt: KeycloakJwtPayload) => ({
      id: jwt.sub === 'sub-parent' ? PARENT_USER : jwt.sub === 'sub-teacher' ? TEACHER_USER : 'user-other',
      tenantId: TENANT,
    })),
  };

  const controller = new LessonsController(
    prisma as unknown as PrismaService,
    scope as unknown as TenantScopeService,
    users as unknown as UserSyncService,
    teachers as unknown as TeacherProfileService,
    {} as unknown as NotificationsService,
    access,
  );

  return { controller, scope, lessonFindMany, txEnrollmentFindMany, trace };
}

describe('AC-2 — le garde `?studentId=` couvre TOUS les appelants, plus seulement `parent`', () => {
  it('ROUGE-AVANT — un ENSEIGNANT sans affectation pour cet élève est REFUSÉ (il passait)', async () => {
    const { controller, scope } = makeWorld();

    await expect(
      controller.list(TEACHER_JWT, undefined, undefined, STUDENT_STRANGER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    // Le refus est PROPRE : aucune transaction n'a été ouverte pour rien.
    expect(scope.run).not.toHaveBeenCalled();
  });

  it('ROUGE-AVANT — un rôle PERSONNALISÉ porteur de `lessons.read` est REFUSÉ (il ne rencontrait aucun garde)', async () => {
    const { controller, scope } = makeWorld();

    await expect(
      controller.list(CUSTOM_JWT, undefined, undefined, STUDENT_TAUGHT),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(scope.run).not.toHaveBeenCalled();
  });

  it('CONTRÔLE NÉGATIF — le parent TUTEUR lit toujours le fil de son enfant', async () => {
    const { controller, lessonFindMany, txEnrollmentFindMany } = makeWorld();

    await expect(
      controller.list(PARENT_JWT, undefined, undefined, STUDENT_TAUGHT),
    ).resolves.toEqual({ data: [] });

    expect(txEnrollmentFindMany).toHaveBeenCalledTimes(1);
    const where = lessonFindMany.mock.calls[0]?.[0].where as Row | undefined;
    expect(where?.['tenantId']).toBe(TENANT);
    // Un parent n'est pas du personnel : le filtre `published` survit intact.
    expect(where?.['status']).toBe('published');
    expect(where?.['teachingAssignment']).toEqual({ classSectionId: { in: [SECTION_TAUGHT] } });
  });

  it('CONTRÔLE NÉGATIF — l’enseignant QUI enseigne l’élève lit toujours, et voit les leçons non publiées', async () => {
    const { controller, lessonFindMany } = makeWorld();

    await expect(
      controller.list(TEACHER_JWT, undefined, undefined, STUDENT_TAUGHT),
    ).resolves.toEqual({ data: [] });

    const where = lessonFindMany.mock.calls[0]?.[0].where as Row | undefined;
    expect(where?.['status']).toBeUndefined();
  });

  it('un administrateur résout SANS qu’aucune requête ABAC soit émise (sentinelle `studentIds: null`)', async () => {
    const { controller, trace } = makeWorld();

    await expect(
      controller.list(ADMIN_JWT, undefined, undefined, STUDENT_STRANGER),
    ).resolves.toEqual({ data: [] });

    // Le coût du mur pour l'administration est EXACTEMENT nul : c'est ce qui
    // permet de l'appeler sans branche de rôle dans le contrôleur.
    expect(trace.filter((t) => t.startsWith('abac:'))).toEqual([]);
  });

  it('sans `?studentId=`, le mur n’est pas armé du tout — la liste enseignant ne paie rien', async () => {
    const { controller, trace } = makeWorld();

    await expect(controller.list(TEACHER_JWT)).resolves.toEqual({ data: [] });
    expect(trace.filter((t) => t.startsWith('abac:'))).toEqual([]);
  });
});

describe('AC-H1 / ADR-071 §D2 — le mur ABAC se referme AVANT l’ouverture de la portée', () => {
  it('l’ORDRE est : requêtes ABAC → `scope:open` → lecture des leçons → `scope:close`', async () => {
    const { controller, trace } = makeWorld();

    await controller.list(PARENT_JWT, undefined, undefined, STUDENT_TAUGHT);

    const open = trace.indexOf('scope:open');
    expect(open).toBeGreaterThanOrEqual(0);
    // TOUTES les instructions ABAC précèdent l'ouverture. Une seule d'entre
    // elles à l'intérieur tiendrait DEUX connexions par requête et pousserait
    // la transaction interactive au-delà de son délai sous charge.
    const insideScope = trace.slice(open).filter((t) => t.startsWith('abac:'));
    expect(insideScope).toEqual([]);
    expect(trace.filter((t) => t.startsWith('abac:')).length).toBeGreaterThanOrEqual(1);
  });

  it('le BUDGET D’INSTRUCTIONS de la portée ne monte pas : au plus DEUX', async () => {
    const { controller, txEnrollmentFindMany, lessonFindMany } = makeWorld();

    await controller.list(PARENT_JWT, undefined, undefined, STUDENT_TAUGHT);

    // `enrollment` (donnée, pas autorisation) + `lessonEntry`. La `guardianship`
    // qui vivait ici est SORTIE ; le budget d'ADR-049 §D4 baisse de trois à deux.
    expect(txEnrollmentFindMany).toHaveBeenCalledTimes(1);
    expect(lessonFindMany).toHaveBeenCalledTimes(1);
  });
});

describe('AC-2 — la COPIE PRIVÉE a bien disparu de la source', () => {
  const SOURCE = readFileSync(join(__dirname, 'lessons.controller.ts'), 'utf8');

  it('plus aucune lecture de `guardianship` liée à l’identité de l’appelant dans ce fichier', () => {
    // Motifs CONCATÉNÉS (`PF-295`).
    expect(SOURCE).not.toContain('guardian' + ': { userProfileId: me.id }');
    expect(SOURCE).not.toContain('guardianship.' + 'findFirst');
  });

  it('le mur passe par le service canonique, une seule fois', () => {
    // On compte l'APPEL, pas le mot : le docblock hissé nomme la méthode en
    // prose, ce qui n'est pas un second site de décision.
    expect(SOURCE.split('this.studentAccess.canAccessStudent').length - 1).toBe(1);
  });
});
