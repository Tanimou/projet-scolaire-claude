import { Module } from '@nestjs/common';

import { PrismaModule } from '../../shared/prisma/prisma.module';
import { QueueModule } from '../../shared/queue/queue.module';

import { ImportsProcessor } from './imports.processor';

/**
 * Worker module draining the third `imports` BullMQ queue (E11-S1).
 * Structural sibling of `ExportsModule`.
 */
@Module({
  imports: [QueueModule, PrismaModule],
  providers: [ImportsProcessor],
})
export class ImportsModule {}
