import { snapshotCoalesceKey } from '@pilotage/contracts';

import { SnapshotDrainCronService } from './snapshot-drain-cron.service';

/**
 * `PF-24` / `S-E03-6` — the MECHANISM evidence for the snapshot drain's status
 * machine, as opposed to the string algebra on the two key helpers.
 *
 * ## Why this file exists as a separate suite
 *
 * The helper tests pin the *derivation* (`terminalCoalesceKey` /
 * `canonicalCoalesceKey` round-trip) and pin nothing about the *defect*: they would
 * stay green through a full re-introduction of `PF-24`, because the defect is not in
 * the formula — it is in which rows the formula is applied to, against a database
 * constraint. So the fake below **enforces `@@unique([tenantId, coalesceKey,
 * status])` for real** and throws a Prisma-shaped `P2002`. A fake that does not bite
 * proves nothing here, which is why `it('the fake enforces the unique …')` is the
 * first test in the file: it is the positive control for every assertion after it.
 *
 * ## The four transitions under test
 *
 * `coalesceKey` is a pure function of `(tenant, reason, scope)`, so the unique — the
 * thing that makes the *pending* slot coalescing — also constrained every OTHER
 * status. Four writes had to become collision-safe:
 *
 *   0. the success write `→ 'done'`;
 *   a. the CLAIM `pending → processing`;
 *   b. `reclaimStaleProcessing` (`processing → pending`);
 *   c. `reviveFailedTriggers` (`failed → pending`).
 *
 * (a), (b) and (c) share a second failure mode beyond the collision itself: each one
 * used to be a single statement covering many rows, or sat outside a `try`, so ONE
 * conflicting row took down the whole pass. Every test below therefore asserts the
 * NON-conflicting work still completes — a pass that merely stops throwing while
 * silently dropping its batch would satisfy a weaker assertion.
 */

type Status = 'pending' | 'processing' | 'done' | 'failed';

interface Row {
  id: string;
  tenantId: string;
  coalesceKey: string;
  status: Status;
  reason: string;
  classSectionId: string | null;
  subjectId: string | null;
  academicYearId: string | null;
  attempts: number;
  lastError: string | null;
  enqueuedAt: Date;
  processedAt: Date | null;
}

const TENANT = 't1';

const keyFor = (classSectionId: string, reason = 'grade_published'): string =>
  snapshotCoalesceKey(TENANT, reason, {
    classSectionId,
    subjectId: 'maths',
    academicYearId: 'y1',
    termId: null,
    studentId: null,
  });

function row(over: Partial<Row> & Pick<Row, 'id' | 'coalesceKey' | 'status'>): Row {
  return {
    tenantId: TENANT,
    reason: 'grade_published',
    classSectionId: 'cA',
    subjectId: 'maths',
    academicYearId: 'y1',
    attempts: 0,
    lastError: null,
    enqueuedAt: new Date('2026-08-26T10:00:00Z'),
    processedAt: null,
    ...over,
  };
}

class UniqueViolation extends Error {
  readonly code = 'P2002';
  constructor() {
    super('Unique constraint failed on the fields: (`tenantId`,`coalesceKey`,`status`)');
  }
}

/**
 * An in-memory `snapshot_recompute_trigger` that enforces the real unique index.
 * Only the operations the drain actually issues are implemented; anything else is
 * deliberately absent so a future call site cannot pass unnoticed.
 */
