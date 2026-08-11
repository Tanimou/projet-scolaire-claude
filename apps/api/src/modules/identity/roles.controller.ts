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
import { assertWithinCeiling } from '../../shared/auth/privilege-ceiling';
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

    // S-E05-2 (PF-09) — THE PRIVILEGE CEILING. Until this line the only question
    // asked was « does this code exist in the catalogue », never « does the
    // caller hold it » — so a `school_admin` could mint a role carrying
    // `grades.revise` (revise PUBLISHED grades, a permission no admin is meant
    // to hold), assign it to themselves, and re-authenticate into it.
    //
    // ORDERING, DECIDED: strictly AFTER the `Permissions inconnues` 400 above —
    // an unknown code is an input-validation error and must keep winning, or a
    // typo would be reported as an authorisation failure. And strictly BEFORE
    // `$transaction` below, so a refused request writes no Role row, no
    // role_permission row and no audit row (the house posture the two
    // cross-tenant refusals in `users.service.ts` already follow).
    //
    // The grantor's set comes from the SAME seam `PermissionsGuard:27-28` uses,
    // derived here in the controller. It is read a second time this request (the
    // guard already read it); that duplicated read is accepted and NOT cached —
    // a cache on an authorisation decision is a staleness fail-open.
    const grantorPermissions = await this.users.effectivePermissions(
      jwt.sub,
      jwt.realm_access?.roles ?? [],
    );
    assertWithinCeiling(grantorPermissions, body.permissionCodes);

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

    // S-E05-2 (PF-09, the worse half) — THE PRIVILEGE CEILING on the REWRITE.
    // `update()` replaces an existing role's permission set wholesale, and every
    // current holder of that role gains the new set at their next
    // `effectivePermissions` read — no second request needed.
    //
    // THE CATALOGUE CHECK IS HOISTED OUT OF THE TRANSACTION, and that move is
    // the point rather than tidying. It used to live INSIDE `$transaction`,
    // while `create()`'s identical check lives outside it. Leaving it there and
    // putting the ceiling before the transaction would have made one input — an
    // unknown permission code — answer 400 from `create()` and 403 from
    // `update()`: two handlers, two answers, for one typo. Hoisting it restores
    // one contract (unknown code → 400 → then ceiling → 403 → then the write)
    // and is safe: `Permission` is a static seeded catalogue and `create()`
    // already reads it outside its own transaction. The `deleteMany` + `create`
    // rewrite below stays INSIDE the transaction, and `writeAudit` is untouched.
    //
    // AC-3 / FR-4 — DELIBERATE EXEMPTION: when `body.permissionCodes` is absent
    // (a rename or a description edit) NO ceiling check runs. Requiring a
    // renamer to hold every permission the role already carries would refuse an
    // operation that grants nothing at all. Recorded as a decision, not an
    // oversight — and recorded as currently UNREACHABLE from the shipped UI,
    // because `RoleBuilderForm.tsx:132-135` always sends `permissionCodes` on
    // edit. It is correct and it is dormant; both halves are in ADR-015.
    let perms: { id: string; code: string }[] | null = null;
    if (body.permissionCodes) {
      const resolved = await this.prisma.permission.findMany({
        where: { code: { in: body.permissionCodes } },
      });
      if (resolved.length !== body.permissionCodes.length) {
        const missing = body.permissionCodes.filter((c) => !resolved.find((p) => p.code === c));
        throw new BadRequestException({ message: 'Permissions inconnues', missing });
      }
      perms = resolved;
      const grantorPermissions = await this.users.effectivePermissions(
        jwt.sub,
        jwt.realm_access?.roles ?? [],
      );
      assertWithinCeiling(grantorPermissions, body.permissionCodes);
    }

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
      if (perms) {
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
