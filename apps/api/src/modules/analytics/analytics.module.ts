import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';
import { TeachingModule } from '../teaching/teaching.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SchoolPerformanceDrilldownService } from './school-performance-drilldown.service';

@Module({
  imports: [AuthModule, SchoolStructureModule, TeachingModule, StudentsModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SchoolPerformanceDrilldownService],
  exports: [AnalyticsService, SchoolPerformanceDrilldownService],
})
export class AnalyticsModule {}
