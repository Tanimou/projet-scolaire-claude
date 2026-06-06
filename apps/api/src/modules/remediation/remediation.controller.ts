import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
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
    });
  }
}
