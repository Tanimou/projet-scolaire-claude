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
import { ClassStatus, Prisma } from '@prisma/client';
import { IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { ClassesService } from './classes.service';
import { SchoolContextService } from './school-context.service';

class CreateClassDto {
  @IsString() @MinLength(1) @MaxLength(40) name!: string;
  @IsUUID() academicYearId!: string;
  @IsUUID() gradeLevelId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxStudents?: number;
  // Champs personnalisables.
  @IsOptional() @IsString() @MaxLength(40) room?: string;
  @IsOptional() @IsString() @MaxLength(40) color?: string;
  @IsOptional() @IsString() @MaxLength(40) icon?: string;
  @IsOptional() @IsObject() options?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string;
}

class UpdateClassDto {
  @IsOptional() @IsString() @MaxLength(40) name?: string;
  @IsOptional() @IsInt() @Min(1) @Max(200) maxStudents?: number;
  @IsOptional() @IsEnum(ClassStatus) status?: ClassStatus;
  // Champs personnalisables (null = effacement explicite).
  @IsOptional() @IsString() @MaxLength(40) room?: string | null;
  @IsOptional() @IsString() @MaxLength(40) color?: string | null;
  @IsOptional() @IsString() @MaxLength(40) icon?: string | null;
  @IsOptional() @IsObject() options?: Record<string, unknown> | null;
  @IsOptional() @IsString() @MaxLength(2000) internalNotes?: string | null;
}

/**
 * Normalise une valeur JSON optionnelle pour Prisma :
 * - `undefined` → champ ignoré ; `null` → effacement (`Prisma.JsonNull`) ;
 * - objet → écrit tel quel.
 */
function toJsonInput(
  value: Record<string, unknown> | null | undefined,
): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.JsonNull;
  return value as Prisma.InputJsonValue;
}

