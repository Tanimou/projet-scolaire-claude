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
import { AssessmentKind } from '@prisma/client';
import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

class CreateAssessmentDto {
  @IsUUID() teachingAssignmentId!: string;
  @IsString() @MinLength(1) @MaxLength(160) title!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsEnum(AssessmentKind) kind?: AssessmentKind;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsDateString() conductedAt?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(1000) maxScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(20) coefficientOverride?: number;
  @IsOptional() @IsUUID() termId?: string;
}

class UpdateAssessmentDto {
  @IsOptional() @IsString() @MaxLength(160) title?: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @IsOptional() @IsEnum(AssessmentKind) kind?: AssessmentKind;
  @IsOptional() @IsDateString() scheduledAt?: string;
  @IsOptional() @IsDateString() conductedAt?: string;
  @IsOptional() @IsNumber() @Min(1) @Max(1000) maxScore?: number;
  @IsOptional() @IsNumber() @Min(0) @Max(20) coefficientOverride?: number;
  @IsOptional() @IsUUID() termId?: string;
}

@ApiTags('grades')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('assessments')
export class AssessmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lists assessments. By default scoped to the caller's teacher profile
   * (so the teacher only sees their own). Admins with `assessments.read` can
   * pass `?teachingAssignmentId=…` to view any.
   */
  @Get()
  @RequiresPermission('assessments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('teachingAssignmentId') teachingAssignmentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('termId') termId?: string,
    @Query('mine') mine?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');

    let teacherFilter: { teacherProfileId?: string } = {};
    if (mine === 'true' || (!isAdmin && roles.includes('teacher'))) {
      const tp = await this.teachers.ensureForUser(me);
      teacherFilter = { teacherProfileId: tp.id };
    }

    const data = await this.prisma.assessment.findMany({
      where: {
        tenantId: me.tenantId,
        ...teacherFilter,
        ...(teachingAssignmentId ? { teachingAssignmentId } : {}),
        ...(classSectionId ? { teachingAssignment: { classSectionId } } : {}),
        ...(termId ? { termId } : {}),
      },
      include: {
        teachingAssignment: {
          include: {
            classSection: {
              select: {
                id: true,
                name: true,
                gradeLevel: { select: { name: true } },
                _count: { select: { enrollments: true } },
              },
            },
            subject: { select: { id: true, name: true, color: true, code: true } },
          },
        },
        teacherProfile: {
          include: {
            userProfile: { select: { firstName: true, lastName: true, photoUrl: true } },
          },
        },
        term: { select: { id: true, name: true } },
        _count: { select: { grades: true } },
      },
      orderBy: [{ scheduledAt: 'desc' }, { createdAt: 'desc' }],
    });
    return { data };
  }

  @Get(':id')
  @RequiresPermission('assessments.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: { include: { gradeLevel: { include: { cycle: true } } } },
            subject: true,
          },
        },
        term: true,
        grades: {
          include: { student: { select: { id: true, firstName: true, lastName: true, externalRef: true } } },
          orderBy: { student: { lastName: 'asc' } },
        },
      },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(a, me, jwt);
    return a;
  }

  @Post()
  @RequiresPermission('assessments.write')
  async create(@Body() body: CreateAssessmentDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const assignment = await this.prisma.teachingAssignment.findUnique({
      where: { id: body.teachingAssignmentId },
      include: { classSection: { include: { academicYear: true } } },
    });
    if (!assignment || assignment.tenantId !== me.tenantId) {
      throw new NotFoundException('Affectation introuvable.');
    }

    const roles = jwt.realm_access?.roles ?? [];
    if (!roles.includes('super_admin') && !roles.includes('school_admin')) {
      const tp = await this.teachers.ensureForUser(me);
      if (assignment.teacherProfileId !== tp.id) {
        throw new ForbiddenException('Vous ne pouvez créer une évaluation que sur vos propres classes.');
      }
    }
    if (assignment.classSection.academicYear.status === 'archived') {
      throw new BadRequestException("Impossible de créer une évaluation dans une année archivée.");
    }
    if (body.termId) {
      const term = await this.prisma.term.findUnique({ where: { id: body.termId } });
      if (!term || term.academicYearId !== assignment.academicYearId) {
        throw new BadRequestException("Le trimestre doit appartenir à l'année de la classe.");
      }
    }

    return this.prisma.assessment.create({
      data: {
        tenantId: me.tenantId,
        teachingAssignmentId: assignment.id,
        teacherProfileId: assignment.teacherProfileId,
        termId: body.termId,
        title: body.title.trim(),
        description: body.description,
        kind: body.kind ?? 'written_test',
        scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : undefined,
        conductedAt: body.conductedAt ? new Date(body.conductedAt) : undefined,
        maxScore: body.maxScore ?? 20,
        coefficientOverride: body.coefficientOverride,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('assessments.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAssessmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.assessment.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(a, me, jwt);

    return this.prisma.assessment.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.kind !== undefined ? { kind: body.kind } : {}),
        ...(body.scheduledAt !== undefined
          ? { scheduledAt: body.scheduledAt ? new Date(body.scheduledAt) : null }
          : {}),
        ...(body.conductedAt !== undefined
          ? { conductedAt: body.conductedAt ? new Date(body.conductedAt) : null }
          : {}),
        ...(body.maxScore !== undefined ? { maxScore: body.maxScore } : {}),
        ...(body.coefficientOverride !== undefined
          ? { coefficientOverride: body.coefficientOverride }
          : {}),
        ...(body.termId !== undefined ? { termId: body.termId || null } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('assessments.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: { _count: { select: { grades: true } } },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(a, me, jwt);
    if (a.isPublished && a._count.grades > 0) {
      throw new BadRequestException(
        'Impossible de supprimer une évaluation publiée avec des notes saisies. Dépubliez-la d\'abord.',
      );
    }
    await this.prisma.assessment.delete({ where: { id } });
    return { ok: true };
  }

  /** Publish all grades for this assessment (atomic). Idempotent. */
  @Post(':id/publish')
  @RequiresPermission('grades.publish')
  async publish(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: { grades: true },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(a, me, jwt);

    const missing = a.grades.filter((g) => g.value === null && !g.isAbsent).length;
    if (missing > 0) {
      throw new BadRequestException(
        `Impossible de publier : ${missing} note(s) manquante(s). Saisissez ou marquez absent.`,
      );
    }
    if (a.grades.length === 0) {
      throw new BadRequestException("Aucune note saisie — rien à publier.");
    }

    const now = new Date();
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id },
        data: { isPublished: true, publishedAt: now },
      });
      await tx.grade.updateMany({
        where: { assessmentId: id, status: 'draft' },
        data: { status: 'published', publishedAt: now },
      });
      await tx.auditLog.create({
        data: {
          tenantId: me.tenantId,
          actorId: me.id,
          action: 'assessment.publish',
          resourceType: 'assessment',
          resourceId: id,
          after: { gradeCount: a.grades.length },
        },
      });
      return tx.assessment.findUnique({
        where: { id },
        include: {
          _count: { select: { grades: true } },
          teachingAssignment: { include: { subject: { select: { name: true } } } },
        },
      });
    });

    // R8 fan-out — notify each guardian whose child has a grade in this assessment.
    // Deduped by sourceId=assessmentId so re-publication never spams.
    try {
      const studentIds = [...new Set(a.grades.map((g) => g.studentId))];
      if (studentIds.length > 0) {
        const guardianships = await this.prisma.guardianship.findMany({
          where: {
            tenantId: me.tenantId,
            studentId: { in: studentIds },
            status: 'active',
            guardian: { userProfileId: { not: null } },
          },
          include: {
            guardian: { select: { userProfileId: true } },
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        });
        const subjectName =
          result?.teachingAssignment?.subject?.name ?? 'une matière';
        await this.notifications.createMany(
          guardianships
            .filter((g) => g.guardian.userProfileId)
            .map((g) => ({
              tenantId: me.tenantId,
              userProfileId: g.guardian.userProfileId!,
              kind: 'grade_published' as const,
              severity: 'info' as const,
              title: `Nouvelle note publiée — ${a.title}`,
              body: `La note de ${g.student.firstName} en ${subjectName} a été publiée.`,
              link: `/parent/grades?studentId=${g.student.id}`,
              sourceType: 'assessment',
              sourceId: id,
            })),
        );
      }
    } catch (err) {
      // Notification fan-out is best-effort — never fails the publish.
      // eslint-disable-next-line no-console
      console.warn('[assessments.publish] notification fan-out failed', err);
    }

    return result;
  }

  /** Unpublish: reverts to draft and hides from parents. Only allowed if no revision exists. */
  @Post(':id/unpublish')
  @RequiresPermission('grades.publish')
  async unpublish(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.assessment.findUnique({
      where: { id },
      include: { grades: { include: { _count: { select: { revisions: true } } } } },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(a, me, jwt);
    if (!a.isPublished) {
      throw new BadRequestException("L'évaluation n'est pas publiée.");
    }
    const revised = a.grades.some((g) => g._count.revisions > 0);
    if (revised) {
      throw new BadRequestException(
        'Impossible de dépublier : certaines notes ont déjà été révisées (audit conservé).',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      await tx.assessment.update({
        where: { id },
        data: { isPublished: false, publishedAt: null },
      });
      await tx.grade.updateMany({
        where: { assessmentId: id, status: 'published' },
        data: { status: 'draft', publishedAt: null },
      });
      return tx.assessment.findUnique({ where: { id } });
    });
  }

  private async assertOwnership(
    assessment: { teacherProfileId: string },
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    const tp = await this.teachers.ensureForUser(me);
    if (assessment.teacherProfileId !== tp.id) {
      throw new ForbiddenException('Vous ne pouvez agir que sur vos propres évaluations.');
    }
  }
}
