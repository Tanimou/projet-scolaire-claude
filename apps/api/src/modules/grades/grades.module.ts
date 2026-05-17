import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { TeachingModule } from '../teaching/teaching.module';

import { AssessmentsController } from './assessments.controller';
import { GradesController } from './grades.controller';
import { GradesService } from './grades.service';

@Module({
  imports: [AuthModule, SchoolStructureModule, TeachingModule],
  controllers: [AssessmentsController, GradesController],
  providers: [GradesService],
  exports: [GradesService],
})
export class GradesModule {}
