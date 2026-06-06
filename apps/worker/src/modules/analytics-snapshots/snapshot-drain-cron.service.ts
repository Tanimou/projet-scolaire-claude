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
 * E6-S5 — a parked (`failed`) trigger older than this is revived to `pending`
 * (attempts reset) so a transient outage that exhausted the retry cap is not a
 * permanent dark backlog (PM-G). Bounded by `FAILED_REVIVE_TAKE` per tick.
 */
const FAILED_RETRY_AFTER_MIN = Number(process.env.SNAPSHOT_FAILED_RETRY_AFTER_MIN ?? 60);
const FAILED_REVIVE_TAKE = Number(process.env.SNAPSHOT_FAILED_REVIVE_TAKE ?? 100);
/** E6-S5 — bounded per-tick orphan-snapshot prune (rows pointing at hard-deleted students/classes). */
const ORPHAN_PRUNE_TAKE = Number(process.env.SNAPSHOT_ORPHAN_PRUNE_TAKE ?? 200);
/** E6-S5 — coarser cadence for the orphan prune (run it every Nth tick, not every tick). */
const ORPHAN_PRUNE_EVERY_TICKS = Number(process.env.SNAPSHOT_ORPHAN_PRUNE_EVERY_TICKS ?? 10);
/** E6-S5 — bound the per-tick whole-tenant `manual_rebuild` fan-out over active class sections. */
const REBUILD_FANOUT_TAKE = Number(process.env.SNAPSHOT_REBUILD_FANOUT_TAKE ?? 200);
/**
 * E6-S5 — the snapshot LOGIC-revision floor (PM-A). `revision` on a snapshot row
 * is a per-row optimistic counter, so the spec's "revision < current" stale clause
 * has no per-row `current` to compare against. We make it an explicit operator
 * knob instead: a snapshot whose `revision < SNAPSHOT_REVISION_FLOOR` is treated as
 * stale-by-logic and re-swept. Default `1` ⇒ the clause never fires (no behaviour
 * change); after a recompute-logic change an operator bumps this env var and the
 * sweep lazily rebuilds every below-floor row exactly once (then no-ops, because
 * the rebuilt rows still carry their own incrementing revision ≥ floor only when a
 * value changed — so stale-by-logic rows are caught by `computedAt < lastGradeAt`
 * as the primary signal; the floor is the deploy-time convergence lever). NO schema
 * change — reuses the existing `revision` column.
 */
