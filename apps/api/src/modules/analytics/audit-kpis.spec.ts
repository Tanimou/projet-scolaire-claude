import { HttpException } from '@nestjs/common';
import {
  AUDIT_PORTAL_NONE,
  UnknownTimezoneError,
  normalizeYmd,
  resolveAuditWindow,
  zonedDayStartUtc,
  zonedYmd,
} from '@pilotage/contracts';

import { AnalyticsService } from './analytics.service';

/**
 * S-E04-5 — **the KPIs share the table's scope, and `to` includes its own day.**
 *
 * Two claims are under test, and they are the same claim twice:
 *
 *  1. a filter means what it says — `to = 2026-08-08` includes the whole of the
 *     8th **in the tenant's timezone**, and `from = 2026-08-08` starts at Paris
 *     midnight, not UTC midnight;
 *  2. a number states its own scope — the four KPIs are computed over the
 *     table's single `where`, and `eventsInRange.value === total` is structural
 *     (it *is* `total`) rather than asserted about two racing counts.
 *
 * **Why a fake Prisma and not `jest.fn()` returning a constant.** The predicate
 * that shipped before returned `7` from every mocked `count`, so a broken
 * implementation passed: the assertions could not see which rows a `where`
 * actually selected. The fake below evaluates the `where` against a fixture, so
 * « the row at 23:59:59 is included » is a *behaviour*, not a restatement of the
 * code. Every `where` is also recorded verbatim, so the anti-drift invariant
 * (AC-2) is checked on the real objects the service passed.
 *
 * **DNC-08.** Every helper here fails loudly and names what was missing when it
 * cannot obtain what it needs. There is no `it.skip`, no early return, and no
 * "nothing to check" pass anywhere in this file.
 */

const TENANT = 'tenant-audit';
const OTHER_TENANT = 'tenant-foreign';
const ZONE = 'Europe/Paris';

interface FakeRow {
  id: string;
  tenantId: string;
  createdAt: Date;
  actorId: string | null;
  actorRole: string | null;
  portal: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  ipAddress: string | null;
  userAgent: string | null;
  before: unknown;
  after: unknown;
}

/**
 * A fixture row, written the way a reader wants to read it: `createdAt` is an
 * ISO **string** at the call site and a `Date` in the row.
 *
 * `Omit<…, 'createdAt'>` is load-bearing, not decoration. `Partial<FakeRow> &
 * { createdAt: string }` intersects `Date | undefined` with `string`, which is
 * `never` in all but name — the parameter type was uninhabitable, every one of
 * the eight literals below was a TS2322, and this file therefore never compiled
 * (so T1/T1b/T1c/T2/T3/T4/T5/T9 had produced no evidence at all).
 */
function row(
  partial: Omit<Partial<FakeRow>, 'createdAt'> & { id: string; createdAt: string },
): FakeRow {
  return {
    tenantId: TENANT,
    actorId: 'u-1',
    actorRole: 'admin',
    portal: 'admin',
    action: 'role.create',
    resourceType: 'role',
    resourceId: 'r-1',
    ipAddress: null,
    userAgent: null,
    before: null,
    after: null,
    ...partial,
    createdAt: new Date(partial.createdAt),
  };
}

/**
 * The fixture. Every instant is chosen for one reason, stated inline — a fixture
 * whose rows are interchangeable proves nothing about a boundary.
 *
 * Paris is UTC+2 on 2026-08-08 (summer time), so the civil day 2026-08-08 runs
 * from `2026-08-07T22:00:00Z` (inclusive) to `2026-08-08T22:00:00Z` (exclusive).
 */
const FIXTURE: FakeRow[] = [
  // 23:59:59 Paris on the 8th — the row the old `lte: new Date(to)` threw away.
  row({ id: 'r-2359', createdAt: '2026-08-08T21:59:59.000Z', action: 'Suppression' }),
  // 00:00:00 Paris on the 8th — the row the old `gte: new Date(from)` threw away.
  row({ id: 'r-0000', createdAt: '2026-08-07T22:00:00.000Z', action: 'export.bulletin.request' }),
  // 00:00:00 Paris on the 9th — the first row that must be OUT of `to=08`.
  row({ id: 'r-next', createdAt: '2026-08-08T22:00:00.000Z', action: 'role.delete' }),
  // 23:59:59 Paris on the 7th — the last row that must be OUT of `from=08`.
  row({ id: 'r-prev', createdAt: '2026-08-07T21:59:59.000Z', action: 'Export' }),
  // Mid-day rows: a second actor, a legacy critical alias, an unactioned row.
  row({ id: 'r-mid-a', createdAt: '2026-08-08T10:00:00.000Z', actorId: 'u-2', action: 'Mise à jour' }),
  row({ id: 'r-mid-b', createdAt: '2026-08-08T11:00:00.000Z', actorId: 'u-2', action: 'grade.flag' }),
  // A system row: no actor, no portal. It must be counted by `eventsInRange`
  // (it happened) and NOT by `distinctActors` (nobody did it).
  row({
    id: 'r-system',
    createdAt: '2026-08-08T12:00:00.000Z',
    actorId: null,
    actorRole: null,
    portal: null,
    action: 'analytics.snapshot_rebuild',
  }),
  // G-TENANT. Inside the window, critical, exporting, with an actor of its own
  // and no portal — it satisfies every predicate EXCEPT the tenant one.
  row({
    id: 'r-foreign',
    tenantId: OTHER_TENANT,
    createdAt: '2026-08-08T13:00:00.000Z',
    actorId: 'u-foreign',
    portal: null,
    action: 'Suppression',
  }),
];

