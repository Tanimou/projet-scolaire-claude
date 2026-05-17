import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

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

  @Post(':id/roles')
  @RequiresPermission('roles.assign')
  async assignRole(
    @Param('id') userId: string,
    @Body() body: AssignRoleDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.userSync.ensureUser(jwt);
    return this.users.assignRole(userId, body.roleId, me.id, me.tenantId);
  }

  @Delete('roles/:userRoleId')
  @RequiresPermission('roles.assign')
  async revokeRole(@Param('userRoleId') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.userSync.ensureUser(jwt);
    return this.users.revokeRole(id, me.tenantId);
  }
}
