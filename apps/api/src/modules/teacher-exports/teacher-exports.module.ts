import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { ExportsModule } from '../exports/exports.module';
import { TeachingModule } from '../teaching/teaching.module';

import { TeacherExportsController } from './teacher-exports.controller';

/**
 * Teacher self-service export surface (E4-S3). Thin controller reusing
 * `ExportsService` (enqueue/list/findOne/signedDownloadUrl) + the existing
 * `grades_xlsx` generator under the new `exports.execute.teacher` permission +
 * teaching-assignment ABAC (via `TeacherProfileService`). No new providers,
 * no new queue, no schema change.
 */
@Module({
  imports: [AuthModule, ExportsModule, TeachingModule],
  controllers: [TeacherExportsController],
})
export class TeacherExportsModule {}
