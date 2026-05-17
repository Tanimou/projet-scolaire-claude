import { Global, Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';

import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationPreferencesController } from './preferences.controller';
import { NotificationPreferencesService } from './preferences.service';

/**
 * Global so any module (Alerts, Announcements, Grades, Enrollments, Lessons)
 * can inject `NotificationsService` to fan out an event, and any module can
 * read `NotificationPreferencesService` to decide whether to dispatch.
 */
@Global()
@Module({
  imports: [AuthModule],
  controllers: [NotificationsController, NotificationPreferencesController],
  providers: [NotificationsService, NotificationPreferencesService],
  exports: [NotificationsService, NotificationPreferencesService],
})
export class NotificationsModule {}
