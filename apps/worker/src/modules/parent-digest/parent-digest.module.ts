import { Module } from '@nestjs/common';

import { MailModule } from '../../shared/mail/mail.module';

import { DigestAggregateService } from './digest-aggregate.service';
import { ParentDigestCronService } from './parent-digest-cron.service';

/**
 * Weekly parent digest (E1-S4). A setInterval cron (mirroring AlertsCronModule)
 * that emails opted-in guardians a one-screen per-child summary via the existing
 * MailerService. No BullMQ queue, no new dependency. PrismaService comes from
 * the global PrismaModule; MailerService from the shared MailModule.
 */
@Module({
  imports: [MailModule],
  providers: [DigestAggregateService, ParentDigestCronService],
  exports: [DigestAggregateService],
})
export class ParentDigestModule {}
