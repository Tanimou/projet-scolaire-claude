import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { Notification, NotificationKind } from '@prisma/client';

import { MailerService } from '../../shared/mail/mailer.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { dailyDigestMarkerId, dayKey, dayLabel, dayStart } from './daily-key';
import type { DailyDigestRenderInput, DigestKindGroup } from './daily-digest.types';
import { fallbackLinkFor, renderDailyDigestEmail } from './daily-digest-email.template';

/** How often the cron checks whether it's the configured send hour. */
const CHECK_INTERVAL_MS = Number(
  process.env.DIGEST_DAILY_CHECK_INTERVAL_MS ?? 60 * 60 * 1000,
);
const STARTUP_DELAY_MS = Number(process.env.DIGEST_DAILY_STARTUP_DELAY_MS ?? 50_000);
/** Hour-of-day gate (UTC) for the daily send, default 18h. */
const SEND_HOUR = Number(process.env.DIGEST_DAILY_SEND_HOUR ?? 18);
/** Max sample titles surfaced per kind-group in the email. */
const MAX_SAMPLES_PER_GROUP = 3;

/** The sent-marker is an internal `system` bookkeeping row, never surfaced. */
const MARKER_KIND: NotificationKind = 'system';
const MARKER_SOURCE_TYPE = 'daily_digest';

/**
 * Cross-kind **daily** digest cron (E5-S2) — a structural sibling of
 * {@link ParentDigestCronService} (E1-S4 weekly digest). It checks hourly and only
 * *sends* during the configured send hour (default 18h UTC, overridable via
 * `DIGEST_DAILY_SEND_HOUR`). A re-entrancy guard prevents overlapping ticks. No
 * BullMQ queue, no new dependency, no new table: it resolves users who set a kind
 * to `cadence = daily_digest` with `emailEnabled = true`, gathers that user's
 * day-window `Notification` rows for those kinds, groups them **by kind**, renders
 * one composite branded email, and sends it via the existing {@link MailerService}.
 *
 * Idempotency without a new table: a `Notification(kind=system,
 * sourceType='daily_digest', sourceId=<deterministic day UUID>, readAt=now)` row is
 * the per-(user, UTC-day) sent-marker — checked before send, written only after a
 * successful send (so a crashed send leaves no marker and retries next tick).
 * `readAt` is pre-set so the marker never rings the bell.
 */
