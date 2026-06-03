import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * LOW_SUBJECT_AVG — fires when a student's weighted average in a subject
 * (over the active academic year, published grades only) drops below the
 * `threshold` parameter (default 10/20).
 */
export async function evaluateLowSubjectAvg(ctx: RuleContext): Promise<DetectedAlert[]> {
  const params = (ctx.rule.parameters as Record<string, unknown>) ?? {};
  // Read admin-tunable params defensively (ADR-013 customization layer): the
  // `parameters` bag is an unvalidated Record. `threshold` is a grade on the
  // 0–20 scale, so the valid range is finite AND > 0 AND <= 20: a 0/negative
  // threshold would silently disable the rule (avg < 0 never matches), and a
  // > 20 typo would fire a low-average alert on every student. Invalid/NaN/
  // out-of-range values fall back to the documented default (10 / 20). Unlike
  // the integer counts, `threshold` is NOT floored — a 9.5/20 seuil is valid.
  const rawThreshold = Number(params.threshold ?? 10);
  const threshold =
    Number.isFinite(rawThreshold) && rawThreshold > 0 && rawThreshold <= 20 ? rawThreshold : 10;
  if (!ctx.academicYearId) return [];

  // Pull all published grades in the active year, for the right tenant / school.
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
    take: 50_000,
  });

  // Aggregate per (student, subject) using normalized-to-20 weighted averages.
  type Bucket = {
    studentId: string;
    subjectId: string;
    subjectName: string;
    subjectCode: string;
    classSectionId: string;
    classSectionName: string;
    sum: number;
    weight: number;
    count: number;
  };
  const buckets = new Map<string, Bucket>();

  for (const g of grades) {
    if (g.value == null) continue;
    const max = Number(g.assessment.maxScore);
    if (max === 0) continue;
    const v20 = (Number(g.value) / max) * 20;
    const coef =
      g.assessment.coefficientOverride != null
        ? Number(g.assessment.coefficientOverride)
        : 1;
    const subj = g.assessment.teachingAssignment.subject;
    const cs = g.assessment.teachingAssignment.classSection;
    const key = `${g.studentId}|${subj.id}`;
    const bucket = buckets.get(key) ?? {
      studentId: g.studentId,
      subjectId: subj.id,
      subjectName: subj.name,
      subjectCode: subj.code,
      classSectionId: cs.id,
      classSectionName: cs.name,
      sum: 0,
      weight: 0,
      count: 0,
    };
    bucket.sum += v20 * coef;
    bucket.weight += coef;
    bucket.count += 1;
    buckets.set(key, bucket);
  }

  const out: DetectedAlert[] = [];
  for (const b of buckets.values()) {
    if (b.count < 2) continue; // require at least 2 grades to be meaningful
    if (b.weight === 0) continue;
    const avg = b.sum / b.weight;
    if (avg < threshold) {
      out.push({
        studentId: b.studentId,
        subjectId: b.subjectId,
        classSectionId: b.classSectionId,
        title: `Moyenne faible en ${b.subjectName}`,
        body: `Moyenne actuelle ${avg.toFixed(2)} / 20 (seuil ${threshold} / 20) sur ${b.count} évaluations publiées.`,
        recommendation: `Consultez le détail en ${b.subjectName} avec votre enfant et l'enseignant·e pour identifier les difficultés.`,
        context: {
          subjectCode: b.subjectCode,
          average: Number(avg.toFixed(2)),
          gradeCount: b.count,
          threshold,
        },
      });
    }
  }
  return out;
}
