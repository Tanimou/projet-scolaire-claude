import {
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  CreateAdminTutorDtoSchema,
  type AdminRemediationOverviewDto,
  type AdminTutorAvailabilityDto,
  type AdminTutorDto,
  type UpdateAdminTutorDto,
} from '@pilotage/contracts';
import type { z } from 'zod';

/**
 * The REQUEST-INPUT shape of the create-tutor body (pre-Zod-parse): the
 * `.default()` fields (`costKind`, `published`) are OPTIONAL here, matching what
 * the controller's class-validator `CreateAdminTutorDto` actually delivers. The
 * service applies the defaults itself (`?? 'free'` / `?? false`), mirroring the
 * `upsertAvailability` request-shape param — so the controller DTO is assignable.
 */
type CreateAdminTutorInput = z.input<typeof CreateAdminTutorDtoSchema>;

import { PrismaService } from '../../shared/prisma/prisma.service';

import { resolveNextSessionAt } from './session-instance';

/** Statuses that occupy a seat (mirror the S2/S4 ACTIVE_STATUSES + the booking guard). */
const ACTIVE_STATUSES = ['requested', 'confirmed'] as const;

type AdminTutorRow = Prisma.TutorGetPayload<{
  include: { availabilities: { select: { id: true } } };
}>;

/**
 * E7-S5 — Admin remediation catalogue curation & oversight.
 *
 * A school admin (the `remediation.manage` authority) creates / approves /
 * retires tenant-scoped `Tutor` resources (teacher-linked or external/peer),
 * publishes/edits their `TutorAvailability` slots, and reads a school-scoped
 * AGGREGATE overview of open plans + active bookings per subject.
 *
 * Hard guarantees (the binding conditions + the pre-mortem ACs):
 *  - tenant-scoped on EVERY read/write (`where:{ tenantId }`, server-derived) —
 *    a tutor/availability outside the caller's tenant 404s (never leaks);
 *  - for a `teacher` tutor: `teacherProfileId` is validated in-tenant and its
 *    `userProfileId` resolved+persisted; its `subjectIds` are CONSTRAINED to
 *    subjects the linked teacher CURRENTLY teaches (FM-1: no catalogue-trust
 *    bypass — the parent catalogue surfaces a tutor only for subjects they teach);
 *  - retire == `published:false` (soft, history-preserving — FM-6: the row, its
 *    slots, and its bookings are NEVER deleted);
 *  - the admin slot path has NO subject-ownership wall but reuses the SAME
 *    capacity-floor guard as the teacher path (FM-7 / ADR-020);
 *  - the overview is AGGREGATE COUNTS ONLY — NO studentId / studentName / per-child
 *    row anywhere (FM-3 RGPD), built from groupBy/count (FM-9 no N+1).
 *
 * `costKind` is a DISPLAY LABEL only — no price/amount/currency read or written
 * (ADR-018). No schema change — reuses the S1 Tutor/TutorAvailability/Booking/
 * RemediationPlan models.
 */
@Injectable()
export class AdminRemediationService {
  constructor(private readonly prisma: PrismaService) {}

  // ----- read: the admin catalogue list --------------------------------------

  /**
   * The full tenant-scoped tutor roster (every type / published state — the admin
   * sees what parents can't), each enriched with `availabilityCount` (active slots)
   * and `activeBookingCount` (active bookings on the resolved next instances)
   * computed in ONE grouped Booking query across all tutors (no per-tutor N+1).
   * Optional `subjectId` filter drives the FilterBar.
   */
  async listTutors(args: {
    tenantId: string;
    subjectId?: string;
  }): Promise<AdminTutorDto[]> {
    const tutors = await this.prisma.tutor.findMany({
      where: {
        tenantId: args.tenantId,
        ...(args.subjectId ? { subjectIds: { has: args.subjectId } } : {}),
      },
      include: {
        availabilities: { where: { active: true }, select: { id: true } },
      },
      orderBy: [{ published: 'desc' }, { displayName: 'asc' }],
    });

    const activeBookingCount = await this.activeBookingCountByTutor({
      tenantId: args.tenantId,
      tutorIds: tutors.map((t) => t.id),
    });

    return tutors.map((t) => this.toAdminTutorDto(t, activeBookingCount.get(t.id) ?? 0));
  }

