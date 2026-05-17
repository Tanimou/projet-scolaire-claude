import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * REPEATED_FAILURE — fires when a student has >= `consecutive` published
 * grades < `threshold` /20 (normalised) in a row within a subject.
 * Defaults: 3 consecutive grades < 10/20.
 */
export async function evaluateRepeatedFailure(ctx: RuleContext): Promise<DetectedAlert[]> {
  const params = (ctx.rule.parameters as Record<string, unknown>) ?? {};
  const threshold = Number(params.threshold ?? 10);
  const consecutive = Number(params.consecutive ?? 3);
  if (!ctx.academicYearId) return [];

  const grades = await ctx.prisma.grade.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'published',
      isAbsent: false,
      value: { not: null },
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
    orderBy: [{ assessment: { scheduledAt: 'asc' } }, { createdAt: 'asc' }],
    take: 100_000,
  });

  // Group by (student, subject) preserving order from query
  type Entry = {
    value20: number;
    subjectId: string;
    subjectName: string;
    classSectionId: string;
    classSectionName: string;
  };
  const groups = new Map<string, Entry[]>();
  for (const g of grades) {
    if (g.value == null) continue;
    const max = Number(g.assessment.maxScore);
    if (max === 0) continue;
    const v20 = (Number(g.value) / max) * 20;
    const subj = g.assessment.teachingAssignment.subject;
    const cs = g.assessment.teachingAssignment.classSection;
    const key = `${g.studentId}|${subj.id}`;
    const arr = groups.get(key) ?? [];
    arr.push({
      value20: v20,
      subjectId: subj.id,
      subjectName: subj.name,
      classSectionId: cs.id,
      classSectionName: cs.name,
    });
    groups.set(key, arr);
  }

  const out: DetectedAlert[] = [];
  for (const [key, arr] of groups) {
    const [studentId] = key.split('|');
    // Check the LAST `consecutive` values
    const tail = arr.slice(-consecutive);
    if (tail.length < consecutive) continue;
    const allFail = tail.every((e) => e.value20 < threshold);
    if (!allFail) continue;
    const first = tail[0]!;
    out.push({
      studentId: studentId!,
      subjectId: first.subjectId,
      classSectionId: first.classSectionId,
      title: `Échecs répétés en ${first.subjectName}`,
      body: `${consecutive} évaluations consécutives sous ${threshold}/20 (dernières notes : ${tail
        .map((e) => e.value20.toFixed(1))
        .join(', ')}).`,
      recommendation:
        "Un entretien avec l'enseignant·e de la matière peut aider à identifier les blocages.",
      context: {
        subjectCode: first.subjectName,
        threshold,
        consecutive,
        lastValues: tail.map((e) => Number(e.value20.toFixed(2))),
      },
    });
  }
  return out;
}
