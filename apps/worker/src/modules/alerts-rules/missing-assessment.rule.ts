import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * MISSING_ASSESSMENT — fires when a student accumulates >= `count` missing
 * evaluations within `windowDays` rolling days in the SAME subject. A "missing
 * evaluation" is a *published* assessment for which the student's grade row is
 * marked absent (`Grade.isAbsent = true`): the student sat no mark for that
 * evaluation, so a rattrapage / justification follow-up is owed.
 *
 * Note on "non justifiée": assessment-level absences are not justification-
 * tracked at the grade layer (justification lives on `AttendanceRecord` for
 * class sessions, not on assessment grades — there is no `justifiedAt` on
 * `Grade`). So every absent published evaluation counts as missing; the admin
 * tunes noise via the `count` threshold rather than a justified/unjustified
 * split. Defaults: 1 évaluation manquante sur 30 jours (cahier des charges:
 * « Absence non justifiée sur une évaluation »).
 */
export async function evaluateMissingAssessment(ctx: RuleContext): Promise<DetectedAlert[]> {
  const params = (ctx.rule.parameters as Record<string, unknown>) ?? {};
  // Read admin-tunable params defensively (ADR-013 customization layer): the
  // `parameters` bag is an unvalidated Record. `count` must stay an integer
  // >= 1 (a 0/negative threshold would fire on students with no missing
  // evaluation at all); `windowDays` must stay an integer >= 1 so `since`
  // is strictly in the past. Invalid/NaN values fall back to defaults.
  const rawCount = Number(params.count ?? 1);
  const count = Number.isFinite(rawCount) && rawCount >= 1 ? Math.floor(rawCount) : 1;
  const rawWindow = Number(params.windowDays ?? 30);
  const windowDays = Number.isFinite(rawWindow) && rawWindow >= 1 ? Math.floor(rawWindow) : 30;
  if (!ctx.academicYearId) return [];

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  since.setUTCHours(0, 0, 0, 0);

  const grades = await ctx.prisma.grade.findMany({
    where: {
      tenantId: ctx.tenantId,
      status: 'published',
      isAbsent: true,
      assessment: {
        scheduledAt: { gte: since },
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
    assessmentTitle: string;
    subjectId: string;
    subjectName: string;
    subjectCode: string;
    classSectionId: string;
    classSectionName: string;
  };
  const groups = new Map<string, Entry[]>();
  for (const g of grades) {
    const subj = g.assessment.teachingAssignment.subject;
    const cs = g.assessment.teachingAssignment.classSection;
    const key = `${g.studentId}|${subj.id}`;
    const arr = groups.get(key) ?? [];
    arr.push({
      assessmentTitle: g.assessment.title,
      subjectId: subj.id,
      subjectName: subj.name,
      subjectCode: subj.code,
      classSectionId: cs.id,
      classSectionName: cs.name,
    });
    groups.set(key, arr);
  }

  const out: DetectedAlert[] = [];
  for (const [key, arr] of groups) {
    const [studentId] = key.split('|');
    if (arr.length < count) continue;
    const first = arr[0]!;
    const missingCount = arr.length;
    const plural = missingCount > 1;
    out.push({
      studentId: studentId!,
      subjectId: first.subjectId,
      classSectionId: first.classSectionId,
      title: plural
        ? `${missingCount} évaluations manquantes en ${first.subjectName}`
        : `Évaluation manquante en ${first.subjectName}`,
      body: plural
        ? `${missingCount} évaluations sans note (élève absent·e) sur les ${windowDays} derniers jours en ${first.subjectName} : ${arr
            .map((e) => e.assessmentTitle)
            .join(', ')}.`
        : `Évaluation sans note (élève absent·e) sur les ${windowDays} derniers jours en ${first.subjectName} : ${first.assessmentTitle}.`,
      recommendation:
        "Vérifier si l'absence est justifiée et planifier un rattrapage de l'évaluation si nécessaire.",
      context: {
        subjectCode: first.subjectCode,
        missingCount,
        threshold: count,
        windowDays,
        assessmentTitles: arr.map((e) => e.assessmentTitle),
      },
    });
  }
  return out;
}
