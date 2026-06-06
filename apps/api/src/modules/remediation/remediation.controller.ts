import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Prisma } from '@prisma/client';

import { deriveAlertActorProvenance } from '../alerts/alert-provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';

import { BookingService } from './booking.service';
import { CreateBookingDto } from './dto/create-booking.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { PromoteRemediationPlanDto } from './dto/promote-remediation-plan.dto';
import { RemediationService } from './remediation.service';

/**
 * E7-S1 — parent-facing remediation surface.
 *
 *  - `POST /remediation/plans` (`remediation.book`): promote an alert into a
 *    tracked, idempotent `RemediationPlan`. Guardianship ABAC on the alert's
 *    student is re-checked BEFORE the write; an append-only `remediation.plan_created`
 *    audit row is written alongside ONLY on a fresh promote (re-promote is a no-op).
 *  - `GET /remediation/plans/:id` (`remediation.read`): one plan, guardianship-walled.
 *  - `GET /remediation/plans?studentId=` (`remediation.read`): the caller's plans
 *    for a child, guardianship-walled.
 *  - `GET /remediation/catalogue?subjectId=` (`remediation.read`): the read-only
 *    catalogue of published, subject-matching tutors with their open slots.
 *
 * Booking is OUT of scope for S1 — no write path exists, so there is provably no
 * over-booking surface (the booking verb + ADR-020 land in S2).
 */
@ApiTags('remediation')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('remediation')
export class RemediationController {
  private readonly logger = new Logger(RemediationController.name);

  constructor(
    private readonly remediation: RemediationService,
    private readonly bookings: BookingService,
    private readonly notifications: NotificationsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly studentAccess: StudentAccessService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('plans')
  @RequiresPermission('remediation.book')
  @ApiOperation({ summary: 'Promote an alert into a remediation plan (idempotent, ABAC)' })
  async promote(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Body() dto: PromoteRemediationPlanDto,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    // Resolve the alert's student FIRST so guardianship ABAC runs BEFORE any write.
    // Tenant-scoped: an alert outside the caller's tenant 404s (never leaks).
    const alert = await this.prisma.alertInstance.findFirst({
      where: { id: dto.alertId, tenantId: me.tenantId },
      select: { studentId: true },
    });
    if (!alert) throw new NotFoundException('Alert not found');

    const allowed = await this.studentAccess.canAccessStudent(
      me,
      jwt,
      alert.studentId,
      schoolId,
    );
    if (!allowed) throw new ForbiddenException('Forbidden');

    const { plan, created } = await this.remediation.promotePlan({
      tenantId: me.tenantId,
      schoolId,
      alertId: dto.alertId,
      userProfileId: me.id,
      objective: dto.objective,
    });

    // Append-only audit ONLY on a fresh promote (re-promote is a no-op; no
    // duplicate audit row). Best-effort: a failure never touches the plan.
    if (created) {
      const { actorRole, portal } = deriveAlertActorProvenance(jwt);
      try {
        await this.prisma.auditLog.create({
          data: {
            tenantId: me.tenantId,
            actorId: me.id,
            actorRole,
            portal,
            action: 'remediation.plan_created',
            resourceType: 'remediation_plan',
            resourceId: plan.id,
            after: {
              studentId: plan.studentId,
              subjectId: plan.subjectId,
              alertId: plan.alertId,
              baselineAvg: plan.baselineAvg,
            } as Prisma.InputJsonValue,
          },
        });
      } catch (err) {
        this.logger.error(
          `Failed to write remediation.plan_created audit row for ${plan.id} (plan unaffected): ${(err as Error).message}`,
        );
      }
    }

    return plan;
  }

  @Get('plans')
  @RequiresPermission('remediation.read')
  @ApiOperation({ summary: "List the caller's remediation plans for one of their children" })
  async listForStudent(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    if (!studentId) return { data: [] };
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException('Forbidden');
    const data = await this.remediation.listPlansForStudent({
      tenantId: me.tenantId,
      studentId,
    });
    return { data };
  }

  @Get('plans/:id')
  @RequiresPermission('remediation.read')
  @ApiOperation({ summary: 'Fetch one remediation plan (guardianship-walled)' })
  async getPlan(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const result = await this.remediation.getPlan({ tenantId: me.tenantId, planId: id });
    if (!result) throw new NotFoundException('Plan not found');
    // Guardianship ABAC on the plan's student (404-before-403: a plan for a child
    // the caller doesn't guard is indistinguishable from a missing plan).
    const allowed = await this.studentAccess.canAccessStudent(
      me,
      jwt,
      result.studentId,
      schoolId,
    );
    if (!allowed) throw new NotFoundException('Plan not found');
    return result.dto;
  }

  @Get('catalogue')
  @RequiresPermission('remediation.read')
  @ApiOperation({ summary: 'Read-only catalogue of published, subject-matching tutors' })
  async catalogue(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('subjectId') subjectId: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    if (!subjectId) throw new BadRequestException('subjectId is required');
    return this.remediation.catalogue({
      tenantId: me.tenantId,
      schoolId,
      subjectId,
      userProfileId: me.id,
    });
  }

  /**
   * E7-S2 — book a tutor availability slot against a plan (parent, ABAC-walled,
   * never over-books). Flow ORDER is load-bearing (ADR-020 / Winston C-2):
   *  (a) load the plan tenant-scoped → 404 if missing;
   *  (b) guardianship ABAC on the plan's student BEFORE any write → 404-before-403
   *      (a plan for a non-guarded child is indistinguishable from missing);
   *  (c) the plan must be open → 422;
   *  (d) load the availability tenant-scoped incl. tutor → 404 if missing/inactive;
   *      re-validate the tutor is published (write-time guarantee, not just read);
   *  (e) if the tutor is teacher-linked (userProfileId != null), re-check the E2
   *      teaching wall — the tutor's teacher must CURRENTLY teach the student →
   *      403 on a lapsed/absent wall; external/peer tutors skip the wall;
   *  (f) the capacity-guarded insert (the service owns sessionAt canonicalisation,
   *      idempotency, and the never-over-book guard — a full slot → kind 409).
   * On a FRESH booking only: best-effort append-only `remediation.booking_created`
   * audit + `NotificationsService.createMany` fan-out (tutor + parent), neither of
   * which can fail or roll back the booking.
   */
  @Post('bookings')
  @RequiresPermission('remediation.book')
  @ApiOperation({ summary: 'Book a tutor slot against a plan (ABAC + teaching wall, never over-books)' })
  async book(@CurrentJwt() jwt: KeycloakJwtPayload, @Body() dto: CreateBookingDto) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    // (a) plan, tenant-scoped
    const plan = await this.remediation.loadPlanForBooking({
      tenantId: me.tenantId,
      planId: dto.planId,
    });
    if (!plan) throw new NotFoundException('Plan not found');

    // (b) guardianship ABAC BEFORE any write (404-before-403)
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, plan.studentId, schoolId);
    if (!allowed) throw new NotFoundException('Plan not found');

