import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { AnnouncementsController } from './announcements.controller';
import { AnnouncementRecipientsService } from './announcements.service';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [AnnouncementsController],
  providers: [AnnouncementRecipientsService],
})
export class AnnouncementsModule {}
