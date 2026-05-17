import { Injectable, Logger } from '@nestjs/common';
import type {
  Notification,
  NotificationKind,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface NotificationDto {
  id: string;
  kind: NotificationKind;
  severity: NotificationSeverity;
  title: string;
  body: string | null;
  link: string | null;
  sourceType: string | null;
  sourceId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface CreateNotificationArgs {
  tenantId: string;
  userProfileId: string;
  kind: NotificationKind;
  title: string;
  body?: string | null;
  link?: string | null;
  severity?: NotificationSeverity;
  sourceType?: string | null;
  sourceId?: string | null;
}

/**
 * Notifications service — owns the unified in-app feed.
 *
 * Producer methods (`create`, `createMany`) are called by:
 *   - AlertsService.evaluateAll  → one per new alert, addressed to each
 *     guardian of the affected student
 *   - AnnouncementsService.publish → one per recipient
 *   - GradesService.publishMany  → one per parent of a graded student (R8.2)
 *   - EnrollmentsService.approve / reject → one per requesting guardian
 *
 * Consumer methods (`list`, `unreadCount`, `markRead*`) back the TopbarBell.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Insert one notification. Returns the created row. */
  async create(args: CreateNotificationArgs): Promise<Notification> {
    return this.prisma.notification.create({
      data: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        kind: args.kind,
        severity: args.severity ?? 'info',
        title: args.title,
        body: args.body ?? null,
        link: args.link ?? null,
        sourceType: args.sourceType ?? null,
        sourceId: args.sourceId ?? null,
      },
    });
  }

  /**
   * Bulk fan-out. Deduplicates by (userProfileId, sourceType, sourceId)
   * within the same tenant so a single source event doesn't ping the same
   * recipient twice even if dispatchers fire concurrently.
   */
  async createMany(items: CreateNotificationArgs[]): Promise<{ created: number }> {
    if (items.length === 0) return { created: 0 };

    // Dedup keys to skip
    const sourceKeys = items
      .filter((i) => i.sourceType && i.sourceId)
      .map((i) => ({
        userProfileId: i.userProfileId,
        sourceType: i.sourceType!,
        sourceId: i.sourceId!,
      }));

    const existing = sourceKeys.length
      ? await this.prisma.notification.findMany({
          where: {
            OR: sourceKeys.map((k) => ({
              userProfileId: k.userProfileId,
              sourceType: k.sourceType,
              sourceId: k.sourceId,
            })),
          },
          select: { userProfileId: true, sourceType: true, sourceId: true },
        })
      : [];
    const seen = new Set(
      existing.map((e) => `${e.userProfileId}|${e.sourceType ?? ''}|${e.sourceId ?? ''}`),
    );

    const toInsert = items.filter((i) => {
      if (!i.sourceType || !i.sourceId) return true;
      return !seen.has(`${i.userProfileId}|${i.sourceType}|${i.sourceId}`);
    });
    if (toInsert.length === 0) return { created: 0 };

    const res = await this.prisma.notification.createMany({
      data: toInsert.map((i) => ({
        tenantId: i.tenantId,
        userProfileId: i.userProfileId,
        kind: i.kind,
        severity: i.severity ?? 'info',
        title: i.title,
        body: i.body ?? null,
        link: i.link ?? null,
        sourceType: i.sourceType ?? null,
        sourceId: i.sourceId ?? null,
      })),
    });
    return { created: res.count };
  }

  async list(args: {
    tenantId: string;
    userProfileId: string;
    limit: number;
    unreadOnly?: boolean;
  }): Promise<NotificationDto[]> {
    const where: Prisma.NotificationWhereInput = {
      tenantId: args.tenantId,
      userProfileId: args.userProfileId,
      ...(args.unreadOnly ? { readAt: null } : {}),
    };
    const rows = await this.prisma.notification.findMany({
      where,
      orderBy: [{ readAt: 'asc' }, { createdAt: 'desc' }],
      take: args.limit,
    });
    return rows.map(this.toDto);
  }

  async unreadCount(args: { tenantId: string; userProfileId: string }): Promise<number> {
    return this.prisma.notification.count({
      where: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        readAt: null,
      },
    });
  }

  async markRead(args: {
    id: string;
    tenantId: string;
    userProfileId: string;
  }): Promise<void> {
    await this.prisma.notification.updateMany({
      where: {
        id: args.id,
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
  }

  async markAllRead(args: { tenantId: string; userProfileId: string }): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: {
        tenantId: args.tenantId,
        userProfileId: args.userProfileId,
        readAt: null,
      },
      data: { readAt: new Date() },
    });
    return res.count;
  }

  private toDto(row: Notification): NotificationDto {
    return {
      id: row.id,
      kind: row.kind,
      severity: row.severity,
      title: row.title,
      body: row.body,
      link: row.link,
      sourceType: row.sourceType,
      sourceId: row.sourceId,
      createdAt: row.createdAt.toISOString(),
      readAt: row.readAt?.toISOString() ?? null,
    };
  }
}
