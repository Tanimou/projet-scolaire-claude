import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { DOMAIN_EVENTS } from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { canonicalCoalesceKey, terminalCoalesceKey } from './snapshot-keys';
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
 * PF-24 — bound on the per-tick stale-`processing` reclaim. The reclaim became a
 * per-row loop (a single `updateMany` is atomic, so ONE colliding row would abort
 * the reclaim of every other), so it needs the same explicit per-tick bound every
 * other sweep already carries. The remainder is reclaimed on the next tick.
 */
const STALE_RECLAIM_TAKE = Number(process.env.SNAPSHOT_STALE_RECLAIM_TAKE ?? 200);
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
 * `S-E03-10b` — a knob that MUST be a positive whole number, or the sweep it governs
 * fails SILENTLY rather than loudly.
 *
 * The file's older knobs are plain `Number(process.env.X ?? D)`, which passes a bad
 * value straight through: `SNAPSHOT_TERMINAL_RETENTION_DAYS=0` would put the cutoff
 * at `now` and delete terminal rows seconds old; a non-numeric value yields `NaN`,
 * then `new Date(NaN)`, then a Prisma throw that `safe()` swallows — retention would
 * never run again, with no signal; `..._EVERY_TICKS=0` makes `tickCount % 0` be `NaN`,
 * so the cadence gate is never true and the sweep never fires. Clamp instead: an
 * unusable value falls back to the documented default.
 *
 * Deliberately NOT retrofitted onto `ORPHAN_PRUNE_EVERY_TICKS` — that pre-existing
 * instance of the same class is RECORDED as a finding by this slice, not fixed here.
 */
function positiveKnob(raw: string | undefined, fallback: number): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n >= 1 ? n : fallback;
}

/**
 * PF-380 / `S-E03-10b` — retention window, in DAYS, for TERMINAL (`done` / `failed`)
 * `snapshot_recompute_trigger` rows.
 *
 * Why a knob and not a constant: `S-E03-10` removed the table's only bound. Before
 * it, `@@unique([tenantId, coalesceKey, status])` held terminal rows at one `done`
 * plus one `failed` per scope forever — the bug and the ceiling were the SAME
 * mechanism. Giving terminal rows a per-row key (ADR-083 §D1) fixed the bug and
 * removed the ceiling, so the table grows one permanent row per recompute per scope.
 * This env var is where the human retention decision now lives (ADR-083 §D2);
 * `OPEN.md` had recorded the TTL as "a decision a human owns, not a code choice", and
 * this slice reverses that by picking a default and NAMING the override rather than
 * leaving the table unbounded.
 *
 * Default 30 days: a `failed` row that has survived 30 days has survived roughly
 * `30 * 24 * 60 / FAILED_RETRY_AFTER_MIN` ~= 720 revive passes at the 60-minute
 * default — it is dead, not awaiting triage. A `done` row is pure history; the only
 * reader of a terminal row anywhere in the repo is the admin ops feed (see
 * `sweepTerminalTriggers`).
 */
const TERMINAL_RETENTION_DAYS = positiveKnob(process.env.SNAPSHOT_TERMINAL_RETENTION_DAYS, 30);
/**
 * PF-380 — per-tick budget of terminal rows deleted, SHARED across tenants. This is a
 * RETENTION bound, not back-pressure. Capacity is
 * `TAKE * (1440 / interval_minutes) / EVERY_TICKS` = `500 * 1440 / 10` = **72 000
 * rows/day**, against a growth model of one row per *(class x subject x term)*
 * publish — trigger scopes are class-keyed, never per-pupil (`grades.controller.ts`
 * and `assessments.controller.ts` both enqueue with no `studentId`; only the admin
 * `manual_rebuild` can set one). A first run against an aged table therefore
 * converges over `backlog / 72000` days rather than instantly, which is the intended
 * shape: a sweep able to clear an arbitrary backlog in one tick would be an unbounded
 * delete.
 */
const TERMINAL_SWEEP_TAKE = positiveKnob(process.env.SNAPSHOT_TERMINAL_SWEEP_TAKE, 500);
/**
 * PF-380 — coarse cadence for the retention sweep (every Nth tick), matching
 * `ORPHAN_PRUNE_EVERY_TICKS`. Retention is a hygiene concern measured in days;
 * running it every tick would buy nothing and cost a scan.
 */
