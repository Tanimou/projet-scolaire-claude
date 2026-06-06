import {
  Injectable,
  Logger,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  CatalogueSlotDto,
  CatalogueTutorDto,
  RemediationCatalogueDto,
  RemediationPlanDto,
} from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

const PLAN_INCLUDE = {
  student: { select: { firstName: true, lastName: true } },
  subject: { select: { code: true, name: true } },
} satisfies Prisma.RemediationPlanInclude;

type PlanFull = Prisma.RemediationPlanGetPayload<{ include: typeof PLAN_INCLUDE }>;

/**
 * Captured baseline figure for a (student, subject) at plan-promotion time — the
 * anchor the S3 progress strip frames the trend delta against. Read snapshot-first
 * (the E6 `StudentSubjectSnapshot` year row) with a live fall-through; a miss is
 * never an error (both fields degrade to null → the strip shows "en attente").
 */
interface SubjectBaseline {
  avg: number | null;
  trendDelta: number | null;
}

/**
 * E7-S1 — Remediation & Tutoring loop service.
 *
 * Two parent-facing capabilities, both tenant-scoped + behind the caller's
 * guardianship wall (re-checked in the controller BEFORE every write/read):
 *  - `promotePlan` — promote an alert's recommendation into a tracked, idempotent
 *    `RemediationPlan` (the E1-S3 MeetingRequest promotion discipline: server-derived
 *    student/subject from the alert, baseline captured from the E6 snapshot, an
 *    append-only `remediation.plan_created` audit row alongside the queryable row).
 *  - `catalogue` — the read-only aggregate of published, tenant-scoped, subject-
 *    matching tutors with their open slots (no N+1, no booking verb yet).
 *
 * NO booking write path exists in S1 — provably no over-booking surface (the
 * Booking/TutorAvailability tables exist with no write path; the booking verb +
 * the ADR-020 concurrency guard arrive in S2).
 */
