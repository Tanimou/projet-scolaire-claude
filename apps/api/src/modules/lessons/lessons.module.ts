import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { TeachingModule } from '../teaching/teaching.module';

import { LessonsController } from './lessons.controller';

@Module({
  imports: [AuthModule, TeachingModule],
  controllers: [LessonsController],
})
export class LessonsModule {}
