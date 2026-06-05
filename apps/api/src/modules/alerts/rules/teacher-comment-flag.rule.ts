import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * TEACHER_COMMENT_FLAG — fires once per published grade a teacher has explicitly
 * flagged as « à signaler » (E3-S1). Unlike the average/trend rules this is a
 * direct, intentional teacher signal: it reads only `isFlagged = true` +
 * published/revised grades (the same parent-visible set the flag endpoint and
 * gradebook accept), tenant-scoped and active-academic-year-scoped,
 * and emits one explainable, NON-COMPARATIVE alert per flagged grade. The
 * teacher's optional `flagNote` is a clearly-attributed, trimmed addendum to a
 * templated, factual body — never the whole body (kind-tone invariant) — and is
 * length-capped at the write DTO. No new disciplinary data is read.
 *
 * Tenant isolation is enforced ENTIRELY by the top-level `tenantId` filter (the
 * evaluator runs on the plain prisma client with no RLS session, esp. in the
 * worker) — `tenantId` + `status` + `isFlagged` MUST stay at the top level of
 * the `grade.where`, never only under the `assessment.teachingAssignment` join.
 *
 * Dedup is automatic via the shared `(rule, student, subjectId)` 7-day window:
 * two flagged grades for the same student+subject collapse to ONE open alert,
 * and an unflag does not close an already-open AlertInstance (E1 lifecycle owns
 * closure). Flag granularity is therefore per (student, subject) per 7 days.
 */
export async function evaluateTeacherCommentFlag(ctx: RuleContext): Promise<DetectedAlert[]> {
  if (!ctx.academicYearId) return [];

  const grades = await ctx.prisma.grade.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: { in: ['published', 'revised'] },
      isFlagged: true,
      assessment: {
        teachingAssignment: {
          academicYearId: ctx.academicYearId,
          ...(ctx.schoolId
            ? { classSection: { gradeLevel: { cycle: { schoolId: ctx.schoolId } } } }
            : {}),
        },
      },
    },
    include: {
      assessment: {
        include: {
          teachingAssignment: {
            include: {
              subject: { select: { id: true, name: true, code: true } },
              classSection: { select: { id: true, name: true } },
            },
          },
        },
      },
    },
    orderBy: [{ flaggedAt: 'asc' }, { createdAt: 'asc' }],
    take: 50_000,
  });

  const out: DetectedAlert[] = [];
  for (const g of grades) {
    const subj = g.assessment.teachingAssignment.subject;
    const cs = g.assessment.teachingAssignment.classSection;
    const note = (g.flagNote ?? '').trim();
    const body = note
      ? `L'enseignant·e a signalé une note en ${subj.name}. Précision : « ${note} »`
      : `L'enseignant·e a signalé une note préoccupante en ${subj.name}.`;
    out.push({
      studentId: g.studentId,
      subjectId: subj.id,
      classSectionId: cs.id,
      title: `Signalement enseignant en ${subj.name}`,
      body,
      recommendation:
        "Un échange avec l'enseignant·e de la matière vous aidera à comprendre ce signalement et la marche à suivre.",
      context: {
        gradeId: g.id,
        subjectCode: subj.code,
        flaggedBy: g.flaggedBy ?? null,
        flaggedAt: g.flaggedAt ? g.flaggedAt.toISOString() : null,
      },
    });
  }
  return out;
}
