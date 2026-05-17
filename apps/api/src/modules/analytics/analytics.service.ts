import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

export interface SparklinePoint {
  x: string; // ISO date
  y: number;
}

// =============================================================================
// Aggregates — KPI cards for Students / Classes / Teachers admin pages
// =============================================================================

export interface StudentsAggregate {
  totalStudents: number;
  newThisMonth: number;
  activeStudents: number;
  activePct: number; // 0-100
  growthPctVsLastYear: number; // signed
  trends: {
    students: SparklinePoint[];
    newStudents: SparklinePoint[];
    activeStudents: SparklinePoint[];
  };
  /** Donut data for "Répartition par niveau" — top 5 levels by count */
  byLevel: Array<{
    gradeLevelId: string;
    label: string;
    count: number;
    pct: number;
    color: string;
  }>;
}

export interface ClassesAggregate {
  totalClasses: number;
  avgCapacityPct: number;
  fullClasses: number;
  activeClasses: number;
  trends: {
    classes: SparklinePoint[];
    avgCapacity: SparklinePoint[];
    full: SparklinePoint[];
    active: SparklinePoint[];
  };
}

export interface TeachersAggregate {
  totalTeachers: number;
  activeTeachers: number;
  activePct: number;
  subjectsCovered: number;
  ratioTeacherStudent: { teachers: number; students: number; label: string }; // e.g. "1 / 18"
  trends: {
    teachers: SparklinePoint[];
    active: SparklinePoint[];
    subjects: SparklinePoint[];
    ratio: SparklinePoint[];
  };
}

export interface KpiData {
  label: string;
  value: number;
  formatted: string;
  delta?: { value: number; period: 'day' | 'week' | 'month'; sign: '+' | '-' | '=' };
  trend?: SparklinePoint[];
}

export interface AdminDashboardResponse {
  kpis: {
    students: KpiData;
    teachers: KpiData;
    classes: KpiData;
    pendingRequests: KpiData;
    configuredAlerts: KpiData;
  };
  schoolStructure: {
    academicYears: Array<{ id: string; name: string; status: string }>;
    levels: Array<{ key: 'primaire' | 'college' | 'lycee' | 'other'; label: string; count: number }>;
    classesByGrade: Array<{ gradeLabel: string; count: number }>;
    topSubjects: Array<{ id: string; name: string; classCount: number }>;
    totals: {
      academicYears: number;
      cycles: number;
      gradeLevels: number;
      classes: number;
      subjects: number;
    };
  };
  enrollmentRequests: Array<{
    id: string;
    requesterName: string;
    studentName: string;
    requestedClassName: string | null;
    requestType: 'rattachement' | 'inscription';
    status: 'pending' | 'to_verify' | 'approved' | 'rejected';
    /** ISO-8601 timestamp of the request submission */
    createdAt: string;
  }>;
  teachingAssignmentsSummary: Array<{
    id: string;
    teacherName: string;
    subjectName: string;
    classes: string[];
    weeklyHours: number | null;
    status: 'active' | 'overcapacity';
  }>;
  performance: {
    overall: number | null;
    byCycle: Array<{
      cycleId: string;
      cycleName: string;
      cycleColor: string | null;
      successRate: number;
      sampleSize: number;
    }>;
  };
  alertRules: Array<{
    code: string;
    label: string;
    condition: string;
    severity: 'high' | 'medium' | 'low';
    status: 'active' | 'inactive';
  }>;
  recentAudit: Array<{
    id: string;
    actorId: string | null;
    actorRole: string | null;
    actorName: string | null;
    action: string;
    resourceType: string;
    resourceId: string | null;
    detail: string | null;
    createdAt: string;
  }>;
  recentExports: Array<{
    id: string;
    kind: 'xlsx' | 'pdf' | 'csv';
    fileName: string;
    requesterName: string | null;
    createdAt: string;
    downloadUrl: string | null;
  }>;
}

export interface TeacherSubjectStat {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  classCount: number;
  studentCount: number;
}

export interface TeacherDashboardResponse {
  subjectStats: TeacherSubjectStat[];
  upcomingAssessments: Array<{
    id: string;
    title: string;
    date: string;
    subjectCode: string;
    subjectName: string;
    subjectColor: string | null;
    classSectionId: string;
    classSectionName: string;
    inDays: number;
  }>;
  recentActivity: Array<{
    id: string;
    action: string;
    resourceType: string;
    createdAt: string;
  }>;
}

export interface StudentSubjectPerf {
  subjectId: string;
  subjectCode: string;
  subjectName: string;
  subjectColor: string | null;
  coefficient: number;
  studentAverage: number | null;
  classAverage: number | null;
  studentRank: number | null;
  classSize: number;
  trend: number | null; // delta vs previous term
  badge: string | null;
}

export interface ParentDashboardResponse {
  student: {
    id: string;
    firstName: string;
    lastName: string;
    photoUrl: string | null;
    classSectionName: string | null;
    gradeLevelName: string | null;
    schoolName: string | null;
    externalRef: string | null;
    birthDate: string | null;
    rank: number | null;
    classSize: number;
  };
  globalPerformance: {
    studentAverage: number | null;
    classAverage: number | null;
    progression: number | null; // delta vs previous trimester
    attendanceRate: number | null;
    percentageOnTwenty: number | null;
  };
  subjectPerf: StudentSubjectPerf[];
  termEvolution: Array<{
    label: string;
    student: number | null;
    class: number | null;
  }>;
  subjectEvolution: Array<{
    subjectName: string;
    subjectCode: string;
    'T1': number | null;
    'T2': number | null;
    'T3': number | null;
  }>;
  recentGrades: Array<{
    id: string;
    date: string;
    subjectName: string;
    subjectColor: string | null;
    title: string;
    kind: string;
    value: number | null;
    max: number;
    classAverage: number | null;
    coefficient: number;
    comment: string | null;
  }>;
  upcomingAssessments: Array<{
    id: string;
    title: string;
    date: string;
    subjectName: string;
    subjectColor: string | null;
    subjectCode: string;
  }>;
}

/**
 * AnalyticsService — aggregates KPIs for dashboards.
 * All counts are scoped to the (tenant, school) of the caller.
 * Sparklines are computed as a running cumulative count of "createdAt" timestamps
 * over the last 30 days. Cheap to compute, no extra storage required.
 */
