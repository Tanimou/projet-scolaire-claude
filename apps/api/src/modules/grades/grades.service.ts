import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

interface GradeForAvg {
  value: Prisma.Decimal | null;
  isAbsent: boolean;
  assessment: {
    maxScore: Prisma.Decimal;
    coefficientOverride: Prisma.Decimal | null;
    teachingAssignment: { subjectId: string; classSection: { gradeLevelId: string } };
  };
}

interface SubjectStats {
  subjectId: string;
  subjectName: string;
  subjectColor: string | null;
  coefficient: number;
  count: number;
  /** weighted average over 20, null if no grade */
  average: number | null;
  min: number | null;
  max: number | null;
}

interface OverallStats {
  bySubject: SubjectStats[];
  overallAverage: number | null;
  overallTrend?: { previousAverage: number | null; delta: number | null };
}

/**
 * Pure-function calculator for student averages. Centralised here so that
 * teacher portal, parent portal, bulletin generation (Phase 6) and any
 * forthcoming analytics consume the SAME coefficient logic.
 *
 * Effective coefficient resolution (most-specific wins):
 *   1. Assessment.coefficientOverride (this individual assessment)
 *   2. SubjectCoefficient(gradeLevelId, subjectId).coefficient (for that level)
 *   3. Subject.defaultCoefficient (school-wide default)
 */