// --- The fake -------------------------------------------------------------

type Where = Record<string, unknown>;

/** Evaluates the subset of Prisma `where` semantics this service emits. */
function matches(r: FakeRow, where: Where): boolean {
  for (const [key, value] of Object.entries(where)) {
    if (key === 'AND') {
      const clauses = value as Where[];
      if (!clauses.every((clause) => matches(r, clause))) return false;
      continue;
    }
    if (key === 'createdAt') {
      const c = value as { gte?: Date; lt?: Date; lte?: Date };
      if (c.gte && r.createdAt.getTime() < c.gte.getTime()) return false;
      if (c.lt && r.createdAt.getTime() >= c.lt.getTime()) return false;
      if (c.lte && r.createdAt.getTime() > c.lte.getTime()) return false;
      continue;
    }
    const actual = (r as unknown as Record<string, unknown>)[key];
    if (value === null) {
      if (actual !== null) return false;
      continue;
    }
    if (value !== null && typeof value === 'object') {
      const op = value as { in?: unknown[]; not?: unknown; contains?: string; mode?: string };
      if (op.in !== undefined && !op.in.includes(actual)) return false;
      if (op.not !== undefined) {
        if (op.not === null ? actual === null : actual === op.not) return false;
      }
      if (op.contains !== undefined) {
        const hay = String(actual ?? '');
        const needle = op.contains;
        const hit =
          op.mode === 'insensitive'
            ? hay.toLowerCase().includes(needle.toLowerCase())
            : hay.includes(needle);
        if (!hit) return false;
      }
      continue;
    }
    if (actual !== value) return false;
  }
  return true;
}

interface Harness {
  service: AnalyticsService;
  findManyWheres: Where[];
  countWheres: Where[];
  groupByArgs: Array<{ by: string[]; where: Where }>;
  tenantFindUnique: jest.Mock;
}

function makeHarness(
  opts: { rows?: FakeRow[]; timezone?: string | null } = {},
): Harness {
  const rows = opts.rows ?? FIXTURE;
  if (rows.length === 0) {
    // DNC-08: a harness with no fixture cannot check anything, and must say so
    // rather than let every assertion below pass vacuously.
    throw new Error('audit-kpis.spec: fixture is empty — nothing could be measured.');
  }
  const findManyWheres: Where[] = [];
  const countWheres: Where[] = [];
  const groupByArgs: Array<{ by: string[]; where: Where }> = [];
  const timezone = opts.timezone === undefined ? ZONE : opts.timezone;
  const tenantFindUnique = jest
    .fn()
    .mockResolvedValue(timezone === null ? null : { timezone });

  const prisma = {
    tenant: { findUnique: tenantFindUnique },
    userProfile: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'u-1', firstName: 'Ada', lastName: 'Lovelace' },
        { id: 'u-2', firstName: 'Alan', lastName: 'Turing' },
      ]),
    },
    auditLog: {
      findMany: jest.fn(
        async (args: { where: Where; take?: number; skip?: number; distinct?: string[] }) => {
          findManyWheres.push(args.where);
          let selected = rows.filter((r) => matches(r, args.where));
          selected = [...selected].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
          if (args.distinct) {
            const fields = args.distinct;
            const seen = new Set<unknown>();
            selected = selected.filter((r) => {
              const bag = r as unknown as Record<string, unknown>;
              const key = fields.map((f) => String(bag[f])).join('|');
              if (seen.has(key)) return false;
              seen.add(key);
              return true;
            });
          }
          const skip = args.skip ?? 0;
          return selected.slice(skip, args.take === undefined ? undefined : skip + args.take);
        },
      ),
      count: jest.fn(async (args: { where: Where }) => {
        countWheres.push(args.where);
        return rows.filter((r) => matches(r, args.where)).length;
      }),
      groupBy: jest.fn(async (args: { by: string[]; where: Where }) => {
        groupByArgs.push(args);
        const selected = rows.filter((r) => matches(r, args.where));
        const keys = new Set(selected.map((r) => r.actorId));
        return [...keys].map((actorId) => ({ actorId }));
      }),
    },
  };

  const service = new AnalyticsService(prisma as never, {} as never, {} as never);
  return { service, findManyWheres, countWheres, groupByArgs, tenantFindUnique };
}

