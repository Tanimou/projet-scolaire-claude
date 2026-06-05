import { Injectable, Logger } from '@nestjs/common';
import type { AlertRuleCode, AlertSeverity, NotificationSeverity, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { evaluateHighAbsence } from '../alerts-rules/high-absence.rule';
import { evaluateLowSubjectAvg } from '../alerts-rules/low-subject-avg.rule';
import { evaluateMissingAssessment } from '../alerts-rules/missing-assessment.rule';
import { evaluateNegativeTrend } from '../alerts-rules/negative-trend.rule';
import { evaluateRepeatedFailure } from '../alerts-rules/repeated-failure.rule';
import { evaluateTeacherCommentFlag } from '../alerts-rules/teacher-comment-flag.rule';
import type { DetectedAlert, RuleContext } from '../alerts-rules/rule-context';

/**
 * Worker-side evaluator. Mirrors AlertsService.evaluateAll on the API side
 * (the rule files are duplicated under `modules/alerts-rules/`). The split
 * exists because the worker runs in its own Nest application context — we
 * keep the surface small and will fold both into a `@pilotage/alerts-core`
 * package once a third caller appears.
 */
const DEDUP_WINDOW_DAYS = 7;

type RuleFn = (ctx: RuleContext) => Promise<DetectedAlert[]>;

const RULE_FN: Partial<Record<AlertRuleCode, RuleFn>> = {
  LOW_SUBJECT_AVG: evaluateLowSubjectAvg,
  HIGH_ABSENCE: evaluateHighAbsence,
  REPEATED_FAILURE: evaluateRepeatedFailure,
  NEGATIVE_TREND: evaluateNegativeTrend,
  MISSING_ASSESSMENT: evaluateMissingAssessment,
  TEACHER_COMMENT_FLAG: evaluateTeacherCommentFlag,
};

@Injectable()
export class AlertsEvaluatorService {
  private readonly logger = new Logger(AlertsEvaluatorService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** List tenants with at least one enabled rule. */
  async tenantsToEvaluate(): Promise<string[]> {
    const rows = await this.prisma.alertRule.findMany({
      where: { enabled: true },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  async evaluateTenant(args: {
    tenantId: string;
    schoolId?: string | null;
  }): Promise<{
    rulesRun: number;
    detected: number;
    createdInstances: number;
    notified: number;
  }> {
    const rules = await this.prisma.alertRule.findMany({
      where: {
        tenantId: args.tenantId,
        enabled: true,
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
    });
    if (rules.length === 0)
      return { rulesRun: 0, detected: 0, createdInstances: 0, notified: 0 };

    const activeYear = await this.prisma.academicYear.findFirst({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    let detected = 0;
    let created = 0;
    let notified = 0;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - DEDUP_WINDOW_DAYS);

    for (const rule of rules) {
      const fn = RULE_FN[rule.code];
      if (!fn) continue;

      const found = await fn({
        prisma: this.prisma,
        rule,
        tenantId: args.tenantId,
        schoolId: args.schoolId ?? null,
        academicYearId: activeYear?.id ?? null,
        dedupWindowDays: DEDUP_WINDOW_DAYS,
      });
      detected += found.length;

      for (const d of found) {
        const recent = await this.prisma.alertInstance.findFirst({
          where: {
            tenantId: args.tenantId,
            ruleId: rule.id,
            studentId: d.studentId,
            subjectId: d.subjectId ?? null,
            detectedAt: { gte: since },
            status: { in: ['open', 'acknowledged'] },
          },
          select: { id: true },
        });
        if (recent) continue;
        const instance = await this.prisma.alertInstance.create({
          data: {
            tenantId: args.tenantId,
            schoolId: args.schoolId ?? null,
            ruleId: rule.id,
            code: rule.code,
            severity: rule.severity,
            status: 'open',
            studentId: d.studentId,
            subjectId: d.subjectId ?? null,
            classSectionId: d.classSectionId ?? null,
            title: d.title,
            body: d.body,
            recommendation: d.recommendation ?? null,
            context: (d.context ?? {}) as Prisma.InputJsonValue,
          },
        });
        created++;

        // Fan out a parent-facing in-app notification for the freshly-created
        // alert — the manual API path (AlertsService.evaluateAll) already does
        // this; without it, cron-detected alerts never ring the parent's bell.
        // Best-effort: a failure here must never roll back the AlertInstance
        // above nor abort the rest of the evaluation pass.
        notified += await this.notifyGuardiansOfAlert({
          tenantId: args.tenantId,
          studentId: d.studentId,
          alertId: instance.id,
          severity: rule.severity,
          title: d.title,
          body: d.body,
        });
      }
    }

    if (detected > 0 || created > 0) {
      this.logger.log(
        `tenant=${args.tenantId} — ${rules.length} rules, ${detected} detected, ${created} new, ${notified} guardians notified`,
      );
    }
    return { rulesRun: rules.length, detected, createdInstances: created, notified };
  }

  /**
   * For a freshly-created AlertInstance, create one in-app `Notification` per
   * active guardian linked to the student via `Guardianship`. Mirrors the API
   * side `AlertsService.notifyGuardiansOfAlert`, but the worker has no
   * `NotificationsService` (only an email *consumer* lives here), so it inserts
   * directly via Prisma.
   *
   * SCOPE — IN-APP ONLY. The email channel (BullMQ `dispatchEmails`) and the
   * per-user notification-preference gate are owned by the API's
   * `NotificationsService`; replicating that plumbing in the worker is
   * deliberately deferred to a follow-up. Email is opt-in / off by default, so
   * cron-path alerts simply skip it for now; the manual "Evaluate now" path
   * still emails. This asymmetry is intentional and tracked.
   *
   * Best-effort: every failure is caught and logged so a notification problem
   * never rolls back the already-committed AlertInstance nor aborts the loop.
   * Returns the number of notification rows created (for telemetry only).
   */
  private async notifyGuardiansOfAlert(args: {
    tenantId: string;
    studentId: string;
    alertId: string;
    severity: AlertSeverity;
    title: string;
    body: string;
  }): Promise<number> {
    try {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          guardian: { userProfileId: { not: null } },
        },
        include: { guardian: { select: { userProfileId: true } } },
      });
      const recipients = guardianships
        .map((g) => g.guardian.userProfileId)
        .filter((id): id is string => !!id);
      if (recipients.length === 0) return 0;

      // Source-dedup so a re-tick / concurrent pass never double-pings the same
      // guardian for the same alert (mirrors NotificationsService.createMany).
      const existing = await this.prisma.notification.findMany({
        where: {
          tenantId: args.tenantId,
          sourceType: 'alert_instance',
          sourceId: args.alertId,
          userProfileId: { in: recipients },
        },
        select: { userProfileId: true },
      });
      const already = new Set(existing.map((e) => e.userProfileId));
      const toInsert = recipients.filter((id) => !already.has(id));
      if (toInsert.length === 0) return 0;

      const severityMap: Record<AlertSeverity, NotificationSeverity> = {
        low: 'info',
        medium: 'warning',
        high: 'danger',
      };

      const res = await this.prisma.notification.createMany({
        data: toInsert.map((userProfileId) => ({
          tenantId: args.tenantId,
          userProfileId,
          kind: 'alert' as const,
          severity: severityMap[args.severity],
          title: args.title,
          body: args.body,
          link: `/parent/recommendations?studentId=${args.studentId}`,
          sourceType: 'alert_instance',
          sourceId: args.alertId,
        })),
      });
      return res.count;
    } catch (err) {
      this.logger.error(
        `notifyGuardiansOfAlert failed (alert=${args.alertId}, student=${args.studentId}): ${(err as Error).message}`,
      );
      return 0;
    }
  }
}
