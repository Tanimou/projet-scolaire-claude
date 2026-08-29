import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import {
  ASSIGNMENT_ROLES,
  type AssignmentRole,
  type PageEnvelope,
  type PageOffset,
  type PageSize,
  type ResultTotal,
  distinctGroupCount,
  pageWindow,
  pageWindowOf,
  resultTotal,
} from '@pilotage/contracts';
import { type Prisma } from '@prisma/client';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { resolveRoleSync } from './assignment-role.util';
import { assignmentYearScopeWhere } from './assignment-year-scope';

class CreateAssignmentDto {
  @IsUUID() teacherProfileId!: string;
  @IsUUID() classSectionId!: string;
  @IsUUID() subjectId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(40) weeklyHours?: number;
  @IsOptional() @IsBoolean() isMainTeacher?: boolean;
  // Rôle de l'enseignant sur l'affectation. `principal` est synchronisé avec `isMainTeacher`.
  @IsOptional() @IsIn(ASSIGNMENT_ROLES as unknown as string[]) role?: AssignmentRole;
}

class UpdateAssignmentDto {
  @IsOptional() @IsNumber() @Min(0) @Max(40) weeklyHours?: number;
  @IsOptional() @IsBoolean() isMainTeacher?: boolean;
  @IsOptional() @IsIn(ASSIGNMENT_ROLES as unknown as string[]) role?: AssignmentRole;
}

/**
 * S-E03-9 / PF-50 / ADR-080 — la fenêtre de page des affectations : 100 par
 * défaut, 500 au maximum.
 *
 * Ce sont des nombres NEUFS, et c'est assumé : ce point d'entrée n'avait AUCUNE
 * borne (`findMany` sans `take`, quatre `include` imbriqués, ~290 lignes en une
 * charge utile). Il n'existe donc pas de défaut observable à préserver ici — le
 * défaut de 100 est plus LARGE que la page par défaut de tout autre site
 * converti, précisément pour qu'aucun appelant existant ne voie sa première
 * page rétrécir sous ce qu'il affichait déjà.
 */
const TEACHING_ASSIGNMENTS_PAGE_WINDOW = pageWindow({ def: 100, max: 500 });

/**
 * S-E03-11 / PF-427 / ADR-081 §D2 — LA FORME DE LA RÉPONSE, DÉCLARÉE.
 *
 * Ce que ce type change : RIEN de ce que le handler RENVOIE. Les six clés, leurs
 * valeurs et leurs octets sont exactement ceux d'avant la tranche. Ce qui change
 * est que la forme est désormais DITE, sur le socle canonique `PageEnvelope` de
 * `packages/contracts` — celui-là même que `apps/web` analyse.
 *
 * POURQUOI, MESURÉ : dans le run 94, ce handler émettait `totals` pendant que
 * `admin/assignments/page.tsx` lisait `summary`. Les deux moitiés ont typé VERT,
 * parce que ce handler n'annonçait AUCUNE forme et que le client AFFIRMAIT la
 * sienne. Sur l'arbre fusionné, les quatre KPI de `/admin/assignments` seraient
 * partis en tirets et le panneau de couverture serait resté « indisponible ». Un
 * humain a comparé deux fichiers ; aucun test ne l'a vu. Depuis cette
 * déclaration, renommer `totals` en `summary` ICI NE COMPILE PLUS.
 *
 * POURQUOI L'ITEM EST `unknown` (ADR-081 §D3) : le CADRE est le contrat, la
 * LIGNE ne l'est pas. Figer ici le payload Prisma des quatre `include`
 * imbriqués transformerait chaque évolution de relation en rupture de contrat
 * déclarée, sans rien protéger : aucun consommateur TypeScript ne lit ce type de
 * ligne — `apps/web` écrit le sien. `data` reste NON VIDE-INTERDIT et `total`
 * reste un `ResultTotal`, donc `total: data.length` continue de ne pas compiler.
 */