/** The `where` the table used — the reference every KPI must agree with. */
function tableWhere(h: Harness): Where {
  const hit = h.findManyWheres[0];
  if (!hit) throw new Error('audit-kpis.spec: auditList issued no auditLog.findMany.');
  return hit;
}

function ids(data: ReadonlyArray<{ id: string }>): string[] {
  return data.map((d) => d.id).sort();
}

/* ================================================================== *
 * AC-1 — the window is the tenant's day, at both ends
 * ================================================================== */

describe('AC-1 — `to` includes its own day, `from` starts at the tenant’s midnight', () => {
  it('to = 2026-08-08 keeps the row at 23:59:59 Paris and drops the one at 00:00:00 the next day', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ tenantId: TENANT, to: '2026-08-08', take: 50, skip: 0 });
    const got = ids(res.data);
    expect(got).toContain('r-2359');
    expect(got).not.toContain('r-next');
    // Exclusive upper bound, no chosen precision. `lte: 23:59:59.999` would have
    // to pick one, and Postgres stores microseconds.
    const createdAt = tableWhere(h).createdAt as { gte?: Date; lt?: Date; lte?: Date };
    expect(createdAt.lt?.toISOString()).toBe('2026-08-08T22:00:00.000Z');
    expect(createdAt.lte).toBeUndefined();
  });

  it('NEGATIVE CONTROL — restoring `lte: new Date(to)` drops that exact row', () => {
    // The falsification AC-1 asks for, executed rather than described: the old
    // bound is applied to the same fixture and is shown to lose `r-2359`.
    const legacyBound = { createdAt: { lte: new Date('2026-08-08') }, tenantId: TENANT };
    const kept = FIXTURE.filter((r) => matches(r, legacyBound)).map((r) => r.id);
    expect(kept).not.toContain('r-2359');
    // …while the shipped bound keeps it. Both halves, or the control proves
    // only that some filter excludes some row.
    const window = resolveAuditWindow(null, '2026-08-08', ZONE);
    const kept2 = FIXTURE.filter((r) =>
      matches(r, { tenantId: TENANT, createdAt: { lt: window.lt! } }),
    ).map((r) => r.id);
    expect(kept2).toContain('r-2359');
  });

  it('MIRROR — from = 2026-08-08 keeps 00:00:00 Paris and drops 23:59:59 the day before', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      from: '2026-08-08',
      take: 50,
      skip: 0,
    });
    const got = ids(res.data);
    expect(got).toContain('r-0000');
    expect(got).not.toContain('r-prev');
    const createdAt = tableWhere(h).createdAt as { gte?: Date };
    expect(createdAt.gte?.toISOString()).toBe('2026-08-07T22:00:00.000Z');
  });

  it('NEGATIVE CONTROL — restoring `gte: new Date(from)` (UTC midnight) drops the 00:30 Paris row', () => {
    const legacyBound = { tenantId: TENANT, createdAt: { gte: new Date('2026-08-08') } };
    expect(FIXTURE.filter((r) => matches(r, legacyBound)).map((r) => r.id)).not.toContain('r-0000');
  });

  it('a single-day filter (from = to) is a full 24 h, not an empty range', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      from: '2026-08-08',
      to: '2026-08-08',
      take: 50,
      skip: 0,
    });
    expect(ids(res.data)).toEqual(['r-0000', 'r-2359', 'r-mid-a', 'r-mid-b', 'r-system']);
  });
});

/* ================================================================== *
 * The window helper itself — DST, malformed input, unknown zones
 * ================================================================== */

