import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { EnrollmentStatus, Prisma } from '@prisma/client';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

import {
  type ClientHintsRequest,
  extractAuditClientHints,
} from '../../shared/audit/client-hints';
import { deriveAuditProvenance } from '../../shared/audit/provenance';
import { writeAudit } from '../../shared/audit/write-audit';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';

class CreateEnrollmentDto {
  @IsUUID() studentId!: string;
  @IsUUID() classSectionId!: string;
  @IsOptional() @IsEnum(EnrollmentStatus) status?: EnrollmentStatus;
}

class TransferEnrollmentDto {
  @IsUUID() toClassSectionId!: string;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

class EndEnrollmentDto {
  @IsEnum(EnrollmentStatus) status!: EnrollmentStatus;
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

@ApiTags('enrollments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('enrollments')
export class EnrollmentsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Fan-out: notify every active guardian of the student about the enrollment event. */
  private async notifyGuardiansOfEnrollment(args: {
    tenantId: string;
    studentId: string;
    enrollmentId: string;
    classSectionName: string;
    status: EnrollmentStatus;
    kind: 'created' | 'transferred' | 'ended';
  }): Promise<void> {
    try {
      const guardianships = await this.prisma.guardianship.findMany({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          guardian: { userProfileId: { not: null } },
        },
        include: {
          guardian: { select: { userProfileId: true } },
          student: { select: { firstName: true } },
        },
      });
      const recipients = guardianships.filter((g) => g.guardian.userProfileId);
      if (recipients.length === 0) return;

      const titleByKind: Record<typeof args.kind, string> = {
        created: `Inscription confirmée — ${args.classSectionName}`,
        transferred: `Changement de classe — ${args.classSectionName}`,
        ended: `Fin d'inscription`,
      };
      const severityByKind: Record<typeof args.kind, 'success' | 'info' | 'warning'> = {
        created: 'success',
        transferred: 'info',
        ended: 'warning',
      };

      await this.notifications.createMany(
        recipients.map((g) => ({
          tenantId: args.tenantId,
          userProfileId: g.guardian.userProfileId!,
          kind: 'enrollment_status' as const,
          severity: severityByKind[args.kind],
          title: titleByKind[args.kind],
          body:
            args.kind === 'ended'
              ? `L'inscription de ${g.student.firstName} a pris fin.`
              : `${g.student.firstName} est désormais inscrit·e en « ${args.classSectionName} ».`,
          link: `/parent/children/${args.studentId}`,
          // Dedup key combines enrollmentId + status transition so a status flip
          // (active → ended → active) yields a fresh notification each time.
          sourceType: `enrollment_${args.kind}`,
          sourceId: args.enrollmentId,
        })),
      );
    } catch (err) {
       
      console.warn('[enrollments] notification fan-out failed', err);
    }
  }

