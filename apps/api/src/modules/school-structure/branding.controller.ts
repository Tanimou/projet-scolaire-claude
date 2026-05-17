import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { BrandingService } from './branding.service';
import { UpdateBrandingDto } from './branding.dto';

@ApiTags('branding')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class BrandingController {
  constructor(
    private readonly branding: BrandingService,
    private readonly users: UserSyncService,
  ) {}

  /**
   * Returns the branding for the current user's tenant.
   * Anyone authenticated (admin/teacher/parent) can read it — it drives the UI theme.
   */
  @Get('branding/me')
  @RequiresPermission('branding.read')
  @ApiOkResponse({ description: 'Branding du tenant courant' })
  async getMine(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    return this.branding.getForTenant(user.tenantId);
  }

  @Patch('schools/:id/branding')
  @RequiresPermission('branding.write')
  @ApiOkResponse({ description: 'Branding mis à jour' })
  update(@Param('id') id: string, @Body() body: UpdateBrandingDto) {
    return this.branding.update(id, body);
  }
}
