import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { evaluateTeacherCommentFlag } from './teacher-comment-flag.rule';
import type { RuleContext } from './rule-context';

/**
 * TEACHER_COMMENT_FLAG (E3-S1). Covers the pre-mortem failure modes that became
 * acceptance criteria:
 *  - FM-3: tenant + status + isFlagged stay at the TOP LEVEL of the grade.where
 *    (the only tenant guard — the evaluator runs on the plain prisma client).
 *  - one explainable, NON-COMPARATIVE alert per flagged published grade.
 *  - body templating: factual sentence; the optional flagNote is a clearly
 *    attributed, trimmed addendum, never the whole body (kind-tone invariant).
 *  - no active academic year → emits nothing.
 *  - FM-4: byte-parity with the worker copy (the two rule bodies are identical).
 */
function makeGrade(over: Partial<{ id: string; flagNote: string | null; flaggedBy: string | null }> = {}) {
  return {
    id: over.id ?? 'g1',
    studentId: 's1',
    flaggedBy: over.flaggedBy ?? 'teacher-user-1',
    flaggedAt: new Date('2026-06-01T10:00:00.000Z'),
    flagNote: over.flagNote ?? null,
    assessment: {
      maxScore: 20,
      teachingAssignment: {
        subject: { id: 'subj1', name: 'Maths', code: 'MATH' },
        classSection: { id: 'cs1', name: '6e A' },
      },
    },
  };
}

function makeCtx(
  grades: ReturnType<typeof makeGrade>[],
  over: Partial<RuleContext> = {},
) {
  const findMany = jest.fn().mockResolvedValue(grades);
  const prisma = { grade: { findMany } };
  const ctx = {
    prisma: prisma as never,
    rule: { parameters: {} } as never,
    tenantId: 't1',
    schoolId: null,
    academicYearId: 'ay1',
    dedupWindowDays: 7,
    ...over,
  } as RuleContext;
  return { ctx, findMany };
}

describe('evaluateTeacherCommentFlag', () => {
  it('emits one explainable alert per flagged published grade', async () => {
    const { ctx } = makeCtx([makeGrade({ id: 'g1' }), makeGrade({ id: 'g2' })]);
    const out = await evaluateTeacherCommentFlag(ctx);
    expect(out).toHaveLength(2);
    const [a] = out;
    expect(a!.title).toBe('Signalement enseignant en Maths');
    expect(a!.subjectId).toBe('subj1');
    expect(a!.classSectionId).toBe('cs1');
    expect(a!.recommendation).toContain('enseignant');
    expect((a!.context as { gradeId: string }).gradeId).toBe('g1');
    expect((a!.context as { subjectCode: string }).subjectCode).toBe('MATH');
  });

  it('queries with tenant + status:{published,revised} + isFlagged at the TOP LEVEL (FM-3)', async () => {
    const { ctx, findMany } = makeCtx([]);
    await evaluateTeacherCommentFlag(ctx);
    const where = findMany.mock.calls[0]![0].where;
    expect(where.tenantId).toBe('t1');
    // matches the parent-visible set the flag endpoint + gradebook accept
    expect(where.status).toEqual({ in: ['published', 'revised'] });
    expect(where.isFlagged).toBe(true);
    // active-year scoping rides the assessment join, not the tenant guard
    expect(where.assessment.teachingAssignment.academicYearId).toBe('ay1');
  });

  it('templates a factual body and never names a peer (kind tone, no note)', async () => {
    const { ctx } = makeCtx([makeGrade({ flagNote: null })]);
    const [a] = await evaluateTeacherCommentFlag(ctx);
    expect(a!.body).toBe('L\'enseignant·e a signalé une note préoccupante en Maths.');
    expect(a!.body).not.toContain('autre');
    expect(a!.body).not.toContain('moins bon');
  });

  it('attributes the trimmed flagNote as an addendum, not the whole body', async () => {
    const { ctx } = makeCtx([makeGrade({ flagNote: '  difficultés en géométrie  ' })]);
    const [a] = await evaluateTeacherCommentFlag(ctx);
    expect(a!.body).toContain('Maths');
    expect(a!.body).toContain('« difficultés en géométrie »');
  });

  it('emits nothing when there is no active academic year', async () => {
    const { ctx, findMany } = makeCtx([makeGrade()], { academicYearId: null });
    const out = await evaluateTeacherCommentFlag(ctx);
    expect(out).toHaveLength(0);
    expect(findMany).not.toHaveBeenCalled();
  });

  it('is byte-identical to the worker copy (byte-parity, FM-4)', () => {
    const api = readFileSync(join(__dirname, 'teacher-comment-flag.rule.ts'), 'utf8');
    const worker = readFileSync(
      join(
        __dirname,
        '../../../../../worker/src/modules/alerts-rules/teacher-comment-flag.rule.ts',
      ),
      'utf8',
    );
    expect(api).toBe(worker);
  });
});
