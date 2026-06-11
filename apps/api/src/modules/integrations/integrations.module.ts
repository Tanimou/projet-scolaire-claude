import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { SchoolStructureModule } from '../school-structure/school-structure.module';

import { IntegrationsController } from './integrations.controller';
import { IntegrationsService } from './integrations.service';

/**
 * E11-S3 — OneRoster roster-sync interop. Connect a source + pull + map a roster
 * into a validated `ImportBatch` (origin = oneroster) that inherits the S1 async
 * apply + the S2 reconciliation panel. Admin-only via `integrations.write`.
 */
@Module({
  imports: [AuthModule, SchoolStructureModule],
  controllers: [IntegrationsController],
  providers: [IntegrationsService],
  exports: [IntegrationsService],
})
export class IntegrationsModule {}
