import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { RemediationController } from './remediation.controller';
import { RemediationService } from './remediation.service';

/**
 * E7-S1 — Remediation & Tutoring loop (parent surface).
 *
 * Parent alert → `RemediationPlan` promotion (idempotent, guardianship-ABAC,
 * audited, baseline-capturing) + the read-only catalogue aggregate. Reuses
 * `StudentAccessService` (guardianship wall) from `StudentsModule` and
 * `SchoolContextService` from `SchoolStructureModule`. PrismaService is global.
 * No booking write path in S1.
 */
@Module({
  imports: [AuthModule, SchoolStructureModule, StudentsModule],
  controllers: [RemediationController],
  providers: [RemediationService],
  exports: [RemediationService],
})
export class RemediationModule {}
