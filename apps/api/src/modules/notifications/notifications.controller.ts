import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { pageSizeOf, pageWindow } from '@pilotage/contracts';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { NotificationsService } from './notifications.service';

/**
 * Notifications endpoints (R8) — backs the TopbarBell across all 3 portals.
 *
 * The data source is the dedicated `Notification` model populated by fan-out
 * dispatchers (AlertsService, AnnouncementsService...). The `body` /
 * `createdAt` / `readAt` / `link` fields preserve the contract that the
 * TopbarBell expected from the legacy `AnnouncementReceipt` shim.
 */
/**
 * S-E03-9 / PF-50 / ADR-080 — la fenêtre de page de la cloche, avec SES
 * nombres : 20 par défaut, 100 au maximum. Inchangés.
 *
 * Ce site CLAMPAIT DÉJÀ correctement par le bas
 * (`Math.min(100, Math.max(1, …))`) : il ne portait PAS le défaut d'inversion.
 * Il est converti quand même — la tranche supprime la DIVERGENCE, pas seulement
 * ses quatre victimes, et une huitième forme correcte reste une huitième forme.
 *
 * ⚠ `apps/web/src/components/notifications` appelle `notifications?limit=100`,
 * EXACTEMENT le plafond (ADR-080 §D1).
 */
const NOTIFICATIONS_PAGE_WINDOW = pageWindow({ def: 20, max: 100 }).pick({ limit: true });

@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly users: UserSyncService,
  ) {}

  @Get()
  @RequiresPermission('profile.read.self')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('limit') limitRaw?: string,
    @Query('unreadOnly') unreadOnly?: string,
  ) {
    const parsedWindow = NOTIFICATIONS_PAGE_WINDOW.safeParse({ limit: limitRaw });
    if (!parsedWindow.success) {
      throw new BadRequestException(parsedWindow.error.issues.map((i) => i.message));
    }
    const limit = pageSizeOf(parsedWindow.data);
    const me = await this.users.ensureUser(jwt);
    const data = await this.notifications.list({
      tenantId: me.tenantId,
      userProfileId: me.id,
      limit,
      unreadOnly: unreadOnly === 'true',
    });
    return { data };
  }

  @Get('unread-count')
  @RequiresPermission('profile.read.self')
  async unreadCount(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const count = await this.notifications.unreadCount({
      tenantId: me.tenantId,
      userProfileId: me.id,
    });
    return { count };
  }

  @Post(':id/read')
  @RequiresPermission('profile.write.self')
  async markRead(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    await this.notifications.markRead({
      id,
      tenantId: me.tenantId,
      userProfileId: me.id,
    });
    return { ok: true };
  }

  @Post('read-all')
  @RequiresPermission('profile.write.self')
  async markAllRead(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const count = await this.notifications.markAllRead({
      tenantId: me.tenantId,
      userProfileId: me.id,
    });
    return { ok: true, count };
  }
}
