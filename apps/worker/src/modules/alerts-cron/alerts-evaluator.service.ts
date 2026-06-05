import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import type { AlertRuleCode, AlertSeverity, NotificationSeverity, Prisma } from '@prisma/client';
import { Queue } from 'bullmq';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { QUEUE_NOTIFICATIONS_EMAIL } from '../../shared/queue/queue.module';
import type { NotificationEmailJob } from '../notifications-email/notification-email.types';

import { evaluateHighAbsence } from '../alerts-rules/high-absence.rule';
import { evaluateLowSubjectAvg } from '../alerts-rules/low-subject-avg.rule';
import { evaluateMissingAssessment } from '../alerts-rules/missing-assessment.rule';
import { evaluateImprovement } from '../alerts-rules/improvement.rule';
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
  IMPROVEMENT: evaluateImprovement,
};

@Injectable()
export class AlertsEvaluatorService {
  private readonly logger = new Logger(AlertsEvaluatorService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(QUEUE_NOTIFICATIONS_EMAIL)
    private readonly emailQueue: Queue<NotificationEmailJob>,
  ) {}

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
   * active guardian linked to the student via `Guardianship`, AND — for each
   * guardian who has opted into the email channel for the `alert` kind
   * (`NotificationPreference(alert, emailEnabled=true)`) — enqueue the SAME
   * `notifications-email` BullMQ job the API path produces. Mirrors the API
   * side `AlertsService.notifyGuardiansOfAlert` → `NotificationsService`, but
   * the worker has no `NotificationsService` (only an email *consumer* lives
   * here), so it inserts the in-app rows directly via Prisma and produces the
   * email jobs onto the existing shared queue.
   *
   * E3-S4 — EMAIL PARITY WITH THE API PATH. Email is opt-in / OFF by default
   * (RGPD), gated per-recipient by `NotificationPreference(alert, emailEnabled)`
   * exactly like the API producer; opt-out / default guardians get in-app only,
   * unchanged. We reuse the existing `notifications-email` queue + template +
   * retry/backoff (no new queue, no new template) so the cron path and the API
   * path now have identical delivery semantics.
   *
   * Best-effort: every failure is caught and logged so a notification problem
   * never rolls back the already-committed AlertInstance nor aborts the loop.
   * The email enqueue is independently wrapped, so an SMTP/Redis hiccup on the
   * email side can never lose the in-app fan-out. Returns the number of in-app
   * notification rows created (for telemetry only).
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

      const link = `/parent/recommendations?studentId=${args.studentId}`;
      const res = await this.prisma.notification.createMany({
        data: toInsert.map((userProfileId) => ({
          tenantId: args.tenantId,
          userProfileId,
          kind: 'alert' as const,
          severity: severityMap[args.severity],
          title: args.title,
          body: args.body,
          link,
          sourceType: 'alert_instance',
          sourceId: args.alertId,
        })),
      });

      // Email channel (E3-S4) — strictly additive, runs on the same freshly
      // notified recipients, gated by the per-user email opt-in. Independent of
      // the in-app insert above and best-effort: never throws back into the loop.
      await this.dispatchAlertEmails({
        tenantId: args.tenantId,
        recipients: toInsert,
        alertId: args.alertId,
        severity: severityMap[args.severity],
        title: args.title,
        body: args.body,
        link,
      });

      return res.count;
    } catch (err) {
      this.logger.error(
        `notifyGuardiansOfAlert failed (alert=${args.alertId}, student=${args.studentId}): ${(err as Error).message}`,
      );
      return 0;
    }
  }

  /**
   * Enqueue one `notifications-email` job per guardian who has *explicitly
   * enabled* the email channel for the `alert` kind. Mirrors the API's
   * `NotificationsService.dispatchEmails` (same kind, same job shape, same
   * retry/backoff) so the consumer + template are shared verbatim.
   *
   * Email defaults to OFF (RGPD), so for the vast majority of guardians this is
   * a no-op (no enabled override row → not emailed). Tenant isolation: the
   * recipients are already resolved from this tenant's active guardianships, and
   * the preference + profile lookups are by those exact userProfileIds, so no
   * cross-tenant recipient can be reached. No double-send: callers pass only the
   * freshly source-deduped recipients, and the alert itself is deduped within
   * the 7-day window before we ever get here.
   *
   * Best-effort: a side-channel failure is swallowed so the already-committed
   * in-app notifications (and the AlertInstance) are never affected.
   */
  private async dispatchAlertEmails(args: {
    tenantId: string;
    recipients: string[];
    alertId: string;
    severity: NotificationSeverity;
    title: string;
    body: string;
    link: string;
  }): Promise<void> {
    try {
      if (args.recipients.length === 0) return;

      // Per-user email opt-in for the `alert` kind. Default OFF: a missing
      // override row means "no email", so only explicitly-enabled rows pass.
      // E5-S2: also gate on `cadence: 'instant'` so this cron path mirrors the
      // API `instantEmailKeys` gate — a parent who set `alert` to `daily_digest`
      // (or `off`) gets NO instant alert email here; the alert is bundled into the
      // daily digest instead (no double-delivery). A missing override row resolves
      // to email OFF anyway, so the explicit-row filter is unaffected.
      const prefs = await this.prisma.notificationPreference.findMany({
        where: {
          tenantId: args.tenantId,
          kind: 'alert',
          emailEnabled: true,
          cadence: 'instant',
          userProfileId: { in: args.recipients },
        },
        select: { userProfileId: true },
      });
      const optedIn = prefs.map((p) => p.userProfileId);
      if (optedIn.length === 0) return;

      const profiles = await this.prisma.userProfile.findMany({
        where: { tenantId: args.tenantId, id: { in: optedIn } },
        select: { id: true, email: true, firstName: true, lastName: true, locale: true },
      });

      const jobs = profiles
        .filter((p) => !!p.email)
        .map((p) => {
          const data: NotificationEmailJob = {
            tenantId: args.tenantId,
            to: p.email,
            recipientName:
              [p.firstName, p.lastName].filter(Boolean).join(' ').trim() || p.email,
            locale: p.locale ?? 'fr-FR',
            kind: 'alert',
            severity: args.severity,
            title: args.title,
            body: args.body,
            link: args.link,
            sourceType: 'alert_instance',
            sourceId: args.alertId,
          };
          return {
            name: 'alert',
            data,
            opts: {
              attempts: 3,
              backoff: { type: 'exponential', delay: 5_000 } as const,
              removeOnComplete: { count: 200, age: 24 * 3600 },
              removeOnFail: { count: 100, age: 7 * 24 * 3600 },
            },
          };
        });

      if (jobs.length === 0) return;
      await this.emailQueue.addBulk(jobs);
      this.logger.log(
        `Enqueued ${jobs.length} alert email(s) (alert=${args.alertId})`,
      );
    } catch (err) {
      // Side channel — an enqueue failure must never surface to the caller whose
      // in-app notifications already landed.
      this.logger.error(
        `dispatchAlertEmails failed (alert=${args.alertId}, in-app unaffected): ${(err as Error).message}`,
      );
    }
  }
}
