import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LessonStatus } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { isSuppliedScopeId } from '../../shared/prisma/scope-fk';
import { TenantScopeService } from '../../shared/prisma/tenant-scope.service';
import { mapWriteRefusal } from '../../shared/prisma/write-refusal';
import { NotificationsService } from '../notifications/notifications.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

class CreateLessonDto {
  @IsUUID() teachingAssignmentId!: string;
  @IsOptional() @IsUUID() classSessionId?: string;
  @IsDateString() date!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MaxLength(10000) content!: string;
  @IsOptional() @IsString() @MaxLength(5000) homework?: string;
  @IsOptional() @IsDateString() homeworkDueAt?: string;
  @IsOptional() @IsEnum(LessonStatus) status?: LessonStatus;
  @IsOptional() @IsArray() attachments?: unknown[];
}

/**
 * S-E01-1e / PF-217 — CE DTO N'A PAS DE `classSessionId`, ET C'EST LA PRÉMISSE.
 *
 * `update` ne peut donc PAS repointer la clé étrangère de portée : le chemin
 * PF-217 n'existe QUE dans `create`. Ajouter ici une sonde de propriété serait
 * une vérification INATTEIGNABLE, c'est-à-dire une AFFIRMATION plutôt qu'un
 * contrôle. La prémisse est ÉPINGLÉE par une assertion de source
 * (`lessons-scope-ownership.spec.ts`, technique de PF-206) : ajouter le champ
 * plus tard rend ce test ROUGE au lieu de rouvrir un trou en silence.
 */
class UpdateLessonDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) content?: string;
  @IsOptional() @IsString() @MaxLength(5000) homework?: string;
  @IsOptional() @IsDateString() homeworkDueAt?: string;
  @IsOptional() @IsEnum(LessonStatus) status?: LessonStatus;
  @IsOptional() @IsArray() attachments?: unknown[];
}

/**
 * S-E01-1e / ADR-051 §D1 — LE CONTEXTE DE PROPRIÉTÉ, RÉSOLU DEHORS.
 *
 * `assertOwnership` faisait DEUX choses : il résolvait l'identité de l'appelant
 * (`teachers.ensureForUser`, quatre instructions dont un `upsert`) puis il
 * comparait. Cette forme n'a plus de place légale une fois le module converti :
 *
 *  - **depuis l'intérieur de la portée** — interdit. Le service ferme sur son
 *    PROPRE `PrismaService` : les quatre instructions partiraient sur la
 *    connexion du PROPRIÉTAIRE pendant que la transaction interactive tient la
 *    connexion applicative, et aucun garde de compilation ne peut le voir.
 *  - **deux portées par handler** (garde ; fermer ; résoudre ; écrire) — refusé.
 *    La lecture de garde et l'écriture atterriraient dans DEUX transactions,
 *    donc potentiellement deux connexions du pool, ouvrant une fenêtre TOCTOU
 *    sur exactement le contrôle qui autorise l'écriture.
 *
 * Reste la seule forme compatible avec ADR-048 §D3 (« portée tardive, fermeture
 * précoce ») ET ADR-049 §D1 (garde et écriture dans LA MÊME portée) : résoudre
 * DEHORS, comparer PUREMENT DEDANS. Le comparateur ne touche pas la base, donc
 * le fait que son TEXTE soit hors de la plage du callback n'est ni un manque de
 * couverture ni un risque — c'est une fonction pure prenant ses entrées en
 * paramètre, exactement la forme que PF-200 autorise.
 */
export interface LessonOwnershipContext {
  /** `super_admin` / `school_admin` : la propriété n'est pas exigée d'eux. */
  readonly isPrivileged: boolean;
  /** `null` = l'appelant n'a AUCUN profil professeur (donc aucune entrée). */
  readonly teacherProfileId: string | null;
}

