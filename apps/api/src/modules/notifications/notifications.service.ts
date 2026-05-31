import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type {
  Notification,
  NotificationKind,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_NOTIFICATIONS_EMAIL } from '../../shared/queue/queue.module';
import type { NotificationEmailJob } from './notification-email.types';
import { NotificationPreferencesService } from './preferences.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly preferences: NotificationPreferencesService,
    @InjectQueue(QUEUE_NOTIFICATIONS_EMAIL)
    private readonly emailQueue: Queue<NotificationEmailJob>,
  ) {}

  /**
   * Insert one notification unconditionally. This is the raw low-level insert
   * and does NOT consult notification preferences — reserve it for guaranteed
   * deliveries. Fan-out producers should use `createMany`, which honours each
   * recipient's in-app preference per kind.
   */
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
   * recipient twice even if dispatchers fire concurrently. Then drops items
   * whose recipient has explicitly disabled the in-app channel for that kind
   * (via `/notifications/preferences`), so the settings toggles actually gate
   * delivery.
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

    const deduped = items.filter((i) => {
      if (!i.sourceType || !i.sourceId) return true;
      return !seen.has(`${i.userProfileId}|${i.sourceType}|${i.sourceId}`);
    });
    if (deduped.length === 0) return { created: 0 };

    // Honour per-user notification preferences: drop items whose recipient has
    // explicitly turned the in-app channel off for that kind. Missing override
    // rows default to in-app on, so they pass through untouched.
    const disabled = await this.preferences.disabledInAppKeys(
      deduped.map((i) => ({ userProfileId: i.userProfileId, kind: i.kind })),
    );
    const toInsert = disabled.size
      ? deduped.filter((i) => !disabled.has(`${i.userProfileId}|${i.kind}`))
      : deduped;

    let created = 0;
    if (toInsert.length > 0) {
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
      created = res.count;
    }

    // Email channel (R8.2) — runs on the full deduped set, INDEPENDENT of the
    // in-app gate above: a recipient may keep email on while turning the in-app
    // feed off (and vice-versa). Best-effort; never blocks or fails the in-app
    // insert that the caller depends on.
    await this.dispatchEmails(deduped);

    return { created };
  }

  /**
   * Enqueue an email per recipient who has *explicitly enabled* the email
   * channel for the notification's kind. Email defaults to off, so this is a
   * no-op for the vast majority until a parent opts in via settings. Content is
   * snapshotted from the notification, so the worker renders without a DB hit.
   *
   * Note: source-dedup relies on the in-app row existing to suppress repeats.
   * For an email-only recipient (in-app off) a producer that fires twice for
   * the same source could email twice — acceptable for v1 since producers are
   * one-shot per event (publish, alert-eval already dedups within 7 days).
   */
  private async dispatchEmails(items: CreateNotificationArgs[]): Promise<void> {
    try {
      if (items.length === 0) return;
      const enabled = await this.preferences.emailEnabledKeys(
        items.map((i) => ({ userProfileId: i.userProfileId, kind: i.kind })),
      );
      if (enabled.size === 0) return;

      const toEmail = items.filter((i) => enabled.has(`${i.userProfileId}|${i.kind}`));
      if (toEmail.length === 0) return;

      const recipientIds = [...new Set(toEmail.map((i) => i.userProfileId))];
      const profiles = await this.prisma.userProfile.findMany({
        where: { id: { in: recipientIds } },
        select: { id: true, email: true, firstName: true, lastName: true, locale: true },
      });
      const byId = new Map(profiles.map((p) => [p.id, p]));

      const jobs = toEmail
        .map((i) => {
          const p = byId.get(i.userProfileId);
          if (!p?.email) return null;
          const data: NotificationEmailJob = {
            tenantId: i.tenantId,
            to: p.email,
            recipientName: [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
            locale: p.locale ?? 'fr-FR',
            kind: i.kind,
            severity: i.severity ?? 'info',
            title: i.title,
            body: i.body ?? null,
            link: i.link ?? null,
            sourceType: i.sourceType ?? null,
            sourceId: i.sourceId ?? null,
          };
          return {
            name: i.kind,
            data,
            opts: {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5_000 } as const,
              removeOnComplete: { count: 200, age: 24 * 3600 },
              removeOnFail: { count: 100, age: 7 * 24 * 3600 },
            },
          };
        })
        .filter((j): j is NonNullable<typeof j> => j !== null);

      if (jobs.length === 0) return;
      await this.emailQueue.addBulk(jobs);
      this.logger.log(`Enqueued ${jobs.length} notification email(s)`);
    } catch (err) {
      // Email is a side channel — an enqueue failure must never surface to the
      // caller whose in-app notifications already landed.
      this.logger.error(
        `Notification email dispatch failed (in-app unaffected): ${(err as Error).message}`,
      );
    }
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
