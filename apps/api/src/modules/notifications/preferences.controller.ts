import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { NotificationKind } from '@prisma/client';
import { IsBoolean, IsOptional } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { NotificationPreferencesService } from './preferences.service';

class UpdatePreferenceDto {
  @IsOptional() @IsBoolean() inAppEnabled?: boolean;
  @IsOptional() @IsBoolean() emailEnabled?: boolean;
  @IsOptional() @IsBoolean() pushEnabled?: boolean;
}

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications/preferences')
export class NotificationPreferencesController {
  constructor(
    private readonly prefs: NotificationPreferencesService,
    private readonly users: UserSyncService,
  ) {}

  /** Returns the full kind list, defaults merged with the user's overrides. */
  @Get()
  @RequiresPermission('profile.read.self')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return { data: await this.prefs.listForUser({ tenantId: me.tenantId, userProfileId: me.id }) };
  }

  @Patch(':kind')
  @RequiresPermission('profile.write.self')
  async update(
    @Param('kind') kind: string,
    @Body() dto: UpdatePreferenceDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.prefs.update({
      tenantId: me.tenantId,
      userProfileId: me.id,
      kind: kind as NotificationKind,
      patch: dto,
    });
  }
}
