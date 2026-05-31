import { Module } from '@nestjs/common';

import { MailModule } from '../../shared/mail/mail.module';
import { QueueModule } from '../../shared/queue/queue.module';

import { NotificationsEmailProcessor } from './notifications-email.processor';

@Module({
  imports: [QueueModule, MailModule],
  providers: [NotificationsEmailProcessor],
})
export class NotificationsEmailModule {}
