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
