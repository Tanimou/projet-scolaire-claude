import { Module } from '@nestjs/common';

import { QueueModule } from '../../shared/queue/queue.module';

import { AlertsCronService } from './alerts-cron.service';
import { AlertsEvaluatorService } from './alerts-evaluator.service';

/**
 * Imports QueueModule so the evaluator can `@InjectQueue` the shared
 * `notifications-email` queue (E3-S4 — email parity on the cron path). The
 * queue is *produced* here and *consumed* by NotificationsEmailModule; no new
 * queue is introduced.
 */
@Module({
  imports: [QueueModule],
  providers: [AlertsEvaluatorService, AlertsCronService],
  exports: [AlertsEvaluatorService],
})
export class AlertsCronModule {}
