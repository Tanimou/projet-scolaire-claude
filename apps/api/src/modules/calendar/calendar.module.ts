import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { CalendarController } from './calendar.controller';

@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [CalendarController],
})
export class CalendarModule {}
