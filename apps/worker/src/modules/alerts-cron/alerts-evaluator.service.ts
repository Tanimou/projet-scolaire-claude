import { Injectable, Logger } from '@nestjs/common';
import type { AlertRuleCode, Prisma } from '@prisma/client';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { evaluateHighAbsence } from '../alerts-rules/high-absence.rule';
import { evaluateLowSubjectAvg } from '../alerts-rules/low-subject-avg.rule';
import { evaluateMissingAssessment } from '../alerts-rules/missing-assessment.rule';
import { evaluateNegativeTrend } from '../alerts-rules/negative-trend.rule';
import { evaluateRepeatedFailure } from '../alerts-rules/repeated-failure.rule';
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
  }): Promise<{ rulesRun: number; detected: number; createdInstances: number }> {
    const rules = await this.prisma.alertRule.findMany({
      where: {
        tenantId: args.tenantId,
        enabled: true,
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
      },
    });
    if (rules.length === 0) return { rulesRun: 0, detected: 0, createdInstances: 0 };

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
        await this.prisma.alertInstance.create({
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
      }
    }

    if (detected > 0 || created > 0) {
      this.logger.log(
        `tenant=${args.tenantId} — ${rules.length} rules, ${detected} detected, ${created} new`,
      );
    }
    return { rulesRun: rules.length, detected, createdInstances: created };
  }
}
