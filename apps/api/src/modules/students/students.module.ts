import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { StudentAccessService } from './student-access.service';
import { StudentsController } from './students.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [StudentsController],
  providers: [StudentAccessService],
  exports: [StudentAccessService],
})
export class StudentsModule {}