  @Get()
  @RequiresPermission('enrollments.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('academicYearId') academicYearId?: string,
    @Query('status') status?: EnrollmentStatus,
  ) {
    const me = await this.users.ensureUser(jwt);
    const data = await this.prisma.enrollment.findMany({
      where: {
        tenantId: me.tenantId,
        ...(studentId ? { studentId } : {}),
        ...(classSectionId ? { classSectionId } : {}),
        ...(academicYearId ? { academicYearId } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: [{ enrolledAt: 'desc' }],
      include: {
        student: { select: { id: true, firstName: true, lastName: true, externalRef: true } },
        classSection: { include: { gradeLevel: true } },
        academicYear: { select: { id: true, name: true, status: true } },
      },
    });
    return { data };
  }

  /**
   * S-E04-6 — the enrollment and its audit row commit together.
   *
   * TWO BOUNDARIES THAT MUST HOLD (`ADR-035` D5), both stated rather than
   * assumed by the next reader:
   *
   *  • The capacity check below reads `_count` OUTSIDE the transaction and STAYS
   *    there. Wrapping the write did NOT close that TOCTOU race — two concurrent
   *    requests can still both pass it and over-fill a class. Unchanged by this
   *    slice, and said out loud so nobody reads the new `$transaction` as a fix.
   *  • `notifyGuardiansOfEnrollment` stays AFTER the commit. It reads every
   *    guardianship and writes N notifications; inside the transaction, a large
   *    roster would blow Prisma's 5 s interactive-transaction timeout and roll
   *    back a valid enrollment, and its swallowed error would become a rollback
   *    trigger for the very thing it is best-effort about.
   */
  @Post()
  @RequiresPermission('enrollments.write')
  async create(
    @Body() body: CreateEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const [student, classSection] = await Promise.all([
      this.prisma.student.findUnique({ where: { id: body.studentId } }),
      this.prisma.classSection.findUnique({
        where: { id: body.classSectionId },
        include: {
          academicYear: true,
          _count: { select: { enrollments: { where: { status: 'active' } } } },
        },
      }),
    ]);
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException('Élève introuvable');
    if (!classSection || classSection.tenantId !== me.tenantId)
      throw new NotFoundException('Classe introuvable');
    if (classSection.academicYear.status === 'archived') {
      throw new BadRequestException("Impossible d'inscrire dans une année archivée.");
    }
    if (classSection.status === 'closed') {
      throw new BadRequestException('Cette classe est fermée.');
    }
    if (classSection._count.enrollments >= classSection.maxStudents) {
      throw new ConflictException(
        `Capacité atteinte : la classe « ${classSection.name} » a déjà ${classSection.maxStudents} élèves inscrits.`,
      );
    }

    // Block double enrollment in the same academic year (active only).
    const conflict = await this.prisma.enrollment.findFirst({
      where: {
        tenantId: me.tenantId,
        studentId: body.studentId,
        academicYearId: classSection.academicYearId,
        status: 'active',
      },
      include: { classSection: { select: { name: true } } },
    });
    if (conflict) {
      throw new ConflictException(
        `L'élève est déjà inscrit en « ${conflict.classSection.name} » pour cette année. Utilisez « transférer » pour le changer de classe.`,
      );
    }

    const created = await this.prisma.$transaction(async (tx) => {
      const enrollment = await tx.enrollment.create({
        data: {
          tenantId: me.tenantId,
          studentId: body.studentId,
          classSectionId: body.classSectionId,
          academicYearId: classSection.academicYearId,
          status: body.status ?? 'active',
          enrolledAt: new Date(),
        },
        include: {
          classSection: { include: { gradeLevel: true } },
          academicYear: true,
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.create',
        resourceType: 'enrollment',
        resourceId: enrollment.id,
        provenance,
        after: {
          studentId: enrollment.studentId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.academicYearId,
          status: enrollment.status,
        },
      });
      return enrollment;
    });

    // R8 fan-out — only notify guardians for active enrollments (skip pending).
    if (created.status === 'active') {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: created.studentId,
        enrollmentId: created.id,
        classSectionName: created.classSection.name,
        status: created.status,
        kind: 'created',
      });
    }

    return created;
  }

  @Patch(':id')
  @RequiresPermission('enrollments.write')
  async update(
    @Param('id') id: string,
    @Body() body: EndEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();

    const isEnding = body.status !== 'active' && body.status !== 'pending';
    const becameActive = enrollment.status !== 'active' && body.status === 'active';

    const updated = await this.prisma.$transaction(async (tx) => {
      const next = await tx.enrollment.update({
        where: { id },
        data: {
          status: body.status,
          ...(isEnding && !enrollment.endedAt ? { endedAt: new Date(), endReason: body.reason } : {}),
        },
        include: { classSection: { select: { name: true } } },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.status_change',
        resourceType: 'enrollment',
        resourceId: id,
        provenance,
        before: { status: enrollment.status, endedAt: enrollment.endedAt?.toISOString() ?? null },
        after: {
          status: next.status,
          endedAt: next.endedAt?.toISOString() ?? null,
          endReason: next.endReason ?? null,
        },
      });
      return next;
    });

    if (becameActive || (isEnding && !enrollment.endedAt)) {
      await this.notifyGuardiansOfEnrollment({
        tenantId: me.tenantId,
        studentId: updated.studentId,
        enrollmentId: updated.id,
        classSectionName: updated.classSection.name,
        status: updated.status,
        kind: becameActive ? 'created' : 'ended',
      });
    }

    return updated;
  }

  /**
   * Transfer student from current active enrollment to a new class (same academic year).
   *
   * S-E04-6 — converted from the ARRAY `$transaction([...])` form to the
   * interactive one, because the array form exposes no `tx` client and therefore
   * cannot host the audit write at all.
   *
   * THE RESPONSE SHAPE IS UNCHANGED, ON PURPOSE. The array form resolved to the
   * two-element tuple `[closed, opened]`; the callback returns exactly that tuple,
   * in that order. A consumer reading `res[1].id` must keep working — a silent
   * drift here would be a 200 with the wrong body, which no test of the audit row
   * would ever catch. Pinned in `enrollments.controller.spec.ts`.
   *
   * ONE row, not two. The transfer is one decision; writing an
   * `enrollment.transfer` row per affected enrollment would leave an auditor with
   * two unlinked rows and no way to reconstruct the move. `resourceId` is the
   * CLOSED enrollment (the one the operator acted on); the opened one is named in
   * `after`.
   */
  @Post(':id/transfer')
  @RequiresPermission('enrollments.write')
  async transfer(
    @Param('id') id: string,
    @Body() body: TransferEnrollmentDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const current = await this.prisma.enrollment.findUnique({
      where: { id },
      include: { classSection: { include: { academicYear: true } } },
    });
    if (!current || current.tenantId !== me.tenantId) throw new NotFoundException();
    if (current.status !== 'active') {
      throw new BadRequestException('Seule une inscription active peut être transférée.');
    }
    if (current.classSectionId === body.toClassSectionId) {
      throw new BadRequestException("L'élève est déjà dans cette classe.");
    }

    const target = await this.prisma.classSection.findUnique({
      where: { id: body.toClassSectionId },
      include: {
        academicYear: true,
        _count: { select: { enrollments: { where: { status: 'active' } } } },
      },
    });
    if (!target || target.tenantId !== me.tenantId) throw new NotFoundException('Classe cible introuvable');
    if (target.academicYearId !== current.academicYearId) {
      throw new BadRequestException('Le transfert doit rester dans la même année scolaire.');
    }
    if (target._count.enrollments >= target.maxStudents) {
      throw new ConflictException(`Capacité atteinte sur « ${target.name} ».`);
    }

    return this.prisma.$transaction(async (tx) => {
      const closed = await tx.enrollment.update({
        where: { id },
        data: {
          status: 'transferred_out',
          endedAt: new Date(),
          endReason: body.reason ?? `Transféré vers ${target.name}`,
        },
      });
      const opened = await tx.enrollment.create({
        data: {
          tenantId: me.tenantId,
          studentId: current.studentId,
          classSectionId: body.toClassSectionId,
          academicYearId: current.academicYearId,
          status: 'active',
        },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.transfer',
        resourceType: 'enrollment',
        resourceId: closed.id,
        provenance,
        before: { classSectionId: current.classSectionId, status: current.status },
        after: {
          closedEnrollmentId: closed.id,
          openedEnrollmentId: opened.id,
          classSectionId: opened.classSectionId,
          reason: body.reason ?? null,
        },
      });
      // The array form's resolved value, byte-for-byte. Do not "tidy" this into
      // an object — it is the shipped response body.
      return [closed, opened];
    });
  }

  /**
   * S-E04-6 — cancellation and its audit row commit together, on BOTH branches.
   *
   * The `pending` branch HARD-deletes. `AuditLog` has no FK to `Enrollment` (and
   * none is added here — PF-96's posture is stated in `ADR-035`, not changed), so
   * the row will point at an id that no longer resolves. `before` therefore
   * carries the full payload: after the delete, the audit row is the only record
   * that the enrollment ever existed.
   */
  @Delete(':id')
  @RequiresPermission('enrollments.delete')
  async remove(
    @Param('id') id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Req() req: ClientHintsRequest,
  ) {
    const me = await this.users.ensureUser(jwt);
    const provenance = deriveAuditProvenance(jwt, extractAuditClientHints(req));
    const enrollment = await this.prisma.enrollment.findUnique({ where: { id } });
    if (!enrollment || enrollment.tenantId !== me.tenantId) throw new NotFoundException();
    // Allow hard-delete only when status is pending. Otherwise mark as dropped (soft).
    if (enrollment.status === 'pending') {
      await this.prisma.$transaction(async (tx) => {
        await tx.enrollment.delete({ where: { id } });
        await writeAudit(tx, {
          tenantId: me.tenantId,
          actorId: me.id,
          action: 'enrollment.cancel',
          resourceType: 'enrollment',
          resourceId: id,
          provenance,
          before: {
            studentId: enrollment.studentId,
            classSectionId: enrollment.classSectionId,
            academicYearId: enrollment.academicYearId,
            status: enrollment.status,
            enrolledAt: enrollment.enrolledAt.toISOString(),
            hardDeleted: true,
          },
        });
      });
      return { ok: true, deleted: true };
    }
    return this.prisma.$transaction(async (tx) => {
      const dropped = await tx.enrollment.update({
        where: { id },
        data: { status: 'dropped', endedAt: new Date(), endReason: 'Annulation administrative' },
      });
      await writeAudit(tx, {
        tenantId: me.tenantId,
        actorId: me.id,
        action: 'enrollment.cancel',
        resourceType: 'enrollment',
        resourceId: id,
        provenance,
        before: { status: enrollment.status, hardDeleted: false },
        after: { status: dropped.status, endReason: dropped.endReason ?? null },
      });
      return dropped;
    });
  }

  /** Roster — list active enrollments per class section, useful for the teacher portal. */
  @Get('roster/:classSectionId')
  @RequiresPermission('enrollments.read')
  async roster(@Param('classSectionId') classSectionId: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const cls = await this.prisma.classSection.findUnique({ where: { id: classSectionId } });
    if (!cls || cls.tenantId !== me.tenantId) throw new NotFoundException();

    const enrollments = await this.prisma.enrollment.findMany({
      where: { classSectionId, status: 'active', tenantId: me.tenantId },
      include: { student: true },
      orderBy: { student: { lastName: 'asc' } satisfies Prisma.StudentOrderByWithRelationInput },
    });
    return {
      classSection: cls,
      enrollments,
      capacity: { current: enrollments.length, max: cls.maxStudents },
    };
  }
}
