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
 * Stable dedup identity of a notification: the tenant FIRST, because a
 * `(userProfileId, sourceType, sourceId)` triple alone is a cross-tenant key
 * (`PF-11`). Null-ish source parts collapse to the empty string, which is safe
 * because items with a partial source pair are filtered out before this is ever
 * consulted.
 */
export function dedupKey(
  tenantId: string,
  userProfileId: string,
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
): string {
  return [tenantId, userProfileId, sourceType ?? '', sourceId ?? ''].join('|');
}

/**
 * Refuse a fan-out batch that mixes tenants, and return the one tenant it is for.
 *
 * `createMany` resolves notification preferences ONCE per batch and derives the
 * tenant for that lookup from the batch itself. Every producer in this codebase
 * loops per tenant, so the batch is single-tenant in practice — but that was a
 * code comment, and a comment cannot stop a future producer from concatenating
 * two tenants' recipients into one call. If one ever did, the preference gates
 * would resolve tenant A's toggles for tenant B's recipients and silently
 * deliver or suppress the wrong notifications.
 *
 * Throwing is the correct failure here rather than filtering: silently dropping
 * the foreign items would make a producer bug invisible (`ADR-068 §D2`). Every
 * caller already wraps `createMany` in try/catch or is itself inside one, so a
 * mixed batch degrades to "no notification + a logged error", never to a
 * wrong-tenant delivery.
 */