/**
 * Le comparateur PUR. Sémantique de refus INCHANGÉE, à l'octet près :
 *
 *  - mêmes rôles court-circuités (`super_admin`, `school_admin`) ;
 *  - même exception (`ForbiddenException`) ;
 *  - même message français.
 *
 * `teacherProfileId === null` rend le MÊME 403 : un appelant sans profil
 * professeur ne possède aucune `lesson_entry` par construction de la clé
 * étrangère. Le traduire en 404 ou en 500 serait un changement de sémantique de
 * refus déguisé en refactor.
 */
export function assertOwnedByTeacher(
  context: LessonOwnershipContext,
  rowTeacherProfileId: string,
): void {
  if (context.isPrivileged) return;
  if (context.teacherProfileId === null || rowTeacherProfileId !== context.teacherProfileId) {
    throw new ForbiddenException('Vous ne pouvez modifier que vos propres entrées.');
  }
}

/**
 * S-E01-1e / PF-217 — LE REFUS DE LA SÉANCE ÉTRANGÈRE (ADR-049 §D2).
 *
 * « séance d'un autre tenant » et « séance inexistante » empruntent la MÊME
 * branche (`findFirst → null`) et produisent donc le MÊME message, à l'octet
 * près. La réponse ne PEUT pas distinguer les deux cas : cette distinction
 * serait elle-même un oracle d'existence inter-tenant (ADR-048 §D9).
 *
 * 400 et non 404 : l'id arrive dans le CORPS, et un 404 sur `POST /lessons` se
 * confondrait avec le 404 que ce handler renvoie déjà pour une AFFECTATION d'un
 * autre tenant. Le message nomme la SÉANCE (donnée de l'appelant) et jamais un
 * tenant, une table, un code Prisma ni une chaîne Postgres : `actions.ts`
 * (`toError`) remonte `body.message` VERBATIM à l'écran du professeur, sans
 * filtre.
 */
export function unknownClassSession(): BadRequestException {
  return new BadRequestException('La séance sélectionnée est introuvable dans votre établissement.');
}

