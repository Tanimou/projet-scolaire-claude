import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/**
 * Single BullMQ connection used as a producer in the API.
 * Workers consume the same queues from `apps/worker`.
 *
 * Queue names are kept as exported constants so producer + consumer agree.
 */
export const QUEUE_EXPORTS = 'exports' as const;
/** Notification email delivery (R8.2). Consumed by apps/worker. */
export const QUEUE_NOTIFICATIONS_EMAIL = 'notifications-email' as const;

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue({ name: QUEUE_EXPORTS }),
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS_EMAIL }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
