import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';

import { ChildClaimsController } from './child-claims.controller';
import { ChildClaimsService } from './child-claims.service';
import { GuardianshipClaimIndexBootstrap } from './guardianship-claim-index.bootstrap';

/**
 * E9-S1 — Enrollment self-service parent child-claim surface.
 *
 * Thin parent-only controller + the deny-by-default matcher service + the boot-applied
 * partial-unique open-claim index (the E7-S2 BookingIndexBootstrap idiom). PrismaService
 * is global; AuthModule provides the guards + UserSyncService. No new shared providers,
 * no second queue, no schema beyond the additive GuardianshipClaim model.
 */
@Module({
  imports: [AuthModule],
  controllers: [ChildClaimsController],
  providers: [ChildClaimsService, GuardianshipClaimIndexBootstrap],
})
export class ChildClaimsModule {}
