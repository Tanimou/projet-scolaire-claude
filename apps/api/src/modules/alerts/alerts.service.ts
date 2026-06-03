import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  AlertInstance,
  AlertRule,
  AlertRuleCode,
  AlertSeverity,
  AlertStatus,
  NotificationSeverity,
  Prisma,
} from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

import {
  AlertInstanceDto,
  AlertRuleDto,
  RULE_CODES,
  RULE_DEFAULTS,
  UpdateAlertRuleDto,
} from './alerts.types';
import { evaluateHighAbsence } from './rules/high-absence.rule';
import { evaluateLowSubjectAvg } from './rules/low-subject-avg.rule';
import { evaluateNegativeTrend } from './rules/negative-trend.rule';
import { evaluateRepeatedFailure } from './rules/repeated-failure.rule';
import type { DetectedAlert, RuleContext } from './rules/rule-context';

const DEDUP_WINDOW_DAYS = 7;

type AlertInstanceFull = AlertInstance & {
  student: { firstName: string; lastName: string };
  subject: { id: string; name: string; code: string } | null;
  classSection: { id: string; name: string } | null;
};

type RuleFn = (ctx: RuleContext) => Promise<DetectedAlert[]>;

const RULE_FN: Partial<Record<AlertRuleCode, RuleFn>> = {
  LOW_SUBJECT_AVG: evaluateLowSubjectAvg,
  HIGH_ABSENCE: evaluateHighAbsence,
  REPEATED_FAILURE: evaluateRepeatedFailure,
  NEGATIVE_TREND: evaluateNegativeTrend,
  // MISSING_ASSESSMENT, TEACHER_COMMENT_FLAG, BEHAVIOR_ALERT
  // remain stubs — they will be wired in subsequent iterations.
};

@Injectable()
export class AlertsService {
  private readonly logger = new Logger(AlertsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {}

  // ----- Rule management -----------------------------------------------------

  /**
   * Materialise rule rows for a tenant on demand. We don't seed them at install
   * time; the first GET creates the defaults so the admin sees the full list
   * with `enabled=false`. Idempotent.
   */
  async ensureRules(args: { tenantId: string; schoolId: string | null }): Promise<AlertRule[]> {
    const existing = await this.prisma.alertRule.findMany({
      where: { tenantId: args.tenantId, schoolId: args.schoolId ?? null },
    });
    const existingByCode = new Map(existing.map((r) => [r.code, r]));
    const toCreate = RULE_CODES.filter((c) => !existingByCode.has(c)).map((code) => ({
      tenantId: args.tenantId,
      schoolId: args.schoolId ?? null,
      code,
      enabled: false,
      severity: RULE_DEFAULTS[code].severity,
      parameters: RULE_DEFAULTS[code].parameters as Prisma.InputJsonValue,
    }));
    if (toCreate.length === 0) return existing;
    await this.prisma.alertRule.createMany({ data: toCreate });
    return this.prisma.alertRule.findMany({
      where: { tenantId: args.tenantId, schoolId: args.schoolId ?? null },
    });
  }

  async listRules(args: {
    tenantId: string;
    schoolId: string | null;
  }): Promise<AlertRuleDto[]> {
    const rules = await this.ensureRules(args);
    const byCode = new Map(rules.map((r) => [r.code, r]));

    // Tally open instances per code in one query
    const openCounts = await this.prisma.alertInstance.groupBy({
      by: ['code'],
      where: {
        tenantId: args.tenantId,
        status: 'open',
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
      _count: { _all: true },
    });
    const openByCode = new Map(openCounts.map((c) => [c.code, c._count._all]));

    return RULE_CODES.map((code) => {
      const r = byCode.get(code) ?? null;
      const defaults = RULE_DEFAULTS[code];
      return {
        id: r?.id ?? null,
        code,
        label: defaults.label,
        description: defaults.description,
        enabled: r?.enabled ?? false,
        severity: (r?.severity ?? defaults.severity) as AlertSeverity,
        parameters: (r?.parameters as Record<string, unknown>) ?? defaults.parameters,
        openInstances: openByCode.get(code) ?? 0,
      };
    });
  }

  async updateRule(args: {
    tenantId: string;
    schoolId: string | null;
    code: AlertRuleCode;
    dto: UpdateAlertRuleDto;
  }): Promise<AlertRuleDto> {
    await this.ensureRules({ tenantId: args.tenantId, schoolId: args.schoolId });
    // Nullable compound unique keys don't get a clean `where` input in Prisma —
    // resolve the row id first, then update by primary key.
    const existing = await this.prisma.alertRule.findFirst({
      where: {
        tenantId: args.tenantId,
        schoolId: args.schoolId ?? null,
        code: args.code,
      },
      select: { id: true },
    });
    if (!existing) throw new NotFoundException('Alert rule not found');
    const updated = await this.prisma.alertRule.update({
      where: { id: existing.id },
      data: {
        ...(args.dto.enabled != null ? { enabled: args.dto.enabled } : {}),
        ...(args.dto.severity ? { severity: args.dto.severity } : {}),
        ...(args.dto.parameters
          ? { parameters: args.dto.parameters as Prisma.InputJsonValue }
          : {}),
      },
    });
    const defaults = RULE_DEFAULTS[args.code];
    return {
      id: updated.id,
      code: updated.code,
      label: defaults.label,
      description: defaults.description,
      enabled: updated.enabled,
      severity: updated.severity,
      parameters: (updated.parameters as Record<string, unknown>) ?? {},
    };
  }

  // ----- Instances -----------------------------------------------------------

  async listInstances(args: {
    tenantId: string;
    schoolId: string | null;
    status?: AlertStatus;
    studentId?: string;
    limit: number;
    offset: number;
  }): Promise<{ data: AlertInstanceDto[]; total: number }> {
    const where: Prisma.AlertInstanceWhereInput = {
      tenantId: args.tenantId,
      ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      ...(args.status ? { status: args.status } : {}),
      ...(args.studentId ? { studentId: args.studentId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.prisma.alertInstance.findMany({
        where,
        include: {
          student: { select: { firstName: true, lastName: true } },
          subject: { select: { id: true, name: true, code: true } },
          classSection: { select: { id: true, name: true } },
        },
        orderBy: [{ status: 'asc' }, { detectedAt: 'desc' }],
        skip: args.offset,
        take: args.limit,
      }),
      this.prisma.alertInstance.count({ where }),
    ]);
    return { data: rows.map((r) => this.toDto(r as AlertInstanceFull)), total };
  }

  async acknowledge(args: { tenantId: string; id: string; userProfileId: string }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    return this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: row.status === 'open' ? 'acknowledged' : row.status,
        acknowledgedAt: row.acknowledgedAt ?? new Date(),
        acknowledgedBy: row.acknowledgedBy ?? args.userProfileId,
      },
    });
  }