    // (c) plan must be open
    if (plan.status !== 'open') {
      throw new ConflictException("Ce plan n'est plus ouvert aux réservations");
    }

    // (d) availability, tenant-scoped + active; published re-validated at write time
    const avail = await this.remediation.loadBookableAvailability({
      tenantId: me.tenantId,
      availabilityId: dto.availabilityId,
    });
    if (!avail || !avail.tutorPublished) throw new NotFoundException('Slot not found');

    // (e) teaching wall for a teacher-linked tutor (external/peer tutors skip it)
    if (avail.tutorUserProfileId) {
      const teaches = await this.remediation.isTeacherOfStudent({
        tenantId: me.tenantId,
        teacherUserProfileId: avail.tutorUserProfileId,
        studentId: plan.studentId,
      });
      if (!teaches) {
        throw new ForbiddenException("Cet enseignant n'encadre plus cet élève");
      }
    }

    // (f) the capacity-guarded insert (422 on sessionAt mismatch, 409 on full)
    const { booking, created } = await this.bookings.createBooking({
      tenantId: me.tenantId,
      schoolId: plan.schoolId ?? schoolId,
      planId: dto.planId,
      studentId: plan.studentId,
      availabilityId: avail.id,
      tutorId: avail.tutorId,
      capacity: avail.capacity,
      slot: {
        kind: avail.kind,
        weekday: avail.weekday,
        startTime: avail.startTime,
        startsAt: avail.startsAt,
      },
      sessionAtIso: dto.sessionAt,
      userProfileId: me.id,
      note: dto.note,
    });

    if (created) {
      await this.writeBookingAudit(jwt, me, 'remediation.booking_created', booking);
      await this.fanOutBookingNotifications({
        tenantId: me.tenantId,
        booking,
        tutorUserProfileId: avail.tutorUserProfileId,
        parentUserProfileId: me.id,
      });
    }

