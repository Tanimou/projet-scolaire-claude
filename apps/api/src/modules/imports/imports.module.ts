import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { QueueModule } from '../../shared/queue/queue.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';

@Module({
  imports: [AuthModule, QueueModule, SchoolStructureModule],
  controllers: [ImportsController],
  providers: [ImportsService],
  exports: [ImportsService],
})
export class ImportsModule {}
