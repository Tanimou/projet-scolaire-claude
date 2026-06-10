import { Module } from '@nestjs/common';

import { AuthModule } from '../../shared/auth/auth.module';
import { NotificationsModule } from '../notifications/notifications.module';

import { AdminChildClaimsController } from './admin-child-claims.controller';
import { ChildClaimsController } from './child-claims.controller';
import { ChildClaimsService } from './child-claims.service';
import { GuardianshipClaimIndexBootstrap } from './guardianship-claim-index.bootstrap';

/**
 * E9 — Enrollment self-service child-claim surface (parent S1 + admin S2).
 *
 * S1: the thin parent-only controller + the deny-by-default matcher service + the
 * boot-applied partial-unique open-claim index (the E7-S2 BookingIndexBootstrap idiom).
 * S2: the admin approval queue + atomic approve/reject controller, reusing the SAME
 * ChildClaimsService (its private audit()/toIsoDate() helpers) and injecting
 * NotificationsService (via the additive NotificationsModule import) for the best-effort
 * parent decision notification — reusing the existing `enrollment_status` kind, no new
 * queue/table/kind. PrismaService is global; AuthModule provides the guards +
 * UserSyncService. No schema change in S2.
 */
@Module({
  imports: [AuthModule, NotificationsModule],
  controllers: [ChildClaimsController, AdminChildClaimsController],
  providers: [ChildClaimsService, GuardianshipClaimIndexBootstrap],
})
export class ChildClaimsModule {}
