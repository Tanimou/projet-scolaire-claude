import {
  BadRequestException,
  Body,
  ConflictException,
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
import { StudentStatus } from '@prisma/client';
import {
  IsDateString,
  IsEmail,
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
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
import { SchoolContextService } from '../school-structure/school-context.service';

import { StudentAccessService } from './student-access.service';

class CreateStudentDto {
  @IsString() @MinLength(1) @MaxLength(80) firstName!: string;
  @IsString() @MinLength(1) @MaxLength(80) lastName!: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Length(1, 1) gender?: string;
  @IsOptional() @IsString() @Length(2, 2) nationality?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) medicalNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

class UpdateStudentDto {
  @IsOptional() @IsString() @MaxLength(80) firstName?: string;
  @IsOptional() @IsString() @MaxLength(80) lastName?: string;
  @IsOptional() @IsDateString() birthDate?: string;
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() @MaxLength(40) phone?: string;
  @IsOptional() @IsString() @Length(1, 1) gender?: string;
  @IsOptional() @IsString() @Length(2, 2) nationality?: string;
  @IsOptional() @IsObject() address?: Record<string, unknown>;
  @IsOptional() @IsString() @MaxLength(2000) medicalNotes?: string;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
  @IsOptional() @IsEnum(StudentStatus) status?: StudentStatus;
  @IsOptional() @IsObject() customFields?: Record<string, unknown>;
}

@ApiTags('students')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('students')
export class StudentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly access: StudentAccessService,
  ) {}

  @Get()
  @RequiresPermission('students.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('q') q?: string,
    @Query('status') status?: StudentStatus,
    @Query('classSectionId') classSectionId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('unenrolled') unenrolled?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forUser(me);
    const scope = await this.access.scopeForUser(me, jwt, schoolId);

    const where: Record<string, unknown> = {
      tenantId: me.tenantId,
      schoolId,
      ...(scope.studentIds ? { id: { in: scope.studentIds } } : {}),
      ...(status ? { status } : {}),
      ...(q
        ? {
            OR: [
              { firstName: { contains: q, mode: 'insensitive' } },
              { lastName: { contains: q, mode: 'insensitive' } },
              { externalRef: { contains: q, mode: 'insensitive' } },
              { email: { contains: q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    if (classSectionId) {
      where.enrollments = {
        some: {
          classSectionId,
          status: 'active',
          ...(academicYearId ? { academicYearId } : {}),
        },
      };
    } else if (unenrolled === 'true' && activeAcademicYearId) {
      where.enrollments = {
        none: { academicYearId: activeAcademicYearId, status: 'active' },
      };
    }

    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const skip = parseInt(offset ?? '0', 10) || 0;

    const [items, total] = await Promise.all([
      this.prisma.student.findMany({
        where,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
        take,
        skip,
        include: {
          enrollments: {
            where: { status: 'active' },
            include: {
              // The list UI surfaces the full breadcrumb Cycle → Niveau → Classe,
              // so we need to load the gradeLevel + cycle even on the list endpoint.
              classSection: {
                select: {
                  id: true,
                  name: true,
                  gradeLevel: {
                    select: {
                      id: true,
                      name: true,
                      code: true,
                      cycle: { select: { id: true, name: true, color: true } },
                    },
                  },
                },
              },
              academicYear: { select: { id: true, name: true } },
            },
          },
          // First active primary guardian — surfaced as "Responsable légal" in the table
          guardianships: {
            where: { status: 'active' },
            orderBy: [{ isPrimaryContact: 'desc' }, { createdAt: 'asc' }],
            take: 1,
            include: {
              guardian: {
                select: { id: true, firstName: true, lastName: true, email: true },
              },
            },
          },
          _count: { select: { guardianships: true } },
        },
      }),
      this.prisma.student.count({ where }),
    ]);
    return { data: items, total, limit: take, offset: skip };
  }

  @Get(':id')
  @RequiresPermission('students.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: {
        enrollments: {
          orderBy: { enrolledAt: 'desc' },
          include: {
            classSection: { include: { gradeLevel: { include: { cycle: true } } } },
            academicYear: true,
          },
        },
        guardianships: {
          where: { status: { not: 'revoked' } },
          include: { guardian: true },
        },
      },
    });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    if (!(await this.access.canAccessStudent(me, jwt, student.id, student.schoolId))) {
      throw new ForbiddenException("Vous n'avez pas accès à cet élève.");
    }
    return student;
  }

  @Post()
  @RequiresPermission('students.write')
  async create(@Body() body: CreateStudentDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    if (body.externalRef) {
      const dup = await this.prisma.student.findUnique({
        where: { schoolId_externalRef: { schoolId, externalRef: body.externalRef } },
      });
      if (dup) throw new ConflictException(`Référence externe « ${body.externalRef} » déjà utilisée.`);
    }

    if (body.birthDate) {
      const d = new Date(body.birthDate);
      const age = (Date.now() - d.getTime()) / (365.25 * 24 * 3600 * 1000);
      if (Number.isNaN(d.getTime()) || age < 2 || age > 30) {
        throw new BadRequestException('Date de naissance invalide (âge attendu 2–30 ans).');
      }
    }

    return this.prisma.student.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        firstName: body.firstName,
        lastName: body.lastName,
        birthDate: body.birthDate ? new Date(body.birthDate) : null,
        externalRef: body.externalRef,
        email: body.email,
        phone: body.phone,
        gender: body.gender,
        nationality: body.nationality?.toUpperCase(),
        address: body.address as never,
        medicalNotes: body.medicalNotes,
        notes: body.notes,
        customFields: (body.customFields ?? {}) as never,
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('students.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateStudentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();

    if (body.externalRef && body.externalRef !== student.externalRef) {
      const dup = await this.prisma.student.findUnique({
        where: { schoolId_externalRef: { schoolId: student.schoolId, externalRef: body.externalRef } },
      });
      if (dup && dup.id !== id) {
        throw new ConflictException(`Référence externe « ${body.externalRef} » déjà utilisée.`);
      }
    }

    return this.prisma.student.update({
      where: { id },
      data: {
        ...(body.firstName !== undefined ? { firstName: body.firstName } : {}),
        ...(body.lastName !== undefined ? { lastName: body.lastName } : {}),
        ...(body.birthDate !== undefined ? { birthDate: body.birthDate ? new Date(body.birthDate) : null } : {}),
        ...(body.externalRef !== undefined ? { externalRef: body.externalRef } : {}),
        ...(body.email !== undefined ? { email: body.email } : {}),
        ...(body.phone !== undefined ? { phone: body.phone } : {}),
        ...(body.gender !== undefined ? { gender: body.gender } : {}),
        ...(body.nationality !== undefined ? { nationality: body.nationality?.toUpperCase() } : {}),
        ...(body.address !== undefined ? { address: body.address as never } : {}),
        ...(body.medicalNotes !== undefined ? { medicalNotes: body.medicalNotes } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.customFields !== undefined ? { customFields: body.customFields as never } : {}),
      },
    });
  }

  @Delete(':id')
  @RequiresPermission('students.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({
      where: { id },
      include: { _count: { select: { enrollments: true } } },
    });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();
    if (student._count.enrollments > 0) {
      throw new BadRequestException(
        "L'élève a un historique d'inscriptions. Marquez-le « withdrawn » au lieu de le supprimer.",
      );
    }
    await this.prisma.student.delete({ where: { id } });
    return { ok: true };
  }
}