function makeTable(seed: Row[]) {
  const rows = seed.map((r) => ({ ...r }));

  /** The constraint itself — the reason this suite exists. */
  const assertUnique = (candidate: Row): void => {
    const clash = rows.some(
      (r) =>
        r.id !== candidate.id &&
        r.tenantId === candidate.tenantId &&
        r.coalesceKey === candidate.coalesceKey &&
        r.status === candidate.status,
    );
    if (clash) throw new UniqueViolation();
  };

  const matches = (r: Row, where: Record<string, unknown>): boolean =>
    Object.entries(where).every(([field, want]) => {
      if (field === 'OR') {
        return (want as Record<string, unknown>[]).some((w) => matches(r, w));
      }
      const have = (r as unknown as Record<string, unknown>)[field];
      if (want !== null && typeof want === 'object' && !(want instanceof Date)) {
        const w = want as { lt?: Date; in?: unknown[] };
        if (w.lt !== undefined) return have instanceof Date && have < w.lt;
        if (w.in !== undefined) return w.in.includes(have);
        return false;
      }
      return have === want;
    });

  const snapshotRecomputeTrigger = {
    findMany: jest.fn(
      async (args: { where?: Record<string, unknown>; take?: number; distinct?: string[] }) => {
        let out = rows.filter((r) => matches(r, args.where ?? {}));
        if (args.distinct?.includes('tenantId')) {
          const seen = new Set<string>();
          out = out.filter((r) => (seen.has(r.tenantId) ? false : (seen.add(r.tenantId), true)));
        }
        if (args.take !== undefined) out = out.slice(0, args.take);
        return out.map((r) => ({ ...r }));
      },
    ),
    findFirst: jest.fn(async (args: { where?: Record<string, unknown> }) => {
      const hit = rows.find((r) => matches(r, args.where ?? {}));
      return hit ? { ...hit } : null;
    }),
    updateMany: jest.fn(
      async (args: { where: Record<string, unknown>; data: Partial<Row> }) => {
        const targets = rows.filter((r) => matches(r, args.where));
        // Prisma's updateMany is ONE statement: it applies to every matched row or
        // to none. Validating all candidates before mutating any reproduces that,
        // which is what makes the "one bad row aborts the sweep" assertions real.
        const next = targets.map((r) => ({ ...r, ...args.data }));
        next.forEach(assertUnique);
        targets.forEach((r, i) => Object.assign(r, next[i]));
        return { count: targets.length };
      },
    ),
    deleteMany: jest.fn(async (args: { where: Record<string, unknown> }) => {
      const doomed = rows.filter((r) => matches(r, args.where));
      for (const r of doomed) rows.splice(rows.indexOf(r), 1);
      return { count: doomed.length };
    }),
    count: jest.fn(async () => 0),
  };

  return {
    prisma: { snapshotRecomputeTrigger },
    rows,
    byId: (id: string): Row | undefined => rows.find((r) => r.id === id),
  };
}

const drain = (prisma: unknown, recomputeScope = jest.fn().mockResolvedValue({})) => ({
  service: new SnapshotDrainCronService(prisma as never, { recomputeScope } as never),
  recomputeScope,
});

const drainTenant = (service: SnapshotDrainCronService, tenantId = TENANT) =>
  (service as unknown as { drainTenant(t: string): Promise<unknown> }).drainTenant(tenantId);

/* -------------------------------------------------------------------------- *
 * `S-E03-10b` — extensions of the SAME harness for the retention sweep, the
 * `expectedStatus` guard and the `lastError` clear. No second fake is invented:
 * everything below drives `makeTable` above, so the unique constraint keeps biting
 * and the positive control at the top of the suite keeps covering these tests too.
 * -------------------------------------------------------------------------- */

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (n: number): Date => new Date(Date.now() - n * DAY_MS);

type Table = ReturnType<typeof makeTable>;

const sweepTerminal = (service: SnapshotDrainCronService): Promise<number> =>
  (service as unknown as { sweepTerminalTriggers(): Promise<number> }).sweepTerminalTriggers();

const reclaimStale = (service: SnapshotDrainCronService): Promise<void> =>
  (service as unknown as { reclaimStaleProcessing(): Promise<void> }).reclaimStaleProcessing();

const reviveFailed = (service: SnapshotDrainCronService): Promise<number> =>
  (service as unknown as { reviveFailedTriggers(): Promise<number> }).reviveFailedTriggers();

/**
 * `PF-382` — the race cannot be produced by seeding alone: every sweep re-reads the
 * row it is about to write, so a row seeded in the "after" state is simply never
 * selected and the test would be green for the wrong reason. This hook mutates the
 * LIVE row *after* `findMany` has handed the caller its (pre-flip) copy — exactly the
 * window between the select and the per-row write — and reports whether it fired, so
 * a test that stops reproducing the race fails instead of passing vacuously.
 */
