import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Drill-down trimestriel des performances de l'établissement.
 *
 * Quatre niveaux de profondeur progressive, tous fondés sur la MÊME règle de
 * réussite que `AnalyticsService.schoolPerformance` :
 *   - note normalisée sur 20 = `(value / maxScore) * 20`
 *   - seuil de réussite : moyenne **≥ 10/20**
 *   - on ne considère que les notes `status ∈ {published, revised}` et `isAbsent = false`
 *   - périmètre : année académique active (ou filtrée par `termId`)
 *
 * Différence clé avec `schoolPerformance` : ici on compte des **élèves** (selon
 * leur moyenne) et non des notes individuelles. À chaque niveau on calcule
 * d'abord la moyenne de chaque élève sur le périmètre, puis on classe l'élève
 * dans « en réussite » (≥10) ou « en difficulté » (<10).
 *
 *   L1 (aucun id)                  → ventilation par cycle
 *   L2 (cycleId)                   → ventilation par classe (ClassSection) du cycle
 *   L3 (classSectionId)            → ventilation par matière (Subject) de la classe
 *   L4 (classSectionId+subjectId)  → liste des élèves {moyenne, rang, tendance, statut}
 *
 * `termId` (optionnel) restreint les Assessment à ce trimestre ; sinon toute
 * l'année active est prise en compte.
 */

/** Seuil de réussite réutilisé partout (moyenne sur 20). */
const PASS_THRESHOLD = 10;