@Injectable()
export class NotificationsDigestCronService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(NotificationsDigestCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log(
      `Daily-digest cron armed — checks every ${CHECK_INTERVAL_MS / 1000}s, sends at hour=${SEND_HOUR}h (UTC)`,
    );
    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** True when `now` is inside the configured daily send hour. */
  private inSendWindow(now: Date): boolean {
    return now.getUTCHours() === SEND_HOUR;
  }

  /** One check tick. Re-entrant-safe; only sends inside the window. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous daily-digest tick still running — skipping this one');
      return;
    }
    if (!this.inSendWindow(now)) return;

    this.running = true;
    const start = Date.now();
    try {
      const tenants = await this.tenantsWithDailyOptIns();
      if (tenants.length === 0) {
        this.logger.debug('No tenants with daily_digest opt-ins — tick is a no-op');
        return;
      }
      let sent = 0;
      let skipped = 0;
      for (const tenantId of tenants) {
        try {
          const r = await this.runTenant({ tenantId, now });
          sent += r.sent;
          skipped += r.skipped;
        } catch (err) {
          this.logger.error(
            `Daily-digest failed for tenant ${tenantId}: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Daily-digest tick complete in ${Date.now() - start}ms — ${tenants.length} tenants, ${sent} sent, ${skipped} skipped`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Tenants with ≥1 user opted into the daily digest for some kind. */
  private async tenantsWithDailyOptIns(): Promise<string[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { cadence: 'daily_digest', emailEnabled: true },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /** Resolve + email every daily-opted-in user for one tenant. tenantId-scoped. */
  private async runTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; skipped: number }> {
    const { tenantId, now } = args;
    const key = dayKey(now);
    const windowStart = dayStart(now);
    const label = dayLabel(now);

    // Every (user, kind) pair this tenant set to daily_digest + email on. One
    // user can appear under several kinds; we fold them into per-user kind lists.
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { tenantId, cadence: 'daily_digest', emailEnabled: true },
      select: {
        userProfileId: true,
        kind: true,
        userProfile: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    type UserBucket = {
      profile: { id: string; email: string | null; firstName: string | null; lastName: string | null };
      kinds: Set<NotificationKind>;
    };
    const byUser = new Map<string, UserBucket>();
    for (const p of prefs) {
      if (!p.userProfile) continue;
      // FR-7: never source the daily digest from the weekly-digest kind. That kind
      // is the orthogonal E1-S4 summary (and its own marker rows carry
      // sourceType='weekly_digest', which the per-row marker filter below does not
      // catch), so a user who set `weekly_digest` to daily cadence must not have its
      // markers re-grouped into "X récapitulatifs". Drop it at the source.
      if (p.kind === 'weekly_digest') continue;
      const bucket = byUser.get(p.userProfileId) ?? {
        profile: p.userProfile,
        kinds: new Set<NotificationKind>(),
      };
      bucket.kinds.add(p.kind);
      byUser.set(p.userProfileId, bucket);
    }

    let sent = 0;
    let skipped = 0;

    for (const { profile, kinds } of byUser.values()) {
      if (!profile.email) {
        skipped++;
        continue;
      }
      try {
        // Daily idempotency: skip if the marker for this (user, day) exists.
        const markerId = dailyDigestMarkerId({
          tenantId,
          userProfileId: profile.id,
          dayKey: key,
        });
        const already = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            userProfileId: profile.id,
            kind: MARKER_KIND,
            sourceType: MARKER_SOURCE_TYPE,
            sourceId: markerId,
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        // Gather this user's day-window notifications for the daily_digest kinds.
        // Exclude the bookkeeping sourceType so a prior marker is never grouped.
        const rows = await this.prisma.notification.findMany({
          where: {
            tenantId,
            userProfileId: profile.id,
            kind: { in: [...kinds] },
            createdAt: { gte: windowStart },
            NOT: { sourceType: MARKER_SOURCE_TYPE },
          },
          orderBy: { createdAt: 'desc' },
          select: {
            kind: true,
            title: true,
            link: true,
            createdAt: true,
          },
        });
        if (rows.length === 0) {
          // Nothing happened today for this user's daily_digest kinds → no email,
          // no marker (so a later event the same day can still trigger a digest).
          skipped++;
          continue;
        }

        const groups = this.groupByKind(rows);
        const recipientName =
          `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || 'cher parent';
        const webBaseUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
        const renderInput: DailyDigestRenderInput = {
          recipientName,
          dayLabel: label,
          totalCount: rows.length,
          groups,
        };
        const { subject, html, text } = renderDailyDigestEmail(renderInput, { webBaseUrl });

        await this.mailer.send({ to: profile.email, subject, html, text });

        // Write the day-marker ONLY after a successful send (a send failure leaves
        // no marker, so the next eligible tick retries). readAt set so it never
        // affects the bell count.
        await this.prisma.notification.create({
          data: {
            tenantId,
            userProfileId: profile.id,
            kind: MARKER_KIND,
            severity: 'info',
            title: `Résumé quotidien — ${label}`,
            body: null,
            link: '/parent/dashboard',
            sourceType: MARKER_SOURCE_TYPE,
            sourceId: markerId,
            readAt: now,
          },
        });
        sent++;
      } catch (err) {
        // One user's send failure must never abort the tenant loop.
        this.logger.error(
          `Daily-digest send failed (tenant=${tenantId}, user=${profile.id}): ${(err as Error).message}`,
        );
        skipped++;
      }
    }

    return { sent, skipped };
  }

  /**
   * Fold day-window notification rows into per-kind groups (display order =
   * descending count, then alphabetical kind for stability). Each group's CTA
   * link is the most-recent notification's own `link`, or a kind-level fallback.
   * Rows arrive sorted by `createdAt desc`, so the first row seen per kind is the
   * most recent.
   */
  private groupByKind(
    rows: Pick<Notification, 'kind' | 'title' | 'link'>[],
  ): DigestKindGroup[] {
    const acc = new Map<
      NotificationKind,
      { count: number; sampleTitles: string[]; link: string | null }
    >();
    for (const r of rows) {
      const g = acc.get(r.kind) ?? { count: 0, sampleTitles: [], link: null };
      g.count += 1;
      if (g.sampleTitles.length < MAX_SAMPLES_PER_GROUP) g.sampleTitles.push(r.title);
      // First row per kind (rows are createdAt desc) sets the freshest link.
      if (g.link === null && r.link) g.link = r.link;
      acc.set(r.kind, g);
    }
    return [...acc.entries()]
      .map(([kind, g]) => ({
        kind,
        count: g.count,
        sampleTitles: g.sampleTitles,
        link: g.link ?? fallbackLinkFor(kind),
      }))
      .sort((a, b) => b.count - a.count || a.kind.localeCompare(b.kind));
  }
}