function flipAfterFindMany(t: Table, id: string, status: Status): () => boolean {
  const inner = t.prisma.snapshotRecomputeTrigger.findMany;
  let fired = false;
  const wrapped = async (args: Parameters<typeof inner>[0]) => {
    const out = await inner(args);
    if (!fired && out.some((r) => r.id === id)) {
      const live = t.byId(id);
      if (live) {
        live.status = status;
        fired = true;
      }
    }
    return out;
  };
  (t.prisma.snapshotRecomputeTrigger as unknown as { findMany: unknown }).findMany =
    jest.fn(wrapped);
  return () => fired;
}

/**
 * The sweep's knobs are module-level constants (the convention every other knob in
 * that file follows), so a test that wants a non-default TTL or take must re-require
 * the module with the env set. `jest.isolateModules` gives it its own registry, so the
 * suite's top-level import is untouched.
 */
function sweepWithEnv(
  env: Record<string, string>,
  prisma: unknown,
): (recomputeScope?: jest.Mock) => Promise<number> {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k] as string;
  }
  let Ctor: typeof SnapshotDrainCronService | undefined;
  jest.isolateModules(() => {
    Ctor = jest.requireActual<typeof import('./snapshot-drain-cron.service')>(
      './snapshot-drain-cron.service',
    ).SnapshotDrainCronService;
  });
  for (const k of Object.keys(env)) {
    const prev = saved[k];
    if (prev === undefined) delete process.env[k];
    else process.env[k] = prev;
  }
  if (!Ctor) throw new Error('isolateModules did not yield SnapshotDrainCronService');
  const Loaded = Ctor;
  return (recomputeScope = jest.fn().mockResolvedValue({})) =>
    sweepTerminal(new Loaded(prisma as never, { recomputeScope } as never));
}

/**
 * `PF-460` — the same `jest.isolateModules` re-require as `sweepWithEnv`, but it hands
 * back the SERVICE instead of a bound sweep call.
 *
 * Why a second helper rather than a parameter: every assertion above calls
 * `sweepTerminalTriggers()` directly, so all of them stay green if the ONE line in
 * `tick()` that invokes the sweep is deleted, moved after the unwrapped
 * `tenantsWithPending()`, or has its cadence gate inverted. `sweepWithEnv` is
 * structurally blind to the wiring; only driving `tick()` can see it.
 */
function serviceWithEnv(env: Record<string, string>, prisma: unknown): SnapshotDrainCronService {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    process.env[k] = env[k] as string;
  }
  let Ctor: typeof SnapshotDrainCronService | undefined;
  jest.isolateModules(() => {
    Ctor = jest.requireActual<typeof import('./snapshot-drain-cron.service')>(
      './snapshot-drain-cron.service',
    ).SnapshotDrainCronService;
  });
  for (const k of Object.keys(env)) {
    const prev = saved[k];
    if (prev === undefined) delete process.env[k];
    else process.env[k] = prev;
  }
  if (!Ctor) throw new Error('isolateModules did not yield SnapshotDrainCronService');
  return new Ctor(prisma as never, {
    recomputeScope: jest.fn().mockResolvedValue({}),
  } as never);
}

