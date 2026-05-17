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
import { IsBoolean, IsNumber, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class CreateAssignmentDto {
  @IsUUID() teacherProfileId!: string;
  @IsUUID() classSectionId!: string;
  @IsUUID() subjectId!: string;
  @IsOptional() @IsNumber() @Min(0) @Max(40) weeklyHours?: number;
  @IsOptional() @IsBoolean() isMainTeacher?: boolean;
}

class UpdateAssignmentDto {
  @IsOptional() @IsNumber() @Min(0) @Max(40) weeklyHours?: number;
  @IsOptional() @IsBoolean() isMainTeacher?: boolean;
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

    // Only one main teacher per class — if this one is main, demote others.
    if (body.isMainTeacher) {
      await this.prisma.teachingAssignment.updateMany({
        where: { classSectionId: body.classSectionId, isMainTeacher: true },
        data: { isMainTeacher: false },
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
        isMainTeacher: body.isMainTeacher ?? false,
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

    if (body.isMainTeacher === true) {
      await this.prisma.teachingAssignment.updateMany({
        where: { classSectionId: a.classSectionId, isMainTeacher: true, id: { not: id } },
        data: { isMainTeacher: false },
      });
    }
    return this.prisma.teachingAssignment.update({
      where: { id },
      data: {
        ...(body.weeklyHours !== undefined ? { weeklyHours: body.weeklyHours } : {}),
        ...(body.isMainTeacher !== undefined ? { isMainTeacher: body.isMainTeacher } : {}),
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
