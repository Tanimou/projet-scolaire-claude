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
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsArray, IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

class CreateRoleDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(40)
  slug!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @IsEnum(['admin', 'teacher', 'parent'])
  portal!: 'admin' | 'teacher' | 'parent';

  @IsArray()
  @IsString({ each: true })
  permissionCodes!: string[];
}

class UpdateRoleDto {
  @IsOptional() @IsString() @MaxLength(80) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsArray() @IsString({ each: true }) permissionCodes?: string[];
}

@ApiTags('roles')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('roles')
export class RolesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
  ) {}

  @Get()
  @RequiresPermission('roles.read')
  @ApiOkResponse({ description: 'Catalog complet rôles + permissions' })
  async list() {
    const roles = await this.prisma.role.findMany({
      orderBy: [{ isSystem: 'desc' }, { name: 'asc' }],
      include: { rolePermissions: { include: { permission: true } } },
    });
    return {
      data: roles.map((r) => ({
        id: r.id,
        slug: r.slug,
        name: r.name,
        description: r.description,
        portal: r.portal,
        isSystem: r.isSystem,
        permissions: r.rolePermissions.map((rp) => rp.permission.code),
      })),
    };
  }

  @Get('permissions/catalog')
  @RequiresPermission('roles.read')
  @ApiOkResponse({ description: 'Catalog complet des permissions disponibles' })
  async permissionsCatalog() {
    const perms = await this.prisma.permission.findMany({
      orderBy: [{ resourceType: 'asc' }, { action: 'asc' }],
    });
    // Group by resource_type for easier UI rendering
    const groups: Record<string, { code: string; label: string; action: string }[]> = {};
    for (const p of perms) {
      if (!groups[p.resourceType]) groups[p.resourceType] = [];
      groups[p.resourceType]!.push({ code: p.code, label: p.label, action: p.action });
    }
    return { groups };
  }

  @Post()
  @RequiresPermission('roles.write')
  async create(@Body() body: CreateRoleDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    // Derived BEFORE the transaction opens (S-E06-6's rule). No `@Req()` in this
    // controller, so the two client hints stay the honest blank they already were;
    // capturing them is PF-123's remaining half and is NOT taken in this slice.
    const provenance = deriveAuditProvenance(jwt);
    // Slug must be unique within the tenant (we don't have a tenant_id on Role yet — Phase 2 will add it)
    const existing = await this.prisma.role.findFirst({ where: { slug: body.slug, schoolId: null } });
    if (existing) throw new BadRequestException(`Un rôle avec le slug '${body.slug}' existe déjà.`);

    const perms = await this.prisma.permission.findMany({
      where: { code: { in: body.permissionCodes } },
    });
    if (perms.length !== body.permissionCodes.length) {
      const missing = body.permissionCodes.filter((c) => !perms.find((p) => p.code === c));
      throw new BadRequestException({ message: 'Permissions inconnues', missing });
    }

    // S-E04-7 — the role and its audit row are now created in ONE transaction.
    // Before this slice they were two separate statements, so a failure between
    // them left a role that exists and is unaudited; `write-audit.ts`'s own header
    // cites this handler by name as the measured example. Fail-closed is the
    // decision (ADR-035 D2): if the audit insert fails, the role is not created.
    const role = await this.prisma.$transaction(async (tx) => {
      const created = await tx.role.create({
        data: {
          name: body.name,
          slug: body.slug,
          description: body.description ?? null,
          portal: body.portal,
          isSystem: false,
          rolePermissions: {
            create: perms.map((p) => ({ permissionId: p.id })),
          },
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'role.create',
        resourceType: 'role',
        resourceId: created.id,
        provenance,
        after: { name: created.name, slug: created.slug, permissions: body.permissionCodes },
      });
      return created;
    });

    return { id: role.id };
  }

  @Patch(':id')
  @RequiresPermission('roles.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateRoleDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const role = await this.prisma.role.findUnique({ where: { id } });
    if (!role) throw new NotFoundException('Rôle introuvable');
    if (role.isSystem) throw new ForbiddenException('Les rôles système ne sont pas modifiables');

    const me = await this.users.ensureUser(jwt);
    // Derived BEFORE the transaction opens (S-E06-6's rule). No `@Req()` in this
    // controller, so the two client hints stay the honest blank they already were;
    // capturing them is PF-123's remaining half and is NOT taken in this slice.
    const provenance = deriveAuditProvenance(jwt);

    // S-E04-7 — the audit row moves INSIDE the transaction that already existed
    // here. It used to be written after it committed, so a permission rewrite
    // could succeed while its trace failed, and nothing would say so.
    await this.prisma.$transaction(async (tx) => {
      await tx.role.update({
        where: { id },
        data: {
          name: body.name ?? undefined,
          description: body.description ?? undefined,
        },
      });
      if (body.permissionCodes) {
        const perms = await tx.permission.findMany({ where: { code: { in: body.permissionCodes } } });
        if (perms.length !== body.permissionCodes.length) {
          const missing = body.permissionCodes.filter((c) => !perms.find((p) => p.code === c));
          throw new BadRequestException({ message: 'Permissions inconnues', missing });
        }
        await tx.rolePermission.deleteMany({ where: { roleId: id } });
        for (const p of perms) {
          await tx.rolePermission.create({ data: { roleId: id, permissionId: p.id } });
        }
      }
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'role.update',
        resourceType: 'role',
        resourceId: id,
        provenance,
        before: { name: role.name },
        after: { name: body.name ?? role.name, permissions: body.permissionCodes },
      });
    });

    return { id };
  }

  @Delete(':id')
  @RequiresPermission('roles.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const role = await this.prisma.role.findUnique({
      where: { id },
      include: { userRoles: { where: { revokedAt: null } } },
    });
    if (!role) throw new NotFoundException('Rôle introuvable');
    if (role.isSystem) throw new ForbiddenException('Les rôles système ne sont pas supprimables');
    if (role.userRoles.length > 0) {
      throw new BadRequestException(
        `Ce rôle est assigné à ${role.userRoles.length} utilisateur(s). Révoquez-le d'abord.`,
      );
    }

    const me = await this.users.ensureUser(jwt);
    // Derived BEFORE the transaction opens (S-E06-6's rule). No `@Req()` in this
    // controller, so the two client hints stay the honest blank they already were;
    // capturing them is PF-123's remaining half and is NOT taken in this slice.
    const provenance = deriveAuditProvenance(jwt);
    // S-E04-7 — deletion and its trace in one transaction. A deleted role whose
    // audit row never landed is the worst of the three cases: the evidence that
    // it ever existed is gone with it.
    await this.prisma.$transaction(async (tx) => {
      await tx.role.delete({ where: { id } });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'role.delete',
        resourceType: 'role',
        resourceId: id,
        provenance,
        before: { name: role.name, slug: role.slug },
      });
    });
    return { ok: true };
  }
}
