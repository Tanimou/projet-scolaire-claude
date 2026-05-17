import type { DetectedAlert, RuleContext } from './rule-context';

/**
 * HIGH_ABSENCE — fires when a student accumulates >= `count` unjustified
 * absences within `windowDays` rolling days. Defaults: 5 absences / 30 days.
 */
export async function evaluateHighAbsence(ctx: RuleContext): Promise<DetectedAlert[]> {
  const params = (ctx.rule.parameters as Record<string, unknown>) ?? {};
  const count = Number(params.count ?? 5);
  const windowDays = Number(params.windowDays ?? 30);

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - windowDays);
  since.setUTCHours(0, 0, 0, 0);

  const rows = await ctx.prisma.attendanceRecord.groupBy({
    by: ['studentId'],
    where: {
      tenantId: ctx.tenantId,
      status: 'absent',
      justifiedAt: null,
      recordedAt: { gte: since },
      ...(ctx.schoolId
        ? {
            classSession: {
              teachingAssignment: {
                classSection: { gradeLevel: { cycle: { schoolId: ctx.schoolId } } },
              },
            },
          }
        : {}),
    },
    _count: { _all: true },
    having: { studentId: { _count: { gte: count } } },
  });

  if (rows.length === 0) return [];

  // Resolve current class section per student for richer alert context.
  const students = await ctx.prisma.student.findMany({
    where: { id: { in: rows.map((r) => r.studentId) } },
    include: {
      enrollments: {
        where: { status: 'active' },
        include: { classSection: { select: { id: true, name: true } } },
        take: 1,
        orderBy: { enrolledAt: 'desc' },
      },
    },
  });
  const enrollmentByStudent = new Map(
    students.map((s) => [s.id, s.enrollments[0]?.classSection ?? null]),
  );

  return rows.map((r) => {
    const cs = enrollmentByStudent.get(r.studentId);
    return {
      studentId: r.studentId,
      classSectionId: cs?.id ?? null,
      title: 'Absences répétées',
      body: `${r._count._all} absences non justifiées sur les ${windowDays} derniers jours (seuil ${count}).`,
      recommendation:
        "Merci de transmettre les justificatifs manquants ou de contacter la vie scolaire.",
      context: {
        absentCount: r._count._all,
        threshold: count,
        windowDays,
      },
    };
  });
}