@Injectable()
export class GradesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Computes per-subject and overall weighted averages for a student.
   *
   * `filter` lets callers restrict to a term, year, etc.
   * Only `published` and `revised` grades are included (drafts are ignored).
   * Absences ARE excluded from the average (they don't count as 0 — they're a
   * non-event from a statistics standpoint).
   */
  async statsForStudent(
    studentId: string,
    tenantId: string,
    filter: { termId?: string; academicYearId?: string; subjectId?: string } = {},
  ): Promise<OverallStats> {
    const grades = await this.prisma.grade.findMany({
      where: {
        studentId,
        tenantId,
        status: { in: ['published', 'revised'] },
        isAbsent: false,
        ...(filter.termId ? { assessment: { termId: filter.termId } } : {}),
        ...(filter.academicYearId
          ? { assessment: { teachingAssignment: { academicYearId: filter.academicYearId } } }
          : {}),
        ...(filter.subjectId
          ? { assessment: { teachingAssignment: { subjectId: filter.subjectId } } }
          : {}),
      },
      include: {
        assessment: {
          include: {
            teachingAssignment: {
              include: {
                classSection: { select: { gradeLevelId: true } },
                subject: { select: { id: true, name: true, color: true, defaultCoefficient: true } },
              },
            },
          },
        },
      },
    });

    // pre-load all coefficient overrides for the (gradeLevel × subject) pairs we encounter
    const pairs = new Set<string>();
    for (const g of grades) {
      pairs.add(
        `${g.assessment.teachingAssignment.classSection.gradeLevelId}:${g.assessment.teachingAssignment.subjectId}`,
      );
    }
    const overrides = await this.prisma.subjectCoefficient.findMany({
      where: {
        OR: [...pairs].map((p) => {
          const [gradeLevelId, subjectId] = p.split(':');
          return { gradeLevelId, subjectId };
        }),
      },
    });
    const coefByPair = new Map<string, number>();
    for (const o of overrides) {
      coefByPair.set(`${o.gradeLevelId}:${o.subjectId}`, Number(o.coefficient));
    }

    // Per-subject aggregation
    type Bucket = {
      subjectId: string;
      subjectName: string;
      subjectColor: string | null;
      coefficient: number; // subject-level coef (used for OVERALL average across subjects)
      /** weighted accumulator over 20 for THIS subject (assessment-level weights) */
      weightedSum: number;
      weightSum: number;
      values: number[];
    };
    const bySubjectId = new Map<string, Bucket>();

    for (const g of grades) {
      if (g.value === null) continue;
      const subj = g.assessment.teachingAssignment.subject;
      const pair = `${g.assessment.teachingAssignment.classSection.gradeLevelId}:${g.assessment.teachingAssignment.subjectId}`;
      const subjectCoef =
        coefByPair.get(pair) ?? Number(subj.defaultCoefficient);

      const assessmentCoef =
        g.assessment.coefficientOverride !== null
          ? Number(g.assessment.coefficientOverride)
          : subjectCoef;

      const scoreOn20 = (Number(g.value) / Number(g.assessment.maxScore)) * 20;

      const b =
        bySubjectId.get(subj.id) ??
        ({
          subjectId: subj.id,
          subjectName: subj.name,
          subjectColor: subj.color,
          coefficient: subjectCoef,
          weightedSum: 0,
          weightSum: 0,
          values: [],
        } as Bucket);
      b.weightedSum += scoreOn20 * assessmentCoef;
      b.weightSum += assessmentCoef;
      b.values.push(scoreOn20);
      bySubjectId.set(subj.id, b);
    }

    const bySubject: SubjectStats[] = [...bySubjectId.values()].map((b) => ({
      subjectId: b.subjectId,
      subjectName: b.subjectName,
      subjectColor: b.subjectColor,
      coefficient: b.coefficient,
      count: b.values.length,
      average: b.weightSum > 0 ? round2(b.weightedSum / b.weightSum) : null,
      min: b.values.length ? round2(Math.min(...b.values)) : null,
      max: b.values.length ? round2(Math.max(...b.values)) : null,
    }));
    bySubject.sort((a, b) => a.subjectName.localeCompare(b.subjectName));

    // Overall = weighted average across subjects (each subject weighted by subject coef)
    let totalWeighted = 0;
    let totalWeight = 0;
    for (const s of bySubject) {
      if (s.average !== null) {
        totalWeighted += s.average * s.coefficient;
        totalWeight += s.coefficient;
      }
    }
    const overallAverage = totalWeight > 0 ? round2(totalWeighted / totalWeight) : null;

    return { bySubject, overallAverage };
  }

  /**
   * Class-wide aggregation for a teacher's class+subject gradebook.
   * Returns each student of the class with their average for the subject.
   */
  async gradebookForAssignment(
    teachingAssignmentId: string,
    tenantId: string,
    options: { termId?: string } = {},
  ) {
    const assignment = await this.prisma.teachingAssignment.findUnique({
      where: { id: teachingAssignmentId },
      include: {
        classSection: {
          include: {
            gradeLevel: { include: { cycle: true } },
            enrollments: {
              where: { status: 'active' },
              include: { student: true },
              orderBy: { student: { lastName: 'asc' } },
            },
          },
        },
        subject: true,
      },
    });
    if (!assignment || assignment.tenantId !== tenantId) return null;

    const assessments = await this.prisma.assessment.findMany({
      where: { teachingAssignmentId, ...(options.termId ? { termId: options.termId } : {}) },
      include: { grades: true },
      orderBy: { scheduledAt: 'asc' },
    });

    // Resolve subject coefficient at this grade level (fallback to subject default)
    const baseCoef =
      (
        await this.prisma.subjectCoefficient.findUnique({
          where: {
            gradeLevelId_subjectId: {
              gradeLevelId: assignment.classSection.gradeLevelId,
              subjectId: assignment.subjectId,
            },
          },
        })
      )?.coefficient ?? assignment.subject.defaultCoefficient;

    const baseCoefNum = Number(baseCoef);

    // Build matrix: students × assessments
    const matrix = assignment.classSection.enrollments.map((e) => {
      const grades = assessments.map((a) => {
        const g = a.grades.find((gr) => gr.studentId === e.student.id);
        return g
          ? {
              id: g.id,
              value: g.value === null ? null : Number(g.value),
              isAbsent: g.isAbsent,
              status: g.status,
              comment: g.comment,
              isFlagged: g.isFlagged,
              flagNote: g.flagNote,
            }
          : null;
      });

      // Average per student
      let weightedSum = 0;
      let weightSum = 0;
      let count = 0;
      assessments.forEach((a, idx) => {
        const g = grades[idx];
        if (!g || g.value === null || g.isAbsent) return;
        const assessmentCoef =
          a.coefficientOverride !== null ? Number(a.coefficientOverride) : baseCoefNum;
        const scoreOn20 = (g.value / Number(a.maxScore)) * 20;
        weightedSum += scoreOn20 * assessmentCoef;
        weightSum += assessmentCoef;
        count += 1;
      });

      return {
        enrollmentId: e.id,
        studentId: e.student.id,
        student: {
          id: e.student.id,
          firstName: e.student.firstName,
          lastName: e.student.lastName,
          externalRef: e.student.externalRef,
        },
        grades,
        average: weightSum > 0 ? round2(weightedSum / weightSum) : null,
        count,
      };
    });

    return {
      assignment: {
        id: assignment.id,
        classSection: {
          id: assignment.classSection.id,
          name: assignment.classSection.name,
          gradeLevel: assignment.classSection.gradeLevel,
        },
        subject: assignment.subject,
        baseCoefficient: baseCoefNum,
      },
      assessments: assessments.map((a) => ({
        id: a.id,
        title: a.title,
        kind: a.kind,
        scheduledAt: a.scheduledAt,
        maxScore: Number(a.maxScore),
        coefficientOverride: a.coefficientOverride !== null ? Number(a.coefficientOverride) : null,
        effectiveCoefficient:
          a.coefficientOverride !== null ? Number(a.coefficientOverride) : baseCoefNum,
        isPublished: a.isPublished,
        termId: a.termId,
      })),
      rows: matrix,
      classAverage:
        matrix.length > 0
          ? round2(
              matrix.reduce((s, r) => s + (r.average ?? 0), 0) /
                (matrix.filter((r) => r.average !== null).length || 1),
            )
          : null,
    };
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
