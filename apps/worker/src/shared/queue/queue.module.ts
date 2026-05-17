import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';

/** Shared with the API producer (apps/api/src/shared/queue/queue.module.ts). */
export const QUEUE_EXPORTS = 'exports' as const;

@Module({
  imports: [
    BullModule.forRoot({
      connection: {
        url: process.env.REDIS_URL ?? 'redis://localhost:6379',
      },
    }),
    BullModule.registerQueue({ name: QUEUE_EXPORTS }),
  ],
  exports: [BullModule],
})
export class QueueModule {}
