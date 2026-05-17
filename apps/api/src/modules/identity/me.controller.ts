import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { UserSyncService } from '../../shared/auth/user-sync.service';

@ApiTags('identity')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeController {
  constructor(private readonly users: UserSyncService) {}

  @Get()
  @ApiOkResponse({ description: 'Current user — provisioned on first call.' })
  async me(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const user = await this.users.ensureUser(jwt);
    const realmRoles = jwt.realm_access?.roles ?? [];
    const permissions = await this.users.listPermissions(jwt.sub, realmRoles);

    const prefs = (user.preferences as Record<string, unknown> | null) ?? {};
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      roles: realmRoles,
      permissions,
      locale: user.locale,
      tenantId: user.tenantId,
      schoolId: (prefs.activeSchoolId as string | undefined) ?? null,
      mfaEnabled: false,
      photoUrl: user.photoUrl,
      preferences: prefs,
    };
  }
}