@Injectable()
export class RemediationService {
  private readonly logger = new Logger(RemediationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Promote an alert into an OPEN remediation plan. Idempotent per
   * (tenant, student, subject, status=open): re-promoting the same diagnosis
   * reuses the existing open plan (no duplicate row, no re-baseline). The caller
   * MUST have passed guardianship ABAC on the alert's student before invoking —
   * the controller checks `canAccessStudent` BEFORE this write.
   *
   * Returns the plan DTO + whether it was freshly created (for the audit row).
   */
  async promotePlan(args: {
    tenantId: string;
    schoolId: string | null;
    alertId: string;
    userProfileId: string;
    objective?: string;
  }): Promise<{ plan: RemediationPlanDto; created: boolean }> {
    // Resolve the diagnosis from the alert (server-derived, never client-supplied).
    // Tenant-scoped: an alert outside the caller's tenant 404s (never leaks).
    const alert = await this.prisma.alertInstance.findFirst({
      where: { id: args.alertId, tenantId: args.tenantId },
      select: { id: true, studentId: true, subjectId: true, schoolId: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');
    if (!alert.subjectId) {
      // A non-subject alert (e.g. HIGH_ABSENCE) cannot seed a subject-scoped plan.
      // 422 (not 404): the alert exists and is accessible, but its shape can't be
      // remediated — a deterministic, non-leaking rejection (spec FR/AC: "422 on
      // null-subject alert"), never a 500 / NOT-NULL crash on the plan's subjectId.
      throw new UnprocessableEntityException('Cette alerte ne cible pas une matière');
    }

    // Idempotency: reuse an existing OPEN plan for (tenant, student, subject).
    const existing = await this.prisma.remediationPlan.findFirst({
      where: {
        tenantId: args.tenantId,
        studentId: alert.studentId,
        subjectId: alert.subjectId,
        status: 'open',
      },
      include: PLAN_INCLUDE,
    });
    if (existing) {
      return { plan: this.toPlanDto(existing), created: false };
    }

    const baseline = await this.captureSubjectBaseline({
      tenantId: args.tenantId,
      studentId: alert.studentId,
      subjectId: alert.subjectId,
    });

    // Create the plan. Catch P2002 (a concurrent promote raced us to the open-plan
    // unique) and reuse the winning row — the write stays idempotent under races.
    let row: PlanFull;
    let created = true;
    try {
      row = await this.prisma.remediationPlan.create({
        data: {
          tenantId: args.tenantId,
          schoolId: alert.schoolId ?? args.schoolId,
          studentId: alert.studentId,
          subjectId: alert.subjectId,
          alertId: alert.id,
          status: 'open',
          objective: args.objective ?? null,
          baselineAvg: baseline.avg,
          baselineTrendDelta: baseline.trendDelta,
          createdBy: args.userProfileId,
        },
        include: PLAN_INCLUDE,
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.prisma.remediationPlan.findFirst({
          where: {
            tenantId: args.tenantId,
            studentId: alert.studentId,
            subjectId: alert.subjectId,
            status: 'open',
          },
          include: PLAN_INCLUDE,
        });
        if (!winner) throw err;
        row = winner;
        created = false;
      } else {
        throw err;
      }
    }

    return { plan: this.toPlanDto(row), created };
  }

  /** Fetch a single plan, tenant-scoped. The caller re-checks guardianship on the
   * plan's student in the controller BEFORE this read (404-before-403). */
  async getPlan(args: {
    tenantId: string;
    planId: string;
  }): Promise<{ dto: RemediationPlanDto; studentId: string } | null> {
    const row = await this.prisma.remediationPlan.findFirst({
      where: { id: args.planId, tenantId: args.tenantId },
      include: PLAN_INCLUDE,
    });
    if (!row) return null;
    return { dto: this.toPlanDto(row), studentId: row.studentId };
  }

  /** A parent's plans for a given student (tenant-scoped). Caller has already
   * passed guardianship ABAC on the student. */
  async listPlansForStudent(args: {
    tenantId: string;
    studentId: string;
  }): Promise<RemediationPlanDto[]> {
    const rows = await this.prisma.remediationPlan.findMany({
      where: { tenantId: args.tenantId, studentId: args.studentId },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.toPlanDto(r));
  }

  /**
   * Read-only catalogue: published, tenant-scoped tutors that cover `subjectId`,
   * each with their active availability slots. One query + a bounded include — no
   * N+1. The plan the catalogue is browsed from is guardianship-walled by the
   * controller; the catalogue itself is school-public to the school's parents
   * (only `published` rows of the caller's tenant are ever returned).
   */
  async catalogue(args: {
    tenantId: string;
    schoolId: string | null;
    subjectId: string;
  }): Promise<RemediationCatalogueDto> {
    const subject = await this.prisma.subject.findFirst({
      where: { id: args.subjectId, tenantId: args.tenantId },
      select: { name: true },
    });

    const tutors = await this.prisma.tutor.findMany({
      where: {
        tenantId: args.tenantId,
        ...(args.schoolId ? { schoolId: args.schoolId } : {}),
        published: true,
        subjectIds: { has: args.subjectId },
      },
      include: {
        availabilities: {
          where: { active: true },
          orderBy: [{ startsAt: 'asc' }, { weekday: 'asc' }, { startTime: 'asc' }],
        },
      },
      orderBy: { displayName: 'asc' },
    });

    return {
      subjectId: args.subjectId,
      subjectName: subject?.name ?? null,
      tutors: tutors.map((t) => this.toCatalogueTutorDto(t)),
    };
  }

  // ----- baseline ------------------------------------------------------------

  /**
   * Capture the subject baseline figure at promotion time — snapshot-first (the
   * E6 `StudentSubjectSnapshot` year row carries the materialised average +
   * trendDelta), with a live fall-through (a simple published-grade average for
   * the subject). A miss/throw on either path degrades to null (the strip shows
   * "en attente des prochaines notes") — never an error, never blocks the promote.
   */
  private async captureSubjectBaseline(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    // Snapshot-first: the year-level (termId=null) per-subject snapshot row.
    try {
      const snap = await this.prisma.studentSubjectSnapshot.findFirst({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          subjectId: args.subjectId,
          termId: null,
        },
        select: { average: true, trendDelta: true },
      });
      if (snap && snap.average != null) {
        return {
          avg: Number(snap.average),
          trendDelta: snap.trendDelta != null ? Number(snap.trendDelta) : null,
        };
      }
    } catch (err) {
      this.logger.debug(
        `baseline snapshot read failed (student=${args.studentId}, subject=${args.subjectId}); falling through to live: ${String(err)}`,
      );
    }

    // Live fall-through: the published, non-absent grade average for the subject,
    // normalised to /20. No new metric — the same notion the dashboard uses.
    return this.computeLiveSubjectBaseline(args);
  }

  private async computeLiveSubjectBaseline(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    try {
      const grades = await this.prisma.grade.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'published',
          isAbsent: false,
          value: { not: null },
          assessment: { teachingAssignment: { subjectId: args.subjectId } },
        },
        select: { value: true, assessment: { select: { maxScore: true } } },
      });
      if (grades.length === 0) return { avg: null, trendDelta: null };
      let sum = 0;
      let n = 0;
      for (const g of grades) {
        const max = Number(g.assessment.maxScore ?? 20) || 20;
        if (g.value == null) continue;
        sum += (Number(g.value) / max) * 20;
        n += 1;
      }
      const avg = n === 0 ? null : Math.round((sum / n) * 100) / 100;
      return { avg, trendDelta: null };
    } catch (err) {
      this.logger.debug(
        `baseline live read failed (student=${args.studentId}, subject=${args.subjectId}); baseline null: ${String(err)}`,
      );
      return { avg: null, trendDelta: null };
    }
  }

  // ----- mappers -------------------------------------------------------------

  private toPlanDto(row: PlanFull): RemediationPlanDto {
    return {
      id: row.id,
      status: row.status,
      studentId: row.studentId,
      studentName: `${row.student.firstName} ${row.student.lastName}`.trim(),
      subjectId: row.subjectId,
      subjectCode: row.subject?.code ?? null,
      subjectName: row.subject?.name ?? null,
      alertId: row.alertId,
      objective: row.objective,
      baselineAvg: row.baselineAvg != null ? Number(row.baselineAvg) : null,
      baselineTrendDelta:
        row.baselineTrendDelta != null ? Number(row.baselineTrendDelta) : null,
      // No booking write in S1 — counts are 0 (kept in the shape for S2/S3).
      sessionsPlanned: 0,
      sessionsDone: 0,
      createdAt: row.createdAt.toISOString(),
      closedAt: row.closedAt?.toISOString() ?? null,
    };
  }

  private toCatalogueTutorDto(
    t: Prisma.TutorGetPayload<{ include: { availabilities: true } }>,
  ): CatalogueTutorDto {
    return {
      id: t.id,
      type: t.type,
      costKind: t.costKind,
      displayName: t.displayName,
      blurb: t.blurb,
      subjectIds: t.subjectIds,
      slots: t.availabilities.map((a): CatalogueSlotDto => ({
        id: a.id,
        kind: a.kind,
        weekday: a.weekday,
        startTime: a.startTime,
        endTime: a.endTime,
        startsAt: a.startsAt?.toISOString() ?? null,
        endsAt: a.endsAt?.toISOString() ?? null,
        capacity: a.capacity,
      })),
    };
  }
}