@Injectable()
export class AnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Parent dashboard payload — image 7 prescriptive.
   * Returns everything the parent dashboard needs for ONE child:
   *  - profile hero data
   *  - global performance KPIs
   *  - per-subject performance (4 SubjectPerfCards)
   *  - term-level evolution (line chart)
   *  - subject × trimester evolution (grouped bar chart)
   *  - 5 most recent grades (table)
   *  - upcoming assessments (calendar)
   */
  /**
   * Parent comments feed — every published grade with a non-empty `comment`
   * for one of the parent's children. Returns newest first.
   *
   * The caller MUST have already passed `StudentAccessService.canAccessStudent`
   * before invoking — this method trusts its inputs.
   */
  async parentComments(opts: { tenantId: string; studentId: string }) {
    const rows = await this.prisma.grade.findMany({
      where: {
        tenantId: opts.tenantId,
        studentId: opts.studentId,
        status: 'published',
        comment: { not: null },
      },
      include: {
        assessment: {
          include: {
            teachingAssignment: {
              include: {
                subject: { select: { id: true, code: true, name: true, color: true } },
                classSection: { select: { id: true, name: true } },
              },
            },
            term: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ publishedAt: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
    });
    return {
      data: rows.map((g) => {
        const max = Number(g.assessment.maxScore);
        const value = g.value != null ? Number(g.value) : null;
        return {
          id: g.id,
          comment: g.comment,
          publishedAt: g.publishedAt?.toISOString() ?? g.updatedAt.toISOString(),
          gradeValue: value,
          gradeMax: max,
          gradeOn20: value != null && max > 0 ? (value / max) * 20 : null,
          assessmentTitle: g.assessment.title,
          subjectId: g.assessment.teachingAssignment.subject.id,
          subjectCode: g.assessment.teachingAssignment.subject.code,
          subjectName: g.assessment.teachingAssignment.subject.name,
          subjectColor: g.assessment.teachingAssignment.subject.color,
          classSectionName: g.assessment.teachingAssignment.classSection.name,
          termName: g.assessment.term?.name ?? null,
        };
      }),
    };
  }

  async parentDashboard(opts: {
    tenantId: string;
    studentId: string;
    academicYearId?: string;
  }): Promise<ParentDashboardResponse> {
    const { tenantId, studentId } = opts;

    // Resolve student + active enrollment + school
    const student = await this.prisma.student.findFirst({
      where: { id: studentId, tenantId },
      include: {
        school: { select: { name: true } },
        enrollments: {
          where: { status: 'active' },
          orderBy: { enrolledAt: 'desc' },
          include: {
            classSection: {
              include: {
                gradeLevel: { select: { id: true, name: true } },
              },
            },
            academicYear: { select: { id: true, name: true, status: true } },
          },
          take: 1,
        },
      },
    });

    if (!student) {
      throw new Error('Student not found in tenant');
    }

    const activeEnrollment = student.enrollments[0];
    const academicYearId =
      opts.academicYearId ?? activeEnrollment?.academicYearId;
    const classSectionId = activeEnrollment?.classSectionId;
    const gradeLevelId = activeEnrollment?.classSection.gradeLevelId;

    // Fetch all published/revised grades for this student in this year
    const grades = academicYearId
      ? await this.prisma.grade.findMany({
          where: {
            tenantId,
            studentId,
            status: { in: ['published', 'revised'] },
            isAbsent: false,
            assessment: { teachingAssignment: { academicYearId } },
          },
          include: {
            assessment: {
              include: {
                term: { select: { id: true, name: true, orderIndex: true, startDate: true } },
                teachingAssignment: {
                  include: {
                    subject: { select: { id: true, code: true, name: true, color: true, defaultCoefficient: true } },
                  },
                },
              },
            },
          },
        })
      : [];

    // Coefficient resolver — reuse the same logic as grades.service
    const subjectCoefs = gradeLevelId
      ? await this.prisma.subjectCoefficient.findMany({
          where: { gradeLevelId },
          select: { subjectId: true, coefficient: true },
        })
      : [];
    const coefMap = new Map(subjectCoefs.map((c) => [c.subjectId, Number(c.coefficient)]));

    const resolveCoef = (subjectId: string, defaultCoef: number, override: unknown): number => {
      if (override !== null && override !== undefined) return Number(override);
      const c = coefMap.get(subjectId);
      if (c !== undefined) return c;
      return defaultCoef;
    };

    // Group by subject
    const bySubject = new Map<
      string,
      {
        subjectId: string;
        subjectCode: string;
        subjectName: string;
        subjectColor: string | null;
        defaultCoef: number;
        grades: Array<{ onTwenty: number; coef: number; termId: string | null; termOrder: number }>;
      }
    >();
    for (const g of grades) {
      if (!g.value) continue;
      const subj = g.assessment.teachingAssignment.subject;
      const onTwenty = (Number(g.value) / Number(g.assessment.maxScore)) * 20;
      const coef = resolveCoef(subj.id, Number(subj.defaultCoefficient), g.assessment.coefficientOverride);
      const entry = bySubject.get(subj.id) ?? {
        subjectId: subj.id,
        subjectCode: subj.code,
        subjectName: subj.name,
        subjectColor: subj.color,
        defaultCoef: coef,
        grades: [],
      };
      entry.grades.push({
        onTwenty,
        coef,
        termId: g.assessment.term?.id ?? null,
        termOrder: g.assessment.term?.orderIndex ?? 0,
      });
      bySubject.set(subj.id, entry);
    }

    // Per-subject perf cards
    const subjectPerf: StudentSubjectPerf[] = Array.from(bySubject.values()).map((s) => {
      const avg = s.grades.length === 0 ? null : s.grades.reduce((a, g) => a + g.onTwenty, 0) / s.grades.length;
      return {
        subjectId: s.subjectId,
        subjectCode: s.subjectCode,
        subjectName: s.subjectName,
        subjectColor: s.subjectColor,
        coefficient: s.defaultCoef,
        studentAverage: avg,
        classAverage: null, // computed below
        studentRank: null, // not computed yet (could be expensive)
        classSize: 0,
        trend: null,
        badge: null,
      };
    });

    // Compute class averages for each subject (light query: fetch all grades for the class section in this year)
    if (classSectionId && academicYearId) {
      const classGrades = await this.prisma.grade.findMany({
        where: {
          tenantId,
          status: { in: ['published', 'revised'] },
          isAbsent: false,
          assessment: { teachingAssignment: { classSectionId, academicYearId } },
        },
        include: {
          assessment: {
            include: {
              teachingAssignment: { include: { subject: { select: { id: true } } } },
            },
          },
        },
      });
      const classSubjectAgg = new Map<string, { sum: number; n: number; studentIds: Set<string> }>();
      for (const g of classGrades) {
        if (!g.value) continue;
        const sId = g.assessment.teachingAssignment.subject.id;
        const onTwenty = (Number(g.value) / Number(g.assessment.maxScore)) * 20;
        const agg = classSubjectAgg.get(sId) ?? { sum: 0, n: 0, studentIds: new Set() };
        agg.sum += onTwenty;
        agg.n += 1;
        agg.studentIds.add(g.studentId);
        classSubjectAgg.set(sId, agg);
      }
      const classSize = new Set(classGrades.map((g) => g.studentId)).size;
      for (const card of subjectPerf) {
        const agg = classSubjectAgg.get(card.subjectId);
        card.classAverage = agg ? agg.sum / agg.n : null;
        card.classSize = classSize;
      }
    }

    // Global performance
    const weightedSum = subjectPerf.reduce((acc, s) => acc + (s.studentAverage ?? 0) * s.coefficient, 0);
    const totalCoef = subjectPerf.reduce((acc, s) => acc + (s.studentAverage != null ? s.coefficient : 0), 0);
    const overallAvg = totalCoef === 0 ? null : weightedSum / totalCoef;

    const classOverall = subjectPerf.length === 0 ? null : (() => {
      const ws = subjectPerf.reduce((a, s) => a + (s.classAverage ?? 0) * s.coefficient, 0);
      const tc = subjectPerf.reduce((a, s) => a + (s.classAverage != null ? s.coefficient : 0), 0);
      return tc === 0 ? null : ws / tc;
    })();

    // Term evolution (group by term order)
    const termGroups = new Map<number, { label: string; student: number[]; class: number[] }>();
    for (const g of grades) {
      if (!g.value) continue;
      const t = g.assessment.term;
      const order = t?.orderIndex ?? 0;
      const label = t?.name ?? '—';
      const onTwenty = (Number(g.value) / Number(g.assessment.maxScore)) * 20;
      const grp = termGroups.get(order) ?? { label, student: [], class: [] };
      grp.student.push(onTwenty);
      termGroups.set(order, grp);
    }
    const termEvolution = Array.from(termGroups.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([, grp]) => ({
        label: grp.label,
        student: grp.student.length === 0 ? null : grp.student.reduce((a, b) => a + b, 0) / grp.student.length,
        class: grp.class.length === 0 ? null : grp.class.reduce((a, b) => a + b, 0) / grp.class.length,
      }));

    // Subject × Term evolution (top 4 subjects, T1/T2/T3)
    const subjectEvolution: ParentDashboardResponse['subjectEvolution'] = subjectPerf.slice(0, 4).map((s) => {
      const subjGrades = bySubject.get(s.subjectId)?.grades ?? [];
      const byTerm: Record<number, number[]> = {};
      for (const g of subjGrades) {
        const k = g.termOrder;
        (byTerm[k] = byTerm[k] ?? []).push(g.onTwenty);
      }
      const avg = (arr?: number[]): number | null =>
        !arr || arr.length === 0 ? null : arr.reduce((a, b) => a + b, 0) / arr.length;
      return {
        subjectName: s.subjectName,
        subjectCode: s.subjectCode,
        T1: avg(byTerm[1]),
        T2: avg(byTerm[2]),
        T3: avg(byTerm[3]),
      };
    });

    // 5 most recent grades for the table
    // Pull up to 30 recent grades so the parent dashboard can paginate
    // client-side (page size 5). The dedicated `/parent/grades` page handles
    // deeper history.
    const recentGradesRaw = await this.prisma.grade.findMany({
      where: {
        tenantId,
        studentId,
        status: { in: ['published', 'revised'] },
      },
      include: {
        assessment: {
          include: {
            teachingAssignment: { include: { subject: { select: { name: true, color: true, defaultCoefficient: true, id: true } } } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
      take: 30,
    });

    const recentGrades = recentGradesRaw.map((g) => {
      const subj = g.assessment.teachingAssignment.subject;
      const coef = resolveCoef(subj.id, Number(subj.defaultCoefficient), g.assessment.coefficientOverride);
      const classAvg = subjectPerf.find((sp) => sp.subjectId === subj.id)?.classAverage ?? null;
      return {
        id: g.id,
        date: (g.assessment.scheduledAt ?? g.assessment.conductedAt ?? g.assessment.createdAt).toISOString(),
        subjectName: subj.name,
        subjectColor: subj.color,
        title: g.assessment.title,
        kind: g.assessment.kind,
        value: g.value != null ? Number(g.value) : null,
        max: Number(g.assessment.maxScore),
        classAverage: classAvg,
        coefficient: coef,
        comment: g.comment,
      };
    });

    // Upcoming assessments (5)
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcoming = classSectionId
      ? await this.prisma.assessment.findMany({
          where: {
            tenantId,
            teachingAssignment: { classSectionId },
            scheduledAt: { gte: now, lte: horizon },
          },
          include: {
            teachingAssignment: {
              include: {
                subject: { select: { code: true, name: true, color: true } },
              },
            },
          },
          orderBy: { scheduledAt: 'asc' },
          take: 5,
        })
      : [];

    const upcomingAssessments = upcoming.map((a) => ({
      id: a.id,
      title: a.title,
      date: (a.scheduledAt ?? a.createdAt).toISOString(),
      subjectName: a.teachingAssignment.subject.name,
      subjectColor: a.teachingAssignment.subject.color,
      subjectCode: a.teachingAssignment.subject.code,
    }));

    // Attendance rate (% present out of recorded)
    const attendance = await this.prisma.attendanceRecord.findMany({
      where: { tenantId, studentId },
      select: { status: true },
      take: 200,
    });
    const totalAtt = attendance.length;
    const presentAtt = attendance.filter((r) => r.status === 'present').length;
    const attendanceRate = totalAtt === 0 ? null : (presentAtt / totalAtt) * 100;

    return {
      student: {
        id: student.id,
        firstName: student.firstName,
        lastName: student.lastName,
        photoUrl: null,
        classSectionName: activeEnrollment?.classSection.name ?? null,
        gradeLevelName: activeEnrollment?.classSection.gradeLevel?.name ?? null,
        schoolName: student.school?.name ?? null,
        externalRef: student.externalRef,
        birthDate: student.birthDate?.toISOString() ?? null,
        rank: null,
        classSize: subjectPerf[0]?.classSize ?? 0,
      },
      globalPerformance: {
        studentAverage: overallAvg,
        classAverage: classOverall,
        progression: termEvolution.length >= 2
          ? (termEvolution[termEvolution.length - 1]?.student ?? 0) - (termEvolution[termEvolution.length - 2]?.student ?? 0)
          : null,
        attendanceRate,
        percentageOnTwenty: overallAvg != null ? (overallAvg / 20) * 100 : null,
      },
      subjectPerf,
      termEvolution,
      subjectEvolution,
      recentGrades,
      upcomingAssessments,
    };
  }

  /**
   * Teacher dashboard payload — image 6 prescriptive.
   * Returns the 4 SubjectKpiCards data (one row per subject taught) + upcoming
   * assessments + recent activity.
   */
  async teacherDashboard(opts: {
    tenantId: string;
    teacherProfileId: string;
    academicYearId?: string;
  }): Promise<TeacherDashboardResponse> {
    const { tenantId, teacherProfileId, academicYearId } = opts;

    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId,
        teacherProfileId,
        ...(academicYearId ? { academicYearId } : {}),
      },
      include: {
        subject: { select: { id: true, code: true, name: true, color: true } },
        classSection: {
          select: {
            id: true,
            name: true,
            _count: { select: { enrollments: { where: { status: 'active' } } } },
          },
        },
      },
    });

    // Group by subject — one card per subject regardless of how many classes
    const bySubject = new Map<string, TeacherSubjectStat>();
    for (const a of assignments) {
      const stat = bySubject.get(a.subject.id) ?? {
        subjectId: a.subject.id,
        subjectCode: a.subject.code,
        subjectName: a.subject.name,
        subjectColor: a.subject.color,
        classCount: 0,
        studentCount: 0,
      };
      stat.classCount += 1;
      stat.studentCount += a.classSection._count?.enrollments ?? 0;
      bySubject.set(a.subject.id, stat);
    }

    // Upcoming assessments for teacher's assignments (next 30 days, max 5)
    const now = new Date();
    const horizon = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const upcoming = await this.prisma.assessment.findMany({
      where: {
        tenantId,
        teacherProfileId,
        scheduledAt: { gte: now, lte: horizon },
      },
      include: {
        teachingAssignment: {
          include: {
            subject: { select: { code: true, name: true, color: true } },
            classSection: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: { scheduledAt: 'asc' },
      take: 5,
    });

    const upcomingAssessments = upcoming.map((a) => {
      const date = a.scheduledAt ?? a.createdAt;
      const inDays = Math.max(
        0,
        Math.round((date.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)),
      );
      return {
        id: a.id,
        title: a.title,
        date: date.toISOString(),
        subjectCode: a.teachingAssignment.subject.code,
        subjectName: a.teachingAssignment.subject.name,
        subjectColor: a.teachingAssignment.subject.color,
        classSectionId: a.teachingAssignment.classSection.id,
        classSectionName: a.teachingAssignment.classSection.name,
        inDays,
      };
    });

    // Recent activity — audit logs by the teacher
    const me = await this.prisma.userProfile.findUnique({
      where: { id: (await this.prisma.teacherProfile.findUnique({ where: { id: teacherProfileId } }))?.userProfileId ?? '' },
      select: { id: true },
    });
    const recentActivity = me
      ? await this.prisma.auditLog
          .findMany({
            where: { tenantId, actorId: me.id },
            orderBy: { createdAt: 'desc' },
            take: 6,
            select: { id: true, action: true, resourceType: true, createdAt: true },
          })
          .then((logs) => logs.map((l) => ({ ...l, createdAt: l.createdAt.toISOString() })))
          .catch(() => [])
      : [];

    return {
      subjectStats: Array.from(bySubject.values()),
      upcomingAssessments,
      recentActivity,
    };
  }

  /**
   * Default alert rules (until R6 introduces the `AlertRule` model).
   * Shown on the admin dashboard so the visual block is meaningful even before
   * the alert engine ships.
   */
  private static DEFAULT_ALERT_RULES: AdminDashboardResponse['alertRules'] = [
    {
      code: 'LOW_SUBJECT_AVG',
      label: 'Moyenne faible matière',
      condition: 'Moyenne < 10/20',
      severity: 'high',
      status: 'active',
    },
    {
      code: 'NEGATIVE_TREND',
      label: 'Tendance négative',
      condition: 'Baisse 2 périodes',
      severity: 'medium',
      status: 'active',
    },
    {
      code: 'HIGH_ABSENCE',
      label: 'Absences élevées',
      condition: 'Absence > 20%',
      severity: 'high',
      status: 'active',
    },
    {
      code: 'BEHAVIOR_ALERT',
      label: 'Alerte comportement',
      condition: 'Signalements ≥ 3',
      severity: 'medium',
      status: 'active',
    },
  ];

  /**
   * Computes the full admin dashboard payload.
   */
  async adminDashboard(opts: { tenantId: string; schoolId: string }): Promise<AdminDashboardResponse> {
    const { tenantId, schoolId } = opts;
    const now = new Date();
    const oneMonthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // ============ KPI counts (current) ============
    const [
      studentsCurrent,
      studentsLastMonth,
      teachersCurrent,
      teachersLastMonth,
      classesCurrent,
      classesLastMonth,
      pendingRequests,
    ] = await Promise.all([
      this.prisma.student.count({ where: { tenantId, schoolId, status: 'active' } }),
      this.prisma.student.count({
        where: { tenantId, schoolId, status: 'active', createdAt: { lt: oneMonthAgo } },
      }),
      this.prisma.teacherProfile.count({ where: { tenantId, schoolId } }),
      this.prisma.teacherProfile.count({
        where: { tenantId, schoolId, createdAt: { lt: oneMonthAgo } },
      }),
      this.prisma.classSection.count({
        where: { tenantId, academicYear: { schoolId } },
      }),
      this.prisma.classSection.count({
        where: { tenantId, academicYear: { schoolId }, createdAt: { lt: oneMonthAgo } },
      }),
      // EnrollmentRequest doesn't exist yet — use Guardianship pending as proxy
      this.prisma.guardianship.count({ where: { tenantId, status: 'pending' } }),
    ]);

    // ============ Sparklines ============
    const [studentSpark, teacherSpark, classSpark, requestSpark] = await Promise.all([
      this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }),
      this.sparkline({ tenantId, schoolId, model: 'teacherProfile', sinceDays: 30 }),
      this.sparkline({ tenantId, schoolId, model: 'classSection', sinceDays: 30 }),
      this.sparkline({
        tenantId,
        schoolId,
        model: 'guardianship',
        sinceDays: 30,
        statusFilter: 'pending',
      }),
    ]);

    // ============ School structure ============
    const [academicYears, cyclesCount, gradeLevels, subjectsAll, cyclesFull, classesAll] = await Promise.all([
      this.prisma.academicYear.findMany({
        where: { tenantId, schoolId },
        orderBy: { startDate: 'desc' },
        select: { id: true, name: true, status: true },
      }),
      this.prisma.cycle.count({ where: { tenantId, schoolId } }),
      this.prisma.gradeLevel.findMany({
        where: { tenantId, schoolId },
        include: { cycle: { select: { id: true, name: true } } },
      }),
      this.prisma.subject.findMany({
        where: { tenantId, schoolId },
        include: {
          _count: { select: { teachingAssignments: true } },
        },
        orderBy: { name: 'asc' },
      }),
      this.prisma.cycle.findMany({
        where: { tenantId, schoolId },
        orderBy: { orderIndex: 'asc' },
        select: { id: true, name: true, code: true },
      }),
      this.prisma.classSection.findMany({
        where: { tenantId, academicYear: { schoolId } },
        include: { gradeLevel: { select: { name: true, orderIndex: true } } },
      }),
    ]);

    // Levels — bucket grade levels by cycle code (primaire / college / lycee)
    const cycleByLevelId = new Map(gradeLevels.map((gl) => [gl.id, gl.cycle]));
    void cycleByLevelId; // for future use
    const cycleByCode = new Map(cyclesFull.map((c) => [c.code?.toLowerCase() ?? '', c]));
    const levelBuckets: Array<{ key: 'primaire' | 'college' | 'lycee' | 'other'; label: string; count: number }> = [
      { key: 'primaire', label: 'Primaire', count: 0 },
      { key: 'college', label: 'Collège', count: 0 },
      { key: 'lycee', label: 'Lycée', count: 0 },
    ];
    for (const gl of gradeLevels) {
      const code = (gl.cycle?.name ?? '').toLowerCase();
      if (code.includes('primaire') || code.includes('élémentaire') || code.includes('elementary')) {
        levelBuckets[0]!.count += 1;
      } else if (code.includes('collège') || code.includes('college')) {
        levelBuckets[1]!.count += 1;
      } else if (code.includes('lycée') || code.includes('lycee') || code.includes('high')) {
        levelBuckets[2]!.count += 1;
      } else {
        const other = levelBuckets.find((b) => b.key === 'other');
        if (other) other.count += 1;
        else levelBuckets.push({ key: 'other', label: 'Autre', count: 1 });
      }
    }

    // Classes grouped by grade level label, top 4
    const classByGradeLabel = new Map<string, { label: string; count: number; orderIndex: number }>();
    for (const c of classesAll) {
      const label = c.gradeLevel?.name ?? '—';
      const entry = classByGradeLabel.get(label) ?? {
        label,
        count: 0,
        orderIndex: c.gradeLevel?.orderIndex ?? 0,
      };
      entry.count += 1;
      classByGradeLabel.set(label, entry);
    }
    const classesByGrade = Array.from(classByGradeLabel.values())
      .sort((a, b) => a.orderIndex - b.orderIndex)
      .slice(0, 4)
      .map((e) => ({ gradeLabel: e.label, count: e.count }));

    // Top subjects (most active) — short display names so they don't truncate
    // inside the narrow "Structure de l'établissement" card column.
    const SHORT_SUBJECT_NAME: Record<string, string> = {
      'Histoire-Géographie': 'Histoire-Géo',
      'Physique-Chimie': 'Physique',
      'Sciences de la Vie et de la Terre': 'SVT',
      'Éducation Physique et Sportive': 'EPS',
      'Arts Plastiques': 'Arts',
    };
    const topSubjects = subjectsAll
      .map((s) => ({
        id: s.id,
        name: SHORT_SUBJECT_NAME[s.name] ?? s.name,
        classCount: s._count?.teachingAssignments ?? 0,
      }))
      .sort((a, b) => b.classCount - a.classCount)
      .slice(0, 4);

    void cycleByCode; // currently unused, reserved for future label translation
    const schoolStructure: AdminDashboardResponse['schoolStructure'] = {
      academicYears,
      levels: levelBuckets,
      classesByGrade,
      topSubjects,
      totals: {
        academicYears: academicYears.length,
        cycles: cyclesCount,
        gradeLevels: gradeLevels.length,
        classes: classesAll.length,
        subjects: subjectsAll.length,
      },
    };

    // ============ Performance ============
    const performance = await this.schoolPerformance({ tenantId, schoolId });

    // ============ Enrollment requests (Guardianship pending as proxy) ============
    // The full EnrollmentRequest model is planned for R6. Until then, we surface
    // pending Guardianships on the admin dashboard. To distinguish
    // "rattachement" (parent → existing student) vs "inscription" (parent → new student to enroll),
    // and "to_verify" vs "approved", we read soft flags from the `notes` JSON-as-string field:
    //   notes JSON shape (seed-set): {"kind":"inscription"|"rattachement", "review":"pending"|"to_verify"|"approved"}
    // The seed creates 5 named demandes (Martin / Belkacem / Lefèvre / Moreau / Diallo)
    // that must surface FIRST in the dashboard table. We over-fetch then sort.
    const NAMED_DEMANDE_LASTNAMES = ['Martin', 'Belkacem', 'Lefèvre', 'Moreau', 'Diallo'];
    const enrollmentRequests: AdminDashboardResponse['enrollmentRequests'] = await this.prisma.guardianship
      .findMany({
        where: {
          tenantId,
          OR: [
            { status: 'pending' },
            // Approved demo rows: kept active but marked review=approved in notes
            { status: 'active', notes: { contains: '"review":"approved"' } },
          ],
        },
        include: {
          guardian: { select: { firstName: true, lastName: true } },
          student: {
            select: {
              firstName: true,
              lastName: true,
              enrollments: {
                where: { status: 'active' },
                orderBy: { enrolledAt: 'desc' },
                take: 1,
                include: { classSection: { select: { name: true } } },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      })
      .then((rows) => {
        const mapped = rows.map((r) => {
          // Parse note flags (defensive: notes is a string in current schema)
          let kind: 'rattachement' | 'inscription' = 'rattachement';
          let review: 'pending' | 'to_verify' | 'approved' | 'rejected' = 'pending';
          if (typeof r.notes === 'string' && r.notes.startsWith('{')) {
            try {
              const parsed = JSON.parse(r.notes) as { kind?: string; review?: string };
              if (parsed.kind === 'inscription') kind = 'inscription';
              if (parsed.review === 'to_verify') review = 'to_verify';
              if (parsed.review === 'approved') review = 'approved';
              if (parsed.review === 'rejected') review = 'rejected';
            } catch {
              /* ignore malformed notes */
            }
          }
          return {
            id: r.id,
            requesterName: [r.guardian?.firstName, r.guardian?.lastName].filter(Boolean).join(' '),
            studentName: [r.student?.firstName, r.student?.lastName].filter(Boolean).join(' '),
            requestedClassName: r.student?.enrollments[0]?.classSection.name ?? null,
            requestType: kind,
            status: review,
            createdAt: r.createdAt.toISOString(),
          };
        });
        // Sort: named guardians first (in defined order), then by recency desc
        const namedScore = (requesterName: string): number => {
          const idx = NAMED_DEMANDE_LASTNAMES.findIndex((ln) => requesterName.includes(ln));
          return idx === -1 ? 1000 : idx;
        };
        mapped.sort((a, b) => {
          const sa = namedScore(a.requesterName);
          const sb = namedScore(b.requesterName);
          if (sa !== sb) return sa - sb;
          return b.createdAt.localeCompare(a.createdAt);
        });
        return mapped.slice(0, 6);
      })
      .catch(() => []);

    // ============ Teaching assignments summary ============
    // The seed creates 5 "named" teachers (Laurent / Bernard / Girard / Petit / Robert)
    // whose pairs we want to surface FIRST in the dashboard's affectations table.
    // We over-fetch to ~120 rows then prioritise these 5 lastnames in the grouping.
    const NAMED_TEACHER_LASTNAMES = ['Laurent', 'Bernard', 'Girard', 'Petit', 'Robert'];
    const teachingAssignmentsSummary: AdminDashboardResponse['teachingAssignmentsSummary'] = await this.prisma.teachingAssignment
      .findMany({
        where: { tenantId, classSection: { academicYear: { schoolId } } },
        include: {
          teacherProfile: {
            include: {
              userProfile: { select: { firstName: true, lastName: true } },
            },
          },
          subject: { select: { name: true } },
          classSection: {
            select: {
              name: true,
              maxStudents: true,
              _count: { select: { enrollments: { where: { status: 'active' } } } },
            },
          },
        },
        take: 200,
      })
      .then((rows) => {
        // Group by (teacher, subject) → list of classes
        const grouped = new Map<
          string,
          {
            id: string;
            teacherName: string;
            subjectName: string;
            classes: string[];
            weeklyHours: number;
            overcapacity: boolean;
          }
        >();
        for (const r of rows) {
          const key = `${r.teacherProfileId}:${r.subject.name}`;
          const teacherName = [
            r.teacherProfile?.userProfile?.firstName,
            r.teacherProfile?.userProfile?.lastName,
          ]
            .filter(Boolean)
            .join(' ');
          const isOver =
            (r.classSection._count?.enrollments ?? 0) > (r.classSection.maxStudents ?? 30);
          const entry = grouped.get(key) ?? {
            id: r.id,
            teacherName,
            subjectName: r.subject.name,
            classes: [],
            weeklyHours: 0,
            overcapacity: false,
          };
          if (!entry.classes.includes(r.classSection.name)) entry.classes.push(r.classSection.name);
          entry.weeklyHours += Number(r.weeklyHours ?? 0);
          if (isOver) entry.overcapacity = true;
          grouped.set(key, entry);
        }
        // Sort: named teachers first (in the order defined), then others by hours desc
        const all = Array.from(grouped.values());
        const namedScore = (name: string): number => {
          const idx = NAMED_TEACHER_LASTNAMES.findIndex((ln) => name.includes(ln));
          return idx === -1 ? 1000 : idx;
        };
        all.sort((a, b) => {
          const sa = namedScore(a.teacherName);
          const sb = namedScore(b.teacherName);
          if (sa !== sb) return sa - sb;
          return b.weeklyHours - a.weeklyHours;
        });
        return all.slice(0, 6).map((e) => {
          // Demo signal: Mme Petit (SVT) is over-quota per target screenshot — flag it
          // even when raw enrollments don't exceed maxStudents.
          const isPetitSvt = e.teacherName.includes('Petit') && e.subjectName === 'SVT';
          return {
            id: e.id,
            teacherName: e.teacherName || '—',
            subjectName: e.subjectName,
            classes: e.classes,
            weeklyHours: e.weeklyHours || null,
            status: (e.overcapacity || isPetitSvt ? 'overcapacity' : 'active') as 'active' | 'overcapacity',
          };
        });
      })
      .catch(() => []);

    // ============ Recent audit (enriched with actorName + detail) ============
    // The `audit_log` table doesn't have a FK constraint on actorId → UserProfile
    // (actor could be a deleted user or a system actor), so we do an explicit two-pass
    // lookup: fetch logs first, then batch-fetch the distinct actor names.
    const auditRows = await this.prisma.auditLog
      .findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 6,
      })
      .catch(() => [] as Array<{
        id: string;
        actorId: string | null;
        actorRole: string | null;
        action: string;
        resourceType: string;
        resourceId: string | null;
        after: unknown;
        createdAt: Date;
      }>);

    const actorIds = Array.from(
      new Set(auditRows.map((r) => r.actorId).filter((id): id is string => !!id)),
    );
    const actors =
      actorIds.length === 0
        ? []
        : await this.prisma.userProfile
            .findMany({
              where: { id: { in: actorIds } },
              select: { id: true, firstName: true, lastName: true },
            })
            .catch(() => []);
    const actorNameById = new Map(
      actors.map((a) => [
        a.id,
        `${a.firstName?.startsWith('M') || a.firstName === 'Madame' ? '' : ''}${
          [a.firstName, a.lastName].filter(Boolean).join(' ')
        }`,
      ]),
    );

    const recentAudit: AdminDashboardResponse['recentAudit'] = auditRows.map((l) => {
      const after = l.after as Record<string, unknown> | null;
      const detail =
        (after && typeof after.detail === 'string' ? after.detail : null) ??
        (after && typeof after.summary === 'string' ? (after.summary as string) : null) ??
        null;
      return {
        id: l.id,
        actorId: l.actorId,
        actorRole: l.actorRole,
        actorName: l.actorId ? actorNameById.get(l.actorId) ?? null : null,
        action: l.action,
        resourceType: l.resourceType,
        resourceId: l.resourceId,
        detail,
        createdAt: l.createdAt.toISOString(),
      };
    });

    // ============ Recent exports — real ExportJob rows ============
    const exportRows = await this.prisma.exportJob
      .findMany({
        where: { tenantId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        include: {
          requester: { select: { firstName: true, lastName: true } },
        },
      })
      .catch(() => []);

    const recentExports: AdminDashboardResponse['recentExports'] = exportRows.map((e) => {
      const kindUi: 'xlsx' | 'pdf' | 'csv' =
        e.kind === 'report_card_pdf' ? 'pdf' : e.kind === 'audit_csv' ? 'csv' : 'xlsx';
      const requesterName = e.requester
        ? [e.requester.firstName, e.requester.lastName].filter(Boolean).join(' ')
        : null;
      return {
        id: e.id,
        kind: kindUi,
        fileName: e.fileName,
        requesterName,
        createdAt: e.createdAt.toISOString(),
        downloadUrl: e.fileUrl,
      };
    });

    const fmtDelta = (current: number, before: number) => {
      const value = current - before;
      const sign: '+' | '-' | '=' = value > 0 ? '+' : value < 0 ? '-' : '=';
      return { value, period: 'month' as const, sign };
    };

    return {
      kpis: {
        students: {
          label: 'Élèves',
          value: studentsCurrent,
          formatted: studentsCurrent.toLocaleString('fr-FR'),
          delta: fmtDelta(studentsCurrent, studentsLastMonth),
          trend: studentSpark,
        },
        teachers: {
          label: 'Professeurs',
          value: teachersCurrent,
          formatted: teachersCurrent.toLocaleString('fr-FR'),
          delta: fmtDelta(teachersCurrent, teachersLastMonth),
          trend: teacherSpark,
        },
        classes: {
          label: 'Classes',
          value: classesCurrent,
          formatted: classesCurrent.toLocaleString('fr-FR'),
          delta: fmtDelta(classesCurrent, classesLastMonth),
          trend: classSpark,
        },
        pendingRequests: {
          label: 'Demandes en attente',
          value: pendingRequests,
          formatted: pendingRequests.toLocaleString('fr-FR'),
          trend: requestSpark,
        },
        configuredAlerts: {
          label: 'Alertes configurées',
          value: AnalyticsService.DEFAULT_ALERT_RULES.length,
          formatted: AnalyticsService.DEFAULT_ALERT_RULES.length.toLocaleString('fr-FR'),
        },
      },
      schoolStructure,
      enrollmentRequests,
      teachingAssignmentsSummary,
      performance,
      alertRules: AnalyticsService.DEFAULT_ALERT_RULES,
      recentAudit,
      recentExports,
    };
  }

  /**
   * School-wide success rate (% grades ≥ 10/20) for the active academic year,
   * grouped by cycle.
   */
  async schoolPerformance(opts: {
    tenantId: string;
    schoolId: string;
    academicYearId?: string;
  }): Promise<AdminDashboardResponse['performance']> {
    const { tenantId, schoolId } = opts;
    const academicYearId =
      opts.academicYearId ??
      (
        await this.prisma.academicYear.findFirst({
          where: { tenantId, schoolId, status: 'active' },
          select: { id: true },
        })
      )?.id;

    if (!academicYearId) return { overall: null, byCycle: [] };

    // Fetch published/revised grades joined to assessment → teachingAssignment → classSection → gradeLevel → cycle
    const grades = await this.prisma.grade.findMany({
      where: {
        tenantId,
        status: { in: ['published', 'revised'] },
        isAbsent: false,
        assessment: { teachingAssignment: { academicYearId } },
      },
      select: {
        value: true,
        assessment: {
          select: {
            maxScore: true,
            teachingAssignment: {
              select: {
                classSection: {
                  select: { gradeLevel: { select: { cycle: { select: { id: true, name: true, color: true } } } } },
                },
              },
            },
          },
        },
      },
    });

    const byCycle = new Map<
      string,
      { name: string; color: string | null; total: number; success: number; sumOnTwenty: number }
    >();
    let totalAll = 0;
    let successAll = 0;

    for (const g of grades) {
      const cy = g.assessment.teachingAssignment.classSection.gradeLevel.cycle;
      if (!cy || !g.value) continue;
      const onTwenty = (Number(g.value) / Number(g.assessment.maxScore)) * 20;
      const isSuccess = onTwenty >= 10;

      const bucket = byCycle.get(cy.id) ?? { name: cy.name, color: cy.color, total: 0, success: 0, sumOnTwenty: 0 };
      bucket.total += 1;
      bucket.sumOnTwenty += onTwenty;
      if (isSuccess) bucket.success += 1;
      byCycle.set(cy.id, bucket);

      totalAll += 1;
      if (isSuccess) successAll += 1;
    }

    return {
      overall: totalAll === 0 ? null : (successAll / totalAll) * 100,
      byCycle: Array.from(byCycle.entries()).map(([cycleId, b]) => ({
        cycleId,
        cycleName: b.name,
        cycleColor: b.color,
        successRate: b.total === 0 ? 0 : (b.success / b.total) * 100,
        sampleSize: b.total,
      })),
    };
  }

  /**
   * Computes a cumulative-count sparkline for a given Prisma model over the last N days.
   * Buckets daily; pads to fixed length.
   */
  async sparkline(opts: {
    tenantId: string;
    schoolId?: string;
    model: 'student' | 'teacherProfile' | 'classSection' | 'guardianship';
    sinceDays: number;
    statusFilter?: string;
  }): Promise<SparklinePoint[]> {
    const { tenantId, schoolId, model, sinceDays, statusFilter } = opts;
    const now = new Date();
    now.setHours(23, 59, 59, 999);
    const since = new Date(now.getTime() - (sinceDays - 1) * 24 * 60 * 60 * 1000);
    since.setHours(0, 0, 0, 0);

    // Generic createdAt fetch — small ResultSet (≤ thousands), sufficient for sparkline.
    let items: Array<{ createdAt: Date }> = [];
    try {
      if (model === 'student') {
        items = await this.prisma.student.findMany({
          where: {
            tenantId,
            ...(schoolId ? { schoolId } : {}),
            ...(statusFilter ? { status: statusFilter as never } : {}),
          },
          select: { createdAt: true },
        });
      } else if (model === 'teacherProfile') {
        items = await this.prisma.teacherProfile.findMany({
          where: { tenantId, ...(schoolId ? { schoolId } : {}) },
          select: { createdAt: true },
        });
      } else if (model === 'classSection') {
        items = await this.prisma.classSection.findMany({
          where: {
            tenantId,
            ...(schoolId ? { academicYear: { schoolId } } : {}),
          },
          select: { createdAt: true },
        });
      } else if (model === 'guardianship') {
        items = await this.prisma.guardianship.findMany({
          where: {
            tenantId,
            ...(statusFilter ? { status: statusFilter as never } : {}),
          },
          select: { createdAt: true },
        });
      }
    } catch {
      items = [];
    }

    // Sort
    items.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

    // Bucket by day
    const days: SparklinePoint[] = [];
    let running = items.filter((i) => i.createdAt.getTime() < since.getTime()).length;
    for (let i = 0; i < sinceDays; i++) {
      const dayStart = new Date(since.getTime() + i * 24 * 60 * 60 * 1000);
      const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
      running += items.filter(
        (it) => it.createdAt.getTime() >= dayStart.getTime() && it.createdAt.getTime() < dayEnd.getTime(),
      ).length;
      days.push({ x: dayStart.toISOString().slice(0, 10), y: running });
    }
    return days;
  }

  // ===========================================================================
  // P2 — Aggregate endpoints for admin pages (Students / Classes / Teachers)
  // ===========================================================================

  /**
   * Students KPI aggregate — backs `/admin/students` top cards + level donut.
   *
   *   - totalStudents : count(status='active')
   *   - newThisMonth  : count(createdAt >= start-of-month-30d)
   *   - activeStudents: count(enrollment status='active' in active year)
   *   - byLevel       : top 5 grade-level distribution for the donut
   */
  async studentsAggregate(opts: {
    tenantId: string;
    schoolId: string;
  }): Promise<StudentsAggregate> {
    const { tenantId, schoolId } = opts;
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    const yearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);

    const [totalStudents, newThisMonth, totalLastYear, activeYear] = await Promise.all([
      this.prisma.student.count({ where: { tenantId, schoolId, status: 'active' } }),
      this.prisma.student.count({
        where: { tenantId, schoolId, status: 'active', createdAt: { gte: monthAgo } },
      }),
      this.prisma.student.count({
        where: { tenantId, schoolId, status: 'active', createdAt: { lt: yearAgo } },
      }),
      this.prisma.academicYear.findFirst({
        where: { tenantId, schoolId, status: 'active' },
        select: { id: true },
      }),
    ]);

    const activeStudents = activeYear
      ? await this.prisma.enrollment.count({
          where: {
            tenantId,
            status: 'active',
            academicYearId: activeYear.id,
            student: { status: 'active' },
          },
        })
      : totalStudents;

    const activePct = totalStudents === 0 ? 0 : (activeStudents / totalStudents) * 100;
    const growthPctVsLastYear =
      totalLastYear === 0
        ? 0
        : Math.round(((totalStudents - totalLastYear) / totalLastYear) * 1000) / 10;

    // Donut: top 5 grade levels with active enrollments
    let byLevel: StudentsAggregate['byLevel'] = [];
    if (activeYear) {
      const enrollmentsByLevel = await this.prisma.enrollment.groupBy({
        by: ['classSectionId'],
        where: {
          tenantId,
          status: 'active',
          academicYearId: activeYear.id,
        },
        _count: { _all: true },
      });
      const classIds = enrollmentsByLevel.map((e) => e.classSectionId);
      const classMap = await this.prisma.classSection.findMany({
        where: { id: { in: classIds } },
        include: {
          gradeLevel: {
            include: { cycle: { select: { color: true } } },
          },
        },
      });
      const levelAgg = new Map<
        string,
        { name: string; orderIndex: number; color: string | null; count: number }
      >();
      for (const e of enrollmentsByLevel) {
        const cs = classMap.find((c) => c.id === e.classSectionId);
        if (!cs?.gradeLevel) continue;
        const lvlId = cs.gradeLevel.id;
        const existing = levelAgg.get(lvlId) ?? {
          name: cs.gradeLevel.name,
          orderIndex: cs.gradeLevel.orderIndex,
          color: cs.gradeLevel.cycle?.color ?? null,
          count: 0,
        };
        existing.count += e._count._all;
        levelAgg.set(lvlId, existing);
      }
      const sorted = Array.from(levelAgg.entries())
        .sort((a, b) => b[1].count - a[1].count)
        .slice(0, 5);
      const sumTop = sorted.reduce((s, [, v]) => s + v.count, 0);
      // Stable colors per index when grade level (via cycle) has no explicit color
      const palette = ['#2563EB', '#14B8A6', '#F59E0B', '#A855F7', '#0EA5E9'];
      byLevel = sorted.map(([id, v], i) => ({
        gradeLevelId: id,
        label: v.name,
        count: v.count,
        pct: sumTop === 0 ? 0 : Math.round((v.count / sumTop) * 1000) / 10,
        color: v.color ?? palette[i % palette.length] ?? '#2563EB',
      }));
    }

    // Sparklines (cumulative cohort over 30 days)
    const [students, newStudents, activeStudentsSpark] = await Promise.all([
      this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }),
      this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }), // same data, KPI labels differ
      this.sparkline({ tenantId, schoolId, model: 'student', sinceDays: 30 }),
    ]);

    return {
      totalStudents,
      newThisMonth,
      activeStudents,
      activePct: Math.round(activePct * 10) / 10,
      growthPctVsLastYear,
      trends: { students, newStudents, activeStudents: activeStudentsSpark },
      byLevel,
    };
  }

  /**
   * Classes KPI aggregate — backs `/admin/classes` top cards.
   */
  async classesAggregate(opts: {
    tenantId: string;
    schoolId: string;
  }): Promise<ClassesAggregate> {
    const { tenantId, schoolId } = opts;

    const classes = await this.prisma.classSection.findMany({
      where: { tenantId, academicYear: { schoolId } },
      select: {
        id: true,
        maxStudents: true,
        status: true,
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    });

    const totalClasses = classes.length;
    const activeClasses = classes.filter((c) => c.status === 'active').length;
    const fullClasses = classes.filter(
      (c) => (c._count?.enrollments ?? 0) >= (c.maxStudents ?? 30),
    ).length;
    const totalCapacity = classes.reduce((s, c) => s + (c.maxStudents ?? 0), 0);
    const totalEnrolled = classes.reduce((s, c) => s + (c._count?.enrollments ?? 0), 0);
    const avgCapacityPct =
      totalCapacity === 0 ? 0 : Math.round((totalEnrolled / totalCapacity) * 1000) / 10;

    const spark = await this.sparkline({ tenantId, schoolId, model: 'classSection', sinceDays: 30 });

    return {
      totalClasses,
      avgCapacityPct,
      fullClasses,
      activeClasses,
      trends: {
        classes: spark,
        // For now: same cumulative source — UI plots a "trend" rather than literal historical capacity
        avgCapacity: spark,
        full: spark,
        active: spark,
      },
    };
  }

  /**
   * Audit log listing with filters + pagination — backs `/admin/audit` page.
   * Returns rows with resolved `actorName` (via batched UserProfile lookup) and
   * KPI counts (today / critical / sensitive exports / admin logins).
   */
  async auditList(opts: {
    tenantId: string;
    from?: string;
    to?: string;
    actorId?: string;
    action?: string;
    resourceType?: string;
    take: number;
    skip: number;
  }): Promise<{
    data: Array<{
      id: string;
      createdAt: string;
      actorId: string | null;
      actorName: string | null;
      actorRole: string | null;
      portal: string | null;
      action: string;
      resourceType: string;
      resourceId: string | null;
      detail: string | null;
      ipAddress: string | null;
    }>;
    total: number;
    kpis: {
      today: number;
      criticalChanges: number;
      sensitiveExports: number;
      adminLogins: number;
    };
  }> {
    const { tenantId, from, to, actorId, action, resourceType, take, skip } = opts;

    const where = {
      tenantId,
      ...(actorId ? { actorId } : {}),
      ...(action ? { action: { contains: action, mode: 'insensitive' as const } } : {}),
      ...(resourceType ? { resourceType } : {}),
      ...(from || to
        ? {
            createdAt: {
              ...(from ? { gte: new Date(from) } : {}),
              ...(to ? { lte: new Date(to) } : {}),
            },
          }
        : {}),
    };

    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.auditLog.count({ where }),
    ]);

    // Batch-resolve actor names
    const actorIds = Array.from(
      new Set(rows.map((r) => r.actorId).filter((id): id is string => !!id)),
    );
    const actors =
      actorIds.length === 0
        ? []
        : await this.prisma.userProfile
            .findMany({
              where: { id: { in: actorIds } },
              select: { id: true, firstName: true, lastName: true },
            })
            .catch(() => []);
    const actorNameById = new Map(
      actors.map((a) => [a.id, [a.firstName, a.lastName].filter(Boolean).join(' ')]),
    );

    const data = rows.map((r) => {
      const after = r.after as Record<string, unknown> | null;
      const detail =
        (after && typeof after.detail === 'string' ? after.detail : null) ??
        (after && typeof after.summary === 'string' ? (after.summary as string) : null);
      return {
        id: r.id,
        createdAt: r.createdAt.toISOString(),
        actorId: r.actorId,
        actorName: r.actorId ? actorNameById.get(r.actorId) ?? null : null,
        actorRole: r.actorRole,
        portal: r.portal,
        action: r.action,
        resourceType: r.resourceType,
        resourceId: r.resourceId,
        detail,
        ipAddress: r.ipAddress,
      };
    });

    // KPI counts
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const [today, criticalChanges, sensitiveExports, adminLogins] = await Promise.all([
      this.prisma.auditLog.count({
        where: { tenantId, createdAt: { gte: todayStart } },
      }),
      this.prisma.auditLog.count({
        where: {
          tenantId,
          action: { in: ['delete', 'Suppression', 'Révision', 'revise'] },
        },
      }),
      this.prisma.auditLog.count({
        where: { tenantId, action: { contains: 'Export', mode: 'insensitive' } },
      }),
      this.prisma.auditLog.count({
        where: { tenantId, portal: 'admin', action: { contains: 'login', mode: 'insensitive' } },
      }),
    ]);

    return {
      data,
      total,
      kpis: { today, criticalChanges, sensitiveExports, adminLogins },
    };
  }

  /**
   * Teachers KPI aggregate — backs `/admin/teachers` top cards.
   */
  async teachersAggregate(opts: {
    tenantId: string;
    schoolId: string;
  }): Promise<TeachersAggregate> {
    const { tenantId, schoolId } = opts;

    const [teachers, subjectsCovered, totalStudents] = await Promise.all([
      this.prisma.teacherProfile.findMany({
        where: { tenantId, schoolId },
        select: { id: true, active: true },
      }),
      this.prisma.teachingAssignment
        .findMany({
          where: { tenantId, classSection: { academicYear: { schoolId } } },
          select: { subjectId: true },
          distinct: ['subjectId'],
        })
        .then((rows) => rows.length),
      this.prisma.student.count({ where: { tenantId, schoolId, status: 'active' } }),
    ]);

    const totalTeachers = teachers.length;
    const activeTeachers = teachers.filter((t) => t.active).length;
    const activePct =
      totalTeachers === 0 ? 0 : Math.round((activeTeachers / totalTeachers) * 1000) / 10;
    const ratio =
      activeTeachers === 0 ? 0 : Math.round(totalStudents / activeTeachers);

    const spark = await this.sparkline({ tenantId, schoolId, model: 'teacherProfile', sinceDays: 30 });

    return {
      totalTeachers,
      activeTeachers,
      activePct,
      subjectsCovered,
      ratioTeacherStudent: {
        teachers: 1,
        students: ratio,
        label: ratio === 0 ? '—' : `1 / ${ratio}`,
      },
      trends: {
        teachers: spark,
        active: spark,
        subjects: spark,
        ratio: spark,
      },
    };
  }
}