  /**
   * Active bookings per tutor across ALL their slots' resolved next instances, in
   * ONE grouped Booking query (no per-tutor / per-slot N+1). We resolve each slot's
   * next instance, then OR the precise (availabilityId, sessionAt) keys so the
   * count is exact, and roll the result up to the tutorId.
   */
  private async activeBookingCountByTutor(args: {
    tenantId: string;
    tutorIds: string[];
  }): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    if (args.tutorIds.length === 0) return counts;

    const slots = await this.prisma.tutorAvailability.findMany({
      where: { tenantId: args.tenantId, tutorId: { in: args.tutorIds }, active: true },
      select: {
        id: true,
        tutorId: true,
        kind: true,
        weekday: true,
        startTime: true,
        startsAt: true,
      },
    });

    const now = new Date();
    const availTutor = new Map<string, string>();
    const instanceKeys: { availabilityId: string; sessionAt: Date }[] = [];
    for (const s of slots) {
      const next = resolveNextSessionAt(
        { kind: s.kind, weekday: s.weekday, startTime: s.startTime, startsAt: s.startsAt },
        now,
      );
      if (next) {
        availTutor.set(s.id, s.tutorId);
        instanceKeys.push({ availabilityId: s.id, sessionAt: next });
      }
    }
    if (instanceKeys.length === 0) return counts;

