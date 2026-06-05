import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DOMAIN_EVENTS } from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { SnapshotRecomputeService } from './snapshot-recompute.service';

const INTERVAL_MS = Number(process.env.SNAPSHOT_RECOMPUTE_INTERVAL_MS ?? 60 * 1000);
const STARTUP_DELAY_MS = Number(process.env.SNAPSHOT_RECOMPUTE_STARTUP_DELAY_MS ?? 40_000);
/** Per-tenant FIFO batch size per tick (bounded — never drains a whole backlog at once). */
const BATCH_SIZE = Number(process.env.SNAPSHOT_RECOMPUTE_BATCH ?? 25);
/** Retry cap before a failed trigger is parked. */
const MAX_ATTEMPTS = Number(process.env.SNAPSHOT_RECOMPUTE_MAX_ATTEMPTS ?? 5);
/** A `processing` row older than this is reclaimed to `pending` (crash recovery, PM-10). */
const STALE_PROCESSING_MIN = Number(process.env.SNAPSHOT_RECOMPUTE_STALE_MIN ?? 15);
/**
 * E6-S3 — upper bound on the per-trigger class fan-out for a class-less
 * `coefficient_changed` trigger (FR7). A coefficient change on a subject can touch
 * every class teaching it in the year; cap the expansion so one huge grade level
 * can never wedge a tick. Remaining classes converge over later ticks / the sweep.
 */
const COEFFICIENT_FANOUT_TAKE = Number(process.env.SNAPSHOT_COEFFICIENT_FANOUT_TAKE ?? 200);

/**
 * E6-S1 — snapshot recompute drain cron. Structural sibling of `AlertsCronService`
 * / `NotificationsDigestCronService`: a plain `setInterval` (no BullMQ), a `running`
 * re-entrancy guard, `OnApplicationBootstrap` arming + `OnModuleDestroy` clearing.
 *
 * Each tick (tenant-scoped throughout — every query carries explicit
 * `where: { tenantId }`):
 *   1. reclaim stale `processing` rows (crash recovery) → back to `pending`;
 *   2. `tenantsWithPending()` → per tenant, claim a FIFO bounded batch via an ATOMIC
 *      guarded `updateMany(status: pending → processing)` (PM-9 — a row is claimed
 *      once even under overlap), recompute each scope, mark `done`/`failed`;
 *   3. a lagging/empty-tenant backfill enqueue so a missed event still converges.
 *
 * One scope's or one tenant's failure NEVER aborts the loop (best-effort, matched to
 * every existing cron). After a tenant pass it references
 * `DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED` on a structured log line (NO queue, NO outbox
 * write — "emit" here is an observability signal, PM-13).
 */