@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('classes')
export class ClassesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly classes: ClassesService,
  ) {}

  @Get()
  @RequiresPermission('classes.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('academicYearId') academicYearId?: string,
    @Query('gradeLevelId') gradeLevelId?: string,
    @Query('cycleId') cycleId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forTenant(me.tenantId);
    const yearFilter = academicYearId ?? activeAcademicYearId;
    const classes = await this.prisma.classSection.findMany({
      where: {
        tenantId: me.tenantId,
        ...(yearFilter ? { academicYearId: yearFilter } : { academicYear: { schoolId } }),
        ...(gradeLevelId ? { gradeLevelId } : {}),
        ...(cycleId ? { gradeLevel: { cycleId } } : {}),
      },
      orderBy: [{ gradeLevel: { orderIndex: 'asc' } }, { name: 'asc' }],
      include: {
        gradeLevel: { include: { cycle: true } },
        academicYear: { select: { id: true, name: true, status: true } },
        _count: { select: { enrollments: { where: { status: 'active' } } } },
        // Main teacher (Professeur principal) — first teaching assignment marked `isMainTeacher`
        teachingAssignments: {
          where: { isMainTeacher: true },
          take: 1,
          include: {
            teacherProfile: {
              include: {
                userProfile: {
                  select: { id: true, firstName: true, lastName: true, email: true, photoUrl: true },
                },
              },
            },
            subject: { select: { id: true, name: true, color: true } },
          },
        },
      },
    });
    return { data: classes };
  }

  /**
   * Class detail — used by the /admin/classes/[id] page.
   * Surfaces the full relationship chain: cycle → grade level → class →
   * active roster + subjects applicable at this level with their coefficients,
   * enrichi des indicateurs agrégés (taux de notation, taux de présence,
   * performance moyenne), de l'équipe enseignante et des alertes de la classe.
   */
  @Get(':id')
  @RequiresPermission('classes.read')
  async detail(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({
      where: { id },
      include: {
        academicYear: { select: { id: true, name: true, status: true, startDate: true, endDate: true } },
        gradeLevel: {
          include: {
            cycle: { select: { id: true, name: true, code: true, color: true, icon: true, orderIndex: true } },
            coefficients: {
              include: {
                subject: {
                  select: { id: true, code: true, name: true, defaultCoefficient: true, color: true, icon: true, active: true },
                },
              },
              orderBy: { subject: { name: 'asc' } },
            },
          },
        },
        enrollments: {
          where: { status: 'active' },
          orderBy: { student: { lastName: 'asc' } },
          include: {
            student: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                externalRef: true,
                gender: true,
                birthDate: true,
                email: true,
                status: true,
                _count: { select: { guardianships: { where: { status: 'active' } } } },
              },
            },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();

    // Also surface subjects without a coefficient (using defaultCoefficient).
    // Useful when the admin hasn't customised coefs for the level yet.
    const allSubjects = await this.prisma.subject.findMany({
      where: { schoolId: cls.gradeLevel.schoolId, active: true },
      orderBy: { name: 'asc' },
    });
    const coefBySubjectId = new Map(cls.gradeLevel.coefficients.map((c) => [c.subjectId, c]));
    const subjects = allSubjects.map((s) => {
      const override = coefBySubjectId.get(s.id);
      return {
        id: s.id,
        code: s.code,
        name: s.name,
        color: s.color,
        icon: s.icon,
        defaultCoefficient: s.defaultCoefficient,
        coefficient: override?.coefficient ?? s.defaultCoefficient,
        isOverride: !!override,
      };
    });

    // Indicateurs agrégés + équipe enseignante + alertes (en parallèle).
    const studentIds = cls.enrollments.map((e) => e.student.id);
    const [aggregate, teachers, alerts] = await Promise.all([
      this.classes.detailAggregate({
        tenantId: me.tenantId,
        classSectionId: cls.id,
        studentIds,
      }),
      this.classes.classTeachers({ tenantId: me.tenantId, classSectionId: cls.id }),
      this.classes.classAlerts({ tenantId: me.tenantId, classSectionId: cls.id }),
    ]);

    return {
      ...cls,
      capacity: { current: cls.enrollments.length, max: cls.maxStudents },
      subjects, // subjects merged with effective coefficient
      teachers,
      alerts,
      openAlertsCount: alerts.filter((a) => a.status === 'open').length,
      gradingRate: aggregate.gradingRate,
      attendanceRate: aggregate.attendanceRate,
      performance: aggregate.performance,
    };
  }

  @Post()
  @RequiresPermission('classes.write')
  async create(@Body() body: CreateClassDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const [year, level] = await Promise.all([
      this.prisma.academicYear.findUnique({ where: { id: body.academicYearId } }),
      this.prisma.gradeLevel.findUnique({ where: { id: body.gradeLevelId } }),
    ]);
    if (!year || year.tenantId !== me.tenantId) throw new NotFoundException('Année scolaire introuvable');
    if (!level || level.tenantId !== me.tenantId) throw new NotFoundException('Niveau introuvable');
    if (year.schoolId !== level.schoolId) {
      throw new BadRequestException("L'année et le niveau doivent appartenir à la même école.");
    }
    if (year.status === 'archived') {
      throw new BadRequestException('Impossible de créer une classe dans une année archivée.');
    }

    const dup = await this.prisma.classSection.findUnique({
      where: {
        academicYearId_gradeLevelId_name: {
          academicYearId: body.academicYearId,
          gradeLevelId: body.gradeLevelId,
          name: body.name,
        },
      },
    });
    if (dup) throw new ConflictException(`Une classe « ${body.name} » existe déjà pour ce niveau cette année.`);

    return this.prisma.classSection.create({
      data: {
        tenantId: me.tenantId,
        academicYearId: body.academicYearId,
        gradeLevelId: body.gradeLevelId,
        name: body.name,
        maxStudents: body.maxStudents ?? 30,
        room: body.room,
        color: body.color,
        icon: body.icon,
        options: toJsonInput(body.options),
        internalNotes: body.internalNotes,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('classes.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateClassDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({ where: { id } });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.classSection.update({
      where: { id },
      data: {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.maxStudents !== undefined ? { maxStudents: body.maxStudents } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.room !== undefined ? { room: body.room } : {}),
        ...(body.color !== undefined ? { color: body.color } : {}),
        ...(body.icon !== undefined ? { icon: body.icon } : {}),
        ...(body.options !== undefined ? { options: toJsonInput(body.options) } : {}),
        ...(body.internalNotes !== undefined ? { internalNotes: body.internalNotes } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('classes.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({
      where: { id },
      include: { _count: { select: { enrollments: { where: { status: 'active' } } } } },
    });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();
    if (cls._count.enrollments > 0) {
      throw new BadRequestException(
        `Impossible de supprimer : ${cls._count.enrollments} élève(s) y sont inscrit(s). Transférez-les ou clôturez la classe.`,
      );
    }
    // Soft alternative: close it rather than hard-delete if it has historical enrollments.
    const historical = await this.prisma.enrollment.count({ where: { classSectionId: id } });
    if (historical > 0) {
      return this.prisma.classSection.update({ where: { id }, data: { status: 'closed' } });
    }
    await this.prisma.classSection.delete({ where: { id } });
    return { ok: true };
  }
}
