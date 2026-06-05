import { Module } from '@nestjs/common';

import { SnapshotDrainCronService } from './snapshot-drain-cron.service';
import { SnapshotRecomputeService } from './snapshot-recompute.service';

/**
 * E6-S1 — Analytics Snapshots recompute/drain module. A setInterval cron — the
 * structural sibling of `AlertsCronModule` / `NotificationsDigestModule` — that
 * drains the durable `SnapshotRecomputeTrigger` dirty-queue into byte-parity
 * snapshot rows. No BullMQ queue, no new dependency: `PrismaService` comes from the
 * global `PrismaModule`. NO read-path wiring in S1 (snapshots are written, never
 * read) — provably zero behaviour change.
 */
@Module({
  providers: [SnapshotRecomputeService, SnapshotDrainCronService],
  exports: [SnapshotRecomputeService],
})
export class AnalyticsSnapshotsModule {}
