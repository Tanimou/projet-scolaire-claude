import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { AnalyticsModule } from '../analytics/analytics.module';
import { RemediationModule } from '../remediation/remediation.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { StudentPortalController } from './student-portal.controller';
import { StudentPortalService } from './student-portal.service';

/**
 * Student Portal module (E8-S1) — the fourth, read-only learner audience.
 *
 * A thin controller + producer behind the student-self ABAC wall
 * (`StudentAccessService`, exported by `StudentsModule`). Reuses `UserSyncService`
 * (AuthModule) for identity and `SchoolContextService` (SchoolStructureModule)
 * for the server-derived tenant/school. Read-only — no provider mutates. A NEW
 * module (not a parent-controller edit) so the parent surface stays untouched.
 */
@Module({
  imports: [AuthModule, StudentsModule, SchoolStructureModule, AnalyticsModule, RemediationModule],
  controllers: [StudentPortalController],
  providers: [StudentPortalService],
})
export class StudentPortalModule {}
