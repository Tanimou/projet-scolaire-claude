import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { StorageModule } from '../../shared/storage/storage.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { ExportsController } from './exports.controller';
import { ExportsService } from './exports.service';

@Module({
  imports: [AuthModule, QueueModule, StorageModule, SchoolStructureModule],
  controllers: [ExportsController],
  providers: [ExportsService],
  exports: [ExportsService],
})
export class ExportsModule {}
