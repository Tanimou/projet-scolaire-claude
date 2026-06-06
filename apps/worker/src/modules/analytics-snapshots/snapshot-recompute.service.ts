import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import {
  competitionRank,
  distribution,
  mean,
  onTwenty,
  resolveCoef,
  round2,
  trendDelta,
  weightedGlobal,
} from './snapshot-formula';

/**
 * E6-S5 — value-column equality helpers for the idempotent rebuild path.
 *
 * The per-term snapshot rows carry a `revision` optimistic counter that the S1
 * upsert bumps on EVERY `update`. That makes a naive re-run advance `revision`
 * even when the underlying grades did not change — violating the S5 AC
 * "re-run on unchanged grades → identical rows AND identical revision". The fix
 * (architect Concern 1, PM-A #3): **read-compare-write** — before each `update`
 * we compare the freshly-derived value columns against the stored row and SKIP
 * the write entirely (no `computedAt` move, no `revision` bump) when nothing
 * changed. So a stable rebuild is a true no-op on the value rows. The first
 * compute (no row yet) still `create`s; a real grade change still updates +
 * bumps. This keeps byte-parity with live (the figures are unchanged) while
 * making the full rebuild idempotent at the row level.
 */
function decEq(a: unknown, b: number | null): boolean {
  const an = a == null ? null : Number(a);
  if (an == null || b == null) return an == null && b == null;
  // Both already at the Decimal(5,2) write boundary → exact compare.
  return an === b;
}
function intEq(a: unknown, b: number | null): boolean {
  const an = a == null ? null : Number(a);
  return an === (b == null ? null : Number(b));
}

/**
 * E6-S1 — recompute one snapshot scope, byte-parity with the live
 * `AnalyticsService`, idempotently, in ONE transaction.
 *
 * A `grade_published` trigger scopes to `(classSectionId, subjectId, termId,
 * academicYearId)` but the recompute is **class-wide** for that academic year:
 * publishing a grade shifts class averages / ranks / the weighted global for every
 * pupil in the class, so we rebuild the whole class slice (still ONE class-grade
 * `findMany` — PM-8, never a per-student dashboard re-run).
 *
 * Per scope, in one `$transaction`:
 *   1. fetch the class grades ONCE (published/revised, non-absent),
 *   2. derive per-(student × subject × term) means → `StudentSubjectSnapshot`
 *      (per-term rows upserted on the natural key + a year roll-up `termId IS NULL`
 *      row written via delete-then-insert, PM-4),
 *   3. cascade per-(student × term) coefficient-weighted global +
 *      mean-of-means-rank → `StudentGlobalSnapshot`,
 *   4. refresh the affected subject's `ClassSubjectDistribution` (per-term + roll-up),
 *   5. stamp `computedAt = now`, `sourceEventId = trigger.id`, bump `revision`.
 *
 * Idempotent: re-running on unchanged grades produces identical figures (only
 * `computedAt`/`revision` move). Every query carries explicit `where: { tenantId }`.
 */
