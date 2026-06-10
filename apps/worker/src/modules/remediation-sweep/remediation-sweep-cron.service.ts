import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import type { NotificationKind } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

/** Default sweep interval — 6h (the suggestion is low-urgency; no need to poll often). */
const INTERVAL_MS = Number(process.env.REMEDIATION_SWEEP_INTERVAL_MS ?? 6 * 60 * 60 * 1000);
const STARTUP_DELAY_MS = Number(process.env.REMEDIATION_SWEEP_STARTUP_DELAY_MS ?? 45_000);

/**
 * The SINGLE shared improvement threshold (the E3/E7-S3 value, /20). The sweep
 * must speak the SAME number as the parent strip + the alert engine, so a
 * suggestion never contradicts what the strip shows. We mirror the value here
 * rather than runtime-importing `@pilotage/contracts` (a value import would need
 * `contracts/dist`); the constant is asserted byte-identical to the contracts
 * `IMPROVEMENT_DELTA_THRESHOLD` by a guard test.
 */
export const IMPROVEMENT_DELTA_THRESHOLD = 1.5;

const REMEDIATION_KIND: NotificationKind = 'remediation';
const SUGGESTION_SOURCE_TYPE = 'remediation_plan';

/**
 * E7-S6 — Auto-suggest-complete sweep (worker, tenant-scoped, re-entrant, no new
 * queue). A structural sibling of {@link AlertsCronService}: a plain `setInterval`
 * poll with a `running` re-entrancy guard, a startup delay, and a per-tenant +
 * per-plan try/catch (one bad row never aborts the tick).
 *
 * Each tick: resolve tenants with ≥1 OPEN `RemediationPlan`; per tenant, find OPEN
 * plans whose target subject's year-row `StudentSubjectSnapshot.trendDelta`
 * (`termId=null`, snapshot-first; a snapshot miss simply SKIPS — never errors, no
 * live fall-through) is ≥ `IMPROVEMENT_DELTA_THRESHOLD`; for each such plan write an
 * IDEMPOTENT best-effort `remediation` Notification SUGGESTING completion
 * (`sourceId = ${planId}:improvement_suggested` so a re-tick never re-sends).
 *
 * The sweep NEVER auto-closes a plan — it ONLY suggests (the close is a human,
 * reversible act, FR-1). Every query is tenant-scoped (`where:{ tenantId }`).
 */
@Injectable()
export class RemediationSweepCronService
  implements OnApplicationBootstrap, OnModuleDestroy
{
  private readonly logger = new Logger(RemediationSweepCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap() {
    this.logger.log(
      `Remediation-sweep cron armed — first tick in ${STARTUP_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 1000}s`,
    );
    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One sweep pass across all tenants with ≥1 open plan. Re-entrant-safe. */
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous remediation-sweep tick still running — skipping this one');
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      const tenants = await this.tenantsWithOpenPlans();
      if (tenants.length === 0) {
        this.logger.debug('No tenants with open remediation plans — tick is a no-op');
        return;
      }
      let suggested = 0;
      for (const tenantId of tenants) {
        try {
          suggested += await this.sweepTenant(tenantId);
        } catch (err) {
          this.logger.error(
            `Remediation-sweep failed for tenant ${tenantId}: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Remediation-sweep tick complete in ${Date.now() - start}ms — ${tenants.length} tenants, ${suggested} completion suggestions written`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Tenants with ≥1 OPEN remediation plan (tenant-scoped distinct). */
  private async tenantsWithOpenPlans(): Promise<string[]> {
    const rows = await this.prisma.remediationPlan.findMany({
      where: { status: 'open' },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /**
   * Sweep one tenant: for each OPEN plan whose subject's year snapshot trendDelta
   * crosses the threshold, write ONE idempotent completion suggestion. Returns the
   * number of NEW suggestions written. Tenant-scoped on every query. A per-plan
   * throw is logged and the loop continues.
   */
  private async sweepTenant(tenantId: string): Promise<number> {
    const plans = await this.prisma.remediationPlan.findMany({
      where: { tenantId, status: 'open' },
      select: {
        id: true,
        studentId: true,
        subjectId: true,
        createdBy: true,
      },
    });
    if (plans.length === 0) return 0;

    let written = 0;
    for (const plan of plans) {
      try {
        // Snapshot-first ONLY (no live fall-through in the sweep — a miss skips).
        const snap = await this.prisma.studentSubjectSnapshot.findFirst({
          where: {
            tenantId,
            studentId: plan.studentId,
            subjectId: plan.subjectId,
            termId: null,
          },
          select: { trendDelta: true },
        });
        if (!snap || snap.trendDelta == null) continue;
        const delta = Number(snap.trendDelta);
        if (!(delta >= IMPROVEMENT_DELTA_THRESHOLD)) continue;

        // Idempotency: one suggestion per plan (a re-tick never re-sends). The
        // marker IS the suggestion notification (sourceType+sourceId), tenant-scoped.
        const sourceId = `${plan.id}:improvement_suggested`;
        const already = await this.prisma.notification.findFirst({
          where: {
            tenantId,
            userProfileId: plan.createdBy,
            kind: REMEDIATION_KIND,
            sourceType: SUGGESTION_SOURCE_TYPE,
            sourceId,
          },
          select: { id: true },
        });
        if (already) continue;

        await this.prisma.notification.create({
          data: {
            tenantId,
            userProfileId: plan.createdBy,
            kind: REMEDIATION_KIND,
            severity: 'info',
            title: 'Le soutien porte ses fruits 🎉',
            body: 'La tendance s’améliore — vous pouvez clôturer ce plan de soutien.',
            link: `/parent/remediation/${plan.id}`,
            sourceType: SUGGESTION_SOURCE_TYPE,
            sourceId,
          },
        });
        written++;
      } catch (err) {
        this.logger.error(
          `Remediation-sweep failed for plan ${plan.id} (tenant=${tenantId}): ${(err as Error).message}`,
        );
      }
    }
    return written;
  }
}
