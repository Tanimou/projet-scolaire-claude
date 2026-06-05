import { Module } from '@nestjs/common';

import { MailModule } from '../../shared/mail/mail.module';

import { NotificationsDigestCronService } from './notifications-digest-cron.service';

/**
 * Cross-kind daily digest (E5-S2). A setInterval cron — the structural sibling of
 * {@link ParentDigestModule} (E1-S4 weekly digest) — that emails users who chose
 * `cadence = daily_digest` for some kind one grouped-by-kind summary of that day's
 * notifications, via the existing MailerService. No BullMQ queue, no new table, no
 * new dependency. PrismaService comes from the global PrismaModule; MailerService
 * from the shared MailModule.
 */
@Module({
  imports: [MailModule],
  providers: [NotificationsDigestCronService],
})
export class NotificationsDigestModule {}
