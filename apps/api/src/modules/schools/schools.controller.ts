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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolStatus } from '@prisma/client';
import { IsEnum, IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class CreateSchoolDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsString() @MinLength(2) @MaxLength(30) schoolCode!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
}

class UpdateSchoolDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsEnum(SchoolStatus) status?: SchoolStatus;
}

@ApiTags('schools')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('schools')
export class SchoolsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
  ) {}

  /** List all schools belonging to caller's tenant. Phase 2D allows multiple. */
  @Get()
  @RequiresPermission('schools.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const schools = await this.prisma.school.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { createdAt: 'asc' },
      include: {
        _count: {
          select: {
            students: true,
            academicYears: true,
          },
        },
      },
    });
    return { data: schools };
  }

  @Post()
  @RequiresPermission('schools.write')
  async create(@Body() body: CreateSchoolDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // school_code must be globally unique (Prisma constraint)
    const dup = await this.prisma.school.findUnique({ where: { schoolCode: body.schoolCode } });
    if (dup) throw new ConflictException(`Code école « ${body.schoolCode} » déjà utilisé.`);

    return this.prisma.school.create({
      data: {
        tenantId: me.tenantId,
        name: body.name,
        schoolCode: body.schoolCode,
        country: body.country.toUpperCase(),
        timezone: body.timezone ?? 'Europe/Paris',
        locale: body.locale ?? 'fr-FR',
      },
    });
  }

  @Patch(':id')
  @RequiresPermission('schools.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSchoolDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const school = await this.prisma.school.findUnique({ where: { id } });
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.school.update({ where: { id }, data: body });
  }

  @Delete(':id')
  @RequiresPermission('schools.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const school = await this.prisma.school.findUnique({
      where: { id },
      include: { _count: { select: { students: true, academicYears: true } } },
    });
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();
    if (school._count.students > 0 || school._count.academicYears > 0) {
      throw new BadRequestException(
        'Impossible de supprimer une école contenant des élèves ou des années scolaires. Archivez-la plutôt.',
      );
    }
    // Soft-close instead of hard delete to preserve audit trail.
    return this.prisma.school.update({ where: { id }, data: { status: 'closed' } });
  }

  /** Switch the caller's "active school" preference. Stored in user_profile.preferences.activeSchoolId. */
  @Post(':id/switch')
  @RequiresPermission('schools.read')
  async switchActive(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const school = await this.prisma.school.findUnique({ where: { id } });
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();
    const prefs = (me.preferences as Record<string, unknown> | null) ?? {};
    await this.prisma.userProfile.update({
      where: { id: me.id },
      data: { preferences: { ...prefs, activeSchoolId: id } },
    });
    return { ok: true, activeSchoolId: id };
  }
}
