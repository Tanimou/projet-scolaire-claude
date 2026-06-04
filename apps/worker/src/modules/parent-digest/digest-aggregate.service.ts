import { Injectable, Logger } from '@nestjs/common';
import type { AlertSeverity } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import type { ChildDigest, DigestTrend, DigestUpcomingAssessment } from './digest-email.types';

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** Below this signed delta we call the trend "stable" (avoid noisy pills). */
const TREND_EPSILON = 0.2;

const ASSESSMENT_KIND_LABEL: Record<string, string> = {
  written_test: 'Contrôle',
  oral: 'Oral',
  homework: 'Devoir maison',
  project: 'Projet',
  participation: 'Participation',
  practical: 'TP',
  other: 'Évaluation',
};

const SEVERITY_RANK: Record<AlertSeverity, number> = { high: 3, medium: 2, low: 1 };

/**
 * Worker-side aggregate that builds a per-child {@link ChildDigest} for the
 * weekly parent digest (E1-S4). Reads directly via the worker's PrismaService
 * (the worker has no auth context), every query hard-scoped by `tenantId`.
 *
 * Pure-ish + deterministic given `now`: it does no I/O beyond Prisma reads and
 * returns a plain data structure, so the cron can render + send without any
 * live recompute in the email loop. Each child is built best-effort by the
 * caller (one child's failure must not abort the guardian/tenant loop).
 */
@Injectable()
export class DigestAggregateService {
  private readonly logger = new Logger(DigestAggregateService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Build the digest for one student. `now` is injected so tests are
   * deterministic and so all per-tick windows share one clock.
   */
  async buildChildDigest(args: {
    tenantId: string;
    studentId: string;
    now: Date;
  }): Promise<ChildDigest> {
    const { tenantId, studentId, now } = args;

    const student = await this.prisma.student.findFirst({
      where: { id: studentId, tenantId },
      select: { id: true, firstName: true, lastName: true },
    });
    const firstName = student?.firstName ?? '';
    const lastName = student?.lastName ?? '';

    // Resolve the active enrollment → class section (for "upcoming assessments").
    const enrollment = await this.prisma.enrollment.findFirst({
      where: { tenantId, studentId, status: 'active' },
      orderBy: { enrolledAt: 'desc' },
      select: { classSectionId: true, classSection: { select: { name: true } } },
    });
    const classSectionId = enrollment?.classSectionId ?? null;
    const className = enrollment?.classSection?.name ?? null;

    const weekAgo = new Date(now.getTime() - WEEK_MS);
    const twoWeeksAgo = new Date(now.getTime() - 2 * WEEK_MS);

    // ---- Published grades for this student (last 2 weeks for the trend) ----
    const grades = await this.prisma.grade.findMany({
      where: {
        tenantId,
        studentId,
        status: 'published',
        value: { not: null },
        isAbsent: false,
      },
      select: {
        value: true,
        publishedAt: true,
        assessment: {
          select: {
            maxScore: true,
            coefficientOverride: true,
            teachingAssignment: { select: { subjectId: true, subject: { select: { defaultCoefficient: true } } } },
          },
        },
      },
    });

    const norm = (value: number, maxScore: number) => (maxScore > 0 ? (value / maxScore) * 20 : value);
    const coefOf = (g: (typeof grades)[number]) => {
      const override = g.assessment.coefficientOverride;
      if (override != null) return Number(override);
      return Number(g.assessment.teachingAssignment?.subject?.defaultCoefficient ?? 1);
    };

    // Global average: weighted /20 over ALL published grades.
    let wSum = 0;
    let wTot = 0;
    for (const g of grades) {
      if (g.value == null) continue;
      const coef = coefOf(g);
      wSum += norm(Number(g.value), Number(g.assessment.maxScore)) * coef;
      wTot += coef;
    }
    const globalAverage = wTot > 0 ? Math.round((wSum / wTot) * 10) / 10 : null;

    // Week-over-week trend: this week's avg vs the prior week's avg (own history).
    const windowAvg = (from: Date, to: Date): number | null => {
      let s = 0;
      let t = 0;
      for (const g of grades) {
        if (g.value == null || !g.publishedAt) continue;
        if (g.publishedAt < from || g.publishedAt >= to) continue;
        const coef = coefOf(g);
        s += norm(Number(g.value), Number(g.assessment.maxScore)) * coef;
        t += coef;
      }
      return t > 0 ? s / t : null;
    };
    const thisWeekAvg = windowAvg(weekAgo, now);
    const priorWeekAvg = windowAvg(twoWeeksAgo, weekAgo);
    let trendDelta: number | null = null;
    let trend: DigestTrend = 'unknown';
    if (thisWeekAvg != null && priorWeekAvg != null) {
      trendDelta = Math.round((thisWeekAvg - priorWeekAvg) * 10) / 10;
      trend = trendDelta > TREND_EPSILON ? 'improving' : trendDelta < -TREND_EPSILON ? 'declining' : 'stable';
    }

    // ---- New alerts this week (detectedAt >= now-7d, open/acknowledged) ----
    const newAlerts = await this.prisma.alertInstance.findMany({
      where: {
        tenantId,
        studentId,
        detectedAt: { gte: weekAgo },
        status: { in: ['open', 'acknowledged'] },
      },
      orderBy: [{ severity: 'desc' }, { detectedAt: 'desc' }],
      select: { title: true, severity: true, subjectId: true, recommendation: true },
    });
    const newAlertsCount = newAlerts.length;
    const newAlertTitles = newAlerts.slice(0, 3).map((a) => a.title);

    // ---- Upcoming assessments in (now, now+7d] for the active class ----
    let upcoming: DigestUpcomingAssessment[] = [];
    if (classSectionId) {
      const in7 = new Date(now.getTime() + WEEK_MS);
      const rows = await this.prisma.assessment.findMany({
        where: {
          tenantId,
          isPublished: true,
          scheduledAt: { gt: now, lte: in7 },
          teachingAssignment: { classSectionId },
        },
        orderBy: { scheduledAt: 'asc' },
        take: 3,
        select: {
          title: true,
          kind: true,
          scheduledAt: true,
          teachingAssignment: { select: { subject: { select: { name: true } } } },
        },
      });
      upcoming = rows.map((r) => ({
        scheduledAt: (r.scheduledAt ?? now).toISOString(),
        subjectName: r.teachingAssignment?.subject?.name ?? 'Matière',
        kindLabel: ASSESSMENT_KIND_LABEL[r.kind] ?? 'Évaluation',
        title: r.title,
      }));
    }

    // ---- One recommended action: most-severe open alert, else positive ----
    let recommendation: string;
    const topAlert = [...newAlerts].sort(
      (a, b) => SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity],
    )[0];
    if (topAlert) {
      recommendation =
        topAlert.recommendation?.trim() ||
        'Échangez avec l’enseignant concerné pour faire le point.';
    } else if (globalAverage != null && globalAverage >= 14) {
      recommendation = 'Tout va bien cette semaine — continuez ainsi.';
    } else {
      recommendation = 'Aucune alerte cette semaine. Continuez à suivre les évaluations à venir.';
    }
    const topAlertSubjectId = topAlert?.subjectId ?? null;
    const recommendationLink = topAlertSubjectId
      ? `/parent/grades?studentId=${studentId}&subjectId=${topAlertSubjectId}`
      : `/parent/dashboard?studentId=${studentId}`;

    return {
      studentId,
      firstName,
      lastName,
      className,
      globalAverage,
      trendDelta,
      trend,
      newAlertsCount,
      newAlertTitles,
      upcoming,
      recommendation,
      recommendationLink,
    };
  }
}
