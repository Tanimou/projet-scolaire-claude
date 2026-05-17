import { Module } from '@nestjs/common';

import { QueueModule } from '../../shared/queue/queue.module';

import { ExportsProcessor } from './exports.processor';

@Module({
  imports: [QueueModule],
  providers: [ExportsProcessor],
})
export class ExportsModule {}