    const active = await this.prisma.booking.findMany({
      where: {
        tenantId: args.tenantId,
        status: { in: [...ACTIVE_STATUSES] },
        OR: instanceKeys.map((k) => ({
          availabilityId: k.availabilityId,
          sessionAt: k.sessionAt,
        })),
      },
      select: { availabilityId: true },
    });
    for (const b of active) {
      const tutorId = availTutor.get(b.availabilityId);
      if (tutorId) counts.set(tutorId, (counts.get(tutorId) ?? 0) + 1);
    }
    return counts;
  }

  // ----- write: create a tutor -----------------------------------------------

  /**
   * Create a tenant + school-scoped tutor. For `type:'teacher'`: `teacherProfileId`
   * is REQUIRED, validated to exist in the caller's tenant (404/422 otherwise — no
   * dangling teacher link), its `userProfileId` is resolved + persisted, and
   * `subjectIds` are CONSTRAINED to subjects the teacher currently teaches (FM-1).
   * A teacher tutor is idempotent on `(tenant, userProfileId, type=teacher)` — a
   * second create for a teacher who already has one (e.g. self-published via S4)
   * REUSES the existing row rather than duplicating it (FM-8). For `external`/`peer`
   * the teacher link is forbidden and stays null.
   */
  async createTutor(args: {
    tenantId: string;
    schoolId: string;
    userProfileId: string;
    dto: CreateAdminTutorInput;
  }): Promise<{
    tutor: AdminTutorDto;
    tutorId: string;
    /** FR-6: true when this "create" REUSED an existing teacher tutor (idempotent
     * FM-8 branch) — the controller then writes `remediation.tutor_updated` with the
     * published before/after instead of `tutor_created`, so a retire/approve flip on
     * a live teacher tutor stays traceable (never a silent untraceable retire). */
    reused: boolean;
    /** The published state BEFORE a reuse update (for the tutor_updated audit). */
    publishedBefore?: boolean;
  }> {
    const { dto } = args;

    let teacherProfileId: string | null = null;
    let teacherUserProfileId: string | null = null;
    let subjectIds = [...new Set(dto.subjectIds)];

    if (dto.type === 'teacher') {
      if (!dto.teacherProfileId) {
        throw new UnprocessableEntityException(
          "Un tuteur de type enseignant requiert un·e enseignant·e",
        );
      }
      // Validate the teacher exists IN the caller's tenant (404-on-cross-tenant).
      const profile = await this.prisma.teacherProfile.findFirst({
        where: { id: dto.teacherProfileId, tenantId: args.tenantId },
        select: { id: true, userProfileId: true },
      });
      if (!profile) throw new NotFoundException('Enseignant·e introuvable');
      teacherProfileId = profile.id;
      teacherUserProfileId = profile.userProfileId;

      // FM-1: constrain subjectIds to subjects the teacher currently teaches —
      // a teacher tutor must never be discoverable for a subject they don't teach.
      subjectIds = await this.constrainToTaughtSubjects({
        tenantId: args.tenantId,
        teacherProfileId: profile.id,
        requested: subjectIds,
      });

      // FM-8: reuse the existing teacher tutor (idempotent on the teacher) rather
      // than creating a duplicate catalogue card.
      const existing = await this.prisma.tutor.findFirst({
        where: { tenantId: args.tenantId, userProfileId: teacherUserProfileId, type: 'teacher' },
        select: { id: true, subjectIds: true, published: true },
      });
      if (existing) {
        const merged = [...new Set([...existing.subjectIds, ...subjectIds])];
        const updated = await this.prisma.tutor.update({
          where: { id: existing.id },
          data: {
            displayName: dto.displayName,
            blurb: dto.blurb?.trim() || null,
            costKind: dto.costKind ?? 'free',
            subjectIds: { set: merged },
            // FR-6: do NOT default a reuse to `published:false` — that would silently
            // RETIRE a live self-published teacher tutor with no traceable audit. Only
            // change `published` when the admin EXPLICITLY provided it (the create-DTO
            // `.default(false)` is applied by Zod pre-parse, so the *input* shape's
            // `published` is `undefined` when the admin left the toggle untouched).
            ...(dto.published !== undefined ? { published: dto.published } : {}),
          },
          include: { availabilities: { where: { active: true }, select: { id: true } } },
        });
        const counts = await this.activeBookingCountByTutor({
          tenantId: args.tenantId,
          tutorIds: [updated.id],
        });
        return {
          tutor: this.toAdminTutorDto(updated, counts.get(updated.id) ?? 0),
          tutorId: updated.id,
          reused: true,
          publishedBefore: existing.published,
        };
      }
    }

    const created = await this.prisma.tutor.create({
      data: {
        tenantId: args.tenantId,
        schoolId: args.schoolId,
        type: dto.type,
        costKind: dto.costKind ?? 'free',
        displayName: dto.displayName,
        blurb: dto.blurb?.trim() || null,
        subjectIds,
        teacherProfileId,
        userProfileId: teacherUserProfileId,
        published: dto.published ?? false,
        createdBy: args.userProfileId,
      },
      include: { availabilities: { where: { active: true }, select: { id: true } } },
    });
    return { tutor: this.toAdminTutorDto(created, 0), tutorId: created.id, reused: false };
  }

  // ----- write: update / approve / retire a tutor ----------------------------

  /**
   * Update a tutor (displayName / blurb / costKind / subjectIds / published).
   * Re-scoped to the caller's tenant (404 if missing/cross-tenant). `published`
   * is the approve(`true`)/retire(`false`) verb — history-preserving (the row +
   * its slots/bookings survive; the S1 parent catalogue already filters
   * `published:true`). `type` is immutable (not accepted). For a teacher tutor,
   * the teacher link is NOT editable here, and any `subjectIds` edit is CONSTRAINED
   * to subjects the teacher currently teaches (FM-1). Returns the row + the
   * before/after published state (for the audit trail).
   */
  async updateTutor(args: {
    tenantId: string;
    tutorId: string;
    dto: UpdateAdminTutorDto;
  }): Promise<{
    tutor: AdminTutorDto;
    tutorId: string;
    publishedBefore: boolean;
    publishedAfter: boolean;
  }> {
    const existing = await this.prisma.tutor.findFirst({
      where: { id: args.tutorId, tenantId: args.tenantId },
      select: { id: true, type: true, teacherProfileId: true, published: true },
    });
    if (!existing) throw new NotFoundException('Tuteur introuvable');

    const data: Prisma.TutorUpdateInput = {};
    if (args.dto.displayName !== undefined) data.displayName = args.dto.displayName;
    if (args.dto.blurb !== undefined) data.blurb = args.dto.blurb?.trim() || null;
    if (args.dto.costKind !== undefined) data.costKind = args.dto.costKind;
    if (args.dto.published !== undefined) data.published = args.dto.published;

    if (args.dto.subjectIds !== undefined) {
      let next = [...new Set(args.dto.subjectIds)];
      if (existing.type === 'teacher' && existing.teacherProfileId) {
        // FM-1: a teacher tutor's subjects stay within what the teacher teaches.
        next = await this.constrainToTaughtSubjects({
          tenantId: args.tenantId,
          teacherProfileId: existing.teacherProfileId,
          requested: next,
        });
      }
      data.subjectIds = { set: next };
    }

    const updated = await this.prisma.tutor.update({
      where: { id: existing.id },
      data,
      include: { availabilities: { where: { active: true }, select: { id: true } } },
    });
    const counts = await this.activeBookingCountByTutor({
      tenantId: args.tenantId,
      tutorIds: [updated.id],
    });
    return {
      tutor: this.toAdminTutorDto(updated, counts.get(updated.id) ?? 0),
      tutorId: updated.id,
      publishedBefore: existing.published,
      publishedAfter: updated.published,
    };
  }

  // ----- write: publish / edit an availability slot (admin variant) ----------

  /**
   * Publish (or edit) a slot for ANY tutor — re-scoped to the caller's tenant
   * (404 otherwise). NO subject-ownership wall (the admin curates; the
   * remediation.manage permission is the authority). Slot shape is re-validated
   * (422). On edit, the SAME capacity-floor guard as the teacher path rejects
   * lowering capacity below the active-booking count on the next instance (422 —
   * never a silent over-commit / ADR-020). Returns the slot + whether it was
   * freshly created (drives the audit action).
   */
  async upsertAvailability(args: {
    tenantId: string;
    tutorId: string;
    availabilityId?: string;
    dto: {
      kind: 'recurring_weekly' | 'one_off';
      weekday?: number | null;
      startTime?: string | null;
      endTime?: string | null;
      startsAt?: string | null;
      endsAt?: string | null;
      capacity?: number;
      active?: boolean;
    };
    /** The actor admin's UserProfile id — the slot's `createdBy` provenance (FR-7). */
    userProfileId: string;
  }): Promise<{
    availability: AdminTutorAvailabilityDto;
    created: boolean;
    tutorId: string;
    /** The linked teacher's UserProfile id (null for external/peer) — FR-4 notify target. */
    tutorUserProfileId: string | null;
  }> {
    // Re-scope the tutor to the caller's tenant (404 — never leaks cross-tenant).
    const tutor = await this.prisma.tutor.findFirst({
      where: { id: args.tutorId, tenantId: args.tenantId },
      select: { id: true, schoolId: true, userProfileId: true },
    });
    if (!tutor) throw new NotFoundException('Tuteur introuvable');

    this.validateSlotShape(args.dto);

    const data: Prisma.TutorAvailabilityUncheckedCreateInput = {
      tenantId: args.tenantId,
      schoolId: tutor.schoolId,
      tutorId: tutor.id,
      kind: args.dto.kind,
      weekday: args.dto.kind === 'recurring_weekly' ? (args.dto.weekday ?? null) : null,
      startTime: args.dto.kind === 'recurring_weekly' ? (args.dto.startTime ?? null) : null,
      endTime: args.dto.kind === 'recurring_weekly' ? (args.dto.endTime ?? null) : null,
      startsAt: args.dto.kind === 'one_off' && args.dto.startsAt ? new Date(args.dto.startsAt) : null,
      endsAt: args.dto.kind === 'one_off' && args.dto.endsAt ? new Date(args.dto.endsAt) : null,
      capacity: args.dto.capacity ?? 1,
      active: args.dto.active ?? true,
      // FR-7: write the actor admin's userProfileId (not the Tutor id), matching
      // every other write path (the teacher path writes the actor) — audit/forensic
      // "who published this slot" now resolves the actor, not the tutor.
      createdBy: args.userProfileId,
    };

    if (args.availabilityId) {
      // Edit — re-scope to the tutor (a slot on another tutor is "missing").
      const slot = await this.prisma.tutorAvailability.findFirst({
        where: { id: args.availabilityId, tenantId: args.tenantId, tutorId: tutor.id },
        select: { id: true, kind: true, weekday: true, startTime: true, startsAt: true },
      });
      if (!slot) throw new NotFoundException('Créneau introuvable');

      // Capacity-floor guard (FM-7 / ADR-020) — identical to the teacher path.
      const newCapacity = data.capacity as number;
      const activeBookings = await this.countActiveBookings({
        tenantId: args.tenantId,
        availabilityId: slot.id,
        slot: {
          kind: slot.kind,
          weekday: slot.weekday,
          startTime: slot.startTime,
          startsAt: slot.startsAt,
        },
      });
      if (newCapacity < activeBookings) {
        throw new UnprocessableEntityException('Des réservations occupent déjà ce créneau');
      }

      const updated = await this.prisma.tutorAvailability.update({
        where: { id: slot.id },
        data: {
          kind: data.kind,
          weekday: data.weekday,
          startTime: data.startTime,
          endTime: data.endTime,
          startsAt: data.startsAt,
          endsAt: data.endsAt,
          capacity: data.capacity,
          active: data.active,
        },
      });
      return {
        availability: this.toAvailabilityDto(updated),
        created: false,
        tutorId: tutor.id,
        tutorUserProfileId: tutor.userProfileId,
      };
    }

    const created = await this.prisma.tutorAvailability.create({ data });
    return {
      availability: this.toAvailabilityDto(created),
      created: true,
      tutorId: tutor.id,
      tutorUserProfileId: tutor.userProfileId,
    };
  }

  // ----- read: the school-scoped aggregate overview --------------------------

  /**
   * The school-scoped overview — per subject openPlans + activeBookings +
   * tutorCount, plus tenant totals. STRICTLY AGGREGATE: the payload carries NO
   * studentId, NO studentName, NO per-child row (FM-3 RGPD non-stigmatising
   * mandate). Built from groupBy/count + a bounded select — no per-subject
   * fan-out (FM-9 no N+1). Tenant-scoped on every query.
   */
  async overview(args: { tenantId: string }): Promise<AdminRemediationOverviewDto> {
    // Open plans grouped by subject (one groupBy, no student include — RGPD).
    const planGroups = await this.prisma.remediationPlan.groupBy({
      by: ['subjectId'],
      where: { tenantId: args.tenantId, status: 'open' },
      _count: { _all: true },
    });
    const openPlansBySubject = new Map<string, number>();
    for (const g of planGroups) openPlansBySubject.set(g.subjectId, g._count._all);

    // Active bookings → subject via the booking's plan.subjectId. One grouped
    // findMany selecting ONLY plan.subjectId (no student field) — RGPD-clean.
    const activeBookings = await this.prisma.booking.findMany({
      where: { tenantId: args.tenantId, status: { in: [...ACTIVE_STATUSES] } },
      select: { plan: { select: { subjectId: true } } },
    });
    const activeBookingsBySubject = new Map<string, number>();
    for (const b of activeBookings) {
      const subjectId = b.plan?.subjectId;
      if (subjectId) {
        activeBookingsBySubject.set(subjectId, (activeBookingsBySubject.get(subjectId) ?? 0) + 1);
      }
    }

    // Tutor count per subject (derived from tutor.subjectIds[]) + published total.
    const tutors = await this.prisma.tutor.findMany({
      where: { tenantId: args.tenantId },
      select: { subjectIds: true, published: true },
    });
    const tutorCountBySubject = new Map<string, number>();
    let publishedTutors = 0;
    for (const t of tutors) {
      // FR-8: count ONLY published (parent-discoverable) tutors per subject, so a
      // subject covered solely by a retired tutor reads as a genuine capacity gap
      // (tutorCount:0 → the "aucun intervenant publié" copy is accurate).
      if (!t.published) continue;
      publishedTutors += 1;
      for (const subjectId of t.subjectIds) {
        tutorCountBySubject.set(subjectId, (tutorCountBySubject.get(subjectId) ?? 0) + 1);
      }
    }

    // The union of subjects that have ANY of: an open plan, an active booking, or
    // a tutor offering it. Resolve names in ONE tenant-scoped query (no N+1).
    const subjectIds = [
      ...new Set([
        ...openPlansBySubject.keys(),
        ...activeBookingsBySubject.keys(),
        ...tutorCountBySubject.keys(),
      ]),
    ];
    const subjectNames = new Map<string, string | null>();
    if (subjectIds.length > 0) {
      const subjects = await this.prisma.subject.findMany({
        where: { tenantId: args.tenantId, id: { in: subjectIds } },
        select: { id: true, name: true },
      });
      for (const s of subjects) subjectNames.set(s.id, s.name);
    }

    const bySubject = subjectIds
      .map((subjectId) => ({
        subjectId,
        subjectName: subjectNames.get(subjectId) ?? null,
        openPlans: openPlansBySubject.get(subjectId) ?? 0,
        activeBookings: activeBookingsBySubject.get(subjectId) ?? 0,
        tutorCount: tutorCountBySubject.get(subjectId) ?? 0,
      }))
      .sort((a, b) =>
        (a.subjectName ?? '').localeCompare(b.subjectName ?? '', 'fr'),
      );

    const totals = {
      openPlans: planGroups.reduce((sum, g) => sum + g._count._all, 0),
      activeBookings: activeBookings.length,
      publishedTutors,
    };

    return { bySubject, totals };
  }

  // ----- helpers -------------------------------------------------------------

  /**
   * Keep only the requested subjects the teacher CURRENTLY teaches (active year).
   * FM-1: a teacher tutor must never be published for an untaught subject. If the
   * filtered set is empty (the admin picked only untaught subjects) → 422, so a
   * teacher tutor is never created/updated with a subject the wall would bypass.
   */
  private async constrainToTaughtSubjects(args: {
    tenantId: string;
    teacherProfileId: string;
    requested: string[];
  }): Promise<string[]> {
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: args.tenantId,
        teacherProfileId: args.teacherProfileId,
        subjectId: { in: args.requested },
        academicYear: { status: 'active' },
      },
      select: { subjectId: true },
    });
    const taught = new Set(assignments.map((a) => a.subjectId));
    const kept = args.requested.filter((id) => taught.has(id));
    if (kept.length === 0) {
      throw new UnprocessableEntityException(
        "L'enseignant·e n'enseigne aucune des matières sélectionnées",
      );
    }
    return kept;
  }

  /**
   * Count the bookings actively occupying the slot's NEXT instance (the same key
   * the capacity guard uses at booking time). A slot with no resolvable future
   * instance holds zero active seats.
   */
  private async countActiveBookings(args: {
    tenantId: string;
    availabilityId: string;
    slot: {
      kind: 'recurring_weekly' | 'one_off';
      weekday: number | null;
      startTime: string | null;
      startsAt: Date | null;
    };
  }): Promise<number> {
    const next = resolveNextSessionAt(args.slot, new Date());
    if (!next) return 0;
    return this.prisma.booking.count({
      where: {
        tenantId: args.tenantId,
        availabilityId: args.availabilityId,
        sessionAt: next,
        status: { in: [...ACTIVE_STATUSES] },
      },
    });
  }

  private validateSlotShape(dto: {
    kind: 'recurring_weekly' | 'one_off';
    weekday?: number | null;
    startTime?: string | null;
    startsAt?: string | null;
  }): void {
    if (dto.kind === 'recurring_weekly') {
      if (dto.weekday == null || dto.weekday < 0 || dto.weekday > 6 || !dto.startTime) {
        throw new UnprocessableEntityException(
          'Un créneau hebdomadaire requiert un jour et une heure de début',
        );
      }
      if (!/^\d{1,2}:\d{2}/.test(dto.startTime.trim())) {
        throw new UnprocessableEntityException("L'heure de début doit être au format HH:mm");
      }
      return;
    }
    if (!dto.startsAt) {
      throw new UnprocessableEntityException('Un créneau ponctuel requiert une date');
    }
    const at = new Date(dto.startsAt);
    if (Number.isNaN(at.getTime())) {
      throw new UnprocessableEntityException('La date du créneau est invalide');
    }
  }

  private toAdminTutorDto(row: AdminTutorRow, activeBookingCount: number): AdminTutorDto {
    return {
      id: row.id,
      type: row.type,
      costKind: row.costKind,
      displayName: row.displayName,
      blurb: row.blurb,
      subjectIds: row.subjectIds,
      teacherProfileId: row.teacherProfileId,
      userProfileId: row.userProfileId,
      published: row.published,
      availabilityCount: row.availabilities.length,
      activeBookingCount,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private toAvailabilityDto(a: {
    id: string;
    kind: 'recurring_weekly' | 'one_off';
    weekday: number | null;
    startTime: string | null;
    endTime: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    capacity: number;
    active: boolean;
  }): AdminTutorAvailabilityDto {
    return {
      id: a.id,
      kind: a.kind,
      weekday: a.weekday,
      startTime: a.startTime,
      endTime: a.endTime,
      startsAt: a.startsAt?.toISOString() ?? null,
      endsAt: a.endsAt?.toISOString() ?? null,
      capacity: a.capacity,
      active: a.active,
      bookedCount: 0,
    };
  }
}
