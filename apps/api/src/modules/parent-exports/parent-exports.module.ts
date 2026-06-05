import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { ExportsModule } from '../exports/exports.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';
import { StudentsModule } from '../students/students.module';

import { ParentExportsController } from './parent-exports.controller';

/**
 * Parent self-service export surface (E4-S2). Thin controller reusing
 * `ExportsService` (enqueue/list/findOne/signedDownloadUrl) under the new
 * `exports.execute.parent` permission + guardianship ABAC. No new providers.
 */
@Module({
  imports: [AuthModule, ExportsModule, StudentsModule, SchoolStructureModule],
  controllers: [ParentExportsController],
})
export class ParentExportsModule {}
