import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { UsersService } from './users.service';

class AssignRoleDto {
  @IsUUID()
  roleId!: string;
}

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('users')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    private readonly userSync: UserSyncService,
  ) {}

  @Get()
  @RequiresPermission('users.read')
  @ApiOkResponse({ description: 'Liste des utilisateurs du tenant' })
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.userSync.ensureUser(jwt);
    const items = await this.users.list(me.tenantId);
    return { data: items, total: items.length };
  }

  /**
   * S-E04-6 — provenance is derived HERE, before the service opens its
   * transaction, from the one extraction seam (`extractAuditClientHints`) and the
   * one derivation (`deriveAuditProvenance`). Neither is reinvented, and the
   * ordering is the `S-E06-6` rule: sanitisation happens outside the transaction
   * so a rejected `inet` cast can never roll back the grant it traces.
   *
   * S-E05-2 — the grantor's EFFECTIVE permission set is derived HERE too, by the
   * same rule and from the same seam `PermissionsGuard:27-28` uses, and passed
   * into the service as a required parameter. `UserSyncService` is deliberately
   * NOT injected into `UsersService` and the realm ∪ custom union is NOT
   * reimplemented: one derivation, one place, the `ADR-035` D4 pattern this
   * handler already follows for `provenance`.
   */
  @Post(':id/roles')
  @RequiresPermission('roles.assign')
  async assignRole(
    @Param('id') userId: string,
    @Body() body: AssignRoleDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.userSync.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const grantorPermissions = await this.userSync.effectivePermissions(
      jwt.sub,
      jwt.realm_access?.roles ?? [],
    );
    return this.users.assignRole(
      userId,
      body.roleId,
      me.id,
      me.tenantId,
      provenance,
      grantorPermissions,
      // ADR-040 — the grantor's realm roles decide their rung on the delegation
      // ladder. Read from the same `realm_access` the permission lookup above
      // uses, so the two bounds cannot disagree about who the grantor is.
      jwt.realm_access?.roles ?? [],
    );
  }

  @Delete('roles/:userRoleId')
  @RequiresPermission('roles.assign')
  async revokeRole(
    @Param('userRoleId') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.userSync.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    return this.users.revokeRole(id, me.tenantId, provenance, me.id);
  }
}