/** Note normalisée sur 20 — règle identique à `schoolPerformance`. */
function onTwenty(value: number, maxScore: number): number {
  return (value / maxScore) * 20;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Statut élève dérivé d'une moyenne (null = pas de note sur le périmètre). */
function statusOf(average: number | null): 'success' | 'at_risk' | 'no_data' {
  if (average === null) return 'no_data';
  return average >= PASS_THRESHOLD ? 'success' : 'at_risk';
}

type Level = 'cycle' | 'class' | 'subject' | 'students';

/** Un groupe agrégé (cycle / classe / matière) avec compteurs élèves. */
export interface DrilldownGroup {
  id: string;
  name: string;
  color: string | null;
  /** Nombre d'élèves avec au moins une note sur le périmètre. */
  studentsWithGrades: number;
  /** Élèves dont la moyenne ≥ 10/20. */
  studentsPassing: number;
  /** Élèves dont la moyenne < 10/20. */
  studentsFailing: number;
  /** Taux de réussite (% d'élèves en réussite parmi ceux notés), null si aucun. */
  successRate: number | null;
  /** Moyenne des moyennes élèves du groupe, null si aucun. */
  averageOfAverages: number | null;
}

/** Une ligne élève au niveau L4. */
export interface DrilldownStudent {
  studentId: string;
  firstName: string;
  lastName: string;
  /** Moyenne de l'élève sur le périmètre (classe × matière × trimestre/année). */
  average: number | null;
  /** Rang 1-indexé parmi les élèves notés de la classe pour cette matière. */
  rank: number | null;
  /** Nombre d'élèves notés (dénominateur du rang). */
  rankOutOf: number;
  /** Tendance = delta entre les deux derniers trimestres disponibles. */
  trend: { previousAverage: number | null; delta: number | null } | null;
  status: 'success' | 'at_risk' | 'no_data';
}

export interface DrilldownResponse {
  level: Level;
  /** Périmètre résolu (utile au front pour l'affichage du fil d'Ariane). */
  scope: {
    academicYearId: string | null;
    termId: string | null;
    cycleId: string | null;
    classSectionId: string | null;
    subjectId: string | null;
  };
  /** Trimestres de l'année active (pour alimenter le sélecteur côté front). */
  terms: Array<{ id: string; name: string; orderIndex: number }>;
  /** Groupes agrégés (présents pour L1/L2/L3 ; vide pour L4). */
  groups: DrilldownGroup[];
  /** Liste élèves (présente uniquement pour L4 ; vide sinon). */
  students: DrilldownStudent[];
}

/** Forme minimale d'une note chargée pour l'agrégation. */
interface LoadedGrade {
  studentId: string;
  value: number;
  maxScore: number;
}

@Injectable()
export class SchoolPerformanceDrilldownService {
  constructor(private readonly prisma: PrismaService) {}

  async drilldown(opts: {
    tenantId: string;
    schoolId: string;
    termId?: string;
    cycleId?: string;
    classSectionId?: string;
    subjectId?: string;
    academicYearId?: string;
  }): Promise<DrilldownResponse> {
    const { tenantId, schoolId, termId, cycleId, classSectionId, subjectId } = opts;

    const academicYearId =
      opts.academicYearId ??
      (
        await this.prisma.academicYear.findFirst({
          where: { tenantId, schoolId, status: 'active' },
          select: { id: true },
        })
      )?.id ??
      null;

    const terms = academicYearId
      ? await this.prisma.term.findMany({
          where: { academicYearId },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, name: true, orderIndex: true },
        })
      : [];

    const scope = {
      academicYearId,
      termId: termId ?? null,
      cycleId: cycleId ?? null,
      classSectionId: classSectionId ?? null,
      subjectId: subjectId ?? null,
    };

    const empty: DrilldownResponse = { level: 'cycle', scope, terms, groups: [], students: [] };
    if (!academicYearId) return empty;

    // L4 — élèves d'une classe pour une matière donnée.
    if (classSectionId && subjectId) {
      return {
        ...empty,
        level: 'students',
        students: await this.studentsForClassSubject({
          tenantId,
          academicYearId,
          termId,
          classSectionId,
          subjectId,
        }),
      };
    }

    // L3 — matières d'une classe.
    if (classSectionId) {
      return {
        ...empty,
        level: 'subject',
        groups: await this.subjectsForClass({ tenantId, academicYearId, termId, classSectionId }),
      };
    }

    // L2 — classes d'un cycle.
    if (cycleId) {
      return {
        ...empty,
        level: 'class',
        groups: await this.classesForCycle({ tenantId, academicYearId, termId, cycleId }),
      };
    }

    // L1 — cycles de l'établissement.
    return {
      ...empty,
      level: 'cycle',
      groups: await this.cyclesForSchool({ tenantId, schoolId, academicYearId, termId }),
    };
  }

  // ---------------------------------------------------------------------------
  // L1 — par cycle
  // ---------------------------------------------------------------------------
  private async cyclesForSchool(opts: {
    tenantId: string;
    schoolId: string;
    academicYearId: string;
    termId?: string;
  }): Promise<DrilldownGroup[]> {
    const { tenantId, academicYearId, termId } = opts;

    const grades = await this.prisma.grade.findMany({
      where: this.gradeWhere({ tenantId, academicYearId, termId }),
      select: {
        studentId: true,
        value: true,
        assessment: {
          select: {
            maxScore: true,
            teachingAssignment: {
              select: {
                classSection: {
                  select: {
                    gradeLevel: {
                      select: { cycle: { select: { id: true, name: true, color: true } } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });

    // Regroupe les notes par cycle, puis par élève à l'intérieur de chaque cycle.
    const byCycle = new Map<
      string,
      { name: string; color: string | null; grades: LoadedGrade[] }
    >();
    for (const g of grades) {
      const cy = g.assessment.teachingAssignment.classSection.gradeLevel.cycle;
      if (!cy || g.value === null) continue;
      const bucket = byCycle.get(cy.id) ?? { name: cy.name, color: cy.color, grades: [] };
      bucket.grades.push({
        studentId: g.studentId,
        value: Number(g.value),
        maxScore: Number(g.assessment.maxScore),
      });
      byCycle.set(cy.id, bucket);
    }

    const groups = [...byCycle.entries()].map(([id, b]) =>
      this.buildGroup(id, b.name, b.color, b.grades),
    );
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  // ---------------------------------------------------------------------------
  // L2 — par classe d'un cycle
  // ---------------------------------------------------------------------------
  private async classesForCycle(opts: {
    tenantId: string;
    academicYearId: string;
    termId?: string;
    cycleId: string;
  }): Promise<DrilldownGroup[]> {
    const { tenantId, academicYearId, termId, cycleId } = opts;

    const grades = await this.prisma.grade.findMany({
      where: {
        ...this.gradeWhere({ tenantId, academicYearId, termId }),
        assessment: {
          ...this.assessmentWhere({ academicYearId, termId }),
          teachingAssignment: {
            academicYearId,
            classSection: { gradeLevel: { cycleId } },
          },
        },
      },
      select: {
        studentId: true,
        value: true,
        assessment: {
          select: {
            maxScore: true,
            teachingAssignment: {
              select: { classSection: { select: { id: true, name: true } } },
            },
          },
        },
      },
    });

    const byClass = new Map<string, { name: string; grades: LoadedGrade[] }>();
    for (const g of grades) {
      const cs = g.assessment.teachingAssignment.classSection;
      if (g.value === null) continue;
      const bucket = byClass.get(cs.id) ?? { name: cs.name, grades: [] };
      bucket.grades.push({
        studentId: g.studentId,
        value: Number(g.value),
        maxScore: Number(g.assessment.maxScore),
      });
      byClass.set(cs.id, bucket);
    }

    const groups = [...byClass.entries()].map(([id, b]) =>
      this.buildGroup(id, b.name, null, b.grades),
    );
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  // ---------------------------------------------------------------------------
  // L3 — par matière d'une classe
  // ---------------------------------------------------------------------------
  private async subjectsForClass(opts: {
    tenantId: string;
    academicYearId: string;
    termId?: string;
    classSectionId: string;
  }): Promise<DrilldownGroup[]> {
    const { tenantId, academicYearId, termId, classSectionId } = opts;

    const grades = await this.prisma.grade.findMany({
      where: {
        ...this.gradeWhere({ tenantId, academicYearId, termId }),
        assessment: {
          ...this.assessmentWhere({ academicYearId, termId }),
          teachingAssignment: { academicYearId, classSectionId },
        },
      },
      select: {
        studentId: true,
        value: true,
        assessment: {
          select: {
            maxScore: true,
            teachingAssignment: {
              select: {
                subject: { select: { id: true, name: true, color: true } },
              },
            },
          },
        },
      },
    });

    const bySubject = new Map<
      string,
      { name: string; color: string | null; grades: LoadedGrade[] }
    >();
    for (const g of grades) {
      const subj = g.assessment.teachingAssignment.subject;
      if (g.value === null) continue;
      const bucket = bySubject.get(subj.id) ?? { name: subj.name, color: subj.color, grades: [] };
      bucket.grades.push({
        studentId: g.studentId,
        value: Number(g.value),
        maxScore: Number(g.assessment.maxScore),
      });
      bySubject.set(subj.id, bucket);
    }

    const groups = [...bySubject.entries()].map(([id, b]) =>
      this.buildGroup(id, b.name, b.color, b.grades),
    );
    groups.sort((a, b) => a.name.localeCompare(b.name));
    return groups;
  }

  // ---------------------------------------------------------------------------
  // L4 — élèves d'une classe pour une matière
  // ---------------------------------------------------------------------------
  private async studentsForClassSubject(opts: {
    tenantId: string;
    academicYearId: string;
    termId?: string;
    classSectionId: string;
    subjectId: string;
  }): Promise<DrilldownStudent[]> {
    const { tenantId, academicYearId, termId, classSectionId, subjectId } = opts;

    // Élèves inscrits (actifs) dans la classe — base de la liste, même sans note.
    const enrollments = await this.prisma.enrollment.findMany({
      where: { classSectionId, academicYearId, status: 'active' },
      select: {
        student: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { student: { lastName: 'asc' } },
    });

    // Moyennes sur le périmètre demandé (trimestre si fourni, sinon année).
    const scoped = await this.averagesForClassSubject({
      tenantId,
      academicYearId,
      termId,
      classSectionId,
      subjectId,
    });

    // Pour la tendance : on calcule aussi les moyennes par trimestre afin de
    // dériver le delta entre les deux derniers trimestres disponibles.
    const perTermAverages = await this.perTermAverages({
      tenantId,
      academicYearId,
      classSectionId,
      subjectId,
    });

    // Classement : élèves notés, par moyenne décroissante.
    const ranked = [...scoped.entries()]
      .map(([studentId, average]) => ({ studentId, average }))
      .filter((r) => r.average !== null)
      .sort((a, b) => (b.average as number) - (a.average as number));
    const rankOf = new Map<string, number>();
    ranked.forEach((r, idx) => rankOf.set(r.studentId, idx + 1));
    const rankOutOf = ranked.length;

    const rows: DrilldownStudent[] = enrollments.map((e) => {
      const s = e.student;
      const average = scoped.get(s.id) ?? null;
      const trend = this.trendFor(perTermAverages.get(s.id));
      return {
        studentId: s.id,
        firstName: s.firstName,
        lastName: s.lastName,
        average,
        rank: rankOf.get(s.id) ?? null,
        rankOutOf,
        trend,
        status: statusOf(average),
      };
    });

    // Tri d'affichage : meilleurs d'abord, puis les sans-note en fin de liste.
    rows.sort((a, b) => {
      if (a.average === null && b.average === null) return a.lastName.localeCompare(b.lastName);
      if (a.average === null) return 1;
      if (b.average === null) return -1;
      return b.average - a.average;
    });

    return rows;
  }

  // ---------------------------------------------------------------------------
  // Helpers d'agrégation
  // ---------------------------------------------------------------------------

  /** Filtre `where` sur Grade : notes publiées/révisées, présentes, année/trimestre. */
  private gradeWhere(opts: {
    tenantId: string;
    academicYearId: string;
    termId?: string;
  }): Prisma.GradeWhereInput {
    const { tenantId, academicYearId, termId } = opts;
    return {
      tenantId,
      status: { in: ['published', 'revised'] },
      isAbsent: false,
      assessment: this.assessmentWhere({ academicYearId, termId }),
    };
  }

  /** Filtre `where` sur Assessment : année active (via TA) + trimestre optionnel. */
  private assessmentWhere(opts: {
    academicYearId: string;
    termId?: string;
  }): Prisma.AssessmentWhereInput {
    const { academicYearId, termId } = opts;
    return {
      teachingAssignment: { academicYearId },
      ...(termId ? { termId } : {}),
    };
  }

  /**
   * Construit un groupe agrégé à partir de notes brutes : calcule la moyenne
   * (simple, sur 20) de chaque élève puis le bucket réussite/difficulté.
   * Moyenne non pondérée par coefficient — cohérent avec `schoolPerformance`
   * qui raisonne sur la note brute normalisée.
   */
  private buildGroup(
    id: string,
    name: string,
    color: string | null,
    grades: LoadedGrade[],
  ): DrilldownGroup {
    const averages = this.studentAverages(grades);
    let passing = 0;
    let failing = 0;
    let sum = 0;
    for (const avg of averages.values()) {
      sum += avg;
      if (avg >= PASS_THRESHOLD) passing += 1;
      else failing += 1;
    }
    const withGrades = averages.size;
    return {
      id,
      name,
      color,
      studentsWithGrades: withGrades,
      studentsPassing: passing,
      studentsFailing: failing,
      successRate: withGrades === 0 ? null : round2((passing / withGrades) * 100),
      averageOfAverages: withGrades === 0 ? null : round2(sum / withGrades),
    };
  }

  /** Moyenne (sur 20, simple) par élève à partir de notes brutes. */
  private studentAverages(grades: LoadedGrade[]): Map<string, number> {
    const acc = new Map<string, { sum: number; count: number }>();
    for (const g of grades) {
      const a = acc.get(g.studentId) ?? { sum: 0, count: 0 };
      a.sum += onTwenty(g.value, g.maxScore);
      a.count += 1;
      acc.set(g.studentId, a);
    }
    const out = new Map<string, number>();
    for (const [studentId, a] of acc) {
      if (a.count > 0) out.set(studentId, round2(a.sum / a.count));
    }
    return out;
  }

  /** Moyennes élève pour une classe × matière sur le périmètre (trimestre/année). */
  private async averagesForClassSubject(opts: {
    tenantId: string;
    academicYearId: string;
    termId?: string;
    classSectionId: string;
    subjectId: string;
  }): Promise<Map<string, number>> {
    const { tenantId, academicYearId, termId, classSectionId, subjectId } = opts;
    const grades = await this.prisma.grade.findMany({
      where: {
        ...this.gradeWhere({ tenantId, academicYearId, termId }),
        assessment: {
          ...this.assessmentWhere({ academicYearId, termId }),
          teachingAssignment: { academicYearId, classSectionId, subjectId },
        },
      },
      select: { studentId: true, value: true, assessment: { select: { maxScore: true } } },
    });
    const loaded: LoadedGrade[] = grades
      .filter((g) => g.value !== null)
      .map((g) => ({
        studentId: g.studentId,
        value: Number(g.value),
        maxScore: Number(g.assessment.maxScore),
      }));
    return this.studentAverages(loaded);
  }

  /**
   * Moyennes par (élève → termId) pour une classe × matière sur toute l'année.
   * Sert au calcul de tendance (delta entre les deux derniers trimestres notés).
   */
  private async perTermAverages(opts: {
    tenantId: string;
    academicYearId: string;
    classSectionId: string;
    subjectId: string;
  }): Promise<Map<string, Map<string, number>>> {
    const { tenantId, academicYearId, classSectionId, subjectId } = opts;
    const grades = await this.prisma.grade.findMany({
      where: {
        ...this.gradeWhere({ tenantId, academicYearId }),
        assessment: {
          teachingAssignment: { academicYearId, classSectionId, subjectId },
          termId: { not: null },
        },
      },
      select: {
        studentId: true,
        value: true,
        assessment: {
          select: { maxScore: true, termId: true, term: { select: { orderIndex: true } } },
        },
      },
    });

    // (élève, terme) → accumulateur
    const acc = new Map<
      string,
      Map<string, { sum: number; count: number; order: number }>
    >();
    for (const g of grades) {
      const termId = g.assessment.termId;
      if (g.value === null || !termId) continue;
      const byTerm = acc.get(g.studentId) ?? new Map();
      const cur = byTerm.get(termId) ?? {
        sum: 0,
        count: 0,
        order: g.assessment.term?.orderIndex ?? 0,
      };
      cur.sum += onTwenty(Number(g.value), Number(g.assessment.maxScore));
      cur.count += 1;
      byTerm.set(termId, cur);
      acc.set(g.studentId, byTerm);
    }

    const out = new Map<string, Map<string, number>>();
    for (const [studentId, byTerm] of acc) {
      const m = new Map<string, number>();
      // Conserve l'ordre du trimestre dans la clé pour pouvoir trier ensuite.
      for (const [termId, v] of byTerm) {
        if (v.count > 0) m.set(`${v.order}:${termId}`, round2(v.sum / v.count));
      }
      out.set(studentId, m);
    }
    return out;
  }

  /**
   * Tendance = delta entre les deux derniers trimestres disponibles.
   * `byTerm` a pour clés `${orderIndex}:${termId}`. On trie par orderIndex et on
   * compare les deux derniers. Retourne `null` si moins de deux trimestres notés.
   */
  private trendFor(
    byTerm: Map<string, number> | undefined,
  ): { previousAverage: number | null; delta: number | null } | null {
    if (!byTerm || byTerm.size < 2) return null;
    const ordered = [...byTerm.entries()]
      .map(([key, avg]) => ({ order: Number(key.split(':')[0]), avg }))
      .sort((a, b) => a.order - b.order);
    const last = ordered[ordered.length - 1]!;
    const prev = ordered[ordered.length - 2]!;
    return {
      previousAverage: prev.avg,
      delta: round2(last.avg - prev.avg),
    };
  }
}
