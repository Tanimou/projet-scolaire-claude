import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
// `Prisma` is imported as a runtime value (used for `instanceof
// Prisma.PrismaClientKnownRequestError` in the P2002 idempotency catch) as well
// as for its `Prisma.*` type helpers.
import { Prisma } from '@prisma/client';
import type {
  AlertInstance,
  AlertRule,
  AlertRuleCode,
  AlertSeverity,
  AlertStatus,
  NotificationSeverity,
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
import { evaluateMissingAssessment } from './rules/missing-assessment.rule';
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
  MISSING_ASSESSMENT: evaluateMissingAssessment,
  // TEACHER_COMMENT_FLAG, BEHAVIOR_ALERT
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
    // Admin list does not surface a per-caller meeting-request marker (it is a
    // parent-confirmation read-path concern); pass an empty map → null field.
    return { data: rows.map((r) => this.toDto(r as AlertInstanceFull)), total };
  }

  /**
   * Resolve the `studentId` an alert instance belongs to, scoped to the caller's
   * tenant. Used by the parent-scoped lifecycle endpoints to run the
   * `StudentAccessService` guardianship ABAC check BEFORE mutating — the alert's
   * studentId is never trusted from the client; it is read here under the same
   * `where: { id, tenantId }` guard the lifecycle methods use, so a cross-tenant
   * id yields `null` (→ 404 at the controller) and never leaks another tenant's
   * student linkage. Returns `null` when the alert does not exist in this tenant.
   */
  async findStudentIdForAlert(args: {
    tenantId: string;
    id: string;
  }): Promise<string | null> {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: { studentId: true },
    });
    return row?.studentId ?? null;
  }

  async acknowledge(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    const didTransition = row.status === 'open';
    const updated = await this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: didTransition ? 'acknowledged' : row.status,
        acknowledgedAt: row.acknowledgedAt ?? new Date(),
        acknowledgedBy: row.acknowledgedBy ?? args.userProfileId,
      },
    });
    // Best-effort, post-update audit trail. Only logged when acknowledge is a
    // real transition (open -> acknowledged); a no-op acknowledge writes no row
    // so the append-only trail stays meaningful. Never rolls back the status.
    if (didTransition) {
      await this.writeAuditEntry({
        tenantId: args.tenantId,
        alertId: args.id,
        actorId: args.userProfileId,
        action: 'alert.acknowledge',
        beforeStatus: row.status,
        afterStatus: 'acknowledged',
        actorRole: args.actorRole,
        portal: args.portal,
      });
    }
    return updated;
  }

  async resolve(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    // Idempotent terminal transition: only open/acknowledged alerts may move to
    // resolved. A second resolve (or a resolve of an already-dismissed alert) is
    // a no-op — it must NOT re-stamp resolvedAt/resolvedBy nor write a duplicate
    // audit row, keeping the append-only trail one-row-per-real-transition and
    // preventing status regression / provenance pollution (e.g. a parent
    // double-click or "resolving" a dismissed alert).
    const didTransition = row.status === 'open' || row.status === 'acknowledged';
    if (!didTransition) return row;
    const updated = await this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: 'resolved',
        resolvedAt: new Date(),
        resolvedBy: args.userProfileId,
      },
    });
    // Best-effort: retract the guardian bell notifications for this alert. The
    // status transition is the source of truth — a notification failure must
    // never roll it back or surface to the admin (mirrors dispatchEmails).
    try {
      await this.notifications.markReadBySource({
        tenantId: args.tenantId,
        sourceType: 'alert_instance',
        sourceId: args.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to retract notifications for resolved alert ${args.id} (status unaffected): ${(err as Error).message}`,
      );
    }
    // Best-effort, post-update audit trail (independent of the retraction above).
    await this.writeAuditEntry({
      tenantId: args.tenantId,
      alertId: args.id,
      actorId: args.userProfileId,
      action: 'alert.resolve',
      beforeStatus: row.status,
      afterStatus: 'resolved',
      actorRole: args.actorRole,
      portal: args.portal,
    });
    return updated;
  }

  async dismiss(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }) {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
    });
    if (!row) throw new NotFoundException('Alert not found');
    // Idempotent terminal transition: only open/acknowledged alerts may move to
    // dismissed. A second dismiss (or dismissing an already-resolved alert) is a
    // no-op — no re-stamp, no duplicate audit row (see resolve for rationale).
    const didTransition = row.status === 'open' || row.status === 'acknowledged';
    if (!didTransition) return row;
    const updated = await this.prisma.alertInstance.update({
      where: { id: args.id },
      data: {
        status: 'dismissed',
        resolvedAt: new Date(),
        resolvedBy: args.userProfileId,
      },
    });
    // Best-effort retraction (see resolve): a dismissed alert is closed, so its
    // guardian bell notifications stop ringing. Never blocks the dismiss.
    try {
      await this.notifications.markReadBySource({
        tenantId: args.tenantId,
        sourceType: 'alert_instance',
        sourceId: args.id,
      });
    } catch (err) {
      this.logger.error(
        `Failed to retract notifications for dismissed alert ${args.id} (status unaffected): ${(err as Error).message}`,
      );
    }
    // Best-effort, post-update audit trail (independent of the retraction above).
    await this.writeAuditEntry({
      tenantId: args.tenantId,
      alertId: args.id,
      actorId: args.userProfileId,
      action: 'alert.dismiss',
      beforeStatus: row.status,
      afterStatus: 'dismissed',
      actorRole: args.actorRole,
      portal: args.portal,
    });
    return updated;
  }

  /**
   * Record a parent's "talk to the teacher" meeting-request intent for an alert
   * (E1-S2, promoted in E1-S3). Unlike the lifecycle methods this does NOT touch
   * `AlertInstance.status` — a meeting request is orthogonal to
   * ack/resolve/dismiss, so the alert stays open/acknowledged and listed.
   *
   * S3 promotes the S2 append-only audit row into a queryable `MeetingRequest`
   * model. This now (a) creates ONE `MeetingRequest` (status `open`) with a
   * server-resolved `assignedToId` (subject teacher → main teacher → null —
   * never client-supplied), (b) STILL writes the append-only
   * `alert.meeting_intent` `AuditLog` row alongside (durable provenance — the
   * audit trail is non-negotiable), and (c) fires ONE in-app notification to the
   * assignee. Idempotency is a DB invariant: the `@@unique(tenantId, alertId,
   * requestedBy)` constraint + a P2002 catch guarantee one row + one notification
   * even under two concurrent POSTs (a re-request returns `alreadyRequested:true`
   * with the original `createdAt` and notifies no one). The alert id has already
   * been confirmed in-tenant and guardianship-checked by the controller
   * (`authorizeParentAlertAction`); studentId/code/subjectId/schoolId are re-read
   * here under the same `{ id, tenantId }` guard, never trusted from the client.
   * The return shape `{ ok, alreadyRequested, requestedAt }` is unchanged from S2.
   */
  async recordMeetingIntent(args: {
    tenantId: string;
    id: string;
    userProfileId: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<{ ok: true; alreadyRequested: boolean; requestedAt: string }> {
    const row = await this.prisma.alertInstance.findFirst({
      where: { id: args.id, tenantId: args.tenantId },
      select: {
        studentId: true,
        code: true,
        subjectId: true,
        schoolId: true,
        title: true,
        student: { select: { firstName: true, lastName: true } },
      },
    });
    if (!row) throw new NotFoundException('Alert not found');

    // Fast-path idempotency check (friendly echo). The DB `@@unique` is the real
    // guarantee — the create below catches P2002 so two concurrent POSTs still
    // yield exactly one row + one notification (closes carried debt #3).
    const existing = await this.prisma.meetingRequest.findUnique({
      where: {
        tenantId_alertId_requestedBy: {
          tenantId: args.tenantId,
          alertId: args.id,
          requestedBy: args.userProfileId,
        },
      },
      select: { createdAt: true },
    });
    if (existing) {
      return {
        ok: true,
        alreadyRequested: true,
        requestedAt: existing.createdAt.toISOString(),
      };
    }

    // Resolve the assignee server-side (never trusted from the client). The
    // request is ALWAYS created even when no assignee resolves (best-effort).
    const assignedToId = await this.resolveMeetingAssignee({
      tenantId: args.tenantId,
      studentId: row.studentId,
      subjectId: row.subjectId ?? null,
    });

    let created: { id: string; createdAt: Date };
    try {
      created = await this.prisma.meetingRequest.create({
        data: {
          tenantId: args.tenantId,
          schoolId: row.schoolId ?? null,
          alertId: args.id,
          studentId: row.studentId,
          subjectId: row.subjectId ?? null,
          alertCode: row.code,
          requestedBy: args.userProfileId,
          assignedToId,
          status: 'open',
        },
        select: { id: true, createdAt: true },
      });
    } catch (err) {
      // Concurrency: a parallel POST won the @@unique race. Treat as
      // already-requested (read the original row's createdAt) — one row, one
      // notification. Any other error propagates.
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        const winner = await this.prisma.meetingRequest.findUnique({
          where: {
            tenantId_alertId_requestedBy: {
              tenantId: args.tenantId,
              alertId: args.id,
              requestedBy: args.userProfileId,
            },
          },
          select: { createdAt: true },
        });
        return {
          ok: true,
          alreadyRequested: true,
          requestedAt: (winner?.createdAt ?? new Date()).toISOString(),
        };
      }
      throw err;
    }

    // Keep the append-only audit trail unbroken (S1/S2 promise) — written only
    // on a genuine new create, alongside the queryable model. Best-effort.
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: args.tenantId,
          actorId: args.userProfileId,
          actorRole: args.actorRole,
          portal: args.portal,
          action: 'alert.meeting_intent',
          resourceType: 'alert_instance',
          resourceId: args.id,
          after: {
            studentId: row.studentId,
            alertCode: row.code,
            subjectId: row.subjectId ?? null,
            meetingRequestId: created.id,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write alert.meeting_intent audit row for meeting request ${created.id} (request unaffected): ${(err as Error).message}`,
      );
    }

    // Notify the assignee on a NEW request only (never on the idempotent path).
    // Best-effort: a notification failure must never roll back the create.
    if (assignedToId) {
      const studentName =
        `${row.student.firstName} ${row.student.lastName}`.trim() || 'Un élève';
      try {
        await this.notifications.createMany([
          {
            tenantId: args.tenantId,
            userProfileId: assignedToId,
            kind: 'alert',
            severity: 'warning',
            title: 'Demande de rendez-vous d’un parent',
            body: `${studentName} — ${row.title}`,
            link: '/teacher/meeting-requests',
            sourceType: 'meeting_request',
            sourceId: created.id,
          },
        ]);
      } catch (err) {
        this.logger.error(
          `Failed to notify assignee ${assignedToId} of meeting request ${created.id} (request unaffected): ${(err as Error).message}`,
        );
      }
    }

    return {
      ok: true,
      alreadyRequested: false,
      requestedAt: created.createdAt.toISOString(),
    };
  }

  /**
   * Resolve the teacher/admin a meeting request routes to, deterministically:
   *   1. subject teacher — active `TeachingAssignment` for the student's current
   *      class section + the alert's subjectId (active academic year), or
   *   2. main teacher (`isMainTeacher`) of the student's current class section, or
   *   3. null (unassigned → visible to school admins in the action center).
   *
   * "Current class section" = the student's active `Enrollment` in the active
   * academic year. Best-effort: any lookup failure → null; NEVER throws, so the
   * meeting request is always created (carried pre-mortem PM-3).
   */
  private async resolveMeetingAssignee(args: {
    tenantId: string;
    studentId: string;
    subjectId: string | null;
  }): Promise<string | null> {
    try {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          academicYear: { status: 'active' },
        },
        orderBy: { enrolledAt: 'desc' },
        select: { classSectionId: true, academicYearId: true },
      });
      if (!enrollment) return null;

      // 1. Subject teacher for (current class section, subject) in the active year.
      if (args.subjectId) {
        const subjectAssignment = await this.prisma.teachingAssignment.findFirst({
          where: {
            tenantId: args.tenantId,
            classSectionId: enrollment.classSectionId,
            subjectId: args.subjectId,
            academicYearId: enrollment.academicYearId,
          },
          select: { teacherProfile: { select: { userProfileId: true } } },
        });
        const subjectTeacherId = subjectAssignment?.teacherProfile.userProfileId ?? null;
        if (subjectTeacherId) return subjectTeacherId;
      }

      // 2. Main teacher of the current class section.
      const mainAssignment = await this.prisma.teachingAssignment.findFirst({
        where: {
          tenantId: args.tenantId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.academicYearId,
          isMainTeacher: true,
        },
        select: { teacherProfile: { select: { userProfileId: true } } },
      });
      return mainAssignment?.teacherProfile.userProfileId ?? null;
    } catch (err) {
      this.logger.error(
        `Failed to resolve meeting assignee for student ${args.studentId} (request will be unassigned): ${(err as Error).message}`,
      );
      return null;
    }
  }

  /**
   * Append-only audit row for an alert lifecycle transition. Best-effort and
   * post-update: a write failure is logged and swallowed, never rolling back the
   * status change nor surfacing to the controller (mirrors the notification
   * retraction). Tenant-scoped — `tenantId` always carries `args.tenantId`, and
   * the alert id has already been confirmed in-tenant by the caller's findFirst.
   * Uses the established inline `prisma.auditLog.create` convention (no shared
   * AuditService exists). `hash`/`prevHash` are left unset, matching every other
   * call site. `actorRole`/`portal` are now derived from the authenticated
   * caller's JWT by the controller (see `deriveAlertActorProvenance`) instead of
   * being hardcoded `school_admin`/`admin`; both are nullable to mirror the
   * `AuditLog` `String?` columns when the caller holds no known realm role.
   */
  private async writeAuditEntry(args: {
    tenantId: string;
    alertId: string;
    actorId: string;
    action: 'alert.acknowledge' | 'alert.resolve' | 'alert.dismiss';
    beforeStatus: string;
    afterStatus: string;
    actorRole: string | null;
    portal: string | null;
  }): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: args.tenantId,
          actorId: args.actorId,
          actorRole: args.actorRole,
          portal: args.portal,
          action: args.action,
          resourceType: 'alert_instance',
          resourceId: args.alertId,
          before: { status: args.beforeStatus } as Prisma.InputJsonValue,
          after: { status: args.afterStatus } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write audit entry ${args.action} for alert ${args.alertId} (status unaffected): ${(err as Error).message}`,
      );
    }
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
   *
   * E1-S3 (carried debt #2): when `userProfileId` is provided, batch-load the
   * caller's OWN open `MeetingRequest` per alert (keyed on `requestedBy =
   * userProfileId`) in ONE query and stamp `meetingRequestedAt` on each DTO so
   * the parent's "Demande envoyée" confirmation persists across reloads. Keyed
   * on the caller's own `requestedBy`, never a co-guardian's — no cross-guardian
   * leak. No per-row N+1: a single `findMany` over the page's alert ids.
   */
  async listForStudent(args: {
    tenantId: string;
    studentId: string;
    userProfileId?: string;
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

    const requestedAtByAlert = await this.loadMeetingRequestedAt({
      tenantId: args.tenantId,
      alertIds: rows.map((r) => r.id),
      userProfileId: args.userProfileId,
    });

    return rows.map((r) => this.toDto(r as AlertInstanceFull, requestedAtByAlert));
  }

  /**
   * Batch-load the caller's own meeting-request timestamp per alert id, in one
   * query. Returns an empty map when no caller is provided (admin list path) or
   * there are no alerts. Best-effort: a lookup failure degrades to "not
   * requested" rather than failing the alert list (the confirmation is a UX hint,
   * not load-bearing).
   */
  private async loadMeetingRequestedAt(args: {
    tenantId: string;
    alertIds: string[];
    userProfileId?: string;
  }): Promise<Map<string, string>> {
    const map = new Map<string, string>();
    if (!args.userProfileId || args.alertIds.length === 0) return map;
    try {
      const requests = await this.prisma.meetingRequest.findMany({
        where: {
          tenantId: args.tenantId,
          alertId: { in: args.alertIds },
          requestedBy: args.userProfileId,
        },
        select: { alertId: true, createdAt: true },
      });
      for (const r of requests) map.set(r.alertId, r.createdAt.toISOString());
    } catch (err) {
      this.logger.error(
        `Failed to load meeting-request markers (parent confirmation degrades to CTA): ${(err as Error).message}`,
      );
    }
    return map;
  }

  // -- helpers --------------------------------------------------------------

  private toDto(
    row: AlertInstanceFull,
    requestedAtByAlert?: Map<string, string>,
  ): AlertInstanceDto {
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
      meetingRequestedAt: requestedAtByAlert?.get(row.id) ?? null,
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