describe('resolveAuditWindow — civil days, not 86 400 000 ms', () => {
  it('the short day: 2026-03-29 in Paris is 23 h, and the bound follows the civil date', () => {
    const w = resolveAuditWindow('2026-03-29', '2026-03-29', ZONE);
    // 29 March 2026: 02:00 local jumps to 03:00. The day starts at 23:00Z on the
    // 28th (UTC+1) and ends at 22:00Z on the 29th (UTC+2) — 23 hours.
    expect(w.gte!.toISOString()).toBe('2026-03-28T23:00:00.000Z');
    expect(w.lt!.toISOString()).toBe('2026-03-29T22:00:00.000Z');
    expect(w.lt!.getTime() - w.gte!.getTime()).toBe(23 * 3_600_000);
  });

  it('the long day: 2026-10-25 in Paris is 25 h', () => {
    const w = resolveAuditWindow('2026-10-25', '2026-10-25', ZONE);
    expect(w.gte!.toISOString()).toBe('2026-10-24T22:00:00.000Z');
    expect(w.lt!.toISOString()).toBe('2026-10-25T23:00:00.000Z');
    expect(w.lt!.getTime() - w.gte!.getTime()).toBe(25 * 3_600_000);
  });

  it('a month boundary rolls the civil date, it does not add a day of milliseconds', () => {
    expect(resolveAuditWindow(null, '2026-01-31', ZONE).lt!.toISOString()).toBe(
      '2026-01-31T23:00:00.000Z',
    );
    expect(resolveAuditWindow(null, '2026-12-31', ZONE).lt!.toISOString()).toBe(
      '2026-12-31T23:00:00.000Z',
    );
    // 2028 is a leap year: 29 February exists and the next day is 1 March.
    expect(resolveAuditWindow(null, '2028-02-29', ZONE).lt!.toISOString()).toBe(
      '2028-02-29T23:00:00.000Z',
    );
  });

  it('a malformed or impossible date is treated as ABSENT, and the echo says so', () => {
    for (const bad of ['garbage', '2026-13-01', '2026-02-30', '08/08/2026', '', '2026-8-8']) {
      const w = resolveAuditWindow(bad, bad, ZONE);
      expect({ bad, gte: w.gte, lt: w.lt, fromDay: w.fromDay, toDay: w.toDay }).toEqual({
        bad,
        gte: null,
        lt: null,
        fromDay: null,
        toDay: null,
      });
    }
    expect(normalizeYmd('2026-02-29')).toBeNull(); // 2026 is not a leap year
    expect(normalizeYmd('2026-08-08T14:00:00Z')).toBe('2026-08-08');
  });

  it('an unknown zone THROWS — there is no silent fallback anywhere in the helper', () => {
    expect(() => resolveAuditWindow('2026-08-08', '2026-08-08', 'Mars/Olympus_Mons')).toThrow(
      UnknownTimezoneError,
    );
    expect(() => zonedDayStartUtc('2026-08-08', '')).toThrow(UnknownTimezoneError);
    try {
      resolveAuditWindow(null, null, 'Nowhere/Nothing');
      throw new Error('expected UnknownTimezoneError');
    } catch (err) {
      expect(err).toBeInstanceOf(UnknownTimezoneError);
      expect((err as UnknownTimezoneError).timezone).toBe('Nowhere/Nothing');
    }
  });

  it('DNC-08 — full ICU is PRESENT in this runtime, asserted rather than assumed', () => {
    // On a small-ICU build `timeZone: 'Europe/Paris'` degrades to UTC silently
    // and every boundary above would be off by one or two hours with no error.
    expect(new Intl.DateTimeFormat('fr', { timeZone: ZONE }).resolvedOptions().timeZone).toBe(ZONE);
    expect(zonedYmd(new Date('2026-08-08T22:30:00Z'), ZONE)).toBe('2026-08-09');
    expect(zonedYmd(new Date('2026-08-08T22:30:00Z'), 'UTC')).toBe('2026-08-08');
  });
});

/* ================================================================== *
 * AC-2 / AC-5 — one `where`, four KPIs, and an invariant by construction
 * ================================================================== */