type TeachingAssignmentsListEnvelope = PageEnvelope<unknown> & {
  readonly limit: PageSize;
  readonly offset: PageOffset;
  readonly totals: {
    readonly assignments: ResultTotal;
    readonly teachers: ResultTotal;
    readonly classes: ResultTotal;
    readonly subjectsWithoutTeacher: ResultTotal;
  };
  readonly coverage: {
    readonly scope: 'establishment';
    readonly classSectionIdsWithPrincipal: readonly string[];
    readonly classSectionIdsWithAssistant: readonly string[];
    readonly subjectIdsWithTeacher: readonly string[];
  };
};

@ApiTags('teaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('teaching-assignments')
export class TeachingAssignmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  /**
   * S-E03-9 / PF-50 / ADR-080 §D4 — LA MOITIÉ « VÉRITÉ » DE LA TRANCHE.
   *
   * AVANT : `findMany` SANS `take`, avec quatre `include` imbriqués. Toutes les
   * lignes du tenant (~290 mesurées) partaient dans une charge utile, et
   * `apps/web/src/app/admin/assignments/page.tsx:39-43` dérivait QUATRE KPI de
   * ce tableau — dont `assignments.length` sous l'étiquette « AFFECTATIONS
   * ACTIVES ».
   *
   * ⚠ POURQUOI LES AGRÉGATS SONT OBLIGATOIRES ET NON « OPTIONNELS »
   * ---------------------------------------------------------------
   * Borner ce point d'entrée SANS eux fabriquerait un défaut de vérité PIRE que
   * celui que PF-50 nomme. Trois des quatre KPI deviendraient la taille de la
   * page portant le nom d'un total — le défaut de PF-20 (« la longueur d'une
   * constante ») et de PF-40 (« un compte sur une liste tronquée »), pour la
   * troisième fois.
   *
   * Le quatrième est pire encore : `subjectsWithoutTeacher` est une DIFFÉRENCE
   * D'ENSEMBLES dont l'AUTRE opérande, `GET /subjects`, est lui-même un
   * `findMany` non borné (`school-structure/subjects.controller.ts:110`,
   * `PF-422`). Borner le seul côté des affectations rendrait la différence
   * MONOTONEMENT FAUSSE DANS LA DIRECTION ALARMANTE : sur une page de 100 lignes
   * parmi ~290, presque chaque matière serait déclarée « sans enseignant ». Un
   * KPI qui sous-estime est un bug ; un KPI qui FABRIQUE une crise de
   * recrutement sur le tableau de bord d'une école viole la north star
   * (GUARDRAILS §1 : chaque chiffre doit être explicable et conduire à l'étape
   * suivante — celui-là conduirait chaque admin à la MAUVAISE étape suivante).
   *
   * ⚠ CE N'EST PAS DNC-01 : `groupBy(...).length` EST UNE TÊTE DE COMPTE
   * --------------------------------------------------------------------
   * Dans le vocabulaire d'ADR-079 §D3 : la longueur INTERDITE est celle d'un
   * tableau BORNÉ par une taille de page. Un `groupBy` ne porte aucun `take` et
   * n'en a pas besoin — sa CARDINALITÉ *est* la réponse. `distinctGroupCount()`
   * le dit dans le nom et dans le type, pour qu'aucun relecteur n'ait à le
   * deviner. Et c'est un `groupBy`, jamais `findMany` + `new Set(...)` : cette
   * dernière forme est exactement la régression de fan-out que `PF-418` a
   * enregistrée au run 93, en citant PF-50 comme la finding qu'elle aggravait.
   * Jamais `$queryRaw` non plus : du SQL brut sortirait de la portée du gate de
   * déploiement tenant-scope.
   *
   * ⚠ G-TENANT — les SEPT lectures portent `tenantId` (la page, le total, les
   * QUATRE `groupBy` et le `count` de matières). Un agrégat est une lecture
   * comme une autre.
   *
   * ⚠ G-AUTHZ — `@RequiresPermission('teaching_assignments.read')` et les deux
   * gardes sont INCHANGÉS. Le changement de FORME est ADDITIF (`{ data }` est
   * préservé) et le seul code de réponse nouveau est le **400** de AC-3.
   *
   * HÉRITÉ, NON CORRIGÉ (DNC-06)
   * ----------------------------
   * `PF-421` — l'étiquette « AFFECTATIONS ACTIVES » du portail admin. Il
   * n'existe AUCUN prédicat `active` sur `TeachingAssignment` (voir
   * `schema.prisma:1006-1032`) et aucun n'est appliqué ici : le compte est celui
   * de TOUTES les affectations. L'étiquette est fausse depuis qu'elle a été
   * écrite, INDÉPENDAMMENT de la pagination. Corriger le mot (ou ajouter le
   * prédicat) est une décision produit, pas une correction de dérivation.
   * `PF-422` — `/subjects` et `/classes` restent non bornés ; §D4 les rend
   * inoffensifs POUR CE KPI en déplaçant la différence côté serveur, il ne les
   * borne pas.
   */
  @Get()
  @RequiresPermission('teaching_assignments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('teacherProfileId') teacherProfileId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('limit') limitRaw?: string,
    @Query('offset') offsetRaw?: string,
  ): Promise<TeachingAssignmentsListEnvelope> {
    const parsedWindow = TEACHING_ASSIGNMENTS_PAGE_WINDOW.safeParse({
      limit: limitRaw,
      offset: offsetRaw,
    });
    if (!parsedWindow.success) {
      throw new BadRequestException(parsedWindow.error.issues.map((i) => i.message));
    }
    const { take, skip } = pageWindowOf(parsedWindow.data);

    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forTenant(me.tenantId);

    // UNE portée, construite UNE fois (patron `PF-358` /
    // `guardians.controller.ts:376-378`). La page, le total et les deux
    // `groupBy` reçoivent LE MÊME OBJET : aucun des quatre ne peut en épeler la
    // moitié, ni oublier l'axe tenant. Deux littéraux construits à la main
    // seraient deux portées qui divergeraient au premier filtre ajouté.
    const where: Prisma.TeachingAssignmentWhereInput = {
      tenantId: me.tenantId,
      ...(teacherProfileId ? { teacherProfileId } : {}),
      ...(classSectionId ? { classSectionId } : {}),
      ...(subjectId ? { subjectId } : {}),
      ...assignmentYearScopeWhere(academicYearId),
    };

    /**
     * LA COUVERTURE A UNE AUTRE PORTÉE, ET C'EST DÉLIBÉRÉ (AC-5b).
     *
     * Le panneau « Couverture » du portail admin affirme quelque chose sur
     * TOUTES LES CLASSES ACTIVES de l'établissement (« Couverture complète.
     * Toutes les classes actives ont un professeur principal… »). Le calculer
     * sur `where` le ferait accuser de « sans professeur principal » CHAQUE
     * classe que le filtre courant exclut — la même erreur monotone que celle
     * décrite plus haut, transposée d'une page à un filtre. La couverture porte
     * donc sur le tenant, restreint à l'année scolaire SI l'appelant en a nommé
     * une (une classe a un PP *pour une année*), et sur rien d'autre.
     *
     * Le champ `scope` du payload NOMME cette portée pour que l'interface ne
     * puisse pas l'étiqueter à tort.
     */
    const coverageWhere: Prisma.TeachingAssignmentWhereInput = {
      tenantId: me.tenantId,
      ...assignmentYearScopeWhere(academicYearId),
    };

    const [
      data,
      totalRows,
      teacherGroups,
      classGroups,
      subjectsWithoutTeacherCount,
      principalGroups,
      assistantGroups,
      subjectGroups,
    ] = await Promise.all([
      this.prisma.teachingAssignment.findMany({
        where,
        include: {
          teacherProfile: {
            include: { userProfile: { select: { firstName: true, lastName: true, email: true } } },
          },
          classSection: {
            include: { gradeLevel: { include: { cycle: { select: { name: true, color: true } } } } },
          },
          subject: { select: { id: true, name: true, code: true, color: true } },
          academicYear: { select: { id: true, name: true, status: true } },
        },
        orderBy: [
          { classSection: { gradeLevel: { orderIndex: 'asc' } } },
          { classSection: { name: 'asc' } },
          { subject: { name: 'asc' } },
        ],
        take,
        skip,
      }),
      this.prisma.teachingAssignment.count({ where }),
      // `_count: { _all: true }` est la forme maison des `groupBy` de ce dépôt
      // (`guardians.controller.ts:446-451`, `analytics.service.ts:3611-3618`).
      // Ce n'est PAS la valeur lue ici — la CARDINALITÉ l'est — mais garder la
      // forme évite d'introduire une seconde façon d'écrire un `groupBy`, ce
      // qui serait le défaut de cette tranche appliqué à elle-même.
      this.prisma.teachingAssignment.groupBy({
        by: ['teacherProfileId'],
        where,
        _count: { _all: true },
      }),
      this.prisma.teachingAssignment.groupBy({
        by: ['classSectionId'],
        where,
        _count: { _all: true },
      }),
      // La différence d'ensembles, CÔTÉ SERVEUR et en UNE lecture. Le
      // dénominateur est celui de `GET /subjects` (les matières de l'école du
      // contexte), pour que les deux surfaces ne puissent pas répondre deux
      // nombres différents ; `tenantId` est ajouté ici, ce qui le RESSERRE.
      this.prisma.subject.count({
        where: { tenantId: me.tenantId, schoolId, teachingAssignments: { none: where } },
      }),
      this.prisma.teachingAssignment.groupBy({
        by: ['classSectionId'],
        where: { ...coverageWhere, role: 'principal' },
        _count: { _all: true },
      }),
      this.prisma.teachingAssignment.groupBy({
        by: ['classSectionId'],
        where: { ...coverageWhere, role: 'assistant' },
        _count: { _all: true },
      }),
      // Les ids des matières POURVUES, sur la même portée `coverageWhere` que
      // les deux agrégats ci-dessus. Le panneau de couverture NOMME les
      // matières sans enseignant ; un scalaire ne peut pas produire des noms,
      // et le dériver de `data` en nommerait toutes celles absentes de la page.
      // La portée est celle de l'établissement, pas celle des filtres : sinon
      // le tiers « matières » du panneau contredirait son propre libellé
      // « Portée : tout l'établissement » que les deux autres tiers respectent.
      this.prisma.teachingAssignment.groupBy({
        by: ['subjectId'],
        where: coverageWhere,
        _count: { _all: true },
      }),
    ]);

    const total = resultTotal(totalRows);

    return {
      // Enveloppe maison, déjà livrée à `students.controller.ts:349` — pas de
      // sous-objet `meta`/`pagination` inventé (ADR-080 §D4).
      data,
      total,
      limit: take,
      offset: skip,
      /**
       * LES QUATRE KPI, EN AGRÉGATS SERVEUR SUR L'ENSEMBLE FILTRÉ. Aucun n'est
       * la longueur de `data`, et `total: data.length` ne compilerait PAS :
       * `ResultTotal` n'est pas assignable depuis un `number` nu (ADR-080 §D2).
       */
      totals: {
        assignments: total,
        teachers: distinctGroupCount(teacherGroups),
        classes: distinctGroupCount(classGroups),
        subjectsWithoutTeacher: resultTotal(subjectsWithoutTeacherCount),
      },
      coverage: {
        /** Portée NOMMÉE : l'établissement, jamais la page ni les filtres. */
        scope: 'establishment' as const,
        classSectionIdsWithPrincipal: principalGroups.map((g) => g.classSectionId),
        classSectionIdsWithAssistant: assistantGroups.map((g) => g.classSectionId),
        subjectIdsWithTeacher: subjectGroups.map((g) => g.subjectId),
      },
    };
  }

  @Post()
  @RequiresPermission('teaching_assignments.write')
  async create(@Body() body: CreateAssignmentDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);

    const [teacher, cls, subject] = await Promise.all([
      this.prisma.teacherProfile.findUnique({ where: { id: body.teacherProfileId } }),
      this.prisma.classSection.findUnique({
        where: { id: body.classSectionId },
        include: { academicYear: true, gradeLevel: true },
      }),
      this.prisma.subject.findUnique({ where: { id: body.subjectId } }),
    ]);
    if (!teacher || teacher.tenantId !== me.tenantId) throw new NotFoundException('Professeur introuvable.');
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException('Classe introuvable.');
    if (!subject || subject.tenantId !== me.tenantId) throw new NotFoundException('Matière introuvable.');
    if (cls.academicYear.status === 'archived') {
      throw new BadRequestException("Impossible d'affecter dans une année archivée.");
    }
    if (cls.gradeLevel.schoolId !== subject.schoolId) {
      throw new BadRequestException("La classe et la matière doivent appartenir à la même école.");
    }
    if (teacher.schoolId !== cls.gradeLevel.schoolId) {
      throw new BadRequestException("Le professeur doit appartenir à l'école de la classe.");
    }

    // Block duplicates: same (teacher, class, subject)
    const dup = await this.prisma.teachingAssignment.findUnique({
      where: {
        teacherProfileId_classSectionId_subjectId: {
          teacherProfileId: body.teacherProfileId,
          classSectionId: body.classSectionId,
          subjectId: body.subjectId,
        },
      },
    });
    if (dup) throw new ConflictException('Cette affectation existe déjà.');

    // Synchronise role ⇔ isMainTeacher à partir du DTO (défaut : subject_teacher).
    const synced = resolveRoleSync({
      role: body.role,
      isMainTeacher: body.isMainTeacher,
      current: { role: 'subject_teacher', isMainTeacher: false },
    }) ?? { role: 'subject_teacher' as AssignmentRole, isMainTeacher: false };

    // Un seul professeur principal par classe : si celle-ci devient PP, on
    // rétrograde les autres (isMainTeacher=false ET role principal→subject_teacher).
    if (synced.isMainTeacher) {
      await this.prisma.teachingAssignment.updateMany({
        where: { classSectionId: body.classSectionId, isMainTeacher: true },
        data: { isMainTeacher: false, role: 'subject_teacher' },
      });
    }

    return this.prisma.teachingAssignment.create({
      data: {
        tenantId: me.tenantId,
        teacherProfileId: body.teacherProfileId,
        classSectionId: body.classSectionId,
        subjectId: body.subjectId,
        academicYearId: cls.academicYearId,
        weeklyHours: body.weeklyHours,
        isMainTeacher: synced.isMainTeacher,
        role: synced.role,
      },
      include: {
        teacherProfile: { include: { userProfile: { select: { firstName: true, lastName: true } } } },
        classSection: true,
        subject: true,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('teaching_assignments.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAssignmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();

    // Synchronise role ⇔ isMainTeacher en partant de l'état courant de l'affectation.
    const synced = resolveRoleSync({
      role: body.role,
      isMainTeacher: body.isMainTeacher,
      current: { role: a.role, isMainTeacher: a.isMainTeacher },
    });

    // Si cette affectation devient PP, on rétrograde les autres de la classe
    // (isMainTeacher=false ET role principal→subject_teacher).
    if (synced?.isMainTeacher) {
      await this.prisma.teachingAssignment.updateMany({
        where: { classSectionId: a.classSectionId, isMainTeacher: true, id: { not: id } },
        data: { isMainTeacher: false, role: 'subject_teacher' },
      });
    }
    return this.prisma.teachingAssignment.update({
      where: { id },
      data: {
        ...(body.weeklyHours !== undefined ? { weeklyHours: body.weeklyHours } : {}),
        ...(synced ? { isMainTeacher: synced.isMainTeacher, role: synced.role } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('teaching_assignments.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id },
      include: { _count: { select: { assessments: true, lessons: true, classSessions: true } } },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a._count.assessments > 0 || a._count.lessons > 0 || a._count.classSessions > 0) {
      throw new BadRequestException(
        `Impossible de supprimer : cette affectation a déjà ${a._count.assessments} évaluation(s), ${a._count.lessons} séquence(s) de cours, ${a._count.classSessions} séance(s). Désactivez-la plutôt.`,
      );
    }
    await this.prisma.teachingAssignment.delete({ where: { id } });
    return { ok: true };
  }
}