const SNAPSHOT_REVISION_FLOOR = Number(process.env.SNAPSHOT_REVISION_FLOOR ?? 1);

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
  /** Monotonic tick counter — gates the coarser-cadence orphan prune (E6-S5). */
  private tickCount = 0;

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
    this.tickCount += 1;
    const start = Date.now();
    // E6-S5 — structured per-tick counts (AC-S5-6). Each pass is independently
    // try/caught so one failing op never aborts the tick (AC-S5-5).
    let recomputed = 0;
    let failed = 0;
    let revived = 0;
    let pruned = 0;
    let backfilled = 0;
    let parked = 0;
    let failedBacklog = 0;
    let tenantCount = 0;
    try {
      await this.safe('reclaimStaleProcessing', () => this.reclaimStaleProcessing());
      revived = await this.safe('reviveFailed', () => this.reviveFailedTriggers(), 0);
      backfilled = await this.safe('backfill', () => this.backfillLaggingTenants(), 0);
      // Orphan prune runs on a coarser cadence (every Nth tick) — best-effort.
      if (this.tickCount % ORPHAN_PRUNE_EVERY_TICKS === 0) {
        pruned = await this.safe('orphanPrune', () => this.pruneOrphanSnapshots(), 0);
      }

      const tenants = await this.tenantsWithPending();
      tenantCount = tenants.length;
      for (const tenantId of tenants) {
        try {
          const r = await this.drainTenant(tenantId);
          recomputed += r.recomputed;
          failed += r.failed;
          parked += r.parked;
        } catch (err) {
          this.logger.error(
            `Snapshot drain failed for tenant ${tenantId}: ${(err as Error).message}`,
          );
        }
      }
      failedBacklog = await this.safe('failedBacklog', () => this.countFailed(), 0);
    } finally {
      this.running = false;
      const durationMs = Date.now() - start;
      // Single structured count line referencing analytics.SnapshotRecomputed —
      // observability only, NO queue/outbox write, NO new event name (AC-S5-6).
      this.logger.log(
        `Snapshot drain tick complete (event=${DOMAIN_EVENTS.SNAPSHOT_RECOMPUTED}) ` +
          JSON.stringify({
            tenants: tenantCount,
            recomputed,
            failed,
            parked,
            revived,
            pruned,
            backfilled,
            failedBacklog,
            durationMs,
          }),
      );
    }
  }

  /**
   * Run a sweep op inside a per-op try/catch so a single op's failure (a probe
   * throw, a prune race) never aborts the whole tick (AC-S5-5). Returns the op's
   * result, or `fallback` on throw.
   */
  private async safe(
    label: string,
    fn: () => Promise<void>,
  ): Promise<void>;
  private async safe<T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T>;
  private async safe<T>(label: string, fn: () => Promise<T>, fallback?: T): Promise<T | undefined> {
    try {
      return await fn();
    } catch (err) {
      this.logger.error(`Snapshot sweep op '${label}' failed (tick continues): ${(err as Error).message}`);
      return fallback;
    }
  }

  /** Standing count of parked (`failed`) triggers across all tenants (observability). */
  private async countFailed(): Promise<number> {
    return this.prisma.snapshotRecomputeTrigger.count({ where: { status: 'failed' } });
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
   *
   * E6-S5 (PM-C): key the staleness on `processedAt` — the timestamp stamped at
   * CLAIM time (pending→processing) — NOT `enqueuedAt`. A trigger that waited a
   * long time in the backlog (old `enqueuedAt`) but was claimed just now is still
   * legitimately running; reclaiming it on `enqueuedAt` would double-recompute it.
   * We reclaim only rows whose claim is older than the threshold (or, defensively,
   * a processing row with a null `processedAt` — a pre-S5 legacy claim).
   */
  private async reclaimStaleProcessing(): Promise<void> {
    const cutoff = new Date(Date.now() - STALE_PROCESSING_MIN * 60 * 1000);
    const reclaimed = await this.prisma.snapshotRecomputeTrigger.updateMany({
      where: {
        status: 'processing',
        OR: [{ processedAt: { lt: cutoff } }, { processedAt: null }],
      },
      data: { status: 'pending' },
    });
    if (reclaimed.count > 0) {
      this.logger.warn(`Reclaimed ${reclaimed.count} stale processing trigger(s) → pending`);
    }
  }

  /**
   * E6-S5 (PM-G) — revive parked (`failed`) triggers older than
   * `FAILED_RETRY_AFTER_MIN` back to `pending` with `attempts=0`, so a transient
   * outage that exhausted the retry cap does not leave a permanent dark backlog.
   * Bounded per tick (`FAILED_REVIVE_TAKE`). Returns the revived count.
   */
  private async reviveFailedTriggers(): Promise<number> {
    const cutoff = new Date(Date.now() - FAILED_RETRY_AFTER_MIN * 60 * 1000);
    // Pick ids first so the revive is bounded (updateMany has no `take`).
    const stale = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: { status: 'failed', processedAt: { lt: cutoff } },
      orderBy: { processedAt: 'asc' },
      take: FAILED_REVIVE_TAKE,
      select: { id: true },
    });
    if (stale.length === 0) return 0;
    const revived = await this.prisma.snapshotRecomputeTrigger.updateMany({
      where: { id: { in: stale.map((s) => s.id) }, status: 'failed' },
      data: { status: 'pending', attempts: 0, lastError: null },
    });
    if (revived.count > 0) {
      this.logger.warn(`Revived ${revived.count} parked (failed) trigger(s) → pending (retry)`);
    }
    return revived.count;
  }

  /**
   * E6-S5 (PM-F) — bounded, tenant-scoped prune of orphan snapshot rows whose
   * `studentId` / `classSectionId` no longer exists in the live tables (hard
   * delete). Snapshots are a disposable cache (ADR-019): a stranded row only
   * wastes space + can serve a number for a student/class that is gone, so reaping
   * it is no-op-correct. The predicate is strict — "NO matching `student` /
   * `class_section` row at all" (hard delete), NEVER enrollment/active status (a
   * pupil who merely changed class is NOT an orphan). Each pass is bounded by
   * `ORPHAN_PRUNE_TAKE` and runs as its own deleteMany (best-effort, never blocks
   * a recompute). Returns the deleted row count.
   */
  private async pruneOrphanSnapshots(): Promise<number> {
    let deleted = 0;
    // Sample a bounded window of snapshot rows, resolve which student/class ids are
    // truly gone (tenant-scoped), then delete just those rows. Coarse cadence keeps
    // this cheap; full convergence spans several prune ticks.
    const sample = await this.prisma.studentGlobalSnapshot.findMany({
      take: ORPHAN_PRUNE_TAKE,
      select: { id: true, tenantId: true, studentId: true, classSectionId: true },
    });
    if (sample.length === 0) return 0;

    const studentIds = [...new Set(sample.map((r) => r.studentId))];
    const classIds = [...new Set(sample.map((r) => r.classSectionId))];
    const liveStudents = new Set(
      (
        await this.prisma.student.findMany({
          where: { id: { in: studentIds } },
          select: { id: true },
        })
      ).map((s) => s.id),
    );
    const liveClasses = new Set(
      (
        await this.prisma.classSection.findMany({
          where: { id: { in: classIds } },
          select: { id: true },
        })
      ).map((c) => c.id),
    );

    const orphans = sample.filter(
      (r) => !liveStudents.has(r.studentId) || !liveClasses.has(r.classSectionId),
    );
    if (orphans.length === 0) return 0;

    // Delete the orphan rows across all three snapshot grains, tenant-scoped.
    const orphanStudentIds = [...new Set(orphans.map((r) => r.studentId).filter((id) => !liveStudents.has(id)))];
    const orphanClassIds = [...new Set(orphans.map((r) => r.classSectionId).filter((id) => !liveClasses.has(id)))];
    const byTenant = new Map<string, true>();
    for (const o of orphans) byTenant.set(o.tenantId, true);

    for (const tenantId of byTenant.keys()) {
      const studentClause = orphanStudentIds.length > 0 ? [{ studentId: { in: orphanStudentIds } }] : [];
      const classClause = orphanClassIds.length > 0 ? [{ classSectionId: { in: orphanClassIds } }] : [];
      const orClause = [...studentClause, ...classClause];
      if (orClause.length === 0) continue;
      const where = { tenantId, OR: orClause };
      const g = await this.prisma.studentGlobalSnapshot.deleteMany({ where });
      const s = await this.prisma.studentSubjectSnapshot.deleteMany({ where });
      // ClassSubjectDistribution carries no studentId — prune only by orphan class.
      const d =
        orphanClassIds.length > 0
          ? await this.prisma.classSubjectDistribution.deleteMany({
              where: { tenantId, classSectionId: { in: orphanClassIds } },
            })
          : { count: 0 };
      deleted += g.count + s.count + d.count;
    }
    if (deleted > 0) {
      this.logger.warn(`Pruned ${deleted} orphan snapshot row(s) (hard-deleted student/class)`);
    }
    return deleted;
  }

  /**
   * Backfill safety-net (E6-S5 PM-B — PRECISE stale detection). A class scope is
   * stale, and gets a coalesced `backfill` trigger, when EITHER:
   *   - it has NO snapshot at all (S1 preserved — fresh/migrated tenant), OR
   *   - its freshest snapshot `computedAt < lastGradeAt` (a dropped best-effort
   *     enqueue: the grade landed but the trigger never did → the snapshot now lags
   *     a populated class), OR
   *   - its snapshot `revision < SNAPSHOT_REVISION_FLOOR` (stale-by-logic after a
   *     recompute-logic deploy bumps the floor).
   * This replaces the S1 "only classes with ZERO snapshots" short-circuit, so a
   * MISSED EVENT on an already-computed class now self-heals within one sweep — the
   * literal S5 thesis. Bounded probe; enqueue at most one trigger per affected class;
   * only tenants with NO open trigger (the normal drain covers the rest). Returns the
   * number of backfill triggers enqueued.
   */
  private async backfillLaggingTenants(): Promise<number> {
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

    // Class sections that have ≥1 published/revised grade, with the freshest grade
    // mutation time (`updatedAt` moves on publish AND revise) so we can compare it to
    // the snapshot's `computedAt`. Bounded probe (full convergence over several ticks).
    const classesWithGrades = await this.prisma.grade.findMany({
      where: { status: { in: ['published', 'revised'] }, isAbsent: false },
      select: {
        tenantId: true,
        updatedAt: true,
        assessment: {
          select: {
            teachingAssignment: {
              select: { classSectionId: true, subjectId: true, academicYearId: true },
            },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 500,
    });

    let enqueued = 0;
    const seen = new Set<string>();
    for (const g of classesWithGrades) {
      const ta = g.assessment.teachingAssignment;
      if (!ta?.classSectionId) continue;
      if (tenantsWithOpen.has(g.tenantId)) continue;
      const dedup = `${g.tenantId}|${ta.classSectionId}|${ta.subjectId ?? '-'}`;
      if (seen.has(dedup)) continue;
      seen.add(dedup);

      // Freshest snapshot for this (class, subject) scope — the row the read path
      // would serve. We compare ITS computedAt/revision against the latest grade.
      const snapshot = await this.prisma.studentSubjectSnapshot.findFirst({
        where: { tenantId: g.tenantId, classSectionId: ta.classSectionId },
        orderBy: { computedAt: 'desc' },
        select: { computedAt: true, revision: true },
      });
      const noSnapshot = snapshot == null;
      const lagsGrades = snapshot != null && snapshot.computedAt < g.updatedAt;
      const staleByLogic = snapshot != null && snapshot.revision < SNAPSHOT_REVISION_FLOOR;
      if (!noSnapshot && !lagsGrades && !staleByLogic) continue; // fresh — nothing to do

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
        enqueued += 1;
      } catch (err) {
        this.logger.debug(`Backfill enqueue skipped: ${(err as Error).message}`);
      }
    }
    return enqueued;
  }

  /** Claim + drain a bounded FIFO batch of one tenant's pending triggers. */
  private async drainTenant(
    tenantId: string,
  ): Promise<{ recomputed: number; failed: number; parked: number }> {
    // FIFO candidate ids (oldest first), bounded.
    const candidates = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: { tenantId, status: 'pending' },
      orderBy: { enqueuedAt: 'asc' },
      take: BATCH_SIZE,
      select: { id: true },
    });
    if (candidates.length === 0) return { recomputed: 0, failed: 0, parked: 0 };

    let recomputed = 0;
    let failed = 0;
    let parkedCount = 0;
    for (const { id } of candidates) {
      // ATOMIC claim (PM-9): only THIS tick flips pending → processing; a concurrent
      // drain/backfill that lost the race claims 0 rows and skips. E6-S5 (PM-C): stamp
      // `processedAt = now` AT CLAIM TIME so the stale-processing reclaim keys on the
      // claim instant (how long it has been RUNNING), never on `enqueuedAt` (how long
      // it waited in the backlog) — a freshly-claimed row is never reclaimed mid-run.
      const claim = await this.prisma.snapshotRecomputeTrigger.updateMany({
        where: { id, tenantId, status: 'pending' },
        data: { status: 'processing', processedAt: new Date() },
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
        const classLess = trigger.classSectionId === null;
        if (classLess && trigger.reason === 'coefficient_changed') {
          // E6-S3 (FR7) — a class-LESS coefficient-change trigger carries only
          // (subjectId, academicYearId). Re-weighting the subject coefficient
          // invalidates the weighted global of EVERY pupil in EVERY class teaching
          // that subject this year. Fan out: resolve those classes (tenant-scoped,
          // bounded) and recompute each class slice — each class-scoped recompute
          // already rebuilds the whole class slice incl. the weighted global. The
          // trigger is marked done only after the whole fan-out succeeds; a class
          // failure throws → the existing attempts/parking path retries the trigger.
          await this.fanOutCoefficientChange(trigger);
        } else if (classLess && trigger.reason === 'manual_rebuild') {
          // E6-S5 — a class-LESS `manual_rebuild` trigger. Two shapes (both bounded):
          //   - (subjectId, academicYearId) present → coefficient-style fan-out over
          //     every class teaching that subject in the year;
          //   - fully unscoped (whole tenant) → fan-out over every active class section
          //     (bounded by REBUILD_FANOUT_TAKE; the rest converge over later ticks /
          //     the backfill sweep).
          if (trigger.subjectId && trigger.academicYearId) {
            await this.fanOutCoefficientChange(trigger);
          } else {
            await this.fanOutWholeTenantRebuild(trigger);
          }
        } else {
          // A class-scoped trigger (grade_published / grade_revised / backfill /
          // class-scoped manual_rebuild) → a single class recompute.
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
        if (parked) parkedCount += 1;
        this.logger.error(
          `Recompute failed (tenant=${tenantId}, trigger=${id}, attempt=${attempts}${parked ? ', PARKED' : ''}): ${(err as Error).message}`,
        );
        // One scope's failure must never abort the tenant batch.
      }
    }
    return { recomputed, failed, parked: parkedCount };
  }

  /**
   * E6-S5 — expand a fully-unscoped (whole-tenant) `manual_rebuild` trigger into one
   * class-scoped recompute per ACTIVE class section in the tenant. Bounded by
   * `REBUILD_FANOUT_TAKE` so a huge tenant can never wedge a tick — the remaining
   * classes converge over later ticks via the backfill sweep (their snapshots will
   * still lag). Re-uses the unchanged `recomputeScope` per class. A per-class failure
   * propagates so the trigger retries/parks via the normal path.
   */
  private async fanOutWholeTenantRebuild(trigger: {
    id: string;
    tenantId: string;
  }): Promise<void> {
    const { id: sourceEventId, tenantId } = trigger;
    const sections = await this.prisma.classSection.findMany({
      where: { tenantId },
      select: { id: true, academicYearId: true },
      take: REBUILD_FANOUT_TAKE,
    });
    for (const section of sections) {
      await this.recompute.recomputeScope({
        id: sourceEventId,
        tenantId,
        classSectionId: section.id,
        subjectId: null,
        academicYearId: section.academicYearId,
      });
    }
    this.logger.debug(
      `Whole-tenant rebuild fan-out (tenant=${tenantId}): ${sections.length} class section(s) recomputed`,
    );
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
