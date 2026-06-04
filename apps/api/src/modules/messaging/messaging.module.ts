import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { MessagingController } from './messaging.controller';
import { MessagingService } from './messaging.service';

/**
 * E2-S1 — parent ↔ teacher messaging. Mirrors `AlertsModule` wiring:
 * `AuthModule` (guards + UserSyncService), `SchoolStructureModule`
 * (SchoolContextService), `StudentsModule` (re-uses the exported
 * `StudentAccessService` for the guardianship wall). `NotificationsService` is
 * provided by the `@Global() NotificationsModule`, so it needs no explicit import.
 */
@Module({
  imports: [AuthModule, SchoolStructureModule, StudentsModule],
  controllers: [MessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