@ApiTags('lessons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('lessons')
export class LessonsController {
  constructor(
    /**
     * TOUJOURS injecté, et il ne reste qu'UN site d'appel sur ce client :
     * `notifyOnLessonPublished` (voir son docblock). Le module est converti sur
     * ses CINQ handlers, PAS sur son fan-out de notifications.
     */
    private readonly prisma: PrismaService,
    private readonly scope: TenantScopeService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Fan-out to every active guardian of every student enrolled in the lesson's
   * class section. Called from `create` (when status='published') and from
   * `update` (when status transitions to 'published').
   *
   * ┌──────────────────────────────────────────────────────────────────────────┐
   * │ S-E01-1e — HORS PORTÉE, DÉLIBÉRÉMENT, POUR TROIS RAISONS MESURÉES        │
   * └──────────────────────────────────────────────────────────────────────────┘
   *
   *  1. **`this.notifications.createMany` ferme sur son PROPRE `PrismaService`**
   *     (`notifications.service.ts`). Appelée depuis l'intérieur d'une portée,
   *     elle émettrait ses `INSERT` sur la connexion du PROPRIÉTAIRE pendant que
   *     le compteur LEXICAL les crédite au callback : de la couverture FAUSSE,
   *     strictement pire qu'un site non couvert, parce qu'un site non couvert se
   *     voit dans le total. Convertir `NotificationsService` serait un TROISIÈME
   *     module ; deux est la tranche.
   *  2. **Elle fait de l'E/S EXTERNE** : elle consulte les préférences puis
   *     ENFILE un job BullMQ. Un job publié depuis une transaction interactive
   *     part AVANT le commit — l'e-mail annonce une leçon qui peut encore être
   *     annulée par un rollback.
   *  3. **Son `include` est profond de cinq niveaux** et coûte un temps
   *     proportionnel à (effectif de la classe × responsables légaux). Dans une
   *     transaction interactive à 5 s, il échoue d'abord sur le tenant qui a les
   *     plus grosses classes — c'est-à-dire en production et pas en recette.
   *
   * CONSÉQUENCE, ÉCRITE PLUTÔT QUE SOUS-ENTENDUE : ce site d'appel reste sur la
   * connexion du PROPRIÉTAIRE et compte NON COUVERT dans l'attribution. Il n'est
   * PAS ajouté à `ENUMERATED_OUTSIDE_SCOPE` : sa seule raison disponible serait
   * « pas encore converti », et l'énumération est une liste de RAISONS, pas de
   * chemins.
   *
   * Le `tenantId` du `where` est le DURCISSEMENT d'une ligne que cette story
   * fait quand même (`findUnique` -> `findFirst`, parce que `findUnique` ne peut
   * pas porter un `tenantId` non unique) : la garde n'était tenue que par la
   * DISCIPLINE de l'appelant, elle est désormais structurelle.
   *
   * Son `try/catch` qui ne fait qu'un `console.warn` reste la maladie de PF-197
   * et n'est PAS corrigé ici : le corriger changerait la sémantique de `create`
   * (une notification en échec ferait échouer la leçon), ce qui est une décision
   * produit et pas un effet de bord de conversion.
   */
  private async notifyOnLessonPublished(args: {
    tenantId: string;
    lessonId: string;
    teachingAssignmentId: string;
    title: string;
    hasHomework: boolean;
  }): Promise<void> {
    try {
      const ta = await this.prisma.teachingAssignment.findFirst({
        where: { id: args.teachingAssignmentId, tenantId: args.tenantId },
        include: {
          classSection: {
            include: {
              enrollments: {
                where: { status: 'active' },
                select: {
                  studentId: true,
                  student: {
                    select: {
                      firstName: true,
                      guardianships: {
                        where: { status: 'active', guardian: { userProfileId: { not: null } } },
                        select: {
                          guardian: { select: { userProfileId: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          subject: { select: { name: true } },
        },
      });
      if (!ta) return;

      const items: Parameters<typeof this.notifications.createMany>[0] = [];
      const seenRecipients = new Set<string>();
      for (const e of ta.classSection.enrollments) {
        for (const g of e.student.guardianships) {
          const uid = g.guardian.userProfileId;
          if (!uid || seenRecipients.has(uid)) continue;
          seenRecipients.add(uid);
          items.push({
            tenantId: args.tenantId,
            userProfileId: uid,
            kind: 'lesson_published',
            severity: args.hasHomework ? 'warning' : 'info',
            title: `Cahier de texte mis à jour — ${ta.subject.name}`,
            body: args.hasHomework
              ? `Nouveau devoir à faire : ${args.title}`
              : args.title,
            link: `/parent/lessons`,
            sourceType: 'lesson',
            sourceId: args.lessonId,
          });
        }
      }
      if (items.length > 0) {
        await this.notifications.createMany(items);
      }
    } catch (err) {

      console.warn('[lessons] notification fan-out failed', err);
    }
  }

  /**
   * ADR-051 §D1 — la résolution d'identité du contexte de propriété, DEHORS.
   *
   * Le test de RÔLE reste EN PREMIER, et ce n'est pas une optimisation. Sans
   * lui, chaque administrateur qui édite une leçon se verrait résoudre un profil
   * professeur — et avec l'ancien `ensureForUser`, s'en verrait PROVISIONNER un.
   * Le court-circuit administrateur est donc une propriété de SÉCURITÉ, pas un
   * raccourci de performance.
   *
   * `findForUser` (LECTURE SEULE) et non `ensureForUser` : la résolution passe
   * désormais AVANT la garde `findUnique`, donc avant le 404. Une provision
   * automatique à cet endroit serait une ÉCRITURE non auditée sur un chemin de
   * REFUS. `ensureForUser` reste là où la provision automatique est le
   * comportement PRODUIT voulu : la branche `mine=true` de `list`.
   */
  private async resolveOwnershipContext(
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ): Promise<LessonOwnershipContext> {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) {
      return { isPrivileged: true, teacherProfileId: null };
    }
    const tp = await this.teachers.findForUser(me);
    return { isPrivileged: false, teacherProfileId: tp === null ? null : tp.id };
  }

  /**
   * Lists lessons. Filters:
   *   - teachingAssignmentId (teacher's specific class+subject)
   *   - classSectionId (all subjects for one class — parent view)
   *   - studentId (all lessons the student should care about, joined via active enrollment)
   *   - from / to (date range)
   *   - mine=true → only logged-in teacher's lessons
   *
   * Parents only ever see lessons with status='published'.
   *
   * BUDGET D'INSTRUCTIONS DANS LA PORTÉE : au plus TROIS (parent + `studentId` :
   * `guardianship` -> `enrollment` -> `lessonEntry`), soit exactement le maximum
   * déjà amendé par ADR-049 §D4. AUCUN nouvel amendement n'est nécessaire, et le
   * dire est le point : une tranche qui ré-amende un budget en silence est
   * précisément la manière dont ADR-048 §D3 s'est retrouvé faux.
   */
  @Get()
  @RequiresPermission('lessons.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('teachingAssignmentId') teachingAssignmentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mine') mine?: string,
    @Query('limit') limit?: string,
  ) {
    // HORS PORTÉE PAR NÉCESSITÉ (PF-199) : `ensureUser` lit `user_profile` — une
    // des 44 tables sous policy — pour PRODUIRE le tenantId qu'une portée
    // exigerait. Elle produit la clé ; elle ne peut pas la consommer.
    const me = await this.users.ensureUser(jwt);
    // UNE seule expression du tenant, réutilisée par le filtre ET par la portée :
    // une portée dont le GUC ne vaut pas le `where.tenantId` rendrait `{data:[]}`
    // avec un 200, indiscernable d'une école sans leçon dans les trois portails.
    const tenantId = me.tenantId;
    const roles = jwt.realm_access?.roles ?? [];
    const isStaff =
      roles.includes('super_admin') || roles.includes('school_admin') || roles.includes('teacher');

    const where: Record<string, unknown> = { tenantId };
    if (!isStaff) where.status = 'published';

    // HORS PORTÉE, et c'est le SECOND résolveur d'identité du module (le brief
    // n'en nommait qu'un) : `ensureForUser` fait `teacherProfile.findUnique` ->
    // `userProfile.findUnique` -> `school.findFirst` -> `teacherProfile.upsert`.
    // Il ÉCRIT, sur son propre client, et il est ici à sa place : sur cette
    // branche la provision automatique EST le comportement produit voulu.
    if (mine === 'true' && roles.includes('teacher')) {
      const tp = await this.teachers.ensureForUser(me);
      where.teacherProfileId = tp.id;
    }
    if (teachingAssignmentId) where.teachingAssignmentId = teachingAssignmentId;
    if (classSectionId) where.teachingAssignment = { classSectionId };
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    // PUR, donc DEHORS : borner la pagination ne lit pas la base.
    const take = Math.min(parseInt(limit ?? '100', 10) || 100, 500);

    // PORTÉE TARDIVE : tout ce qui précède est terminé.
    return this.scope.run(tenantId, async (tx) => {
      if (studentId) {
        // Restrict to lessons of classes the student is enrolled in (any year).
        // ABAC: parent must be guardian of that student.
        if (roles.includes('parent')) {
          const gship = await tx.guardianship.findFirst({
            where: { tenantId, studentId, status: 'active', guardian: { userProfileId: me.id } },
          });
          if (!gship) throw new ForbiddenException("Vous n'avez pas accès à cet élève.");
        }
        const enrollments = await tx.enrollment.findMany({
          where: { studentId, tenantId },
          select: { classSectionId: true },
        });
        where.teachingAssignment = {
          classSectionId: { in: enrollments.map((e) => e.classSectionId) },
        };
      }

      // `include` = CLÔTURE RELATIONNELLE : sous RLS, `teaching_assignment`,
      // `class_section`, `subject`, `teacher_profile` et `user_profile` doivent
      // PASSER pour `app_user` aussi. Les cinq sont dans les 44 tables
      // accordées, et `APP_ROLE_REQUIRED_PRIVILEGES` les déclare désormais —
      // sans quoi la sonde de démarrage certifierait `enforcing: true` pendant
      // que chaque requête leçon rendrait « permission denied ».
      return {
        data: await tx.lessonEntry.findMany({
          where,
          orderBy: { date: 'desc' },
          take,
          include: {
            teachingAssignment: {
              include: {
                classSection: { select: { id: true, name: true } },
                subject: { select: { id: true, name: true, color: true } },
              },
            },
            teacherProfile: {
              include: { userProfile: { select: { firstName: true, lastName: true } } },
            },
          },
        }),
      };
    });
  }

  @Get(':id')
  @RequiresPermission('lessons.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    const roles = jwt.realm_access?.roles ?? [];

    return this.scope.run(tenantId, async (tx) => {
      const lesson = await tx.lessonEntry.findUnique({
        where: { id },
        include: {
          teachingAssignment: {
            include: {
              classSection: { include: { gradeLevel: { include: { cycle: true } } } },
              subject: true,
            },
          },
          teacherProfile: { include: { userProfile: { select: { firstName: true, lastName: true } } } },
        },
      });
      // Garde applicative CONSERVÉE (ADR-042 §D1) — défense en profondeur. Sur
      // `degraded_no_app_url`, c'est-à-dire TOUS les déploiements
      // d'aujourd'hui, c'est la SEULE chose qui travaille.
      if (!lesson || lesson.tenantId !== tenantId) throw new NotFoundException();
      if (!roles.includes('super_admin') && !roles.includes('school_admin') && !roles.includes('teacher')) {
        if (lesson.status !== 'published') throw new ForbiddenException();
      }
      return lesson;
    });
  }

  @Post()
  @RequiresPermission('lessons.write')
  async create(@Body() body: CreateLessonDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    // ADR-051 §D1 — résolution d'identité DEHORS, comparaison pure DEDANS.
    const ownership = await this.resolveOwnershipContext(me, jwt);

    // BUDGET : au plus TROIS instructions dans la portée — la garde
    // d'affectation, AU PLUS UNE sonde de séance, puis l'écriture. Le maximum
    // est borné par le SCHÉMA (une sonde par FK porteuse de tenant que ce
    // handler ÉCRIT), jamais par la requête.
    const lesson = await this.scope.run(tenantId, async (tx) => {
      // `findFirst({ id, tenantId })` remplace le `findUnique` + comparaison
      // manuelle : `findUnique` ne peut PAS porter un `tenantId` non unique.
      // Le 404 qu'il rendait est conservé tel quel.
      const assignment = await tx.teachingAssignment.findFirst({
        where: { id: body.teachingAssignmentId, tenantId },
        select: { id: true, teacherProfileId: true },
      });
      if (!assignment) throw new NotFoundException();
      // ORDRE (ADR-049 §D1) : 404 (ligne absente ou étrangère) AVANT 403 (pas
      // le propriétaire). L'appelant n'apprend rien de son corps tant qu'il n'a
      // pas prouvé qu'il possède la ligne du chemin.
      assertOwnedByTeacher(ownership, assignment.teacherProfileId);

      // ── PF-217 ────────────────────────────────────────────────────────────
      // `LessonEntry.classSessionId` est une FK MONO-COLONNE vers `class_session`,
      // table portant un `tenant_id`. PostgreSQL évalue l'intégrité
      // référentielle EN DEHORS de la row security : le `WITH CHECK` de
      // `tenant_isolation` ne voit que `lesson_entry.tenant_id`, et la
      // contrainte qui valide `class_session_id` s'exécute en tant que
      // propriétaire de `class_session`, policy éteinte. Un id d'un AUTRE tenant
      // s'insère donc proprement sous une policy parfaitement correcte.
      //
      // `findFirst` et non `findUnique` : `findUnique` ne peut pas porter le
      // `tenantId`, qui n'est pas unique. `tenantId` EXPLICITE même là où RLS le
      // rendrait redondant (ADR-042 §D1).
      //
      // `isSuppliedScopeId` et JAMAIS la présence de clé : la colonne est
      // NULLABLE et `findFirst({ where: { id: undefined, tenantId } })` ferait
      // OMETTRE le filtre à Prisma — la sonde rendrait la première séance du
      // tenant et passerait À VIDE sur chaque requête sans id.
      if (isSuppliedScopeId(body.classSessionId)) {
        const owned = await tx.classSession.findFirst({
          where: { id: body.classSessionId, tenantId },
          select: { id: true },
        });
        if (owned === null) throw unknownClassSession();
      }

      try {
        return await tx.lessonEntry.create({
          data: {
            tenantId,
            teachingAssignmentId: assignment.id,
            teacherProfileId: assignment.teacherProfileId,
            classSessionId: body.classSessionId,
            date: new Date(body.date),
            title: body.title.trim(),
            content: body.content,
            homework: body.homework,
            homeworkDueAt: body.homeworkDueAt ? new Date(body.homeworkDueAt) : undefined,
            status: body.status ?? 'published',
            attachments: (body.attachments ?? []) as never,
          },
        });
      } catch (error) {
        throw mapWriteRefusal(error);
      }
    });

    // HORS PORTÉE, et APRÈS le commit : voir `notifyOnLessonPublished`.
    if (lesson.status === 'published') {
      await this.notifyOnLessonPublished({
        tenantId,
        lessonId: lesson.id,
        teachingAssignmentId: lesson.teachingAssignmentId,
        title: lesson.title,
        hasHomework: !!lesson.homework,
      });
    }

    return lesson;
  }

  @Patch(':id')
  @RequiresPermission('lessons.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLessonDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    const ownership = await this.resolveOwnershipContext(me, jwt);

    // La lecture de garde ET l'écriture dans LA MÊME portée : elles doivent voir
    // le même GUC. Deux portées successives seraient deux transactions, donc
    // potentiellement deux connexions, et une fenêtre TOCTOU sur la garde.
    //
    // PF-217 ne s'applique PAS ici, et c'est MESURÉ : `UpdateLessonDto` n'a pas
    // de `classSessionId` et le bloc `data` ci-dessous ne l'écrit pas.
    const { updated, wasDraft } = await this.scope.run(tenantId, async (tx) => {
      const lesson = await tx.lessonEntry.findUnique({ where: { id } });
      if (!lesson || lesson.tenantId !== tenantId) throw new NotFoundException();
      assertOwnedByTeacher(ownership, lesson.teacherProfileId);

      const draftBefore = lesson.status !== 'published';
      try {
        const row = await tx.lessonEntry.update({
          where: { id },
          data: {
            ...(body.title !== undefined ? { title: body.title.trim() } : {}),
            ...(body.content !== undefined ? { content: body.content } : {}),
            ...(body.homework !== undefined ? { homework: body.homework } : {}),
            ...(body.homeworkDueAt !== undefined
              ? { homeworkDueAt: body.homeworkDueAt ? new Date(body.homeworkDueAt) : null }
              : {}),
            ...(body.status !== undefined ? { status: body.status } : {}),
            ...(body.attachments !== undefined ? { attachments: body.attachments as never } : {}),
          },
        });
        return { updated: row, wasDraft: draftBefore };
      } catch (error) {
        throw mapWriteRefusal(error);
      }
    });

    if (wasDraft && updated.status === 'published') {
      await this.notifyOnLessonPublished({
        tenantId,
        lessonId: updated.id,
        teachingAssignmentId: updated.teachingAssignmentId,
        title: updated.title,
        hasHomework: !!updated.homework,
      });
    }

    return updated;
  }

  @Delete(':id')
  @RequiresPermission('lessons.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const tenantId = me.tenantId;
    const ownership = await this.resolveOwnershipContext(me, jwt);

    return this.scope.run(tenantId, async (tx) => {
      const lesson = await tx.lessonEntry.findUnique({ where: { id } });
      if (!lesson || lesson.tenantId !== tenantId) throw new NotFoundException();
      assertOwnedByTeacher(ownership, lesson.teacherProfileId);
      try {
        await tx.lessonEntry.delete({ where: { id } });
      } catch (error) {
        throw mapWriteRefusal(error);
      }
      return { ok: true };
    });
  }
}
