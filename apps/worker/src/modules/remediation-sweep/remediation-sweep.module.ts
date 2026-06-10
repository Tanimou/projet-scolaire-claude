import { Module } from '@nestjs/common';

import { RemediationSweepCronService } from './remediation-sweep-cron.service';

/**
 * E7-S6 — Auto-suggest-complete sweep module. A setInterval cron — the structural
 * sibling of `AlertsCronModule` / `NotificationsDigestModule` / `AnalyticsSnapshotsModule`
 * — that suggests (never auto-closes) plan completion when the IMPROVEMENT threshold
 * holds on a plan's subject. No BullMQ queue, no new dependency: `PrismaService`
 * comes from the global `PrismaModule`. The suggestion is an idempotent best-effort
 * `remediation` Notification (sourceId-deduped), tenant-scoped on every query.
 */
@Module({
  providers: [RemediationSweepCronService],
})
export class RemediationSweepModule {}
