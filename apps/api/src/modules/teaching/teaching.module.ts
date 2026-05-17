import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { TeacherProfileService } from './teacher-profile.service';
import { TeachersController } from './teachers.controller';
import { TeachingAssignmentsController } from './teaching-assignments.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [TeachersController, TeachingAssignmentsController],
  providers: [TeacherProfileService],
  exports: [TeacherProfileService],
})
export class TeachingModule {}
