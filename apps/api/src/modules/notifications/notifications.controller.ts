import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

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
    const me = await this.users.ensureUser(jwt);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? '20', 10) || 20));
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

  /**
   * Send a one-off test email to the current user from the settings page, so a
   * parent/teacher can verify the email channel actually reaches their inbox
   * after enabling it. Goes through the same queue + worker as real emails.
   */
  @Post('test-email')
  @RequiresPermission('profile.read.self')
  async sendTestEmail(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { to } = await this.notifications.sendTestEmail({
      tenantId: me.tenantId,
      userProfileId: me.id,
    });
    return { ok: true, to };
  }
}
