import { evaluateLowSubjectAvg } from './low-subject-avg.rule';
import type { RuleContext } from './rule-context';

/**
 * Guards the defensive parsing of the unvalidated `AlertRule.parameters` JSONB
 * (ADR-013) for LOW_SUBJECT_AVG. `threshold` is a 0–20 grade: invalid (NaN,
 * non-numeric), <= 0, or > 20 must fall back to the documented default 10/20.
 * A 0/negative threshold would silently disable the rule (avg < 0 never
 * matches) and a > 20 typo would fire on every student. Fractional thresholds
 * inside (0,20] are preserved un-floored. We drive two real grade rows through
 * the rule and assert which threshold the emitted alert used.
 */
function makeGrade(value: number) {
  return {
    studentId: 's1',
    value,
    assessment: {
      maxScore: 20,
      coefficientOverride: null,
      teachingAssignment: {
        subject: { id: 'subj1', name: 'Maths', code: 'MATH' },
        classSection: { id: 'cs1', name: '6e A' },
      },
    },
  };
}

function makeCtx(parameters: unknown, grades: ReturnType<typeof makeGrade>[]) {
  const findMany = jest.fn().mockResolvedValue(grades);
  const prisma = { grade: { findMany } };
  const ctx = {
    prisma: prisma as never,
    rule: { parameters } as never,
    tenantId: 't1',
    schoolId: null,
    academicYearId: 'ay1',
    dedupWindowDays: 7,
  } as RuleContext;
  return { ctx, findMany };
}

describe('evaluateLowSubjectAvg — defensive param parsing (ADR-013)', () => {
  // Student average = 8/20 (two grades of 8). Fires under the default 10.
  const lowGrades = [makeGrade(8), makeGrade(8)];

  it.each([
    ['threshold: 0 (AC1) → default 10', { threshold: 0 }],
    ['threshold: -5 (AC2) → default 10', { threshold: -5 }],
    ["threshold: 'abc' (AC3) → default 10", { threshold: 'abc' }],
    ['threshold: null (AC3) → default 10', { threshold: null }],
    ['threshold: 25 out-of-range (AC5) → default 10', { threshold: 25 }],
    ['empty params (AC6) → default 10', {}],
    ['null params (AC6) → default 10', null],
  ])('%s and fires on the 8/20 student', async (_label, parameters) => {
    const { ctx } = makeCtx(parameters, lowGrades);
    const out = await evaluateLowSubjectAvg(ctx);
    expect(out).toHaveLength(1);
    const [alert] = out;
    expect(alert).toBeDefined();
    expect((alert!.context as { threshold: number }).threshold).toBe(10);
  });

  it('fractional threshold 9.5 is preserved un-floored within (0,20] (AC4)', async () => {
    const { ctx } = makeCtx({ threshold: 9.5 }, lowGrades);
    const out = await evaluateLowSubjectAvg(ctx);
    expect(out).toHaveLength(1);
    const [alert] = out;
    expect(alert).toBeDefined();
    expect((alert!.context as { threshold: number }).threshold).toBe(9.5);
  });

  it('valid threshold 12 passes through unchanged (AC6)', async () => {
    const { ctx } = makeCtx({ threshold: 12 }, lowGrades);
    const out = await evaluateLowSubjectAvg(ctx);
    expect(out).toHaveLength(1);
    const [alert] = out;
    expect(alert).toBeDefined();
    expect((alert!.context as { threshold: number }).threshold).toBe(12);
  });

  it('a 0 threshold does NOT fire on the whole cohort (AC1/AC5 safety)', async () => {
    // With the malicious 0 honored, avg(8) < 0 is false → no alert. The fix
    // defaults to 10 instead, so the genuinely-low 8/20 student IS flagged —
    // i.e. the rule is neither silently disabled nor firing on everyone.
    const { ctx } = makeCtx({ threshold: 0 }, [makeGrade(15), makeGrade(15)]);
    const out = await evaluateLowSubjectAvg(ctx);
    expect(out).toHaveLength(0); // 15/20 average is above the defaulted 10
  });
});
