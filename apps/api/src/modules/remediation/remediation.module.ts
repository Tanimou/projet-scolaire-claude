import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { BookingIndexBootstrap } from './booking-index.bootstrap';
import { BookingService } from './booking.service';
import { RemediationController } from './remediation.controller';
import { RemediationService } from './remediation.service';
import { TeacherRemediationService } from './teacher-remediation.service';

/**
 * E7-S1 — Remediation & Tutoring loop (parent surface).
 *
 * Parent alert → `RemediationPlan` promotion (idempotent, guardianship-ABAC,
 * audited, baseline-capturing) + the read-only catalogue aggregate. Reuses
 * `StudentAccessService` (guardianship wall) from `StudentsModule` and
 * `SchoolContextService` from `SchoolStructureModule`. PrismaService is global.
 * E7-S2 adds the booking write path (`BookingService` + the ADR-020 concurrency
 * guard), the tutor+parent fan-out (`NotificationsModule.NotificationsService.
 * createMany`, kind `remediation`, no new queue), and `BookingIndexBootstrap`
 * which applies the partial-unique over-book index on boot. The E2 teaching wall
 * is INLINED into `RemediationService.isTeacherOfStudent` (not a MessagingModule
 * import) to avoid a circular module dependency.
 */
@Module({
  imports: [AuthModule, SchoolStructureModule, StudentsModule, NotificationsModule],
  controllers: [RemediationController],
  providers: [
    RemediationService,
    BookingService,
    TeacherRemediationService,
    BookingIndexBootstrap,
  ],
  exports: [RemediationService, BookingService],
})
export class RemediationModule {}
