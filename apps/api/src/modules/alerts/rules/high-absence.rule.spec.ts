import { evaluateHighAbsence } from './high-absence.rule';
import type { RuleContext } from './rule-context';

/**
 * Guards the defensive parsing of the unvalidated `AlertRule.parameters` JSONB
 * (ADR-013): an admin typo (`count: 0`, NaN, negative, fractional) must fall
 * back to the documented defaults (5 absences / 30 days) and NOT emit a
 * `gte: 0` HAVING clause that fires on the whole cohort + notifies every
 * guardian. Asserts on the value actually handed to `attendanceRecord.groupBy`.
 */
function makeCtx(parameters: unknown): {
  ctx: RuleContext;
  groupBy: jest.Mock;
  findMany: jest.Mock;
} {
  const groupBy = jest.fn().mockResolvedValue([]); // no rows → rule short-circuits
  const findMany = jest.fn().mockResolvedValue([]);
  const prisma = {
    attendanceRecord: { groupBy },
    student: { findMany },
  };
  const ctx = {
    prisma: prisma as never,
    rule: { parameters } as never,
    tenantId: 't1',
    schoolId: null,
    academicYearId: 'ay1',
    dedupWindowDays: 7,
  };
  return { ctx, groupBy, findMany };
}

/** Extract the `gte` integer the rule put into the HAVING clause. */
function havingCount(groupBy: jest.Mock): unknown {
  return groupBy.mock.calls[0][0].having.studentId._count.gte;
}

/** Extract the `recordedAt.gte` Date the rule computed from windowDays. */
function recordedSince(groupBy: jest.Mock): Date {
  return groupBy.mock.calls[0][0].where.recordedAt.gte;
}

describe('evaluateHighAbsence — defensive param parsing (ADR-013)', () => {
  it.each([
    ['count: 0 (AC1)', { count: 0 }, 5],
    ['count: -3 (AC2)', { count: -3 }, 5],
    ["count: 'abc' (AC3)", { count: 'abc' }, 5],
    ['count: null (AC3)', { count: null }, 5],
    ['windowDays object (AC3)', { windowDays: {} }, 5], // count missing → default 5
    ['count: 5.9 floored (AC4)', { count: 5.9 }, 5],
    ['empty params (AC6)', {}, 5],
    ['null params (AC6)', null, 5],
    ['valid count: 8 (AC6)', { count: 8 }, 8],
  ])('count → HAVING gte for %s', async (_label, parameters, expected) => {
    const { ctx, groupBy } = makeCtx(parameters);
    await evaluateHighAbsence(ctx);
    expect(havingCount(groupBy)).toBe(expected);
  });

  it('windowDays NaN/0/negative/huge fall back to 30; never an Invalid Date (AC2/AC3)', async () => {
    // 1e9 is finite and >= 1, but setUTCDate(... - 1e9) overflows to an Invalid
    // Date — the upper bound (<= 3650) rejects it back to the 30-day default.
    for (const bad of [
      { windowDays: 0 },
      { windowDays: -1 },
      { windowDays: 'x' },
      { windowDays: 1e9 },
      {},
    ]) {
      const { ctx, groupBy } = makeCtx(bad);
      await evaluateHighAbsence(ctx);
      const since = recordedSince(groupBy);
      expect(Number.isNaN(since.getTime())).toBe(false); // not an Invalid Date
      const ms = Date.now() - since.getTime();
      // ~30 days back for every invalid input (allow a band for UTC flooring).
      expect(ms).toBeGreaterThan(29 * 86_400_000);
      expect(ms).toBeLessThan(31.5 * 86_400_000);
    }
  });

  it('valid params pass through unchanged: { count: 8, windowDays: 14 } (AC6)', async () => {
    const { ctx, groupBy } = makeCtx({ count: 8, windowDays: 14 });
    await evaluateHighAbsence(ctx);
    expect(havingCount(groupBy)).toBe(8);
    const since = recordedSince(groupBy);
    const ms = Date.now() - since.getTime();
    // ~14 days back (allow a generous band for the UTC midnight flooring).
    expect(ms).toBeGreaterThan(13 * 86_400_000);
    expect(ms).toBeLessThan(15.5 * 86_400_000);
  });
});
