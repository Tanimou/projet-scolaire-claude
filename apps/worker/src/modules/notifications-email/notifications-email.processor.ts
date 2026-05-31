import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import { MailerService } from '../../shared/mail/mailer.service';
import { QUEUE_NOTIFICATIONS_EMAIL } from '../../shared/queue/queue.module';

import { renderNotificationEmail } from './notification-email.template';
import type { NotificationEmailJob } from './notification-email.types';

/**
 * Consumes the `notifications-email` queue: renders a branded email from the
 * notification snapshot and delivers it over SMTP (Maildev in dev). Producers
 * only enqueue for recipients who opted into the email channel, so this worker
 * never has to consult preferences — it just sends.
 */
@Processor(QUEUE_NOTIFICATIONS_EMAIL)
export class NotificationsEmailProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationsEmailProcessor.name);

  constructor(private readonly mailer: MailerService) {
    super();
  }

  async process(job: Job<NotificationEmailJob>): Promise<{ sent: true }> {
    const data = job.data;
    const webBaseUrl = process.env.WEB_PUBLIC_URL ?? 'http://localhost:3000';

    const { subject, html, text } = renderNotificationEmail(data, { webBaseUrl });
    await this.mailer.send({ to: data.to, subject, html, text });

    this.logger.log(`[${data.kind}] email sent → ${data.to}`);
    return { sent: true };
  }
}