export function assertSingleTenantBatch(
  items: ReadonlyArray<{ tenantId: string }>,
): string {
  const first = items[0]!.tenantId;
  for (const i of items) {
    if (i.tenantId !== first) {
      throw new Error(
        'NotificationsService.createMany: mixed-tenant batch refused ' +
          `(saw ${first} and ${i.tenantId}); fan-out must be one batch per tenant`,
      );
    }
  }
  return first;
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
   * Bulk fan-out. Deduplicates by (tenantId, userProfileId, sourceType,
   * sourceId) so a single source event doesn't ping the same recipient twice
   * even if dispatchers fire concurrently. Then drops items whose recipient
   * has explicitly disabled the in-app channel for that kind (via
   * `/notifications/preferences`), so the settings toggles actually gate
   * delivery.
   *
   * TENANCY (`PF-11`, `ADR-068`). Until 2026-08-23 the docblock above claimed
   * the dedup ran "within the same tenant" and the query carried no
   * `tenantId` at all — the only `notification` query in either app that did
   * not. Every OR branch now carries its item's OWN `tenantId`, so the query
   * is correct for any batch rather than correct only because callers happen
   * to loop per tenant. `assertSingleTenantBatch` then enforces that habit,
   * because the two preference gates below derive their tenant POSITIONALLY
   * from the batch and a mixed batch would resolve one tenant's toggles
   * against another tenant's recipients.
   */
  async createMany(items: CreateNotificationArgs[]): Promise<{ created: number }> {
    if (items.length === 0) return { created: 0 };
    const batchTenantId = assertSingleTenantBatch(items);

    // Dedup keys to skip. `tenantId` is carried per item, NOT pinned from
    // `items[0]`: a `where` that is only tenant-correct under an unenforced
    // convention is the shape `ADR-063 §D2` refuses.
    const sourceKeys = items
      .filter((i) => i.sourceType && i.sourceId)
      .map((i) => ({
        tenantId: i.tenantId,
        userProfileId: i.userProfileId,
        sourceType: i.sourceType!,
        sourceId: i.sourceId!,
      }));

    const existing = sourceKeys.length
      ? await this.prisma.notification.findMany({
          where: {
            OR: sourceKeys.map((k) => ({
              tenantId: k.tenantId,
              userProfileId: k.userProfileId,
              sourceType: k.sourceType,
              sourceId: k.sourceId,
            })),
          },
          select: {
            tenantId: true,
            userProfileId: true,
            sourceType: true,
            sourceId: true,
          },
        })
      : [];
    const seen = new Set(
      existing.map((e) => dedupKey(e.tenantId, e.userProfileId, e.sourceType, e.sourceId)),
    );

    const deduped = items.filter((i) => {
      if (!i.sourceType || !i.sourceId) return true;
      return !seen.has(dedupKey(i.tenantId, i.userProfileId, i.sourceType, i.sourceId));
    });
    if (deduped.length === 0) return { created: 0 };

    // Honour per-user notification preferences (E5-S2 FR-2 in-app gate). Each
    // (user, kind) resolves to one of three in-app actions per the §1.2 truth
    // table: `skip` (cadence `off` wins, or in-app channel off while instant),
    // `hiddenSource` (in-app channel off but cadence `daily_digest` → write a
    // hidden readAt=now row so the daily cron has a durable source), or a normal
    // visible row (the default for any kind with no override / in-app on). The
    // tenant is the one `assertSingleTenantBatch` PROVED at entry, not
    // `deduped[0]` — the same value today, but derived from a checked invariant
    // instead of from position (`ADR-068 §D2`).
    const { skip, hiddenSource } = await this.preferences.inAppPlan(
      deduped.map((i) => ({ userProfileId: i.userProfileId, kind: i.kind })),
      batchTenantId,
    );
    const now = new Date();
    const toInsert = deduped
      .filter((i) => !skip.has(`${i.userProfileId}|${i.kind}`))
      .map((i) => ({
        item: i,
        // Hidden digest-source row (data-model §3.3): pre-read so it never rings
        // the bell, but exists for the daily-digest cron to group.
        hidden: hiddenSource.has(`${i.userProfileId}|${i.kind}`),
      }));

    let created = 0;
    if (toInsert.length > 0) {
      const res = await this.prisma.notification.createMany({
        data: toInsert.map(({ item: i, hidden }) => ({
          tenantId: i.tenantId,
          userProfileId: i.userProfileId,
          kind: i.kind,
          severity: i.severity ?? 'info',
          title: i.title,
          body: i.body ?? null,
          link: i.link ?? null,
          sourceType: i.sourceType ?? null,
          sourceId: i.sourceId ?? null,
          readAt: hidden ? now : null,
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
      // One tenant per batch, ENFORCED by `assertSingleTenantBatch` in the
      // caller rather than assumed; both downstream queries are tenant-scoped,
      // matching the worker cron sibling (`dispatchAlertEmails`) and ADR-002.
      const tenantId = assertSingleTenantBatch(items);
      // E5-S2 FR-2 email gate: enqueue a per-event email only for keys that are
      // emailEnabled AND cadence=instant. `daily_digest` keys are suppressed here
      // (the notifications-digest cron bundles them into one grouped email/day);
      // `off` keys are muted. `emailEnabled=false` is excluded as before.
      const enabled = await this.preferences.instantEmailKeys(
        items.map((i) => ({ userProfileId: i.userProfileId, kind: i.kind })),
        tenantId,
      );
      if (enabled.size === 0) return;

      const toEmail = items.filter((i) => enabled.has(`${i.userProfileId}|${i.kind}`));
      if (toEmail.length === 0) return;

      const recipientIds = [...new Set(toEmail.map((i) => i.userProfileId))];
      const profiles = await this.prisma.userProfile.findMany({
        where: { tenantId, id: { in: recipientIds } },
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

  /**
   * Retract every unread notification that points at a single source event,
   * across ALL recipients in the tenant. Used when a source's lifecycle closes
   * (e.g. an admin resolves/dismisses an AlertInstance) so the parent bell stops
   * surfacing notifications for something no longer active.
   *
   * Unlike `markRead`/`markAllRead`, this is keyed by the source pair
   * `(sourceType, sourceId)` — NOT by `userProfileId` — so it clears the row for
   * every guardian who was notified. It is tenant-scoped (always filters
   * `tenantId`) and idempotent: the `readAt: null` guard means a re-invocation
   * marks zero additional rows and is a safe no-op (double-resolve, or the
   * cron-vs-admin race). Returns the number of rows newly marked read.
   */
  async markReadBySource(args: {
    tenantId: string;
    sourceType: string;
    sourceId: string;
  }): Promise<number> {
    const res = await this.prisma.notification.updateMany({
      where: {
        tenantId: args.tenantId,
        sourceType: args.sourceType,
        sourceId: args.sourceId,
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