@Injectable()
export class SnapshotRecomputeService {
  private readonly logger = new Logger(SnapshotRecomputeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Recompute the snapshot slice for a trigger. Returns the number of student-subject
   * rows written (for observability). Throws on a hard failure (the cron parks the
   * trigger). A scope missing its `classSectionId`/`academicYearId` is a no-op.
   */
  async recomputeScope(trigger: {
    id: string;
    tenantId: string;
    classSectionId: string | null;
    subjectId: string | null;
    academicYearId: string | null;
  }): Promise<{ subjectRows: number; globalRows: number; distributionRows: number }> {
    const { id: sourceEventId, tenantId, classSectionId } = trigger;
    if (!classSectionId) return { subjectRows: 0, globalRows: 0, distributionRows: 0 };

    // Resolve the class section (school + grade level + academic year). Tenant-scoped.
    const section = await this.prisma.classSection.findFirst({
      where: { id: classSectionId, tenantId },
      select: { id: true, gradeLevelId: true, academicYearId: true },
    });
    if (!section) return { subjectRows: 0, globalRows: 0, distributionRows: 0 };
    const academicYearId = trigger.academicYearId ?? section.academicYearId;

    // Coefficient overrides for this grade level (gradeLevel × subject). Tenant-scoped.
    const subjectCoefs = await this.prisma.subjectCoefficient.findMany({
      where: { tenantId, gradeLevelId: section.gradeLevelId },
      select: { subjectId: true, coefficient: true },
    });
    const coefMap = new Map(subjectCoefs.map((c) => [c.subjectId, Number(c.coefficient)]));

    // The single class-grade scan (PM-8): all published/revised, non-absent grades
    // for this class in this year, across all subjects (needed for the weighted global).
    const classGrades = await this.prisma.grade.findMany({
      where: {
        tenantId,
        status: { in: ['published', 'revised'] },
        isAbsent: false,
        assessment: { teachingAssignment: { classSectionId, academicYearId } },
      },
      select: {
        value: true,
        studentId: true,
        assessment: {
          select: {
            maxScore: true,
            coefficientOverride: true,
            term: { select: { id: true, orderIndex: true } },
            teachingAssignment: {
              select: {
                subject: { select: { id: true, defaultCoefficient: true } },
              },
            },
          },
        },
      },
    });

    // Per-student school resolution (snapshots carry a school_id). One query.
    const studentIds = [...new Set(classGrades.map((g) => g.studentId))];
    const students =
      studentIds.length > 0
        ? await this.prisma.student.findMany({
            where: { tenantId, id: { in: studentIds } },
            select: { id: true, schoolId: true },
          })
        : [];
    const schoolByStudent = new Map(students.map((s) => [s.id, s.schoolId]));
    // Snapshot rows need a non-null school_id; fall back to the first known school.
    const fallbackSchoolId = students[0]?.schoolId ?? null;

    // --- In-memory aggregation (mirrors the live perStudentSubject pass) ---
    // key: studentId -> subjectId -> termId(|'__year__') -> onTwenty[]
    const YEAR = '__year__';
    type Cell = { values: number[]; coef: number; termOrder: number };
    const perStudent = new Map<string, Map<string, Map<string, Cell>>>();
    // class-level per (subject, term) onTwenty list for distribution + class average
    const classSubjectTerm = new Map<string, Map<string, number[]>>();
    const subjectsSeen = new Set<string>();

    for (const g of classGrades) {
      if (g.value == null) continue;
      const subj = g.assessment.teachingAssignment.subject;
      const ot = onTwenty(Number(g.value), Number(g.assessment.maxScore));
      const coef = resolveCoef(
        g.assessment.coefficientOverride != null ? Number(g.assessment.coefficientOverride) : null,
        coefMap.get(subj.id),
        Number(subj.defaultCoefficient),
      );
      const termId = g.assessment.term?.id ?? null;
      const termOrder = g.assessment.term?.orderIndex ?? 0;
      subjectsSeen.add(subj.id);

      // Push the grade into its per-term bucket (when it has a term) AND the YEAR
      // roll-up bucket. A grade with no term contributes only to the year roll-up.
      const termKeys = termId === null ? [YEAR] : [termId, YEAR];

      const subjMap = perStudent.get(g.studentId) ?? new Map<string, Map<string, Cell>>();
      const termMap = subjMap.get(subj.id) ?? new Map<string, Cell>();
      for (const tKey of termKeys) {
        const cell = termMap.get(tKey) ?? { values: [], coef, termOrder };
        cell.values.push(ot);
        cell.coef = coef;
        // The per-term cell keeps its own order; the YEAR cell uses the max order
        // so a later-term grade dominates the (unused-for-year) ordering field.
        if (tKey !== YEAR) cell.termOrder = termOrder;
        termMap.set(tKey, cell);
      }
      subjMap.set(subj.id, termMap);
      perStudent.set(g.studentId, subjMap);

      // class distribution buckets (per subject, per term + year)
      const cst = classSubjectTerm.get(subj.id) ?? new Map<string, number[]>();
      for (const tKey of termKeys) {
        const arr = cst.get(tKey) ?? [];
        arr.push(ot);
        cst.set(tKey, arr);
      }
      classSubjectTerm.set(subj.id, cst);
    }

    // --- Derive per-(student × subject × term) averages ---
    interface SubjectRow {
      studentId: string;
      subjectId: string;
      termId: string | null;
      average: number | null;
      coefficient: number;
      gradeCount: number;
      termOrder: number;
    }
    const subjectRows: SubjectRow[] = [];
    for (const [studentId, subjMap] of perStudent.entries()) {
      for (const [subjectId, termMap] of subjMap.entries()) {
        for (const [tKey, cell] of termMap.entries()) {
          subjectRows.push({
            studentId,
            subjectId,
            termId: tKey === YEAR ? null : tKey,
            average: mean(cell.values),
            coefficient: cell.coef,
            gradeCount: cell.values.length,
            termOrder: cell.termOrder,
          });
        }
      }
    }

    // Per-subject-term competition rank (over the per-student subject mean), and
    // per-student-term weighted global + the mean-of-means used for the GLOBAL rank
    // (PM-7: the rank denominator uses an UNWEIGHTED mean-of-means, distinct from the
    // weighted hero average).
    const rankIndex = new Map<string, Map<string, number[]>>(); // termKey -> subjectId -> [means]
    for (const r of subjectRows) {
      if (r.average == null) continue;
      const tk = r.termId ?? YEAR;
      const bySubject = rankIndex.get(tk) ?? new Map<string, number[]>();
      const arr = bySubject.get(r.subjectId) ?? [];
      arr.push(r.average);
      bySubject.set(r.subjectId, arr);
      rankIndex.set(tk, bySubject);
    }

    // Global per (student, term): weighted average + mean-of-means; then rank.
    interface GlobalRow {
      studentId: string;
      termId: string | null;
      globalAverage: number | null;
      meanOfMeans: number | null;
      classAverage: number | null;
      classRank: number | null;
      classSize: number;
      progressionDelta: number | null;
      subjectCount: number;
      termOrder: number;
    }
    // group subjectRows by (student, term)
    const byStudentTerm = new Map<string, SubjectRow[]>();
    for (const r of subjectRows) {
      const key = `${r.studentId}|${r.termId ?? YEAR}`;
      const arr = byStudentTerm.get(key) ?? [];
      arr.push(r);
      byStudentTerm.set(key, arr);
    }
    const globalDraft: GlobalRow[] = [];
    for (const [key, rows] of byStudentTerm.entries()) {
      const [studentId, tk] = key.split('|') as [string, string];
      const withAvg = rows.filter((r) => r.average != null);
      const globalAverage = weightedGlobal(
        rows.map((r) => ({ average: r.average, coefficient: r.coefficient })),
      );
      const meanOfMeans = mean(withAvg.map((r) => r.average as number));
      globalDraft.push({
        studentId,
        termId: tk === YEAR ? null : tk,
        globalAverage,
        meanOfMeans,
        classAverage: null,
        classRank: null,
        classSize: 0,
        progressionDelta: null,
        subjectCount: withAvg.length,
        termOrder: rows[0]?.termOrder ?? 0,
      });
    }

    // Global rank + classSize + classAverage per term, over meanOfMeans (PM-7).
    const globalByTerm = new Map<string, GlobalRow[]>();
    for (const g of globalDraft) {
      const tk = g.termId ?? YEAR;
      const arr = globalByTerm.get(tk) ?? [];
      arr.push(g);
      globalByTerm.set(tk, arr);
    }
    for (const [, rows] of globalByTerm.entries()) {
      const means = rows.map((r) => r.meanOfMeans).filter((v): v is number => v != null);
      const classSize = means.length;
      const classAverage = mean(means);
      for (const r of rows) {
        r.classSize = classSize;
        r.classAverage = classAverage;
        r.classRank = competitionRank(r.meanOfMeans, means);
      }
    }

    // progression delta (per student: lastTerm.global − prevTerm.global)
    const globalByStudent = new Map<string, GlobalRow[]>();
    for (const g of globalDraft) {
      if (g.termId === null) continue; // year roll-up does not get a delta
      const arr = globalByStudent.get(g.studentId) ?? [];
      arr.push(g);
      globalByStudent.set(g.studentId, arr);
    }
    for (const rows of globalByStudent.values()) {
      const ordered = rows
        .filter((r) => r.globalAverage != null)
        .map((r) => ({ order: r.termOrder, average: r.globalAverage as number, ref: r }))
        .sort((a, b) => a.order - b.order);
      if (ordered.length >= 2) {
        const last = ordered[ordered.length - 1]!;
        last.ref.progressionDelta = last.average - ordered[ordered.length - 2]!.average;
      }
    }

    // per-subject classAverage + studentRank attached to subjectRows
    interface SubjectRowFinal extends SubjectRow {
      classAverage: number | null;
      classRank: number | null;
      classSize: number;
      trendDelta: number | null;
    }
    // classAverage per (subject, termKey) from class distribution lists
    const classAvgBySubjectTerm = new Map<string, number | null>();
    for (const [subjectId, cst] of classSubjectTerm.entries()) {
      for (const [tk, arr] of cst.entries()) {
        classAvgBySubjectTerm.set(`${subjectId}|${tk}`, mean(arr));
      }
    }
    // trend per (student, subject): lastTerm.avg − prevTerm.avg
    const trendByStudentSubject = new Map<string, number | null>();
    const subjRowsByStudentSubject = new Map<string, SubjectRow[]>();
    for (const r of subjectRows) {
      if (r.termId === null) continue;
      const k = `${r.studentId}|${r.subjectId}`;
      const arr = subjRowsByStudentSubject.get(k) ?? [];
      arr.push(r);
      subjRowsByStudentSubject.set(k, arr);
    }
    for (const [k, rows] of subjRowsByStudentSubject.entries()) {
      const withAvg = rows
        .filter((r) => r.average != null)
        .map((r) => ({ order: r.termOrder, average: r.average as number }));
      trendByStudentSubject.set(k, trendDelta(withAvg));
    }

    const subjectRowsFinal: SubjectRowFinal[] = subjectRows.map((r) => {
      const tk = r.termId ?? YEAR;
      const ranks = rankIndex.get(tk)?.get(r.subjectId) ?? [];
      return {
        ...r,
        classAverage: classAvgBySubjectTerm.get(`${r.subjectId}|${tk}`) ?? null,
        classRank: competitionRank(r.average, ranks),
        classSize: ranks.length,
        trendDelta: r.termId === null ? null : (trendByStudentSubject.get(`${r.studentId}|${r.subjectId}`) ?? null),
      };
    });

    // --- Persist everything in ONE transaction ---
    const now = new Date();
    const subjectKeySet = subjectRowsFinal.map((r) => ({
      studentId: r.studentId,
      subjectId: r.subjectId,
      termId: r.termId,
    }));
    const globalKeySet = globalDraft.map((r) => ({ studentId: r.studentId, termId: r.termId }));

    await this.prisma.$transaction(async (tx) => {
      // 1. delete-then-insert the year roll-up rows (termId IS NULL) for the affected
      //    students/subjects to dodge the NULL-not-unique caveat (PM-4); per-term rows
      //    are upserted on their natural key.
      const yearStudentSubject = subjectRowsFinal.filter((r) => r.termId === null);
      if (yearStudentSubject.length > 0) {
        await tx.studentSubjectSnapshot.deleteMany({
          where: {
            tenantId,
            termId: null,
            OR: yearStudentSubject.map((r) => ({ studentId: r.studentId, subjectId: r.subjectId })),
          },
        });
      }
      const yearGlobal = globalDraft.filter((r) => r.termId === null);
      if (yearGlobal.length > 0) {
        await tx.studentGlobalSnapshot.deleteMany({
          where: { tenantId, termId: null, OR: yearGlobal.map((r) => ({ studentId: r.studentId })) },
        });
      }
      const yearDist = [...classSubjectTerm.entries()].some(([, cst]) => cst.has(YEAR));
      if (yearDist) {
        await tx.classSubjectDistribution.deleteMany({
          where: {
            tenantId,
            classSectionId,
            termId: null,
            subjectId: { in: [...subjectsSeen] },
          },
        });
      }

      // 2. StudentSubjectSnapshot rows
      for (const r of subjectRowsFinal) {
        const schoolId = schoolByStudent.get(r.studentId) ?? fallbackSchoolId;
        if (!schoolId) continue;
        const data = {
          tenantId,
          schoolId,
          academicYearId,
          studentId: r.studentId,
          classSectionId,
          subjectId: r.subjectId,
          average: round2(r.average) as Prisma.Decimal | number | null,
          coefficient: r.coefficient,
          gradeCount: r.gradeCount,
          classRank: r.classRank,
          classSize: r.classSize,
          trendDelta: round2(r.trendDelta) as Prisma.Decimal | number | null,
          computedAt: now,
          sourceEventId,
        };
        if (r.termId === null) {
          await tx.studentSubjectSnapshot.create({ data: { ...data, termId: null } });
        } else {
          // E6-S5 read-compare-write: skip the write (no revision/computedAt move)
          // when the value columns are byte-identical to the stored row → a stable
          // rebuild is a true no-op (AC-S5-2). A first compute / real change writes.
          const existing = await tx.studentSubjectSnapshot.findUnique({
            where: {
              studentId_subjectId_termId: {
                studentId: r.studentId,
                subjectId: r.subjectId,
                termId: r.termId,
              },
            },
            select: {
              average: true,
              coefficient: true,
              gradeCount: true,
              classRank: true,
              classSize: true,
              trendDelta: true,
            },
          });
          const unchanged =
            existing != null &&
            decEq(existing.average, round2(r.average)) &&
            decEq(existing.coefficient, r.coefficient) &&
            intEq(existing.gradeCount, r.gradeCount) &&
            intEq(existing.classRank, r.classRank) &&
            intEq(existing.classSize, r.classSize) &&
            decEq(existing.trendDelta, round2(r.trendDelta));
          if (unchanged) continue;
          await tx.studentSubjectSnapshot.upsert({
            where: {
              studentId_subjectId_termId: {
                studentId: r.studentId,
                subjectId: r.subjectId,
                termId: r.termId,
              },
            },
            create: { ...data, termId: r.termId },
            update: {
              average: data.average,
              coefficient: data.coefficient,
              gradeCount: data.gradeCount,
              classRank: data.classRank,
              classSize: data.classSize,
              trendDelta: data.trendDelta,
              classSectionId,
              academicYearId,
              schoolId,
              computedAt: now,
              sourceEventId,
              revision: { increment: 1 },
            },
          });
        }
      }

      // 3. StudentGlobalSnapshot cascade
      for (const r of globalDraft) {
        const schoolId = schoolByStudent.get(r.studentId) ?? fallbackSchoolId;
        if (!schoolId) continue;
        const data = {
          tenantId,
          schoolId,
          academicYearId,
          studentId: r.studentId,
          classSectionId,
          globalAverage: round2(r.globalAverage) as Prisma.Decimal | number | null,
          classAverage: round2(r.classAverage) as Prisma.Decimal | number | null,
          classRank: r.classRank,
          classSize: r.classSize,
          progressionDelta: round2(r.progressionDelta) as Prisma.Decimal | number | null,
          subjectCount: r.subjectCount,
          computedAt: now,
          sourceEventId,
        };
        if (r.termId === null) {
          await tx.studentGlobalSnapshot.create({ data: { ...data, termId: null } });
        } else {
          // E6-S5 read-compare-write (AC-S5-2): no-op a stable rebuild.
          const existing = await tx.studentGlobalSnapshot.findUnique({
            where: { studentId_termId: { studentId: r.studentId, termId: r.termId } },
            select: {
              globalAverage: true,
              classAverage: true,
              classRank: true,
              classSize: true,
              progressionDelta: true,
              subjectCount: true,
            },
          });
          const unchanged =
            existing != null &&
            decEq(existing.globalAverage, round2(r.globalAverage)) &&
            decEq(existing.classAverage, round2(r.classAverage)) &&
            intEq(existing.classRank, r.classRank) &&
            intEq(existing.classSize, r.classSize) &&
            decEq(existing.progressionDelta, round2(r.progressionDelta)) &&
            intEq(existing.subjectCount, r.subjectCount);
          if (unchanged) continue;
          await tx.studentGlobalSnapshot.upsert({
            where: { studentId_termId: { studentId: r.studentId, termId: r.termId } },
            create: { ...data, termId: r.termId },
            update: {
              globalAverage: data.globalAverage,
              classAverage: data.classAverage,
              classRank: data.classRank,
              classSize: data.classSize,
              progressionDelta: data.progressionDelta,
              subjectCount: data.subjectCount,
              classSectionId,
              academicYearId,
              schoolId,
              computedAt: now,
              sourceEventId,
              revision: { increment: 1 },
            },
          });
        }
      }

      // 4. ClassSubjectDistribution refresh (per subject, per term + roll-up)
      for (const [subjectId, cst] of classSubjectTerm.entries()) {
        const schoolId = fallbackSchoolId;
        if (!schoolId) continue;
        for (const [tk, arr] of cst.entries()) {
          const d = distribution(arr);
          const data = {
            tenantId,
            schoolId,
            academicYearId,
            classSectionId,
            subjectId,
            average: round2(d.average) as Prisma.Decimal | number | null,
            median: round2(d.median) as Prisma.Decimal | number | null,
            minScore: round2(d.minScore) as Prisma.Decimal | number | null,
            maxScore: round2(d.maxScore) as Prisma.Decimal | number | null,
            countLow: d.countLow,
            countMid: d.countMid,
            countHigh: d.countHigh,
            passRate: round2(d.passRate) as Prisma.Decimal | number | null,
            gradeCount: d.gradeCount,
            studentCount: new Set(
              classGrades
                .filter(
                  (g) =>
                    g.value != null &&
                    g.assessment.teachingAssignment.subject.id === subjectId &&
                    (tk === YEAR || g.assessment.term?.id === tk),
                )
                .map((g) => g.studentId),
            ).size,
            computedAt: now,
            sourceEventId,
          };
          if (tk === YEAR) {
            await tx.classSubjectDistribution.create({ data: { ...data, termId: null } });
          } else {
            // E6-S5 read-compare-write (AC-S5-2): no-op a stable rebuild.
            const existing = await tx.classSubjectDistribution.findUnique({
              where: {
                classSectionId_subjectId_termId: { classSectionId, subjectId, termId: tk },
              },
              select: {
                average: true,
                median: true,
                minScore: true,
                maxScore: true,
                countLow: true,
                countMid: true,
                countHigh: true,
                passRate: true,
                gradeCount: true,
                studentCount: true,
              },
            });
            const unchanged =
              existing != null &&
              decEq(existing.average, round2(d.average)) &&
              decEq(existing.median, round2(d.median)) &&
              decEq(existing.minScore, round2(d.minScore)) &&
              decEq(existing.maxScore, round2(d.maxScore)) &&
              intEq(existing.countLow, d.countLow) &&
              intEq(existing.countMid, d.countMid) &&
              intEq(existing.countHigh, d.countHigh) &&
              decEq(existing.passRate, round2(d.passRate)) &&
              intEq(existing.gradeCount, d.gradeCount) &&
              intEq(existing.studentCount, Number(data.studentCount));
            if (unchanged) continue;
            await tx.classSubjectDistribution.upsert({
              where: {
                classSectionId_subjectId_termId: { classSectionId, subjectId, termId: tk },
              },
              create: { ...data, termId: tk },
              update: {
                average: data.average,
                median: data.median,
                minScore: data.minScore,
                maxScore: data.maxScore,
                countLow: data.countLow,
                countMid: data.countMid,
                countHigh: data.countHigh,
                passRate: data.passRate,
                gradeCount: data.gradeCount,
                studentCount: data.studentCount,
                academicYearId,
                schoolId,
                computedAt: now,
                sourceEventId,
                revision: { increment: 1 },
              },
            });
          }
        }
      }
    });

    this.logger.debug(
      `Recomputed scope (tenant=${tenantId}, class=${classSectionId}): ` +
        `${subjectKeySet.length} subject rows, ${globalKeySet.length} global rows`,
    );
    return {
      subjectRows: subjectRowsFinal.length,
      globalRows: globalDraft.length,
      distributionRows: [...classSubjectTerm.values()].reduce((n, m) => n + m.size, 0),
    };
  }
}