describe('PF-24 — the snapshot trigger status machine is conflict-safe (mechanism)', () => {
  it('the fake enforces the unique — POSITIVE CONTROL for every test below', async () => {
    const t = makeTable([
      row({ id: 'a', coalesceKey: keyFor('cA'), status: 'done' }),
      row({ id: 'b', coalesceKey: keyFor('cA'), status: 'pending' }),
    ]);
    // Moving `b` onto the status `a` already occupies, under the same key, must throw
    // exactly as Postgres would. If this test ever passes silently, every assertion
    // in this file is vacuous.
    await expect(
      t.prisma.snapshotRecomputeTrigger.updateMany({
        where: { id: 'b' },
        data: { status: 'done' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  // ---- AC-1: the finding itself ------------------------------------------

  it('AC-1 — TWO successive recomputes of the SAME scope both reach `done`', async () => {
    const key = keyFor('cA');
    const t = makeTable([row({ id: 'first', coalesceKey: key, status: 'pending' })]);
    const { service } = drain(t.prisma);

    await drainTenant(service);
    expect(t.byId('first')!.status).toBe('done');

    // A second dirty for the SAME scope: the API enqueue folds onto the free pending
    // slot (the first row no longer occupies it), and the drain settles it too.
    t.rows.push(row({ id: 'second', coalesceKey: key, status: 'pending' }));
    await drainTenant(service);

    expect(t.byId('second')!.status).toBe('done');
    // This is the whole finding: before the fix the second row could not leave
    // `processing`, and `computeSnapshotFreshness` derives `recomputing` from
    // `status IN ('pending','processing')` — so it pinned true forever.
    expect(t.rows.filter((r) => r.status === 'processing')).toHaveLength(0);
  });

  it('AC-1b — a LEGACY `done` row still holding the canonical key does not wedge the next recompute', async () => {
    // No migration rewrites rows written before this fix, so the upgrade path has to
    // work against a table that already contains a canonical-keyed terminal row.
    const key = keyFor('cA');
    const t = makeTable([
      row({ id: 'legacy', coalesceKey: key, status: 'done' }),
      row({ id: 'next', coalesceKey: key, status: 'pending' }),
    ]);
    const { service } = drain(t.prisma);

    await drainTenant(service);

    expect(t.byId('next')!.status).toBe('done');
    expect(t.byId('legacy')!.status).toBe('done');
  });

  // ---- AC-2: one conflicting row never takes down a pass ------------------

  it('AC-2a — a CLAIM that collides with a live `processing` row skips that trigger and still drains the rest of the tenant batch', async () => {
    const t = makeTable([
      // `cA` is mid-recompute; a dirty arrived meanwhile, so a pending row for the
      // same scope exists. Claiming it would put two rows in `processing` under one
      // key — the collision. It used to escape `drainTenant` entirely.
      row({ id: 'inflight', coalesceKey: keyFor('cA'), status: 'processing' }),
      row({ id: 'blocked', coalesceKey: keyFor('cA'), status: 'pending' }),
      row({ id: 'other', coalesceKey: keyFor('cB'), classSectionId: 'cB', status: 'pending' }),
    ]);
    const { service, recomputeScope } = drain(t.prisma);

    await expect(drainTenant(service)).resolves.toBeDefined();

    expect(t.byId('blocked')!.status).toBe('pending'); // skipped, not lost
    expect(t.byId('other')!.status).toBe('done'); // the batch was NOT abandoned
    expect(recomputeScope).toHaveBeenCalledTimes(1);
  });

  it('AC-2b — `reclaimStaleProcessing` reclaims every non-conflicting row when one row conflicts', async () => {
    const old = new Date(Date.now() - 60 * 60 * 1000);
    const t = makeTable([
      // Its scope already has a live pending row, so the restore collides.
      row({ id: 'stuck', coalesceKey: keyFor('cA'), status: 'processing', processedAt: old }),
      row({ id: 'live', coalesceKey: keyFor('cA'), status: 'pending' }),
      // Nothing holds this scope; it must come back regardless of the row above.
      row({
        id: 'clean',
        coalesceKey: keyFor('cB'),
        classSectionId: 'cB',
        status: 'processing',
        processedAt: old,
      }),
    ]);
    const { service } = drain(t.prisma);

    await (
      service as unknown as { reclaimStaleProcessing(): Promise<void> }
    ).reclaimStaleProcessing();

    expect(t.byId('clean')!.status).toBe('pending');
    expect(t.byId('live')!.status).toBe('pending');
    // The redundant row is dropped rather than left wedged in `processing` forever —
    // the surviving pending row IS its work.
    expect(t.byId('stuck')).toBeUndefined();
  });

  it('AC-2c — `reviveFailedTriggers` revives every non-conflicting row when one row conflicts', async () => {
    const old = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const t = makeTable([
      row({
        id: 'parked-blocked',
        coalesceKey: `${keyFor('cA')}#terminal:parked-blocked`,
        status: 'failed',
        processedAt: old,
        attempts: 5,
      }),
      row({ id: 'live', coalesceKey: keyFor('cA'), status: 'pending' }),
      row({
        id: 'parked-clean',
        coalesceKey: `${keyFor('cB')}#terminal:parked-clean`,
        classSectionId: 'cB',
        status: 'failed',
        processedAt: old,
        attempts: 5,
      }),
    ]);
    const { service } = drain(t.prisma);

    const revived = await (
      service as unknown as { reviveFailedTriggers(): Promise<number> }
    ).reviveFailedTriggers();

    expect(revived).toBe(1);
    expect(t.byId('parked-clean')!.status).toBe('pending');
    expect(t.byId('parked-clean')!.attempts).toBe(0);
    // AC-3 — and it comes back under the CANONICAL key, so the next dirty for that
    // scope folds onto this row instead of growing a second pending row.
    expect(t.byId('parked-clean')!.coalesceKey).toBe(keyFor('cB'));
    expect(t.byId('parked-blocked')).toBeUndefined();
  });

  // ---- The failure path, which had the defect from both sides -------------

  it('a recompute failure parks without collision, and the failure of one scope does not abort the batch', async () => {
    const t = makeTable([
      row({ id: 'boom', coalesceKey: keyFor('cA'), status: 'failed', attempts: 4 }),
      row({ id: 'retry', coalesceKey: keyFor('cA'), status: 'pending', attempts: 4 }),
      row({ id: 'other', coalesceKey: keyFor('cB'), classSectionId: 'cB', status: 'pending' }),
    ]);
    const recomputeScope = jest
      .fn()
      .mockImplementation(async (trigger: { id: string }) => {
        if (trigger.id === 'retry') throw new Error('recompute exploded');
        return {};
      });
    const { service } = drain(t.prisma, recomputeScope);

    await drainTenant(service);

    // `retry` is on its fifth attempt, so it parks — against a scope that ALREADY
    // has a parked row. Both survive because each carries its own terminal key.
    expect(t.byId('retry')!.status).toBe('failed');
    expect(t.byId('boom')!.status).toBe('failed');
    expect(t.byId('retry')!.coalesceKey).not.toBe(t.byId('boom')!.coalesceKey);
    expect(t.byId('other')!.status).toBe('done');
  });
});

/**
 * `PF-380` / `S-E03-10b` — the retention bound the `PF-24` fix removed.
 *
 * Before `S-E03-10`, `@@unique([tenantId, coalesceKey, status])` held terminal rows at
 * one `done` + one `failed` per scope forever: the bug and the ceiling were the SAME
 * mechanism, and removing the bug removed the ceiling. These cases pin the replacement
 * — and, more importantly, pin what it must NEVER delete, because `recomputing` is
 * derived from `status IN ('pending','processing')` in three services and rendered by
 * `FreshnessChip` in all three portals.
 */
describe('PF-380 — terminal-row retention is bounded, tenant-scoped and never touches live work', () => {
  it('(1) deletes a terminal row whose `processedAt` is past the TTL — catches: no sweep at all, the finding itself', async () => {
    const t = makeTable([
      row({ id: 'old-done', coalesceKey: 'k1#terminal:old-done', status: 'done', processedAt: daysAgo(31) }),
      row({
        id: 'old-failed',
        coalesceKey: 'k2#terminal:old-failed',
        status: 'failed',
        attempts: 5,
        processedAt: daysAgo(400),
      }),
    ]);
    const { service } = drain(t.prisma);

    await expect(sweepTerminal(service)).resolves.toBe(2);
    expect(t.rows).toHaveLength(0);
  });

  it('(2) does NOT delete a terminal row inside the TTL — catches: a cutoff computed at or after `now` (e.g. a 0/NaN knob)', async () => {
    const t = makeTable([
      row({ id: 'fresh', coalesceKey: 'k1#terminal:fresh', status: 'done', processedAt: daysAgo(29) }),
      row({ id: 'aged', coalesceKey: 'k2#terminal:aged', status: 'done', processedAt: daysAgo(31) }),
    ]);
    const { service } = drain(t.prisma);

    await expect(sweepTerminal(service)).resolves.toBe(1);
    expect(t.byId('fresh')).toBeDefined();
    expect(t.byId('aged')).toBeUndefined();
  });

  it('(3) NEVER deletes a `pending` or `processing` row, however ancient — catches: a `where` missing the `status` pin (G-TRUTH / DNC-01)', async () => {
    // This is the measurement of the G-TRUTH sentence in `sweepTerminalTriggers`'s
    // docblock. `analytics.service.ts:1473` / `:4480` and
    // `school-performance-drilldown.service.ts:241` all derive `recomputing` from
    // `status IN ('pending','processing')`. Sweeping either status would drop queued
    // work AND flip `FreshnessChip` out of "Recomputing…" mid-recompute — a chip
    // announcing a state change that did not happen, over a stale number.
    const t = makeTable([
      row({ id: 'ancient-pending', coalesceKey: keyFor('cA'), status: 'pending', processedAt: daysAgo(400) }),
      row({
        id: 'ancient-processing',
        coalesceKey: keyFor('cB'),
        classSectionId: 'cB',
        status: 'processing',
        processedAt: daysAgo(400),
      }),
      // Anti-vacuity: the sweep must actually have run and deleted something.
      row({ id: 'control', coalesceKey: 'kc#terminal:control', status: 'done', processedAt: daysAgo(400) }),
    ]);
    const { service } = drain(t.prisma);

    await expect(sweepTerminal(service)).resolves.toBe(1);
    expect(t.byId('ancient-pending')!.status).toBe('pending');
    expect(t.byId('ancient-processing')!.status).toBe('processing');
    expect(t.byId('control')).toBeUndefined();
  });

  it('(4) NEVER deletes a row with `processedAt: null` — catches: a refactor of `lt` into an `OR … null` clause (the shape `reclaimStaleProcessing` uses)', async () => {
    // `processedAt: { lt: cutoff }` already excludes NULL in Postgres (`NULL < x` is
    // NULL, never true) and in the fake above. This pins the guarantee anyway: the
    // sibling sweep two hundred lines away deliberately writes
    // `OR: [{ processedAt: { lt } }, { processedAt: null }]`, and copying that here
    // would delete every never-processed row.
    const t = makeTable([
      row({ id: 'never-processed', coalesceKey: 'k1#terminal:never-processed', status: 'done', processedAt: null }),
      row({ id: 'control', coalesceKey: 'kc#terminal:control', status: 'done', processedAt: daysAgo(400) }),
    ]);
    const { service } = drain(t.prisma);

    await expect(sweepTerminal(service)).resolves.toBe(1);
    expect(t.byId('never-processed')).toBeDefined();
    expect(t.byId('control')).toBeUndefined();
  });

  it('(5) is tenant-scoped: every `deleteMany` names ONE tenant and only ids that belong to it — catches: flattening to a single id-only delete (G-TENANT)', async () => {
    const owner: Record<string, string> = { a1: 't1', a2: 't1', b1: 't2', b2: 't2' };
    const t = makeTable([
      row({ id: 'a1', tenantId: 't1', coalesceKey: 'ka1#terminal:a1', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'a2', tenantId: 't1', coalesceKey: 'ka2#terminal:a2', status: 'failed', processedAt: daysAgo(40) }),
      row({ id: 'b1', tenantId: 't2', coalesceKey: 'kb1#terminal:b1', status: 'done', processedAt: daysAgo(40) }),
      // (8) the discriminating case: a FOREIGN tenant's terminal row that is INSIDE
      // its own TTL must survive a sweep of the other tenant's group.
      row({ id: 'b2', tenantId: 't2', coalesceKey: 'kb2#terminal:b2', status: 'done', processedAt: daysAgo(2) }),
    ]);
    const { service } = drain(t.prisma);

    await expect(sweepTerminal(service)).resolves.toBe(3);
    expect(t.byId('b2')).toBeDefined();

    const calls = t.prisma.snapshotRecomputeTrigger.deleteMany.mock.calls;
    // Anti-vacuity: a sweep that issued no delete would satisfy every assertion below.
    expect(calls.length).toBeGreaterThan(0);
    const tenantsNamed = new Set<string>();
    for (const [args] of calls) {
      const where = args.where as { tenantId?: string; id?: { in?: string[] } };
      expect(typeof where.tenantId).toBe('string');
      tenantsNamed.add(where.tenantId as string);
      for (const id of where.id?.in ?? []) {
        // No call may ever pair tenant A's key with a row owned by tenant B.
        expect(owner[id]).toBe(where.tenantId);
      }
    }
    expect(tenantsNamed.size).toBe(calls.length); // one call per tenant, never a mixed batch
  });

  it('(5b) is bounded by `SNAPSHOT_TERMINAL_SWEEP_TAKE` across tenants — catches: an unbounded delete', async () => {
    const t = makeTable([
      row({ id: 'a1', tenantId: 't1', coalesceKey: 'ka1#terminal:a1', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'a2', tenantId: 't1', coalesceKey: 'ka2#terminal:a2', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'b1', tenantId: 't2', coalesceKey: 'kb1#terminal:b1', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'b2', tenantId: 't2', coalesceKey: 'kb2#terminal:b2', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'b3', tenantId: 't2', coalesceKey: 'kb3#terminal:b3', status: 'done', processedAt: daysAgo(40) }),
    ]);
    const sweep = sweepWithEnv({ SNAPSHOT_TERMINAL_SWEEP_TAKE: '3' }, t.prisma);

    // A COUNT assertion, never a named id: the sweep carries no `orderBy` (deliberately
    // — a top-N sort of the whole terminal population buys nothing), so which of the
    // eligible rows goes first is not a promise.
    await expect(sweep()).resolves.toBe(3);
    expect(t.rows).toHaveLength(2);
  });

  it('(9) a `SNAPSHOT_TERMINAL_RETENTION_DAYS` of 0 falls back to the default instead of deleting rows seconds old — catches: `Number(env ?? 30)` copied verbatim', async () => {
    const t = makeTable([
      row({ id: 'seconds-old', coalesceKey: 'k1#terminal:seconds-old', status: 'done', processedAt: new Date() }),
      row({ id: 'aged', coalesceKey: 'k2#terminal:aged', status: 'done', processedAt: daysAgo(40) }),
    ]);
    const sweep = sweepWithEnv({ SNAPSHOT_TERMINAL_RETENTION_DAYS: '0' }, t.prisma);

    await expect(sweep()).resolves.toBe(1);
    expect(t.byId('seconds-old')).toBeDefined();
    expect(t.byId('aged')).toBeUndefined();
  });

  it('(10) `tick()` REACHES the sweep, on the coarse cadence and not before — catches: the wiring line deleted, sequenced after the unwrapped `tenantsWithPending()`, or firing every tick (PF-460)', async () => {
    const t = makeTable([
      row({ id: 'aged', coalesceKey: 'k1#terminal:aged', status: 'done', processedAt: daysAgo(40) }),
      row({ id: 'live', coalesceKey: keyFor('cLive'), status: 'pending', processedAt: daysAgo(99) }),
    ]);
    const service = serviceWithEnv({ SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS: '2' }, t.prisma);

    // Tick 1 — below the cadence. RED if the sweep is wired to fire every tick.
    await service.tick();
    expect(t.byId('aged')).toBeDefined();

    // Tick 2 — the cadence fires. RED if the wiring line is absent or unreachable.
    await service.tick();
    expect(t.byId('aged')).toBeUndefined();
    // The whole point of the sweep's placement AND of its `status` pin, asserted through
    // the real entry point rather than the private method: an ancient PENDING row is
    // still live work and survives (G-TRUTH / DNC-01).
    expect(t.byId('live')).toBeDefined();
  });

  it('(11) `SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS=0` DISABLES the sweep — catches: `positiveKnob` clamping the off switch back to the default, which is a trap because the sibling `ORPHAN_PRUNE_EVERY_TICKS=0` DOES disable (PF-459)', async () => {
    const seed = (): Row[] => [
      row({ id: 'aged', coalesceKey: 'k1#terminal:aged', status: 'done', processedAt: daysAgo(40) }),
    ];

    const off = makeTable(seed());
    const disabled = serviceWithEnv({ SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS: '0' }, off.prisma);
    // 12 ticks > the default cadence of 10, so a clamp back to the default would show.
    for (let i = 0; i < 12; i += 1) await disabled.tick();
    expect(off.byId('aged')).toBeDefined();

    // ANTI-VACUITY, and it is load-bearing: the identical 12 ticks with the switch UNSET
    // must delete the row. Without this, a `tick()` that never reached the sweep for any
    // unrelated reason would make the assertion above pass for the wrong reason.
    const on = makeTable(seed());
    const enabled = serviceWithEnv({ SNAPSHOT_TERMINAL_SWEEP_EVERY_TICKS: '10' }, on.prisma);
    for (let i = 0; i < 12; i += 1) await enabled.tick();
    expect(on.byId('aged')).toBeUndefined();
  });
});

/**
 * `PF-382` / `PF-383` — the two writes the `PF-24` fix left unguarded.
 */
describe('PF-382/PF-383 — a settled row is not resurrected, and a success clears its error text', () => {
  it('(6a) `reclaimStaleProcessing` does not resurrect a row that settled to `done` under it', async () => {
    const t = makeTable([
      row({ id: 'raced', coalesceKey: keyFor('cA'), status: 'processing', processedAt: daysAgo(1) }),
      row({
        id: 'clean',
        coalesceKey: keyFor('cB'),
        classSectionId: 'cB',
        status: 'processing',
        processedAt: daysAgo(1),
      }),
    ]);
    const fired = flipAfterFindMany(t, 'raced', 'done');
    const { service } = drain(t.prisma);

    await reclaimStale(service);

    expect(fired()).toBe(true); // the race was actually reproduced
    // Without `expectedStatus: 'processing'` in the `where`, this row goes back to
    // `pending` under its canonical key: a spurious recompute, and a `FreshnessChip`
    // announcing "Recomputing…" on a dashboard that is already current.
    expect(t.byId('raced')!.status).toBe('done');
    expect(t.byId('clean')!.status).toBe('pending'); // the rest of the pass still ran
  });

  it('(6b) `reviveFailedTriggers` does not revive a row that settled to `done` under it', async () => {
    const t = makeTable([
      row({
        id: 'parked-raced',
        coalesceKey: `${keyFor('cA')}#terminal:parked-raced`,
        status: 'failed',
        attempts: 5,
        processedAt: daysAgo(1),
      }),
      row({
        id: 'parked-clean',
        coalesceKey: `${keyFor('cB')}#terminal:parked-clean`,
        classSectionId: 'cB',
        status: 'failed',
        attempts: 5,
        processedAt: daysAgo(1),
      }),
    ]);
    const fired = flipAfterFindMany(t, 'parked-raced', 'done');
    const { service } = drain(t.prisma);

    await expect(reviveFailed(service)).resolves.toBe(1);

    expect(fired()).toBe(true);
    expect(t.byId('parked-raced')!.status).toBe('done');
    expect(t.byId('parked-raced')!.attempts).toBe(5); // its counter was not reset either
    expect(t.byId('parked-clean')!.status).toBe('pending');
  });

  it('(6c) `settleTrigger`’s retry path does not resurrect a row another drain already finished', async () => {
    // Third call site, and the one whose expected status had to be READ rather than
    // assumed: `settleTrigger` is only ever reached from `drainTenant`, on a row this
    // tick claimed at the atomic `pending → processing` update, so `'processing'` it is.
    const t = makeTable([row({ id: 'late', coalesceKey: keyFor('cA'), status: 'pending' })]);
    const recomputeScope = jest.fn(async (trigger: { id: string }) => {
      // While we were recomputing, the row was reclaimed and finished by another drain.
      t.byId(trigger.id)!.status = 'done';
      throw new Error('recompute exploded');
    });
    const { service } = drain(t.prisma, recomputeScope);

    await drainTenant(service);

    // Unguarded, the late failure write pulls a finished row back to `pending` AND
    // stamps raw error text onto it.
    expect(t.byId('late')!.status).toBe('done');
    expect(t.byId('late')!.lastError).toBeNull();
  });

  it('(7) `lastError` is null after fail → retry → success (G-AUDIT), and `attempts` is NOT cleared', async () => {
    const t = makeTable([row({ id: 'flaky', coalesceKey: keyFor('cA'), status: 'pending' })]);
    let calls = 0;
    const recomputeScope = jest.fn(async () => {
      calls += 1;
      // Raw Prisma text is what `lastError` stores — it can quote a child's name.
      if (calls === 1) throw new Error('prisma.grade.findMany failed for student Amina Diallo');
      return {};
    });
    const { service } = drain(t.prisma, recomputeScope);

    await drainTenant(service);
    expect(t.byId('flaky')!.status).toBe('pending');
    expect(t.byId('flaky')!.lastError).toContain('Amina Diallo');
    expect(t.byId('flaky')!.attempts).toBe(1);

    await drainTenant(service);

    expect(t.byId('flaky')!.status).toBe('done');
    // The whole of AC-3: the row succeeded, so the error text must not survive on it
    // for the (now merely TTL-bounded) life of a terminal row.
    expect(t.byId('flaky')!.lastError).toBeNull();
    // …but the retry counter is history, not error text, and stays.
    expect(t.byId('flaky')!.attempts).toBe(1);
  });
});
