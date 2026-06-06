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
  RemediationProgressDto,
} from '@pilotage/contracts';
import { IMPROVEMENT_DELTA_THRESHOLD } from '@pilotage/contracts';

import { PrismaService } from '../../shared/prisma/prisma.service';

import { resolveNextSessionAt } from './session-instance';

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
   * E7-S3 — the parent remediation progress strip payload: one entry per OPEN
   * (`status:'open'`) plan for the student, carrying the measured-improvement
   * payoff the dashboard strip renders. Composed into the parent-dashboard
   * aggregate by `AnalyticsService` (best-effort; a throw degrades to `[]` so the
   * strip never errors the dashboard).
   *
   * Bounded work, no new class scan (FR2/FR3/FR10):
   *  - ONE `remediationPlan.findMany` (open plans, tenant+student scoped).
   *  - per plan, the SHARED {@link readSubjectAverage} (snapshot point-read + at most
   *    one per-subject grade average on fall-through) — the SAME reader the baseline
   *    used, so `current − baseline` can't diverge from the captured anchor.
   *  - ONE grouped `booking.findMany` over ALL the open plans (no per-plan N+1) for
   *    `sessionsPlanned`/`sessionsDone`/`nextSessionAt`.
   *
   * `trendDelta = round(currentAvg − baselineAvg, 2)` only when BOTH are non-null,
   * else null (FR2 / PM-4: a null baseline NEVER fabricates a `current − 0` positive
   * delta). `improved = trendDelta != null && trendDelta >= IMPROVEMENT_DELTA_THRESHOLD`
   * (the shared E3 `1.5`, FR4 / PM-5: noise below threshold stays calm).
   */
  async remediationProgress(args: {
    tenantId: string;
    studentId: string;
  }): Promise<RemediationProgressDto[]> {
    const plans = await this.prisma.remediationPlan.findMany({
      where: { tenantId: args.tenantId, studentId: args.studentId, status: 'open' },
      include: PLAN_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    if (plans.length === 0) return [];

    // ONE grouped Booking query over every open plan (no per-plan N+1). Empty
    // booking tables (S2 db push pending) → no rows → counts 0 / nextSessionAt null,
    // and the strip still renders the trend.
    const now = new Date();
    const planIds = plans.map((p) => p.id);
    const bookings = await this.prisma.booking.findMany({
      where: { tenantId: args.tenantId, planId: { in: planIds } },
      select: { planId: true, status: true, sessionAt: true },
    });

    const planned = new Map<string, number>();
    const done = new Map<string, number>();
    const nextAt = new Map<string, Date>();
    for (const b of bookings) {
      if (b.status === 'requested' || b.status === 'confirmed') {
        planned.set(b.planId, (planned.get(b.planId) ?? 0) + 1);
        // soonest FUTURE active instance only (PM-8: never a past "prochaine").
        if (b.sessionAt >= now) {
          const cur = nextAt.get(b.planId);
          if (!cur || b.sessionAt < cur) nextAt.set(b.planId, b.sessionAt);
        }
      } else if (b.status === 'completed') {
        done.set(b.planId, (done.get(b.planId) ?? 0) + 1);
      }
    }

    const out: RemediationProgressDto[] = [];
    for (const p of plans) {
      const baselineAvg = p.baselineAvg != null ? Number(p.baselineAvg) : null;
      // Current subject average via the SAME shared reader the baseline used.
      const current = await this.readSubjectAverage({
        tenantId: args.tenantId,
        studentId: args.studentId,
        subjectId: p.subjectId,
      });
      const currentAvg = current.avg;
      const trendDelta =
        baselineAvg != null && currentAvg != null
          ? Math.round((currentAvg - baselineAvg) * 100) / 100
          : null;
      out.push({
        planId: p.id,
        subjectId: p.subjectId,
        subjectCode: p.subject?.code ?? null,
        subjectName: p.subject?.name ?? null,
        objective: p.objective,
        baselineAvg,
        currentAvg,
        trendDelta,
        improved: trendDelta != null && trendDelta >= IMPROVEMENT_DELTA_THRESHOLD,
        sessionsPlanned: planned.get(p.id) ?? 0,
        sessionsDone: done.get(p.id) ?? 0,
        nextSessionAt: nextAt.get(p.id)?.toISOString() ?? null,
        createdAt: p.createdAt.toISOString(),
      });
    }
    return out;
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
    /** The caller's UserProfile id — to surface their own existing active booking
     * per slot (idempotency hint for the "Réservé" badge). */
    userProfileId?: string;
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

    // E7-S2: resolve, per active slot, its NEXT concrete dated instance, then
    // compute the live remaining-seat count + the caller's own active booking id
    // in ONE bounded grouped Booking query (never per-slot N+1). A slot whose next
    // instance can't be resolved (a past one_off) renders nextSessionAt=null /
    // remainingSeats=0 ("Indisponible").
    const now = new Date();
    const slotInstances = new Map<string, { availabilityId: string; sessionAt: Date }>();
    for (const t of tutors) {
      for (const a of t.availabilities) {
        const next = resolveNextSessionAt(
          { kind: a.kind, weekday: a.weekday, startTime: a.startTime, startsAt: a.startsAt },
          now,
        );
        if (next) slotInstances.set(a.id, { availabilityId: a.id, sessionAt: next });
      }
    }

    // One grouped query: active bookings (requested|confirmed) for every resolved
    // (availabilityId, sessionAt) instance. We OR the precise instance keys so the
    // count is exact (not "any sessionAt for this slot").
    const instanceList = [...slotInstances.values()];
    const activeBookings =
      instanceList.length > 0
        ? await this.prisma.booking.findMany({
            where: {
              tenantId: args.tenantId,
              status: { in: ['requested', 'confirmed'] },
              OR: instanceList.map((i) => ({
                availabilityId: i.availabilityId,
                sessionAt: i.sessionAt,
              })),
            },
            select: { availabilityId: true, bookedBy: true },
          })
        : [];

    const seatTaken = new Map<string, number>();
    const myBooking = new Map<string, string>();
    if (activeBookings.length > 0) {
      // Re-read the booking ids only for the caller's own rows (small set), to
      // surface myBookingId without widening the grouped query.
      const mineRows = args.userProfileId
        ? await this.prisma.booking.findMany({
            where: {
              tenantId: args.tenantId,
              bookedBy: args.userProfileId,
              status: { in: ['requested', 'confirmed'] },
              OR: instanceList.map((i) => ({
                availabilityId: i.availabilityId,
                sessionAt: i.sessionAt,
              })),
            },
            select: { id: true, availabilityId: true },
          })
        : [];
      for (const b of activeBookings) {
        seatTaken.set(b.availabilityId, (seatTaken.get(b.availabilityId) ?? 0) + 1);
      }
      for (const m of mineRows) myBooking.set(m.availabilityId, m.id);
    }

    return {
      subjectId: args.subjectId,
      subjectName: subject?.name ?? null,
      tutors: tutors.map((t) =>
        this.toCatalogueTutorDto(t, slotInstances, seatTaken, myBooking),
      ),
    };
  }

  // ----- baseline ------------------------------------------------------------

  /**
   * Capture the subject baseline figure at promotion time. Thin wrapper over the
   * SHARED {@link readSubjectAverage} reader (the ONE code path), so the figure the
   * S3 progress strip anchors against is read with byte-identical logic to the
   * figure it later measures the current average with — no divergence is possible.
   */
  private async captureSubjectBaseline(args: {
    tenantId: string;
    studentId: string;
    subjectId: string;
  }): Promise<SubjectBaseline> {
    return this.readSubjectAverage(args);
  }

  /**
   * The single, shared snapshot-first / live-fall-through subject-average reader.
   * Used by BOTH the baseline capture (at promote time) AND the S3 progress read
   * (the "current" figure for the trend delta) — extracting it guarantees ONE code
   * path, so the baseline anchor and the current measure can never diverge.
   *
   * Snapshot-first (the E6 `StudentSubjectSnapshot` YEAR row, `termId=null`, carries
   * the materialised average + trendDelta), with a live fall-through (a simple
   * published-grade average for the subject normalised to /20). A miss/throw on
   * either path degrades to `{ avg: null, trendDelta: null }` — never an error,
   * never blocks the caller (the strip then shows "en attente des prochaines notes").
   * NO new class-wide scan: a single per-subject point-read, then at most one
   * per-subject grade average on the fall-through.
   */
  private async readSubjectAverage(args: {
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
    slotInstances: Map<string, { availabilityId: string; sessionAt: Date }>,
    seatTaken: Map<string, number>,
    myBooking: Map<string, string>,
  ): CatalogueTutorDto {
    return {
      id: t.id,
      type: t.type,
      costKind: t.costKind,
      displayName: t.displayName,
      blurb: t.blurb,
      subjectIds: t.subjectIds,
      slots: t.availabilities.map((a): CatalogueSlotDto => {
        const instance = slotInstances.get(a.id) ?? null;
        const taken = seatTaken.get(a.id) ?? 0;
        const remaining = instance ? Math.max(0, a.capacity - taken) : 0;
        return {
          id: a.id,
          kind: a.kind,
          weekday: a.weekday,
          startTime: a.startTime,
          endTime: a.endTime,
          startsAt: a.startsAt?.toISOString() ?? null,
          endsAt: a.endsAt?.toISOString() ?? null,
          capacity: a.capacity,
          remainingSeats: remaining,
          nextSessionAt: instance ? instance.sessionAt.toISOString() : null,
          myBookingId: myBooking.get(a.id) ?? null,
        };
      }),
    };
  }

  // ----- S2 booking support reads --------------------------------------------

  /**
   * Load an availability slot tenant-scoped, incl. the tutor's linkage fields the
   * booking controller needs for the E2 teaching wall + the capacity guard. Used
   * by the booking verb BEFORE the write. Returns null on miss/inactive (404).
   */
  async loadBookableAvailability(args: {
    tenantId: string;
    availabilityId: string;
  }): Promise<{
    id: string;
    tutorId: string;
    capacity: number;
    kind: 'recurring_weekly' | 'one_off';
    weekday: number | null;
    startTime: string | null;
    startsAt: Date | null;
    tutorTeacherProfileId: string | null;
    tutorUserProfileId: string | null;
    tutorPublished: boolean;
  } | null> {
    const a = await this.prisma.tutorAvailability.findFirst({
      where: { id: args.availabilityId, tenantId: args.tenantId, active: true },
      select: {
        id: true,
        tutorId: true,
        capacity: true,
        kind: true,
        weekday: true,
        startTime: true,
        startsAt: true,
        tutor: {
          select: { teacherProfileId: true, userProfileId: true, published: true },
        },
      },
    });
    if (!a) return null;
    return {
      id: a.id,
      tutorId: a.tutorId,
      capacity: a.capacity,
      kind: a.kind,
      weekday: a.weekday,
      startTime: a.startTime,
      startsAt: a.startsAt,
      tutorTeacherProfileId: a.tutor.teacherProfileId,
      tutorUserProfileId: a.tutor.userProfileId,
      tutorPublished: a.tutor.published,
    };
  }

  /**
   * Load a plan tenant-scoped for the booking verb — returns the student + status
   * the controller needs (guardianship ABAC on the student; plan must be open).
   * Null on miss (404). The controller re-checks guardianship BEFORE the write.
   */
  async loadPlanForBooking(args: {
    tenantId: string;
    planId: string;
  }): Promise<{ studentId: string; status: string; schoolId: string | null } | null> {
    const p = await this.prisma.remediationPlan.findFirst({
      where: { id: args.planId, tenantId: args.tenantId },
      select: { studentId: true, status: true, schoolId: true },
    });
    return p;
  }

  /**
   * The E2 teaching wall, inlined to avoid a circular MessagingModule dependency
   * (mirrors messaging.service.ts isTeacherOfStudent exactly): the student's active
   * Enrollment in the active academic year → a TeachingAssignment for that
   * (classSectionId, academicYearId) whose teacherProfile.userProfileId === the
   * tutor's userProfileId. Returns false (never throws) when there is no active
   * enrollment or no matching assignment — a lapsed/absent wall → the controller
   * 403s. Only called for a teacher-linked tutor (userProfileId != null).
   */
  async isTeacherOfStudent(args: {
    tenantId: string;
    teacherUserProfileId: string;
    studentId: string;
  }): Promise<boolean> {
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
      if (!enrollment) return false;

      const assignment = await this.prisma.teachingAssignment.findFirst({
        where: {
          tenantId: args.tenantId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.academicYearId,
          teacherProfile: { userProfileId: args.teacherUserProfileId },
        },
        select: { id: true },
      });
      return assignment != null;
    } catch (err) {
      this.logger.error(
        `isTeacherOfStudent failed (student ${args.studentId}, teacher ${args.teacherUserProfileId}): ${(err as Error).message}`,
      );
      return false;
    }
  }
}
