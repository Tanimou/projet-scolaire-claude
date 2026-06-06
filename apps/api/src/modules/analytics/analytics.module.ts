import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { GradesModule } from '../grades/grades.module';
import { RemediationModule } from '../remediation/remediation.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';
import { TeachingModule } from '../teaching/teaching.module';

import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';
import { SchoolPerformanceDrilldownService } from './school-performance-drilldown.service';
import { SnapshotOpsService } from './snapshot-ops.service';

@Module({
  imports: [
    AuthModule,
    SchoolStructureModule,
    TeachingModule,
    StudentsModule,
    GradesModule,
    RemediationModule,
  ],
  controllers: [AnalyticsController],
  providers: [AnalyticsService, SchoolPerformanceDrilldownService, SnapshotOpsService],
  exports: [AnalyticsService, SchoolPerformanceDrilldownService],
})
export class AnalyticsModule {}