  async resolve(args: { tenantId: string; id: string; userProfileId: string }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    return this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: args.userProfileId,
      },
    });
  }

  async dismiss(args: { tenantId: string; id: string; userProfileId: string }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    return this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: 'dismissed',
        resolvedAt: new Date(),
        resolvedBy: args.userProfileId,
      },
    });
  }

  // ----- Evaluator -----------------------------------------------------------

  /**
   * Run every enabled rule and materialise new alerts (deduped within
   * DEDUP_WINDOW_DAYS). Returns the count of new alerts created.
   *
   * Called from:
   *  - Admin "Lancer l'évaluation" button via POST /alerts/evaluate
   *  - Worker cron (every 15 min)
   *  - Future event triggers (grade.publish, attendance.batch)
   */
  async evaluateAll(args: { tenantId: string; schoolId: string | null }): Promise<{
    rulesRun: number;
    detected: number;
    createdInstances: number;
  }> {
    const rules = await this.prisma.alertRule.findMany({
      where: {
        tenantId: args.tenantId,
        enabled: true,
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
    });

    if (rules.length === 0) {
      return { rulesRun: 0, detected: 0, createdInstances: 0 };
    }

    // Resolve active academic year once.
    const activeYear = await this.prisma.academicYear.findFirst({
      where: {
        tenantId: args.tenantId,
        status: 'active',
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    let totalDetected = 0;
    let totalCreated = 0;
    const since = new Date();
    since.setUTCDate(since.getUTCDate() - DEDUP_WINDOW_DAYS);

    for (const rule of rules) {
      const fn = RULE_FN[rule.code];
      if (!fn) {
        this.logger.debug(`Rule ${rule.code} has no evaluator yet — skipping`);
        continue;
      }

      const detections = await fn({
        prisma: this.prisma,
        rule,
        tenantId: args.tenantId,
        schoolId: args.schoolId,
        academicYearId: activeYear?.id ?? null,
        dedupWindowDays: DEDUP_WINDOW_DAYS,
      });
      totalDetected += detections.length;

      // Deduplicate against existing recent alerts for the same (rule, student, subject?)
      for (const d of detections) {
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
        totalCreated++;

        // Fan out a notification to each active guardian. Dedup by sourceId
        // ensures a re-evaluation never double-pings the same parent.
        await this.notifyGuardiansOfAlert({
          tenantId: args.tenantId,
          studentId: d.studentId,
          alertId: instance.id,
          severity: rule.severity,
          title: d.title,
          body: d.body,
        });
      }
    }

    this.logger.log(
      `evaluateAll(tenant=${args.tenantId}, school=${args.schoolId ?? '*'}) — ${rules.length} rules, ${totalDetected} detected, ${totalCreated} new`,
    );
    return { rulesRun: rules.length, detected: totalDetected, createdInstances: totalCreated };
  }

  // ----- Notification fan-out ------------------------------------------------

  /**
   * For a freshly-created AlertInstance, look up every active guardian linked
   * to the student via `Guardianship` and create one in-app notification per
   * guardian (deduplicated by `sourceId = alertId` so the same alert never
   * notifies the same guardian twice).
   */
  private async notifyGuardiansOfAlert(args: {
    tenantId: string;
    studentId: string;
    alertId: string;
    severity: AlertSeverity;
    title: string;
    body: string;
  }): Promise<void> {
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
    if (recipients.length === 0) return;

    const severityMap: Record<AlertSeverity, NotificationSeverity> = {
      low: 'info',
      medium: 'warning',
      high: 'danger',
    };

    await this.notifications.createMany(
      recipients.map((userProfileId) => ({
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
    );
  }

  // ----- Parent view (ABAC) --------------------------------------------------

  /**
   * Alerts visible by a parent for a given student. The caller MUST have
   * already passed `StudentAccessService.canAccessStudent` before invoking
   * this — the service trusts its inputs.
   */
  async listForStudent(args: {
    tenantId: string;
    studentId: string;
    limit?: number;
  }): Promise<AlertInstanceDto[]> {
    const rows = await this.prisma.alertInstance.findMany({
      where: {
        tenantId: args.tenantId,
        studentId: args.studentId,
        status: { in: ['open', 'acknowledged'] },
      },
      include: {
        student: { select: { firstName: true, lastName: true } },
        subject: { select: { id: true, name: true, code: true } },
        classSection: { select: { id: true, name: true } },
      },
      orderBy: { detectedAt: 'desc' },
      take: args.limit ?? 10,
    });
    return rows.map((r) => this.toDto(r as AlertInstanceFull));
  }

  // -- helpers --------------------------------------------------------------

  private toDto(row: AlertInstanceFull): AlertInstanceDto {
    return {
      id: row.id,
      code: row.code,
      severity: row.severity,
      status: row.status,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      subjectId: row.subject?.id ?? null,
      subjectName: row.subject?.name ?? null,
      subjectCode: row.subject?.code ?? null,
      classSectionId: row.classSection?.id ?? null,
      classSectionName: row.classSection?.name ?? null,
      title: row.title,
      body: row.body,
      recommendation: row.recommendation,
      detectedAt: row.detectedAt.toISOString(),
      acknowledgedAt: row.acknowledgedAt?.toISOString() ?? null,
      resolvedAt: row.resolvedAt?.toISOString() ?? null,
    };
  }

  // ----- Tenant scan (worker) ------------------------------------------------

  /**
   * Returns every tenant id that has at least one enabled rule. Used by the
   * worker cron to know which tenants need evaluation.
   */
  async tenantsWithEnabledRules(): Promise<string[]> {
    const rows = await this.prisma.alertRule.findMany({
      where: { enabled: true },
      select: { tenantId: true },
      distinct: ['tenantId'],
    });
    return rows.map((r) => r.tenantId);
  }

  /**
   * Permission helper for non-controller code paths (no-op for now — the
   * controller already gates writes via the existing @RequiresPermission
   * decorator).
   */
  ensureAdmin(_isAdmin: boolean): void {
    if (!_isAdmin) throw new ForbiddenException('Admin permission required');
  }
}
