import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/** Shared with the API producer (apps/api/src/shared/queue/queue.module.ts). */
export const QUEUE_EXPORTS = 'exports' as const;
/** Notification email delivery (R8.2). Produced by apps/api. */
export const QUEUE_NOTIFICATIONS_EMAIL = 'notifications-email' as const;
/** Async bulk-import apply/rollback (E11-S1). Produced by apps/api. */
export const QUEUE_IMPORTS = 'imports' as const;

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue({ name: QUEUE_EXPORTS }),
    BullModule.registerQueue({ name: QUEUE_NOTIFICATIONS_EMAIL }),
    BullModule.registerQueue({ name: QUEUE_IMPORTS }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
