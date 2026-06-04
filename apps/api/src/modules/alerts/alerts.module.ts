import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { MeetingRequestsController } from './meeting-requests.controller';
import { MeetingRequestsService } from './meeting-requests.service';

@Module({
  imports: [AuthModule, SchoolStructureModule, StudentsModule],
  controllers: [AlertsController, MeetingRequestsController],
  providers: [AlertsService, MeetingRequestsService],
  exports: [AlertsService],
})
export class AlertsModule {}
