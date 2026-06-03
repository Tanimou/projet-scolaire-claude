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
import { Prisma, SchoolStatus } from '@prisma/client';
import {
  IsEnum,
  IsObject,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { SchoolAddressSchema } from '@pilotage/contracts';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

/** DTO d'adresse structurée — sous-objet JSON du champ `School.address`. */
class SchoolAddressDto {
  @IsOptional() @IsString() @MaxLength(50) continent?: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() @MaxLength(100) city?: string;
  @IsOptional() @IsString() @MaxLength(100) quartier?: string;
  @IsOptional() @IsString() @MaxLength(200) line1?: string;
  @IsOptional() @IsString() @MaxLength(20) postalCode?: string;
}

/**
 * Valide et normalise un objet d'adresse brut (provenant du champ JSON Prisma).
 * Retourne `null` si l'objet est absent ou invalide.
 */
function parseAddress(raw: unknown): ReturnType<typeof SchoolAddressSchema.parse> | null {
  const result = SchoolAddressSchema.safeParse(raw);
  return result.success ? result.data : null;
}

class CreateSchoolDto {
  @IsString() @MinLength(2) @MaxLength(200) name!: string;
  @IsString() @MinLength(2) @MaxLength(30) schoolCode!: string;
  @IsString() @Length(2, 2) country!: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
  /** Adresse géographique structurée de l'établissement (optionnelle). */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SchoolAddressDto)
  address?: SchoolAddressDto;
}

class UpdateSchoolDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() timezone?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsEnum(SchoolStatus) status?: SchoolStatus;
  /** Adresse géographique structurée de l'établissement (optionnelle, `null` = effacer). */
  @IsOptional() @IsObject() @ValidateNested() @Type(() => SchoolAddressDto)
  address?: SchoolAddressDto | null;
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
    // Normalise le champ JSON `address` en objet structuré validé (ou null).
    return {
      data: schools.map((s) => ({
        ...s,
        address: parseAddress(s.address),
      })),
    };
  }

  @Post()
  @RequiresPermission('schools.write')
  async create(@Body() body: CreateSchoolDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // school_code must be globally unique (Prisma constraint)
    const dup = await this.prisma.school.findUnique({ where: { schoolCode: body.schoolCode } });
    if (dup) throw new ConflictException(`Code école « ${body.schoolCode} » déjà utilisé.`);

    const created = await this.prisma.school.create({
      data: {
        tenantId: me.tenantId,
        name: body.name,
        schoolCode: body.schoolCode,
        country: body.country.toUpperCase(),
        timezone: body.timezone ?? 'Europe/Paris',
        locale: body.locale ?? 'fr-FR',
        ...(body.address ? { address: body.address as object } : {}),
      },
    });
    return { ...created, address: parseAddress(created.address) };
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

    // Extrait `address` séparément pour le caster en `object` (type attendu par Prisma Json).
    const { address, ...rest } = body;
    const updated = await this.prisma.school.update({
      where: { id },
      data: {
        ...rest,
        // `null` efface explicitement ; `undefined` = pas de changement d'adresse.
        ...(address !== undefined
          ? { address: address === null ? Prisma.DbNull : (address as object) }
          : {}),
      },
    });
    return { ...updated, address: parseAddress(updated.address) };
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