const TERMINAL_SWEEP_EVERY_TICKS = positiveKnob(
  process.env.SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS,
  10,
);
/**
 * `PF-459` / ADR-083 §D8 — the OFF switch, and why it had to be added explicitly.
 *
 * This sweep is the first DESTRUCTIVE delete in this file, and `positiveKnob` clamps an
 * out-of-range cadence back to the default — so with it alone there was no value of
 * `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS` that could stop the sweep. That is a trap rather
 * than merely a gap: the sibling idiom two lines away, `ORPHAN_PRUNE_EVERY_TICKS=0`,
 * DOES disable its prune (`tickCount % 0` is `NaN`, never `0`), so an operator reaching
 * for the one lever this file already taught them would have silently kept deleting.
 *
 * `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS=0` therefore means DISABLED, matching the sibling.
 * Matched on the RAW string, not on `Number(...) === 0`, because `Number('')` is `0` and
 * an empty value in a compose file means "unset", which must never disable retention.
 */
const TERMINAL_SWEEP_DISABLED =
  (process.env.SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS ?? '').trim() === '0';
/**
 * PF-380 — the two TERMINAL statuses, named ONCE. Every clause of the retention sweep
 * pins this list; a row outside it is never a delete candidate, which is the invariant
 * three portal-visible freshness reads depend on (see `sweepTerminalTriggers`).
 */
const TERMINAL_STATUSES: ('done' | 'failed')[] = ['done', 'failed'];

/**
 * PF-24 — duck-typed unique-violation predicate. Prisma raises
 * `PrismaClientKnownRequestError` with `code: 'P2002'`; matching on the code alone
 * keeps this a type-only dependency on `@prisma/client` (the worker imports Prisma
 * as `import type` everywhere) and matches how the API's P2002 catches are exercised.
 */
