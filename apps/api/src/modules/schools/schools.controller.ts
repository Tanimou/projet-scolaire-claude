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
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { SchoolAddressSchema } from '@pilotage/contracts';
import { Prisma, SchoolStatus } from '@prisma/client';
import { Type } from 'class-transformer';
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

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
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

  /**
   * S-E04-6 — creation and its audit row, in ONE transaction.
   *
   * The duplicate check stays OUTSIDE: it is a read, and `schoolCode` is
   * globally unique, so the check races regardless of transaction placement —
   * the unique constraint is what actually decides. Posture recorded rather than
   * discovered in review: the 409 echoes the submitted code back, which is a
   * cross-tenant existence oracle on a globally unique column. Pre-existing, not
   * introduced here, and not silently changed inside an audit slice (`ADR-035`).
   */
  @Post()
  @RequiresPermission('schools.write')
  async create(
    @Body() body: CreateSchoolDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    // school_code must be globally unique (Prisma constraint)
    const dup = await this.prisma.school.findUnique({ where: { schoolCode: body.schoolCode } });
    if (dup) throw new ConflictException(`Code école « ${body.schoolCode} » déjà utilisé.`);

    const created = await this.prisma.$transaction(async (tx) => {
      const school = await tx.school.create({
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
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.create',
        resourceType: 'school',
        resourceId: school.id,
        provenance,
        after: {
          name: school.name,
          schoolCode: school.schoolCode,
          country: school.country,
          timezone: school.timezone,
          locale: school.locale,
        },
      });
      return school;
    });
    return { ...created, address: parseAddress(created.address) };
  }

  @Patch(':id')
  @RequiresPermission('schools.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateSchoolDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const school = await this.prisma.school.findUnique({ where: { id } });
    // G-TENANT — a foreign-tenant id is a 404 here, before the transaction opens,
    // so a refused request writes no row.
    if (!school || school.tenantId !== me.tenantId) throw new NotFoundException();

    // Extrait `address` séparément pour le caster en `object` (type attendu par Prisma Json).
    const { address, ...rest } = body;
    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.school.update({
        where: { id },
        data: {
          ...rest,
          // `null` efface explicitement ; `undefined` = pas de changement d'adresse.
          ...(address !== undefined
            ? { address: address === null ? Prisma.DbNull : (address as object) }
            : {}),
        },
      });
      await writeAudit(tx, {
        // The CALLER's tenant, never the target's — they are equal here only
        // because the guard above refused every case in which they would differ.
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.update',
        resourceType: 'school',
        resourceId: id,
        provenance,
        before: { name: school.name, timezone: school.timezone, locale: school.locale, status: school.status },
        after: { name: next.name, timezone: next.timezone, locale: next.locale, status: next.status },
      });
      return next;
    });
    return { ...updated, address: parseAddress(updated.address) };
  }

  @Delete(':id')
  @RequiresPermission('schools.write')
  async remove(
    @Param('id') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
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
    // Soft-close instead of hard delete to preserve audit trail. The audit code is
    // therefore `school.close`, NOT `school.delete`: the row survives with
    // `status: 'closed'` and the vocabulary must not describe a deletion that did
    // not happen.
    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.school.update({ where: { id }, data: { status: 'closed' } });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'school.close',
        resourceType: 'school',
        resourceId: id,
        provenance,
        before: { name: school.name, schoolCode: school.schoolCode, status: school.status },
        after: { status: closed.status },
      });
      return closed;
    });
  }

  /**
   * Switch the caller's "active school" preference. Stored in
   * user_profile.preferences.activeSchoolId.
   *
   * S-E04-6 — DELIBERATELY NOT AUDITED, and deliberately NOT a member of the
   * « school mutation » family. It mutates `userProfile.preferences` — the
   * caller's own UI state — and no school row changes. Auditing it would fill the
   * governance trail with navigation, and calling it a school mutation would make
   * the family's coverage claim false in the other direction.
   */
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
