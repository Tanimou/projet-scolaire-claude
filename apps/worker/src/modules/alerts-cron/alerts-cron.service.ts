import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';

import { AlertsEvaluatorService } from './alerts-evaluator.service';

const INTERVAL_MS = Number(process.env.ALERTS_EVAL_INTERVAL_MS ?? 15 * 60 * 1000);
const STARTUP_DELAY_MS = Number(process.env.ALERTS_EVAL_STARTUP_DELAY_MS ?? 30_000);

/**
 * Plain setInterval cron — runs the alerts evaluator across every tenant
 * with at least one enabled rule. We do not use BullMQ for the periodic
 * trigger because (a) the work is idempotent and tolerant to occasional
 * skips, and (b) BullMQ's `repeat` is overkill for a single-shot evaluator
 * that always needs the current `now()`.
 *
 * Event-driven re-evaluations (grade.publish, attendance.batch) will piggy-
 * back on a separate BullMQ queue when the outbox listener is wired.
 */
@Injectable()
export class AlertsCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(AlertsCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly evaluator: AlertsEvaluatorService) {}

  onApplicationBootstrap() {
    this.logger.log(
      `Alerts cron armed — first tick in ${STARTUP_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 1000}s`,
    );
    // Delay first run so the API has time to seed default rules on first call.
    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** Run a single evaluation pass across all eligible tenants. Re-entrant-safe. */
  private async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous tick still running — skipping this one');
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      const tenants = await this.evaluator.tenantsToEvaluate();
      if (tenants.length === 0) {
        this.logger.debug('No tenants with enabled rules — tick is a no-op');
        return;
      }
      let detected = 0;
      let created = 0;
      for (const tenantId of tenants) {
        try {
          const r = await this.evaluator.evaluateTenant({ tenantId, schoolId: null });
          detected += r.detected;
          created += r.createdInstances;
        } catch (err) {
          this.logger.error(`Evaluator failed for tenant ${tenantId}: ${(err as Error).message}`);
        }
      }
      this.logger.log(
        `Tick complete in ${Date.now() - start}ms — ${tenants.length} tenants, ${detected} detected, ${created} new alerts`,
      );
    } finally {
      this.running = false;
    }
  }
}