describe('AC-2 — the four KPIs are computed over the table’s own `where`', () => {
  const FILTER = {
    tenantId: TENANT,
    from: '2026-08-08',
    to: '2026-08-08',
    portal: 'admin',
    take: 50,
    skip: 0,
  } as const;

  it('every KPI query is the table `where` plus EXACTLY ONE extra predicate', async () => {
    const h = makeHarness();
    await h.service.auditList({ ...FILTER });
    const base = tableWhere(h);

    const kpiWheres = [
      ...h.countWheres.filter((w) => 'AND' in w),
      ...h.groupByArgs.map((g) => g.where),
    ];
    expect(kpiWheres).toHaveLength(3); // criticalChanges, sensitiveExports, distinctActors
    for (const where of kpiWheres) {
      const { AND, ...rest } = where as { AND: unknown[] };
      expect(rest).toEqual(base);
      expect(AND).toHaveLength(1);
    }
    // The table's own count carries the bare `where` — no fifth KPI query hides
    // behind it (P0-3: `eventsInRange` is `total`, not a second count).
    expect(h.countWheres.filter((w) => !('AND' in w))).toHaveLength(1);
  });

  it('FALSIFIABILITY — giving a KPI `{ tenantId }` again changes its value on this fixture', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ ...FILTER });
    const allTimeCritical = FIXTURE.filter(
      (r) => r.tenantId === TENANT && ['Suppression', 'Mise à jour', 'role.delete'].includes(r.action),
    ).length;
    // The old shape counted 3 (`r-2359`, `r-mid-a`, `r-next`); the filtered one
    // counts 2 — `r-next` is the 9th and `portal: 'admin'` is honoured. If the
    // two were equal this test would be decorative, so the difference is pinned.
    expect(allTimeCritical).toBe(3);
    expect(res.kpis.criticalChanges.value).toBe(2);
    expect(res.kpis.criticalChanges.value).not.toBe(allTimeCritical);
  });

  it('the user’s own `action` filter is NOT overwritten by a KPI predicate', async () => {
    const h = makeHarness();
    await h.service.auditList({ tenantId: TENANT, action: 'export', take: 50, skip: 0 });
    for (const where of h.countWheres) {
      expect((where as { action?: unknown }).action).toEqual({
        contains: 'export',
        mode: 'insensitive',
      });
    }
  });

  it('eventsInRange.value === total, and no fifth count is issued to produce it', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ ...FILTER });
    expect(res.kpis.eventsInRange.value).toBe(res.total);
    // 1 table count + 2 KPI counts. A third KPI count would mean `eventsInRange`
    // is a second snapshot of an append-only table, and the invariant would be
    // true in this mock and intermittently false in production.
    expect(h.countWheres).toHaveLength(3);
  });

  it('P0-3 — the invariant survives a `count` that returns a DIFFERENT value each call', async () => {
    let n = 0;
    const prisma = {
      tenant: { findUnique: jest.fn().mockResolvedValue({ timezone: ZONE }) },
      userProfile: { findMany: jest.fn().mockResolvedValue([]) },
      auditLog: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn(async () => ++n),
        groupBy: jest.fn().mockResolvedValue([]),
      },
    };
    const service = new AnalyticsService(prisma as never, {} as never, {} as never);
    const res = await service.auditList({ tenantId: TENANT, take: 10, skip: 0 });
    // A constant mock (the previous fixture returned `7` from every call) would
    // pass even if `eventsInRange` were a separate query. This one cannot.
    expect(res.kpis.eventsInRange.value).toBe(res.total);
  });

  it('AC-5 — the same request twice is deep-equal, and matches the table when the page holds it all', async () => {
    const h = makeHarness();
    const first = await h.service.auditList({ ...FILTER });
    const second = await h.service.auditList({ ...FILTER });
    expect(second).toEqual(first);
    expect(first.kpis.eventsInRange.value).toBe(first.total);
    expect(first.total).toBe(first.data.length);
  });
});

/* ================================================================== *
 * AC-3 / AC-4 — every KPI states its scope; no impossible card survives
 * ================================================================== */

describe('AC-3 / AC-4 — scope travels with the number, and `adminLogins` is gone', () => {
  it('all four KPIs carry `{ value, scope, label }` with a server-supplied French label', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ tenantId: TENANT, take: 50, skip: 0 });
    expect(Object.keys(res.kpis).sort()).toEqual([
      'criticalChanges',
      'distinctActors',
      'eventsInRange',
      'sensitiveExports',
    ]);
    for (const [key, kpi] of Object.entries(res.kpis)) {
      expect({ key, scope: kpi.scope }).toEqual({ key, scope: 'filtered' });
      expect(typeof kpi.value).toBe('number');
      expect(kpi.label.length).toBeGreaterThan(0);
    }
    expect(res.kpis.eventsInRange.label).toBe('Actions filtrées');
    expect(res.kpis.criticalChanges.label).toBe('Modifications critiques');
    expect(res.kpis.sensitiveExports.label).toBe('Exports sensibles');
    expect(res.kpis.distinctActors.label).toBe('Acteurs distincts');
  });

  it('AC-4 — no `adminLogins`, no `today`: a card that could only read 0 no longer exists', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ tenantId: TENANT, take: 50, skip: 0 });
    expect(res.kpis).not.toHaveProperty('adminLogins');
    expect(res.kpis).not.toHaveProperty('today');
    // …and nothing counted a login: no query carries an empty `in` (DNC-09).
    for (const where of h.countWheres) {
      const clauses = ((where as { AND?: Array<{ action?: { in?: string[] } }> }).AND ?? []).concat();
      for (const clause of clauses) {
        if (clause.action?.in) expect(clause.action.in.length).toBeGreaterThan(0);
      }
    }
  });

  it('`distinctActors` counts actors, not rows, and never counts the actor-less system row', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      from: '2026-08-08',
      to: '2026-08-08',
      take: 50,
      skip: 0,
    });
    // Rows in range: r-0000 (u-1), r-2359 (u-1), r-mid-a (u-2), r-mid-b (u-2),
    // r-system (null). Two actors, five rows.
    expect(res.total).toBe(5);
    expect(res.kpis.distinctActors.value).toBe(2);
    expect(h.groupByArgs[0]!.by).toEqual(['actorId']);
    expect(h.groupByArgs[0]!.where).toHaveProperty('AND', [{ actorId: { not: null } }]);
  });

  it('the KPI vocabulary comes from the declaration, never from an inline array', async () => {
    const h = makeHarness();
    await h.service.auditList({ tenantId: TENANT, take: 50, skip: 0 });
    const criticalIn = (h.countWheres.find(
      (w) => 'AND' in w,
    ) as { AND: Array<{ action: { in: string[] } }> }).AND[0]!.action.in;
    expect(criticalIn).toContain('role.delete'); // canonical
    expect(criticalIn).toContain('Suppression'); // frozen legacy alias
    expect(criticalIn).toContain('coefficient.upsert');
    expect(criticalIn).toContain('grade.unflag');
  });
});