    return booking;
  }

  /**
   * E7-S2 — parent cancel (atomic seat free, append-only). Guardianship ABAC on the
   * booking's student BEFORE the write (404-before-403); only an active booking is
   * cancellable (a double-cancel is a safe no-op → 409 illegal transition). The
   * cancel frees the seat because the active-status filter excludes 'cancelled'.
   * Best-effort `remediation.booking_cancelled` audit + parent/tutor notify.
   */
  @Patch('bookings/:id/cancel')
  @RequiresPermission('remediation.book')
  @ApiOperation({ summary: 'Cancel a booking (atomic seat free, append-only, ABAC)' })
  async cancel(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    const existing = await this.bookings.loadBooking({ tenantId: me.tenantId, bookingId: id });
    if (!existing) throw new NotFoundException('Booking not found');

    // Guardianship ABAC on the booking's student BEFORE the write (404-before-403).
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, existing.studentId, schoolId);
    if (!allowed) throw new NotFoundException('Booking not found');

    const result = await this.bookings.cancelBooking({
      tenantId: me.tenantId,
      bookingId: id,
      userProfileId: me.id,
    });
    if (!result) {
      // Nothing was cancellable (already cancelled/declined/completed) — a safe
      // no-op; surface a deterministic 409 illegal-transition (never a 500).
      throw new ConflictException("Cette réservation ne peut plus être annulée");
    }

    await this.writeBookingAudit(jwt, me, 'remediation.booking_cancelled', result.booking);

    // Best-effort cancel notify to the parent (the tutor target needs its linkage;
    // we notify the parent of the freed seat — a side-effect only).
    try {
      await this.notifications.createMany([
        {
          tenantId: me.tenantId,
          userProfileId: me.id,
          kind: 'remediation',
          title: 'Réservation annulée',
          body: 'Votre réservation de soutien a été annulée.',
          link: `/parent/remediation/${result.booking.planId}`,
          sourceType: 'booking',
          sourceId: `${result.booking.id}:cancelled`,
        },
      ]);
    } catch (err) {
      this.logger.error(
        `Best-effort cancel notify failed for booking ${result.booking.id} (booking unaffected): ${(err as Error).message}`,
      );
    }

    return result.booking;
  }

  // ----- best-effort side-effects (never fail/roll back the booking) ----------

  private async writeBookingAudit(
    jwt: KeycloakJwtPayload,
    me: { id: string; tenantId: string },
    action: 'remediation.booking_created' | 'remediation.booking_cancelled',
    booking: {
      id: string;
      planId: string;
      availabilityId: string;
      sessionAt: string;
      studentId: string;
      tutorId: string;
      status: string;
    },
  ): Promise<void> {
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: me.tenantId,
          actorId: me.id,
          actorRole,
          portal,
          action,
          resourceType: 'booking',
          resourceId: booking.id,
          after: {
            planId: booking.planId,
            availabilityId: booking.availabilityId,
            sessionAt: booking.sessionAt,
            studentId: booking.studentId,
            tutorId: booking.tutorId,
            status: booking.status,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write ${action} audit row for booking ${booking.id} (booking unaffected): ${(err as Error).message}`,
      );
    }
  }

  private async fanOutBookingNotifications(args: {
    tenantId: string;
    booking: { id: string; planId: string };
    tutorUserProfileId: string | null;
    parentUserProfileId: string;
  }): Promise<void> {
    const items = [];
    if (args.tutorUserProfileId) {
      items.push({
        tenantId: args.tenantId,
        userProfileId: args.tutorUserProfileId,
        kind: 'remediation' as const,
        title: 'Nouvelle réservation de soutien',
        body: 'Un parent a réservé un de vos créneaux de soutien.',
        link: '/teacher/remediation',
        sourceType: 'booking',
        sourceId: args.booking.id,
      });
    }
    items.push({
      tenantId: args.tenantId,
      userProfileId: args.parentUserProfileId,
      kind: 'remediation' as const,
      title: 'Votre réservation est enregistrée',
      body: 'Votre réservation de soutien a bien été prise en compte.',
      link: `/parent/remediation/${args.booking.planId}`,
      sourceType: 'booking',
      sourceId: args.booking.id,
    });
    try {
      await this.notifications.createMany(items);
    } catch (err) {
      this.logger.error(
        `Best-effort booking notify failed for booking ${args.booking.id} (booking unaffected): ${(err as Error).message}`,
      );
    }
  }
}