function isUniqueViolation(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: unknown }).code === 'P2002';
}

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
    let sweptTerminal = 0;
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
      // PF-380 — terminal-row retention, also on a coarse cadence. It sits with the
      // PRE-loop sweeps deliberately: `tenantsWithPending()` below is the one call in
      // this tick NOT wrapped in `safe()`, so anything sequenced after it is skipped
      // whenever that scan throws. Retention placed after the drain loop would be
      // silently disabled by a transient scan failure — the exact shape of the finding
      // it exists to fix.
      if (!TERMINAL_SWEEP_DISABLED && this.tickCount % TERMINAL_SWEEP_EVERY_TICKS === 0) {
        sweptTerminal = await this.safe('terminalSweep', () => this.sweepTerminalTriggers(), 0);
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
            sweptTerminal,
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
    const stale = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: {
        status: 'processing',
        OR: [{ processedAt: { lt: cutoff } }, { processedAt: null }],
      },
      orderBy: { processedAt: 'asc' },
      take: STALE_RECLAIM_TAKE,
      select: { id: true, tenantId: true, coalesceKey: true },
    });
    if (stale.length === 0) return;
    // PF-24 — one row at a time through `requeueCanonical`. A single `updateMany`
    // is atomic: ONE stale row whose scope already has a live `pending` row raises
    // P2002 on `@@unique([tenantId, coalesceKey, status])` and aborts the reclaim of
    // every OTHER stale row — crash recovery wedged for the whole deployment.
    let reclaimed = 0;
    for (const row of stale) {
      // PF-382 — `expectedStatus: 'processing'` is the predicate this loop's own
      // `where` carried before the per-row rewrite. Without it, a row that settled to
      // `done` between the `findMany` above and this write is RESURRECTED to `pending`
      // with its canonical key restored — a spurious recompute, and a `FreshnessChip`
      // that announces "Recomputing…" on a dashboard that is already current.
      if (await this.requeueCanonical(row, 'processing')) reclaimed += 1;
    }
    if (reclaimed > 0) {
      this.logger.warn(`Reclaimed ${reclaimed} stale processing trigger(s) → pending`);
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
      select: { id: true, tenantId: true, coalesceKey: true },
    });
    if (stale.length === 0) return 0;
    // PF-24 — a parked row carries a TERMINAL coalescing key, so the revive MUST put
    // the canonical one back: otherwise the API enqueue would no longer fold onto the
    // revived row and the queue would grow one uncoalesced row per dirty. That restore
    // can legitimately collide with a live `pending` row for the same scope, so it runs
    // per row (an `updateMany` would abort the whole batch on the first collision).
    let revived = 0;
    for (const row of stale) {
      // PF-382 — `expectedStatus: 'failed'` restores the predicate the pre-rewrite
      // `updateMany({ where: { id: { in: … }, status: 'failed' } })` carried.
      if (await this.requeueCanonical(row, 'failed', { attempts: 0, lastError: null })) {
        revived += 1;
      }
    }
    if (revived > 0) {
      this.logger.warn(`Revived ${revived} parked (failed) trigger(s) → pending (retry)`);
    }
    return revived;
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
   * PF-380 / `S-E03-10b` — bounded, tenant-scoped, coarse-cadence RETENTION sweep over
   * TERMINAL `snapshot_recompute_trigger` rows. Returns the deleted row count.
   *
   * ## Why this exists
   *
   * `@@unique([tenantId, coalesceKey, status])` used to hold terminal rows at one
   * `done` + one `failed` per scope forever. That ceiling was an ACCIDENT of the bug
   * `PF-24` fixed, and `S-E03-10` removed both together: every terminal row now carries
   * `terminalCoalesceKey(key, id)`, so nothing bounds the table any more. This sweep is
   * the explicit replacement (ADR-083 §D2). The trigger table is transient bookkeeping,
   * not a domain aggregate (ADR-019 §Non-goals) — deleting a settled row is
   * no-op-correct and carries no audit obligation, which is exactly why the append-only
   * audit log is NOT touched here.
   *
   * ## G-TRUTH — why only TERMINAL rows may ever be deleted
   *
   * `recomputing` is derived in THREE places, and every one of them filters
   * `status: { in: ['pending','processing'] }`:
   *   - `apps/api/src/modules/analytics/analytics.service.ts:1473-1482` (the inline
   *     probe on the child/student-rank path);
   *   - `apps/api/src/modules/analytics/analytics.service.ts:4480-4492`
   *     (`resolveTeacherReportsFreshness`);
   *   - `apps/api/src/modules/analytics/school-performance-drilldown.service.ts:241`
   *     (`resolveFreshness`).
   * All three feed `FreshnessChip` (`apps/web/src/components/freshness/FreshnessChip.tsx`),
   * rendered by the parent dashboard, the teacher reports page and the admin
   * drilldown. A sweep restricted to `status IN ('done','failed')` cannot change any of
   * those result sets, so every chip state is bit-identical before and after, and no
   * `aria-live` transition is announced that did not happen. Deleting a `pending` or
   * `processing` row would instead flip a chip out of "Recomputing…" while the
   * recompute is still in flight AND drop queued work — the KPI/ledger divergence
   * `DNC-01` forbids. The `status` pin below is therefore a UI-facing invariant, not
   * merely data hygiene; test (3) of `snapshot-trigger-conflict.spec.ts` is its
   * measurement.
   *
   * ## G-PORTAL — the one surface that DOES change (accepted, ADR-083 §D4)
   *
   * `SnapshotOpsService.getRecomputeStatus` (`apps/api/src/modules/analytics/
   * snapshot-ops.service.ts:38-80`, admin ops, `schools.read`) reads this table: its
   * `failed` count (`:45`) now excludes rows older than the TTL — a correct number
   * whose growth stops — and its `recent` feed (`:51-65`, the 20 newest by
   * `enqueuedAt desc`, ALL statuses) is unchanged on an active tenant but can empty out
   * on a tenant dormant longer than the TTL. No `apps/web` file reads that endpoint, so
   * there is no UI change; there IS an API-visible one.
   *
   * ## Shape — ONE bounded read, then one `deleteMany` per tenant present in it
   *
   * `PF-457`. The first cut of this sweep enumerated tenants first
   * (`findMany({ where: { status IN TERMINAL }, distinct: ['tenantId'] })`) and then read
   * each tenant's candidates under its own key, to supply the `(tenant_id, status)` prefix
   * of `@@index([tenantId, status, enqueuedAt])`. The escalation panel measured that the
   * enumeration was **itself unbounded and unindexed**: it carries no `take` and no
   * `tenant_id`, so it sequential-scanned — with no ceiling — exactly the population this
   * finding says grows without bound, on EVERY sweep tick, whether or not anything was due.
   * A `safe()`-swallowed statement timeout there disables retention silently, so the
   * control could switch itself off on the first aged table it met.
   *
   * The candidate read is now the ONLY read, and it is bounded by `TERMINAL_SWEEP_TAKE`.
   * That is strictly cheaper than what it replaces: the old shape paid one unbounded scan
   * PLUS N indexed reads; this pays one scan that Postgres stops early once `LIMIT` is
   * satisfied. The residual is real and recorded rather than hidden: with nothing past the
   * TTL, `LIMIT` cannot short-circuit and the scan runs to completion once every
   * `TERMINAL_SWEEP_EVERY_TICKS` ticks. `processed_at` is in no index under any shape, so
   * the fix is the composite `@@index([tenantId, status, processedAt])` — which needs a
   * migration, deliberately out of scope here, and rides the first migration that touches
   * this table (`PF-451`).
   *
   * **G-TENANT stays structural, and gets stronger.** Candidates are grouped by the
   * `tenantId` each row itself carries, and a group's `deleteMany` is keyed on that same
   * value, so every id in the call provably belongs to the tenant in its `where` — the
   * grouping key IS the row's own tenant, not a value carried from an outer loop. Do NOT
   * flatten this into one `deleteMany({ where: { id: { in: allIds } } })`.
   *
   * It also cannot starve: it is driven by rows that are TERMINAL and past the TTL, never
   * by `tenantsWithPending()` — a tenant whose queue is entirely terminal is the exact
   * steady state this finding describes and would otherwise never be swept. The budget is
   * shared across tenants and the read carries no `orderBy`, so a single huge tenant can
   * crowd out others on a given tick; retention is measured in days and converges over
   * later ticks, but the unfairness is real and recorded (`PF-458`, the `PF-385` shape).
   *
   * The `deleteMany` RE-ASSERTS the full predicate rather than trusting the ids, because
   * terminal-ness FLIPS: `reviveFailedTriggers` (`:257-275`) selects `status: 'failed'`
   * in the same tick and returns rows to `pending` under the canonical key, onto which a
   * fresh dirty immediately folds. Deleting by id alone could therefore erase queued
   * work with no error. Postgres re-checks a DELETE's predicate at write time under read
   * committed, which closes that window.
   *
   * `processedAt: { lt: cutoff }` already excludes `processedAt: null`: SQL `NULL < x`
   * is `NULL`, never `true`. No `not: null` clause is needed — and none is added, so the
   * predicate stays within the operators the spec's fake table implements. There is no
   * `orderBy`: it would force a top-N sort of the whole terminal population for no
   * benefit, since retention does not care WHICH rows past the TTL go first.
   */
  private async sweepTerminalTriggers(): Promise<number> {
    const cutoff = new Date(Date.now() - TERMINAL_RETENTION_DAYS * 24 * 60 * 60 * 1000);
    // The ONE read, bounded (PF-457). Every row it returns is already a delete
    // candidate: terminal AND past the TTL. Nothing else is read.
    const doomed = await this.prisma.snapshotRecomputeTrigger.findMany({
      where: { status: { in: TERMINAL_STATUSES }, processedAt: { lt: cutoff } },
      select: { id: true, tenantId: true },
      take: TERMINAL_SWEEP_TAKE,
    });
    // Grouped by the tenant each row CARRIES, so the `tenantId` in a group's `where` and
    // the ids in the same call cannot disagree. This is the G-TENANT argument, in code.
    const idsByTenant = new Map<string, string[]>();
    for (const row of doomed) {
      const bucket = idsByTenant.get(row.tenantId);
      if (bucket) bucket.push(row.id);
      else idsByTenant.set(row.tenantId, [row.id]);
    }
    let deleted = 0;
    for (const [tenantId, ids] of idsByTenant) {
      const removed = await this.prisma.snapshotRecomputeTrigger.deleteMany({
        where: {
          tenantId,
          id: { in: ids },
          status: { in: TERMINAL_STATUSES },
          processedAt: { lt: cutoff },
        },
      });
      deleted += removed.count;
    }
    if (deleted > 0) {
      this.logger.warn(
        `Retention sweep removed ${deleted} terminal trigger row(s) older than ${TERMINAL_RETENTION_DAYS}d`,
      );
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
      //
      // PF-24 — the CLAIM is the fourth site the unique constrains, and the only one
      // that is not a settle. `processing` keeps the CANONICAL key (it must: the row
      // is still the live one for its scope), so claiming a pending row while an
      // EARLIER row for the same scope is still `processing` raises P2002 — reachable
      // whenever a recompute outlives a tick and a dirty was enqueued meanwhile,
      // which is the same window the settle comments describe. This call sits before
      // the `try` below, so that P2002 used to escape `drainTenant` into the
      // per-tenant catch and abandon the REST of the tenant's batch for the tick.
      // A claim that collides has, by definition, lost the race to a live row for
      // its scope, so it is treated exactly as `claim.count === 0` already is.
      let claimed = false;
      try {
        const claim = await this.prisma.snapshotRecomputeTrigger.updateMany({
          where: { id, tenantId, status: 'pending' },
          data: { status: 'processing', processedAt: new Date() },
        });
        claimed = claim.count > 0;
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        this.logger.debug(
          `Trigger ${id} (tenant=${tenantId}) not claimed — a live row already holds its scope`,
        );
      }
      if (!claimed) continue; // someone else claimed it, or holds the scope

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
          // PF-24 — the settle needs the stored key to derive the terminal one.
          coalesceKey: true,
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
        // PF-24 — the terminal write carries a per-ROW terminal key. Before this,
        // `done` kept the canonical key and hit `@@unique([tenantId, coalesceKey,
        // status])` against the `done` row left by the FIRST recompute of the same
        // scope: every second recompute of every scope threw P2002, the row stayed
        // `processing` forever and the freshness read pinned `recomputing: true`.
        //
        // PF-383 (G-AUDIT) — `lastError: null`. A row that failed, retried and then
        // SUCCEEDED kept the text its failure wrote: `(err as Error).message.slice(0,
        // 500)`, i.e. raw Prisma output, which can quote names and identifiers. With
        // terminal rows no longer bounded by the unique constraint that used to cap
        // them, that was permanent retention of raw error text on a settled row. The
        // success write clears it. `attempts` is deliberately NOT cleared — the retry
        // counter's semantics are a separate recorded finding.
        await this.settleTrigger(trigger, 'done', { lastError: null });
        recomputed += 1;
      } catch (err) {
        const attempts = trigger.attempts + 1;
        const parked = attempts >= MAX_ATTEMPTS;
        const lastError = (err as Error).message.slice(0, 500);
        // PF-24 — the FAILURE write hit the same constraint from both sides: parking
        // on `failed` collided with an older parked row for the scope, and the retry
        // write back to `pending` collided with a dirty enqueued while this row was
        // `processing`. Either P2002 escaped `drainTenant` into the per-tenant catch
        // and silently abandoned the REST of that tenant's batch for the tick — so
        // fixing only the `done` write would have left this abort path open. The
        // settle is collision-safe on both branches, and a settle that fails for any
        // OTHER reason is logged rather than allowed to abort the batch.
        try {
          // Parked → stays `failed`; otherwise back to `pending` to retry next tick.
          await this.settleTrigger(trigger, parked ? 'failed' : 'pending', { attempts, lastError });
        } catch (settleErr) {
          this.logger.error(
            `Could not settle trigger ${id} (tenant=${tenantId}) after a recompute failure: ${(settleErr as Error).message}`,
          );
        }
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
   * PF-24 — write a trigger's OUTCOME status without ever tripping
   * `@@unique([tenantId, coalesceKey, status])`.
   *
   * That unique is what makes the *pending* slot coalescing (one live row per
   * scope). It was never meant to constrain terminal rows, but `coalesceKey` is a
   * pure function of `(tenant, reason, scope)`, so it constrained them anyway: one
   * `done` row and one `failed` row per scope, for the lifetime of the table.
   *
   *   - `done` / `failed` → the row takes `terminalCoalesceKey(key, id)`, suffixed
   *     with its own primary key. Collision-free BY CONSTRUCTION, not by retry: no
   *     two rows can ever derive the same terminal key.
   *   - `pending` (retry) → the row must take the CANONICAL key back, which CAN
   *     legitimately collide with a live pending row for the same scope; that case
   *     is handled in `requeueCanonical`.
   *
   * PF-382 — the `pending` (retry) branch, and ONLY that branch, carries
   * `expectedStatus: 'processing'`, READ rather than assumed: the sole caller of that
   * branch is `drainTenant`'s catch block, on a row THIS tick claimed at the atomic
   * `updateMany({ where: { id, tenantId, status: 'pending' }, data: { status:
   * 'processing', … } })`. Without the predicate a row that reached a terminal state
   * under us is dragged back to `pending` and stamped with raw error text.
   *
   * The TERMINAL branch deliberately keeps `where: { id, tenantId }` and NO status
   * predicate. S-E03-10b §7 puts it out of scope, and measuring it rather than assuming
   * symmetry shows the predicate would be a REGRESSION, not a guard:
   * `reclaimStaleProcessing` returns a `processing` row to `pending` once its claim is
   * older than `STALE_PROCESSING_MIN`, so a recompute that outlives that window would
   * settle ZERO rows. The success path would then never record `done` — `status IN
   * ('pending','processing')` stays true, so `recomputing` reads true forever on the
   * parent dashboard while the same fan-out is redone every tick — and the park path
   * would never persist `attempts`, so `MAX_ATTEMPTS` is never reached and the retry
   * loop is unbounded. Re-writing `done` over `done` is harmless by comparison, and the
   * predicate would also change the `recomputed` count. The unguarded terminal settle is
   * RECORDED as a finding, not fixed here.
   *
   * NOT race-free on the retry branch either, and the docblock says so rather than
   * overclaiming: the guard closes the recorded defect (a settled row resurrected), not
   * ABA. A row reclaimed to `pending` and then re-claimed by a second drain is
   * `processing` again, so the predicate matches the WRONG claim — and a row still
   * sitting at `pending` after that reclaim loses this attempt's `attempts` bump, which
   * is `PF-384`'s territory (§7 — record, do not touch). Closing either needs the claim
   * instant compared as well as the status, which is out of scope for this slice.
   */
  private async settleTrigger(
    trigger: { id: string; tenantId: string; coalesceKey: string },
    status: 'done' | 'failed' | 'pending',
    extra: { attempts?: number; lastError?: string | null } = {},
  ): Promise<void> {
    if (status === 'pending') {
      await this.requeueCanonical(trigger, 'processing', extra);
      return;
    }
    const { id, tenantId, coalesceKey } = trigger;
    await this.prisma.snapshotRecomputeTrigger.updateMany({
      where: { id, tenantId },
      data: {
        ...extra,
        status,
        coalesceKey: terminalCoalesceKey(coalesceKey, id),
        processedAt: new Date(),
      },
    });
  }

  /**
   * PF-24 — put a row back into the `pending` coalescing slot under its CANONICAL
   * key (stripping a terminal suffix if it carried one). Returns `true` when the row
   * is now pending.
   *
   * The canonical key is exactly the one the API enqueue upserts on, so the restore
   * can collide with a live pending row for the same `(tenant, reason, scope)`. That
   * collision is not an error: the surviving pending row IS this row's work — it
   * recomputes the same scope on a later tick. The redundant row is dropped (the
   * trigger table is transient bookkeeping, not a domain aggregate — no audit
   * concern, ADR-019 §Non-goals) rather than left wedged in a non-terminal status
   * forever, which is the failure this whole finding is about.
   *
   * PF-382 — `expectedStatus` is the status the CALLER read this row at, and it is
   * carried in the `where` of both writes. Each of the three call sites had that
   * predicate before the per-row rewrite dropped it: the stale reclaim read
   * `'processing'`, the parked revive read `'failed'`, and `settleTrigger`'s retry path
   * settles a row this tick claimed, so it too is `'processing'`. Without it, a row
   * that reached a terminal state between its caller's `findMany` and this write is
   * resurrected to `pending` — spurious work, and a `FreshnessChip` announcing a
   * recompute that is not happening. It also guards the DELETE below, which would
   * otherwise be the last write here able to remove a row that has since become the
   * live `pending` row holding the canonical slot.
   */
  private async requeueCanonical(
    trigger: { id: string; tenantId: string; coalesceKey: string },
    expectedStatus: 'processing' | 'failed',
    extra: { attempts?: number; lastError?: string | null } = {},
  ): Promise<boolean> {
    const { id, tenantId } = trigger;
    try {
      const updated = await this.prisma.snapshotRecomputeTrigger.updateMany({
        where: { id, tenantId, status: expectedStatus },
        data: {
          ...extra,
          status: 'pending',
          coalesceKey: canonicalCoalesceKey(trigger.coalesceKey),
          processedAt: new Date(),
        },
      });
      return updated.count > 0;
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
      await this.prisma.snapshotRecomputeTrigger.deleteMany({
        where: { id, tenantId, status: expectedStatus },
      });
      // PF-382 — `warn`, not `debug`: `debug` is suppressed in production, so work
      // being discarded (however correctly) had ZERO signal on the surface an operator
      // actually reads.
      this.logger.warn(
        `Trigger ${id} (tenant=${tenantId}) dropped as redundant — a pending row already covers its scope`,
      );
      return false;
    }
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