/* ================================================================== *
 * AC-7 — the timezone is resolved, echoed, and never accepted
 * ================================================================== */

describe('AC-7 — the resolved timezone is the tenant’s, and the client cannot supply it', () => {
  it('is read from Tenant.timezone by primary key and echoed in filters.timezone', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ tenantId: TENANT, to: '2026-08-08', take: 5, skip: 0 });
    expect(h.tenantFindUnique).toHaveBeenCalledWith({
      where: { id: TENANT },
      select: { timezone: true },
    });
    expect(res.filters.timezone).toBe(ZONE);
  });

  it('a caller-supplied `timezone` changes neither the echo nor the boundary', async () => {
    const h = makeHarness();
    // Not part of the signature — passed the way a rogue caller (or a future
    // `@Query('timezone')`) would. The service must ignore it entirely.
    const rogue = {
      tenantId: TENANT,
      to: '2026-08-08',
      take: 5,
      skip: 0,
      timezone: 'Pacific/Kiritimati',
    };
    const res = await h.service.auditList(
      rogue as unknown as Parameters<AnalyticsService['auditList']>[0],
    );
    expect(res.filters.timezone).toBe(ZONE);
    expect((tableWhere(h).createdAt as { lt: Date }).lt.toISOString()).toBe(
      '2026-08-08T22:00:00.000Z',
    );
  });

  it('a different tenant zone genuinely moves the boundary', async () => {
    const h = makeHarness({ timezone: 'Pacific/Kiritimati' }); // UTC+14
    const res = await h.service.auditList({
      tenantId: TENANT,
      to: '2026-08-08',
      take: 5,
      skip: 0,
    });
    expect(res.filters.timezone).toBe('Pacific/Kiritimati');
    expect((tableWhere(h).createdAt as { lt: Date }).lt.toISOString()).toBe(
      '2026-08-08T10:00:00.000Z',
    );
  });

  /**
   * S-E04-11 / PF-149 — **REWRITTEN, not softened.**
   *
   * `rejects.toBeInstanceOf(UnknownTimezoneError)` was correct and became false
   * the moment the error acquired a deliberate answer. The claim it defended —
   * *it throws, it never silently falls back to the server zone* — is still
   * asserted below, and now with more: a defined status, a stable code, the
   * offending zone in the body, and no numbers computed in an unstated zone.
   *
   * The error under assertion is produced by the REAL `assertKnownTimezone`
   * reached through the service; it is never constructed here. A hand-built
   * error would prove nothing about module identity, which is the exact way a
   * bare `instanceof` guard passes its test and stays dead in production.
   */
  it('an unusable Tenant.timezone is REFUSED with a named 503 — never a silent fallback', async () => {
    const h = makeHarness({ timezone: 'Europe/Paris-ish' });
    const err = await h.service
      .auditList({ tenantId: TENANT, to: '2026-08-08', take: 5, skip: 0 })
      .then(
        () => {
          throw new Error('auditList resolved — an unusable tenant zone must be refused.');
        },
        (e: unknown) => e as HttpException,
      );

    // Not the raw contracts error: it was answered, not leaked as a generic 500
    // whose body names nothing.
    expect(err).toBeInstanceOf(HttpException);
    expect(err).not.toBeInstanceOf(UnknownTimezoneError);
    // 503, not 4xx: `from`/`to` are already validated in the controller and
    // there is deliberately no `timezone` query parameter, so nothing the caller
    // sent is wrong. The server's own `Tenant.timezone` is unusable until an
    // operator edits it.
    expect(err.getStatus()).toBe(503);

    const body = err.getResponse() as Record<string, unknown>;
    // A stable discriminator, so the page can eventually tell « analytics is
    // down » from « this tenant's timezone is misconfigured » without parsing a
    // French sentence.
    expect(body.code).toBe('TENANT_TIMEZONE_UNUSABLE');
    expect(body.timezone).toBe('Europe/Paris-ish');
    expect(String(body.message)).toContain('Europe/Paris-ish');
    // French UI copy — this text is what an admin reads, not a class name.
    expect(String(body.message)).not.toContain('UnknownTimezoneError');

    // The rejected zone is in the BODY and NOWHERE ELSE. `/admin/audit` feeds
    // `filters.timezone` straight into `new Intl.DateTimeFormat({ timeZone })`
    // during a server render, so echoing it back would re-create the 500 one
    // layer up — on the very route that was 500-ing for every admin three
    // commits ago (PF-14).
    expect(body).not.toHaveProperty('filters');

    // Fail-closed: not one number was computed in an unstated zone.
    expect(h.findManyWheres).toHaveLength(0);
    expect(h.countWheres).toHaveLength(0);
  });

  it('the guard spans the WINDOW RESOLUTION, not just the assertKnownTimezone call', async () => {
    // The `DEFAULT_AUDIT_TIMEZONE` branch never reaches `assertKnownTimezone`,
    // so under a small-ICU runtime the throw arrives later, from
    // `resolveAuditWindow` (`window.ts:323` → `zonedDayStartUtc` →
    // `partsInZone`) — and it arrives for EVERY tenant at once, which is the
    // only variant of PF-149 that can fire today. A `try` around the assert
    // alone would miss exactly that one.
    //
    // Reaching that branch on a full-ICU host (`process.versions.icu` = 76.1)
    // requires stubbing `Intl`: the formatter is ACCEPTED (so the assert passes
    // and caches) and then fails to produce a field. The zone below is used in
    // this test ONLY — `window.ts:86` caches formatters per zone for the life of
    // the module, so sharing one would make these tests order-dependent.
    const DOWNSTREAM_ZONE = 'Indian/Kerguelen';
    const realDateTimeFormat = Intl.DateTimeFormat;
    (Intl as { DateTimeFormat: unknown }).DateTimeFormat = function stubbed(
      locale: string,
      options: Intl.DateTimeFormatOptions,
    ) {
      const real = new realDateTimeFormat(locale, { ...options, timeZone: 'UTC' });
      return {
        resolvedOptions: () => ({ ...real.resolvedOptions(), timeZone: options.timeZone }),
        formatToParts: (d: Date) => real.formatToParts(d).filter((p) => p.type !== 'day'),
        format: (d: Date) => real.format(d),
      };
    };
    try {
      const h = makeHarness({ timezone: DOWNSTREAM_ZONE });
      const err = await h.service
        .auditList({ tenantId: TENANT, from: '2026-08-01', to: '2026-08-08', take: 5, skip: 0 })
        .then(
          () => {
            throw new Error('auditList resolved — a downstream zone failure must be refused.');
          },
          (e: unknown) => e as HttpException,
        );
      expect(err).toBeInstanceOf(HttpException);
      expect(err.getStatus()).toBe(503);
      expect((err.getResponse() as Record<string, unknown>).timezone).toBe(DOWNSTREAM_ZONE);
      expect(h.findManyWheres).toHaveLength(0);
    } finally {
      (Intl as { DateTimeFormat: unknown }).DateTimeFormat = realDateTimeFormat;
    }
  });

  it('anything that is NOT an unusable zone keeps its own meaning', async () => {
    // `zonedDayStartUtc` also throws `RangeError` (`window.ts:245`). Swallowing
    // it into the same 503 would be a new silent-fallback class — the defect
    // wearing the fix's clothes. Proven on the real helper rather than through
    // the service, because `resolveAuditWindow` normalises malformed days to
    // `null` upstream, which is itself the behaviour the echo test pins below.
    expect(() => zonedDayStartUtc('2026-02-30', ZONE)).toThrow(RangeError);
    expect(() => zonedDayStartUtc('2026-08-08', ZONE)).not.toThrow();
  });

  it('an ABSENT zone (no row, empty column) uses the column default and says which it used', async () => {
    for (const timezone of [null, '', '  ']) {
      const h = makeHarness({ timezone });
      const res = await h.service.auditList({
        tenantId: TENANT,
        to: '2026-08-08',
        take: 5,
        skip: 0,
      });
      expect({ timezone, echoed: res.filters.timezone }).toEqual({
        timezone,
        echoed: 'Europe/Paris',
      });
    }
    // A trailing space is a typo, not a broken zone: it resolves, and the echo
    // is the clean value the UI will print.
    const h = makeHarness({ timezone: 'Europe/Paris ' });
    const res = await h.service.auditList({ tenantId: TENANT, take: 5, skip: 0 });
    expect(res.filters.timezone).toBe('Europe/Paris');
  });

  it('filters echo what was APPLIED — a malformed date comes back null, not verbatim', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      from: 'garbage',
      to: '2026-08-08',
      actorId: 'u-2',
      resourceType: 'role',
      take: 5,
      skip: 0,
    });
    expect(res.filters).toEqual({
      timezone: ZONE,
      from: null,
      to: '2026-08-08',
      actorId: 'u-2',
      action: null,
      resourceType: 'role',
      portal: null,
    });
  });
});

