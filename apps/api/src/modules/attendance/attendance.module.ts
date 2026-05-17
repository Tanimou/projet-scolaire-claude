import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { TeachingModule } from '../teaching/teaching.module';

import { AttendanceController } from './attendance.controller';

@Module({
  imports: [AuthModule, TeachingModule],
  controllers: [AttendanceController],
})
export class AttendanceModule {}