@Injectable()
export class SnapshotDrainCronService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SnapshotDrainCronService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly recompute: SnapshotRecomputeService,
  ) {}

  onApplicationBootstrap() {
    this.logger.log(
      `Snapshot drain cron armed — first tick in ${STARTUP_DELAY_MS / 1000}s, then every ${INTERVAL_MS / 1000}s`,
    );
    setTimeout(() => {
      void this.tick();
      this.timer = setInterval(() => void this.tick(), INTERVAL_MS);
    }, STARTUP_DELAY_MS);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  /** One drain pass across every tenant with pending triggers. Re-entrant-safe. */
  async tick(): Promise<void> {
    if (this.running) {
      this.logger.warn('Previous snapshot drain tick still running — skipping this one');
      return;
    }
    this.running = true;
    const start = Date.now();
    try {
      await this.reclaimStaleProcessing();
      await this.backfillLaggingTenants();

      const tenants = await this.tenantsWithPending();
      if (tenants.length === 0) {
        this.logger.debug('No tenants with pending recompute triggers — tick is a no-op');
        return;
      }
      let recomputed = 0;
      let failed = 0;
      for (const tenantId of tenants) {
        try {
          const r = await this.drainTenant(tenantId);
          recomputed += r.recomputed;
          failed += r.failed;
        } catch (err) {
          this.logger.error(
            `Snapshot drain failed for tenant ${tenantId}: ${(err as Error).message}`,
          );
        }
      }
      this.logger.log(
        `Snapshot drain tick complete in ${Date.now() - start}ms — ${tenants.length} tenants, ` +
          `${recomputed} scopes recomputed, ${failed} failed (event=${DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED})`,
      );
    } finally {
      this.running = false;
    }
  }

  /** Distinct tenantIds with at least one pending trigger. */
  private async tenantsWithPending(): Promise<string[]> {
    const rows = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: { status: 'pending' },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /**
   * Reclaim `processing` rows stuck past the stale threshold (a worker died mid-tick)
   * back to `pending` so the scope is never wedged forever (PM-10). Tenant-agnostic
   * sweep — bounded by the threshold, not by tenant.
   */
  private async reclaimStaleProcessing(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MIN * 60 * 1000);
    const reclaimed = await this.prisma.snapshotRecomputeTrigger.updateMany({
      where: { status: 'processing', enqueuedAt: { lt: cutoff } },
      data: { status: 'pending' },
    });
    if (reclaimed.count > 0) {
      this.logger.warn(`Reclaimed ${reclaimed.count} stale processing trigger(s) → pending`);
    }
  }

  /**
   * Backfill safety-net: a tenant whose snapshots lag its latest published grade (or
   * has published grades but NO snapshots at all) gets a coalesced `backfill` trigger
   * for each lagging class so the next drain converges. Bounded, indexed probe
   * (PM-11): we only look at tenants with NO pending/processing trigger already (the
   * normal path covers those), and enqueue at most one trigger per affected class.
   */
  private async backfillLaggingTenants(): Promise<void> {
    // Tenants that currently have NO open trigger at all — these are the only ones a
    // missed enqueue could have left stale. Tenants with open triggers self-heal via
    // the normal drain.
    const tenantsWithOpen = new Set(
      (
        await this.prisma.snapshotRecomputeTrigger.findMany({
          where: { status: { in: ['pending', 'processing'] } },
          select: { tenantId: true },
          distinct: ['tenantId'],
        })
      ).map((r) => r.tenantId),
    );

    // Class sections that have ≥1 published/revised grade but whose newest grade is
    // newer than the freshest snapshot for that class (or have no snapshot yet).
    // Cheap, indexed: one grouped query over the snapshot table's computedAt.
    const classesWithGrades = await this.prisma.grade.findMany({
      where: { status: { in: ['published', 'revised'] }, isAbsent: false },
      select: {
        tenantId: true,
        assessment: {
          select: {
            teachingAssignment: {
              select: { classSectionId: true, subjectId: true, academicYearId: true },
            },
          },
        },
      },
      distinct: ['assessmentId'],
      take: 500, // bound the probe — full convergence still happens over several ticks
    });

    const seen = new Set<string>();
    for (const g of classesWithGrades) {
      const ta = g.assessment.teachingAssignment;
      if (!ta?.classSectionId) continue;
      if (tenantsWithOpen.has(g.tenantId)) continue;
      const dedup = `${g.tenantId}|${ta.classSectionId}|${ta.subjectId ?? '-'}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      const hasSnapshot = await this.prisma.studentSubjectSnapshot.findFirst({
        where: { tenantId: g.tenantId, classSectionId: ta.classSectionId },
        select: { id: true },
      });
      if (hasSnapshot) continue; // S1: only backfill classes with NO snapshot at all

      const coalesceKey = [
        g.tenantId,
        'backfill',
        ta.academicYearId ?? '-',
        ta.classSectionId,
        ta.subjectId ?? '-',
        '-',
        '-',
      ].join('|');
      try {
        await this.prisma.snapshotRecomputeTrigger.upsert({
          where: {
            tenantId_coalesceKey_status: {
              tenantId: g.tenantId,
              coalesceKey,
              status: 'pending',
            },
          },
          create: {
            tenantId: g.tenantId,
            reason: 'backfill',
            status: 'pending',
            classSectionId: ta.classSectionId,
            subjectId: ta.subjectId,
            academicYearId: ta.academicYearId,
            coalesceKey,
          },
          update: {},
        });
      } catch (err) {
        this.logger.debug(`Backfill enqueue skipped: ${(err as Error).message}`);
      }
    }
  }

  /** Claim + drain a bounded FIFO batch of one tenant's pending triggers. */
  private async drainTenant(tenantId: string): Promise<{ recomputed: number; failed: number }> {
    // FIFO candidate ids (oldest first), bounded.
    const candidates = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { enqueuedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    });
    if (candidates.length === 0) return { recomputed: 0, failed: 0 };

    let recomputed = 0;
    let failed = 0;
    for (const { id } of candidates) {
      // ATOMIC claim (PM-9): only THIS tick flips pending → processing; a concurrent
      // drain/backfill that lost the race claims 0 rows and skips.
      const claim = await this.prisma.snapshotRecomputeTrigger.updateMany({
        where: { id, tenantId, status: 'pending' },
        data: { status: 'processing' },
      });
      if (claim.count === 0) continue; // someone else claimed it

      const trigger = await this.prisma.snapshotRecomputeTrigger.findFirst({
        where: { id, tenantId },
        select: {
          id: true,
          tenantId: true,
          reason: true,
          classSectionId: true,
          subjectId: true,
          academicYearId: true,
          attempts: true,
        },
      });
      if (!trigger) continue;

      try {
        if (trigger.classSectionId === null && trigger.reason === 'coefficient_changed') {
          // E6-S3 (FR7) — a class-LESS coefficient-change trigger carries only
          // (subjectId, academicYearId). Re-weighting the subject coefficient
          // invalidates the weighted global of EVERY pupil in EVERY class teaching
          // that subject this year. Fan out: resolve those classes (tenant-scoped,
          // bounded) and recompute each class slice — each class-scoped recompute
          // already rebuilds the whole class slice incl. the weighted global. The
          // trigger is marked done only after the whole fan-out succeeds; a class
          // failure throws → the existing attempts/parking path retries the trigger.
          await this.fanOutCoefficientChange(trigger);
        } else {
          await this.recompute.recomputeScope(trigger);
        }
        await this.prisma.snapshotRecomputeTrigger.updateMany({
          where: { id, tenantId },
          data: { status: 'done', processedAt: new Date() },
        });
        recomputed += 1;
      } catch (err) {
        const attempts = trigger.attempts + 1;
        const parked = attempts >= MAX_ATTEMPTS;
        await this.prisma.snapshotRecomputeTrigger.updateMany({
          where: { id, tenantId },
          data: {
            // Parked → stays `failed`; otherwise back to `pending` to retry next tick.
            status: parked ? 'failed' : 'pending',
            attempts,
            lastError: (err as Error).message.slice(0, 500),
            processedAt: new Date(),
          },
        });
        failed += 1;
        this.logger.error(
          `Recompute failed (tenant=${tenantId}, trigger=${id}, attempt=${attempts}${parked ? ', PARKED' : ''}): ${(err as Error).message}`,
        );
        // One scope's failure must never abort the tenant batch.
      }
    }
    return { recomputed, failed };
  }

  /**
   * E6-S3 (FR7) — expand a class-LESS `coefficient_changed` trigger into one
   * class-scoped recompute per affected ClassSection. Affected = every distinct
   * class section that has a `TeachingAssignment` for the changed subject in the
   * trigger's academic year (tenant-scoped). Each resolved class is recomputed via
   * the unchanged `recomputeScope` (which rebuilds the whole class slice incl. the
   * re-weighted global). Bounded by `COEFFICIENT_FANOUT_TAKE` so a huge grade level
   * cannot wedge a tick. A per-class failure propagates so the trigger retries.
   */
  private async fanOutCoefficientChange(trigger: {
    id: string;
    tenantId: string;
    subjectId: string | null;
    academicYearId: string | null;
  }): Promise<void> {
    const { id: sourceEventId, tenantId, subjectId, academicYearId } = trigger;
    if (!subjectId || !academicYearId) return; // nothing resolvable → no-op

    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { tenantId, subjectId, academicYearId },
      select: { classSectionId: true },
      distinct: ['classSectionId'],
      take: COEFFICIENT_FANOUT_TAKE,
    });
    const classSectionIds = [...new Set(assignments.map((a) => a.classSectionId))];

    for (const classSectionId of classSectionIds) {
      // Re-use the trigger id as the sourceEventId so the refreshed snapshot rows
      // are attributable to the coefficient change (explainability/freshness).
      await this.recompute.recomputeScope({
        id: sourceEventId,
        tenantId,
        classSectionId,
        subjectId,
        academicYearId,
      });
    }

    this.logger.debug(
      `Coefficient fan-out (tenant=${tenantId}, subject=${subjectId}, year=${academicYearId}): ` +
        `${classSectionIds.length} class section(s) recomputed`,
    );
  }
}