/* ================================================================== *
 * AC-10 — « Sans portail » (PF-123, read half)
 * ================================================================== */

describe('AC-10 — a null-portal row is reachable, and only when one exists', () => {
  it('the sentinel decodes to `where.portal === null` server-side', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      portal: AUDIT_PORTAL_NONE,
      take: 50,
      skip: 0,
    });
    expect(tableWhere(h).portal).toBeNull();
    expect(ids(res.data)).toEqual(['r-system']);
    // The sentinel is echoed as sent, so the filter strip can re-select it.
    expect(res.filters.portal).toBe(AUDIT_PORTAL_NONE);
  });

  it('a real portal value still filters by equality — the sentinel is not a wildcard', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({ tenantId: TENANT, portal: 'admin', take: 50, skip: 0 });
    expect(tableWhere(h).portal).toBe('admin');
    expect(ids(res.data)).not.toContain('r-system');
  });

  it('the facet OFFERS the sentinel when a null-portal row exists', async () => {
    const h = makeHarness();
    const facets = await h.service.auditFacets({ tenantId: TENANT });
    expect(facets.hasNullPortal).toBe(true);
    expect(facets.portals).toContain(AUDIT_PORTAL_NONE);
    expect(facets.portals[facets.portals.length - 1]).toBe(AUDIT_PORTAL_NONE);
    // The facet query no longer excludes nulls, which is what made the row
    // unreachable in the first place.
    const portalCall = h.findManyWheres.find((w) => 'tenantId' in w && Object.keys(w).length === 1);
    expect(portalCall).toBeDefined();
  });

  it('…and does NOT offer it when no such row exists — a filter that can only return nothing', async () => {
    const h = makeHarness({ rows: FIXTURE.filter((r) => r.portal !== null) });
    const facets = await h.service.auditFacets({ tenantId: TENANT });
    expect(facets.hasNullPortal).toBe(false);
    expect(facets.portals).not.toContain(AUDIT_PORTAL_NONE);
  });

  it('every offered portal plus the sentinel accounts for every row (no residual gap)', async () => {
    const h = makeHarness();
    const facets = await h.service.auditFacets({ tenantId: TENANT });
    let summed = 0;
    for (const portal of facets.portals) {
      const res = await h.service.auditList({ tenantId: TENANT, portal, take: 50, skip: 0 });
      summed += res.total;
    }
    const unfiltered = await h.service.auditList({ tenantId: TENANT, take: 50, skip: 0 });
    expect(summed).toBe(unfiltered.total);
  });
});

