import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';

import { EnrollmentsController } from './enrollments.controller';

@Module({
  imports: [AuthModule],
  controllers: [EnrollmentsController],
})
export class EnrollmentsModule {}
