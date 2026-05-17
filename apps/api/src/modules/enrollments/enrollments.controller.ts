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
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

class CreateEnrollmentDto {
  @IsUUID() studentId!: string;
  @IsUUID() classSectionId!: string;
  @IsOptional() @IsEnum(EnrollmentStatus) status?: EnrollmentStatus;
}

class TransferEnrollmentDto {
  @IsUUID() toClassSectionId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class EndEnrollmentDto {
  @IsEnum(EnrollmentStatus) status!: EnrollmentStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@ApiTags('enrollments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Fan-out: notify every active guardian of the student about the enrollment event. */
  private async notifyGuardiansOfEnrollment(args: {
    tenantId: string;
    studentId: string;
    enrollmentId: string;
    classSectionName: string;
    status: EnrollmentStatus;
    kind: 'created' | 'transferred' | 'ended';
  }): Promise<void> {
    try {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          guardian: { userProfileId: { not: null } },
        },
        include: {
          guardian: { select: { userProfileId: true } },
          student: { select: { firstName: true } },
        },
      });
      const recipients = guardianships.filter((g) => g.guardian.userProfileId);
      if (recipients.length === 0) return;

      const titleByKind: Record<typeof args.kind, string> = {
        created: `Inscription confirmée — ${args.classSectionName}`,
        transferred: `Changement de classe — ${args.classSectionName}`,
        ended: `Fin d'inscription`,
      };
      const severityByKind: Record<typeof args.kind, 'success' | 'info' | 'warning'> = {
        created: 'success',
        transferred: 'info',
        ended: 'warning',
      };

      await this.notifications.createMany(
        recipients.map((g) => ({
          tenantId: args.tenantId,
          userProfileId: g.guardian.userProfileId!,
          kind: 'enrollment_status' as const,
          severity: severityByKind[args.kind],
          title: titleByKind[args.kind],
          body:
            args.kind === 'ended'
              ? `L'inscription de ${g.student.firstName} a pris fin.`
              : `${g.student.firstName} est désormais inscrit·e en « ${args.classSectionName} ».`,
          link: `/parent/children/${args.studentId}`,
          // Dedup key combines enrollmentId + status transition so a status flip
          // (active → ended → active) yields a fresh notification each time.
          sourceType: `enrollment_${args.kind}`,
          sourceId: args.enrollmentId,
        })),
      );
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[enrollments] notification fan-out failed', err);
    }
  }

  @Get()
  @RequiresPermission('enrollments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('status') status?: EnrollmentStatus,
  ) {
    const me = await this.users.ensureUser(jwt);
    const data = await this.prisma.enrollment.findMany({
      where: {
        tenantId: me.tenantId,
        ...(studentId ? { studentId } : {}),
        ...(classSectionId ? { classSectionId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ enrolledAt: 'desc' }],
      include: {
        student: { select: { id: true, firstName: true, lastName: true, externalRef: true } },
        classSection: { include: { gradeLevel: true } },
        academicYear: { select: { id: true, name: true, status: true } },
      },
    });
    return { data };
  }

  @Post()
  @RequiresPermission('enrollments.write')
  async create(@Body() body: CreateEnrollmentDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const [student, classSection] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: body.studentId } }),
      this.prisma.classSection.findUnique({
        where: { id: body.classSectionId },
        include: {
          academicYear: true,
          _count: { select: { enrollments: { where: { status: 'active' } } } },
        },
      }),
    ]);
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException('Élève introuvable');
    if (!classSection || classSection.tenantId !== me.tenantId)
      throw new NotFoundException('Classe introuvable');
    if (classSection.academicYear.status === 'archived') {
      throw new BadRequestException("Impossible d'inscrire dans une année archivée.");
    }
    if (classSection.status === 'closed') {
      throw new BadRequestException('Cette classe est fermée.');
    }
    if (classSection._count.enrollments >= classSection.maxStudents) {
      throw new ConflictException(
        `Capacité atteinte : la classe « ${classSection.name} » a déjà ${classSection.maxStudents} élèves inscrits.`,
      );
    }

    // Block double enrollment in the same academic year (active only).
    const conflict = await this.prisma.enrollment.findFirst({
      where: {
        tenantId: me.tenantId,
        studentId: body.studentId,
        academicYearId: classSection.academicYearId,
        status: 'active',
      },
      include: { classSection: { select: { name: true } } },
    });
    if (conflict) {
      throw new ConflictException(
        `L'élève est déjà inscrit en « ${conflict.classSection.name} » pour cette année. Utilisez « transférer » pour le changer de classe.`,
      );
    }

    const created = await this.prisma.enrollment.create({
      data: {
        tenantId: me.tenantId,
        studentId: body.studentId,
        classSectionId: body.classSectionId,
        academicYearId: classSection.academicYearId,
        status: body.status ?? 'active',
        enrolledAt: new Date(),
      },
      include: {
        classSection: { include: { gradeLevel: true } },
        academicYear: true,
      },
    });

    // R8 fan-out — only notify guardians for active enrollments (skip pending).
    if (created.status === 'active') {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: created.studentId,
        enrollmentId: created.id,
        classSectionName: created.classSection.name,
        status: created.status,
        kind: 'created',
      });
    }

    return created;
  }

  @Patch(':id')
  @RequiresPermission('enrollments.write')
  async update(
    @Param('id') id: string,
    @Body() body: EndEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();

    const isEnding = body.status !== 'active' && body.status !== 'pending';
    const becameActive = enrollment.status !== 'active' && body.status === 'active';

    const updated = await this.prisma.enrollment.update({
      where: { id },
      data: {
        status: body.status,
        ...(isEnding && !enrollment.endedAt ? { endedAt: new Date(), endReason: body.reason } : {}),
      },
      include: { classSection: { select: { name: true } } },
    });

    if (becameActive || (isEnding && !enrollment.endedAt)) {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: updated.studentId,
        enrollmentId: updated.id,
        classSectionName: updated.classSection.name,
        status: updated.status,
        kind: becameActive ? 'created' : 'ended',
      });
    }

    return updated;
  }

  /** Transfer student from current active enrollment to a new class (same academic year). */
  @Post(':id/transfer')
  @RequiresPermission('enrollments.write')
  async transfer(
    @Param('id') id: string,
    @Body() body: TransferEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const current = await this.prisma.enrollment.findUnique({
      where: { id },
      include: { classSection: { include: { academicYear: true } } },
    });
    if (!current || current.tenantId !== me.tenantId) throw new NotFoundException();
    if (current.status !== 'active') {
      throw new BadRequestException('Seule une inscription active peut être transférée.');
    }
    if (current.classSectionId === body.toClassSectionId) {
      throw new BadRequestException("L'élève est déjà dans cette classe.");
    }

    const target = await this.prisma.classSection.findUnique({
      where: { id: body.toClassSectionId },
      include: {
        academicYear: true,
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    });
    if (!target || target.tenantId !== me.tenantId) throw new NotFoundException('Classe cible introuvable');
    if (target.academicYearId !== current.academicYearId) {
      throw new BadRequestException('Le transfert doit rester dans la même année scolaire.');
    }
    if (target._count.enrollments >= target.maxStudents) {
      throw new ConflictException(`Capacité atteinte sur « ${target.name} ».`);
    }

    return this.prisma.$transaction([
      this.prisma.enrollment.update({
        where: { id },
        data: {
          status: 'transferred_out',
          endedAt: new Date(),
          endReason: body.reason ?? `Transféré vers ${target.name}`,
        },
      }),
      this.prisma.enrollment.create({
        data: {
          tenantId: me.tenantId,
          studentId: current.studentId,
          classSectionId: body.toClassSectionId,
          academicYearId: current.academicYearId,
          status: 'active',
        },
      }),
    ]);
  }

  @Delete(':id')
  @RequiresPermission('enrollments.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();
    // Allow hard-delete only when status is pending. Otherwise mark as dropped (soft).
    if (enrollment.status === 'pending') {
      await this.prisma.enrollment.delete({ where: { id } });
      return { ok: true, deleted: true };
    }
    return this.prisma.enrollment.update({
      where: { id },
      data: { status: 'dropped', endedAt: new Date(), endReason: 'Annulation administrative' },
    });
  }

  /** Roster — list active enrollments per class section, useful for the teacher portal. */
  @Get('roster/:classSectionId')
  @RequiresPermission('enrollments.read')
  async roster(@Param('classSectionId') classSectionId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({ where: { id: classSectionId } });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classSectionId, status: 'active', tenantId: me.tenantId },
      include: { student: true },
      orderBy: { student: { lastName: 'asc' } satisfies Prisma.StudentOrderByWithRelationInput },
    });
    return {
      classSection: cls,
      enrollments,
      capacity: { current: enrollments.length, max: cls.maxStudents },
    };
  }
}
