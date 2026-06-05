import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * IMPROVEMENT — the inverted mirror of NEGATIVE_TREND. Fires when a student's
 * running average in a subject RECOVERS by at least `delta` points /20 across
 * the last `windowAssessments` consecutive published evaluations. The trailing
 * window is split in two halves (earlier vs later) in memory — over the SAME
 * single `grade.findMany` the sibling rules run, no extra query — and the rule
 * fires only on an upward move: `lastHalfAvg - firstHalfAvg >= delta`. This is
 * a celebratory, never-comparative positive signal: it states the rule, the
 * subject, the threshold and the actual point gain for THIS child only, and
 * never names or compares to another child.
 * Defaults: progression de >= 1.5 pts sur 3 évaluations consécutives.
 */
export async function evaluateImprovement(ctx: RuleContext): Promise<DetectedAlert[]> {
  const params = (ctx.rule.parameters as Record<string, unknown>) ?? {};
  // Read admin-tunable params defensively (ADR-013 customization layer): the
  // `parameters` bag is an unvalidated Record, so clamp to keep the "fires only
  // on a real upward trend" guarantee for ANY value. `delta` must stay > 0 —
  // a 0/negative delta would fire on a flat or falling series. The window needs
  // >= 2 grades to form two non-empty halves — a window of 1 splits into two
  // empty halves and could never fire. Invalid/NaN values fall back to defaults.
  const rawDelta = Number(params.delta ?? 1.5);
  const delta = Number.isFinite(rawDelta) && rawDelta > 0 ? rawDelta : 1.5;
  const rawWindow = Number(params.windowAssessments ?? 3);
  const windowAssessments =
    Number.isFinite(rawWindow) && rawWindow >= 2 ? Math.floor(rawWindow) : 3;
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

  // Group by (student, subject) preserving chronological order from the query.
  type Entry = {
    value20: number;
    subjectId: string;
    subjectName: string;
    subjectCode: string;
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
      subjectCode: subj.code,
      classSectionId: cs.id,
      classSectionName: cs.name,
    });
    groups.set(key, arr);
  }

  const avg = (xs: number[]): number =>
    xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;

  const out: DetectedAlert[] = [];
  for (const [key, arr] of groups) {
    const [studentId] = key.split('|');
    // Use the LAST `windowAssessments` consecutive grades. A partial window
    // (fewer published grades than declared) never fires.
    const tail = arr.slice(-windowAssessments);
    if (tail.length < windowAssessments) continue;

    // Split the window into an earlier half and a later half. The middle grade
    // of an odd window is excluded so the two halves are symmetric (e.g. for a
    // window of 3 we compare grade[0] vs grade[2]).
    const half = Math.floor(tail.length / 2);
    const firstHalf = tail.slice(0, half).map((e) => e.value20);
    const lastHalf = tail.slice(tail.length - half).map((e) => e.value20);
    const firstHalfAvg = avg(firstHalf);
    const lastHalfAvg = avg(lastHalf);
    const gain = lastHalfAvg - firstHalfAvg;
    // Fire ONLY on an upward trend (gain >= delta). Flat / falling series produce nothing.
    if (gain < delta) continue;

    const first = tail[0]!;
    out.push({
      studentId: studentId!,
      subjectId: first.subjectId,
      classSectionId: first.classSectionId,
      title: `Progrès en ${first.subjectName} 🎉`,
      body: `Progression de +${gain.toFixed(1)} pts /20 sur les ${windowAssessments} dernières évaluations en ${first.subjectName} (de ${firstHalfAvg.toFixed(1)} à ${lastHalfAvg.toFixed(1)} /20).`,
      recommendation:
        'Félicitez votre enfant et encouragez-le·la à maintenir ses efforts dans cette matière.',
      context: {
        subjectCode: first.subjectCode,
        delta,
        windowAssessments,
        firstHalfAvg: Number(firstHalfAvg.toFixed(2)),
        lastHalfAvg: Number(lastHalfAvg.toFixed(2)),
        gain: Number(gain.toFixed(2)),
        windowValues: tail.map((e) => Number(e.value20.toFixed(2))),
      },
    });
  }
  return out;
}
