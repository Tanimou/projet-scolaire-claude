import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../../shared/prisma/prisma.service';

/**
 * Forme agrégée renvoyée par {@link ClassesService.detailAggregate} — alimente
 * les indicateurs de la vue détail classe (`/admin/classes/[id]`).
 */
export interface ClassDetailAggregate {
  /** Taux de notation : évaluations notées/publiées vs total planifié. */
  gradingRate: { total: number; graded: number; rate: number | null };
  /** Taux de présence : relevés « present » vs total des relevés des inscrits. */
  attendanceRate: number | null;
  /** Performance : moyenne normalisée /20, taux de réussite (>= 10/20), volume. */
  performance: {
    averageScore: number | null;
    passRate: number | null;
    gradedCount: number;
  };
}

/**
 * Calculs agrégés réutilisables pour une classe (`ClassSection`).
 *
 * Extrait du contrôleur pour être testable unitairement (cf.
 * `classes.service.spec.ts`). La résolution du contexte (tenant/école) et les
 * gardes de permission restent dans le contrôleur ; ce service suppose ses
 * entrées déjà validées et travaille uniquement à partir d'identifiants.
 */
@Injectable()
export class ClassesService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Agrège, pour une classe donnée, le taux de notation, le taux de présence
   * et la performance moyenne. Toutes les requêtes sont scopées au tenant.
   */
  async detailAggregate(args: {
    tenantId: string;
    classSectionId: string;
    studentIds: string[];
  }): Promise<ClassDetailAggregate> {
    const [gradingRate, attendanceRate, performance] = await Promise.all([
      this.computeGradingRate(args.tenantId, args.classSectionId),
      this.computeAttendanceRate(args.tenantId, args.studentIds),
      this.computePerformance(args.tenantId, args.classSectionId),
    ]);

    return { gradingRate, attendanceRate, performance };
  }

  /**
   * Taux de notation : part des évaluations publiées (notes diffusées) parmi
   * l'ensemble des évaluations planifiées pour la classe. `rate` est en
   * pourcentage arrondi à la décimale, ou `null` si aucune évaluation.
   */
  async computeGradingRate(
    tenantId: string,
    classSectionId: string,
  ): Promise<ClassDetailAggregate['gradingRate']> {
    const where = {
      tenantId,
      teachingAssignment: { classSectionId },
    } as const;

    const [total, graded] = await Promise.all([
      this.prisma.assessment.count({ where }),
      this.prisma.assessment.count({ where: { ...where, isPublished: true } }),
    ]);

    return {
      total,
      graded,
      rate: total > 0 ? round1((graded / total) * 100) : null,
    };
  }

  /**
   * Taux de présence : part des relevés « present » parmi tous les relevés des
   * élèves inscrits. `null` si aucun élève ou aucun relevé.
   */
  async computeAttendanceRate(
    tenantId: string,
    studentIds: string[],
  ): Promise<number | null> {
    if (studentIds.length === 0) {
      return null;
    }
    const [total, present] = await Promise.all([
      this.prisma.attendanceRecord.count({
        where: { tenantId, studentId: { in: studentIds } },
      }),
      this.prisma.attendanceRecord.count({
        where: { tenantId, studentId: { in: studentIds }, status: 'present' },
      }),
    ]);
    if (total === 0) {
      return null;
    }
    return round1((present / total) * 100);
  }

  /**
   * Performance moyenne de la classe : moyenne normalisée /20 et taux de
   * réussite (note normalisée >= 10/20) sur les notes publiées/révisées des
   * élèves présents (`isAbsent=false`). Aligné sur `analytics.service`.
   */
  async computePerformance(
    tenantId: string,
    classSectionId: string,
  ): Promise<ClassDetailAggregate['performance']> {
    const grades = await this.prisma.grade.findMany({
      where: {
        tenantId,
        isAbsent: false,
        status: { in: ['published', 'revised'] },
        value: { not: null },
        assessment: { teachingAssignment: { classSectionId } },
      },
      select: {
        value: true,
        assessment: { select: { maxScore: true } },
      },
    });

    if (grades.length === 0) {
      return { averageScore: null, passRate: null, gradedCount: 0 };
    }

    let totalNormalized = 0;
    let passCount = 0;
    for (const g of grades) {
      const maxScore = Number(g.assessment.maxScore);
      const normalized = maxScore > 0 ? (Number(g.value) / maxScore) * 20 : 0;
      totalNormalized += normalized;
      if (normalized >= 10) {
        passCount += 1;
      }
    }

    return {
      averageScore: round2(totalNormalized / grades.length),
      passRate: round1((passCount / grades.length) * 100),
      gradedCount: grades.length,
    };
  }

  /**
   * Alertes liées à une classe (modèle `AlertInstance`, filtré par
   * `classSectionId`), les plus récentes en premier.
   */
  async classAlerts(args: { tenantId: string; classSectionId: string }) {
    const rows = await this.prisma.alertInstance.findMany({
      where: { tenantId: args.tenantId, classSectionId: args.classSectionId },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        subject: { select: { id: true, name: true, code: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: 50,
    });
    return rows.map((a) => ({
      id: a.id,
      code: a.code,
      severity: a.severity,
      status: a.status,
      title: a.title,
      body: a.body,
      recommendation: a.recommendation,
      studentId: a.studentId,
      studentName: a.student
        ? `${a.student.lastName} ${a.student.firstName}`.trim()
        : null,
      subjectName: a.subject?.name ?? null,
      detectedAt: a.detectedAt.toISOString(),
    }));
  }

  /**
   * Enseignants distincts affectés à la classe, avec la liste de leurs
   * matières et le drapeau « professeur principal ».
   */
  async classTeachers(args: { tenantId: string; classSectionId: string }) {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: { tenantId: args.tenantId, classSectionId: args.classSectionId },
      include: {
        teacherProfile: {
          select: {
            id: true,
            userProfile: {
              select: { firstName: true, lastName: true, email: true, photoUrl: true },
            },
          },
        },
        subject: { select: { id: true, name: true, code: true, color: true } },
      },
    });

    const byTeacher = new Map<
      string,
      {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        photoUrl: string | null;
        isMainTeacher: boolean;
        subjects: Array<{ id: string; name: string; code: string; color: string | null }>;
      }
    >();

    for (const a of assignments) {
      const tp = a.teacherProfile;
      if (!tp?.userProfile) continue;
      const entry = byTeacher.get(tp.id) ?? {
        id: tp.id,
        firstName: tp.userProfile.firstName,
        lastName: tp.userProfile.lastName,
        email: tp.userProfile.email ?? null,
        photoUrl: tp.userProfile.photoUrl ?? null,
        isMainTeacher: false,
        subjects: [],
      };
      if (a.isMainTeacher) entry.isMainTeacher = true;
      if (a.subject && !entry.subjects.some((s) => s.id === a.subject.id)) {
        entry.subjects.push(a.subject);
      }
      byTeacher.set(tp.id, entry);
    }

    return [...byTeacher.values()].sort((x, y) => {
      // Professeur principal d'abord, puis ordre alphabétique.
      if (x.isMainTeacher !== y.isMainTeacher) return x.isMainTeacher ? -1 : 1;
      return `${x.lastName} ${x.firstName}`.localeCompare(
        `${y.lastName} ${y.firstName}`,
        'fr',
      );
    });
  }

  /** Vérifie qu'une classe existe pour le tenant ; lève 404 sinon. */
  async ensureExists(tenantId: string, id: string) {
    const existing = await this.prisma.classSection.findFirst({
      where: { id, tenantId },
    });
    if (!existing) throw new NotFoundException('Classe introuvable');
    return existing;
  }
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
