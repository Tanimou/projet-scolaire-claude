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
import { ASSIGNMENT_ROLES, type AssignmentRole } from '@pilotage/contracts';
import { IsBoolean, IsIn, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { resolveRoleSync } from './assignment-role.util';

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

@ApiTags('teaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('teaching-assignments')
export class TeachingAssignmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
  ) {}

  @Get()
  @RequiresPermission('teaching_assignments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('teacherProfileId') teacherProfileId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('subjectId') subjectId?: string,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const data = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: me.tenantId,
        ...(teacherProfileId ? { teacherProfileId } : {}),
        ...(classSectionId ? { classSectionId } : {}),
        ...(subjectId ? { subjectId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
      },
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
    });
    return { data };
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
