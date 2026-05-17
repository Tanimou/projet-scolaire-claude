import { Module } from '@nestjs/common';

import { AlertsCronService } from './alerts-cron.service';
import { AlertsEvaluatorService } from './alerts-evaluator.service';

@Module({
  providers: [AlertsEvaluatorService, AlertsCronService],
  exports: [AlertsEvaluatorService],
})
export class AlertsCronModule {}
