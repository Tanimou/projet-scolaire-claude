import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { MailerService } from '../../shared/mail/mailer.service';

import { DigestAggregateService } from './digest-aggregate.service';
import { renderDigestEmail } from './digest-email.template';
import type { ChildDigest } from './digest-email.types';
import { digestMarkerId, isoWeekKey, isoWeekMonday, weekRangeLabel } from './iso-week';

/** How often the cron checks whether it's the configured send window. */
const CHECK_INTERVAL_MS = Number(process.env.DIGEST_CHECK_INTERVAL_MS ?? 60 * 60 * 1000);
const STARTUP_DELAY_MS = Number(process.env.DIGEST_STARTUP_DELAY_MS ?? 45_000);
/** Day-of-week gate (0=Sun … 1=Mon … 6=Sat), default Monday. */
const SEND_DOW = Number(process.env.DIGEST_SEND_DOW ?? 1);
/** Hour-of-day gate (UTC), default 07h. */
const SEND_HOUR = Number(process.env.DIGEST_SEND_HOUR ?? 7);

/**
 * Plain setInterval cron for the weekly parent digest (E1-S4) — mirrors
 * {@link AlertsCronService}. It checks hourly and only *sends* during the
 * configured day-of-week + hour window (default Monday 07h UTC, overridable via
 * `DIGEST_SEND_DOW` / `DIGEST_SEND_HOUR`). Re-entrancy guard prevents
 * overlapping ticks. No BullMQ queue, no new dependency: it resolves opted-in
 * guardians, aggregates a one-screen per-child summary, renders one composite
 * email per guardian, and sends via the existing {@link MailerService}.
 *
 * Idempotency without a new table: a `Notification(kind=weekly_digest,
 * sourceType=weekly_digest, sourceId=<deterministic week UUID>, readAt set)` row
 * is the per-(guardian, ISO-week) sent-marker — checked before send, written
 * only after a successful send. `readAt` is pre-set so it never rings the bell.
 */
@Injectable()
export class ParentDigestCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ParentDigestCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly aggregate: DigestAggregateService,
    private readonly mailer: MailerService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log(
      `Parent-digest cron armed — checks every ${CHECK_INTERVAL_MS / 1000}s, sends on dow=${SEND_DOW} hour=${SEND_HOUR}h (UTC)`,
    );
    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), CHECK_INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** True when `now` is inside the configured send window. */
  private inSendWindow(now: Date): boolean {
    return now.getUTCDay() === SEND_DOW && now.getUTCHours() === SEND_HOUR;
  }

  /** One check tick. Re-entrant-safe; only sends inside the window. */
  async tick(now: Date = new Date()): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous digest tick still running — skipping this one');
      return;
    }
    if (!this.inSendWindow(now)) return;

    this.running = true;
    const start = Date.now();
    try {
      const tenants = await this.tenantsWithOptIns();
      if (tenants.length === 0) {
        this.logger.debug('No tenants with weekly_digest opt-ins — tick is a no-op');
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
            `Parent-digest failed for tenant ${tenantId}: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Digest tick complete in ${Date.now() - start}ms — ${tenants.length} tenants, ${sent} sent, ${skipped} skipped`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Tenants that have at least one guardian opted into the weekly digest. */
  private async tenantsWithOptIns(): Promise<string[]> {
    const rows = await this.prisma.notificationPreference.findMany({
      where: { kind: 'weekly_digest', emailEnabled: true },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /** Resolve + email every opted-in guardian for one tenant. tenantId-scoped. */
  private async runTenant(args: {
    tenantId: string;
    now: Date;
  }): Promise<{ sent: number; skipped: number }> {
    const { tenantId, now } = args;
    const weekKey = isoWeekKey(now);
    const monday = isoWeekMonday(now);
    const sunday = new Date(monday.getTime() + 6 * 24 * 3600 * 1000);
    const weekLabel = weekRangeLabel(monday, sunday);

    // Opted-in guardians: NotificationPreference(weekly_digest, emailEnabled)
    // → UserProfile (email required by schema). tenantId hard-scoped.
    const prefs = await this.prisma.notificationPreference.findMany({
      where: { tenantId, kind: 'weekly_digest', emailEnabled: true },
      select: {
        userProfileId: true,
        userProfile: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
    });

    let sent = 0;
    let skipped = 0;

    for (const pref of prefs) {
      const profile = pref.userProfile;
      if (!profile?.email) {
        skipped++;
        continue;
      }
      try {
        // Weekly idempotency: skip if the marker for this (guardian, week) exists.
        const markerId = digestMarkerId({
          tenantId,
          userProfileId: profile.id,
          weekKey,
        });
        const already = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            userProfileId: profile.id,
            kind: 'weekly_digest',
            sourceType: 'weekly_digest',
            sourceId: markerId,
          },
          select: { id: true },
        });
        if (already) {
          skipped++;
          continue;
        }

        // Resolve this guardian's active-guardianship children (ABAC boundary),
        // reusing the notifyGuardiansOfAlert guardianship shape: a guardian's
        // own UserProfile → Guardian → active Guardianship → Student.
        const guardianships = await this.prisma.guardianship.findMany({
          where: {
            tenantId,
            status: 'active',
            guardian: { userProfileId: profile.id },
          },
          select: { studentId: true },
        });
        const studentIds = [...new Set(guardianships.map((g) => g.studentId))];
        if (studentIds.length === 0) {
          skipped++;
          continue;
        }

        const children: ChildDigest[] = [];
        for (const studentId of studentIds) {
          try {
            children.push(
              await this.aggregate.buildChildDigest({ tenantId, studentId, now }),
            );
          } catch (err) {
            // One child's payload failure must never abort the guardian's send.
            this.logger.error(
              `Digest child aggregate failed (tenant=${tenantId}, student=${studentId}): ${(err as Error).message}`,
            );
          }
        }
        if (children.length === 0) {
          skipped++;
          continue;
        }

        const recipientName =
          `${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || 'cher parent';
        const webBaseUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';
        const { subject, html, text } = renderDigestEmail(
          { recipientName, weekLabel, children },
          { webBaseUrl },
        );

        await this.mailer.send({ to: profile.email, subject, html, text });

        // Write the week-marker ONLY after a successful send (a send failure
        // leaves no marker, so the next eligible tick retries). readAt set so it
        // never affects the bell count.
        await this.prisma.notification.create({
          data: {
            tenantId,
            userProfileId: profile.id,
            kind: 'weekly_digest',
            severity: 'info',
            title: `Récapitulatif hebdomadaire — ${weekLabel}`,
            body: null,
            link: '/parent/dashboard',
            sourceType: 'weekly_digest',
            sourceId: markerId,
            readAt: now,
          },
        });
        sent++;
      } catch (err) {
        // One guardian's send failure must never abort the tenant loop.
        this.logger.error(
          `Digest send failed (tenant=${tenantId}, guardian=${profile.id}): ${(err as Error).message}`,
        );
        skipped++;
      }
    }

    return { sent, skipped };
  }
}