/* ================================================================== *
 * AC-11 — G-TENANT: one negative per new query
 * ================================================================== */

describe('AC-11 / G-TENANT — the foreign row satisfies every predicate but the tenant one', () => {
  it('is excluded from the window query, all four KPIs, the groupBy and the null-portal probe', async () => {
    const h = makeHarness();
    const res = await h.service.auditList({
      tenantId: TENANT,
      from: '2026-08-08',
      to: '2026-08-08',
      take: 50,
      skip: 0,
    });
    expect(ids(res.data)).not.toContain('r-foreign');

    // Every emitted `where` — table, both counts, the groupBy, and the facets —
    // carries the tenant predicate. Enumerated, not sampled.
    await h.service.auditFacets({ tenantId: TENANT });
    const everyWhere = [...h.findManyWheres, ...h.countWheres, ...h.groupByArgs.map((g) => g.where)];
    expect(everyWhere.length).toBeGreaterThan(5);
    for (const where of everyWhere) {
      expect(where.tenantId).toBe(TENANT);
    }

    // And behaviourally: the foreign actor never reaches `distinctActors`, even
    // though `u-foreign` is a non-null actor inside the window.
    const groupWhere = h.groupByArgs[0]!.where;
    const grouped = FIXTURE.filter((r) => matches(r, groupWhere)).map((r) => r.actorId);
    expect(grouped).not.toContain('u-foreign');

    // The foreign row is also the only other null-portal row: the facet must not
    // borrow it to justify offering « Sans portail » to this tenant.
    const h2 = makeHarness({ rows: FIXTURE.filter((r) => r.id !== 'r-system') });
    expect((await h2.service.auditFacets({ tenantId: TENANT })).hasNullPortal).toBe(false);
  });
});
