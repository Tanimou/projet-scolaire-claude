import { Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type {
  StudentAnnouncementsResponse,
  StudentAttendanceResponse,
  StudentDashboardResponse,
  StudentGradesResponse,
  StudentMeResponse,
  StudentUpcomingResponse,
} from '@pilotage/contracts';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { StudentPortalService } from './student-portal.service';

/**
 * Student Portal — the fourth, read-only learner audience (E8-S1).
 *
 * Every endpoint is server-resolved to the caller's OWN dossier:
 *  - guarded by the student-only `*.read.self` permissions (a parent/teacher/admin
 *    token lacks them → 403; a `student` token is denied on parent/teacher/admin
 *    endpoints by the missing permission + the guardianship/teaching wall),
 *  - the studentId is resolved server-side from `Student.userProfileId === me.id`
 *    (no `:studentId` path param exists anywhere here — the IDOR surface is
 *    structurally removed; a client-supplied id is impossible to inject),
 *  - tenant-scoped on every query (server-derived from the JWT).
 *
 * Read-only: there is NO student write verb. An unlinked account degrades to a
 * kind activation gate (`/student/me` → activated:false), never a leak/crash.
 * See docs/adr/ADR-021-student-role-and-self-abac.md.
 */
@ApiTags('student-portal')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('student')
export class StudentPortalController {
  constructor(
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly portal: StudentPortalService,
  ) {}

  @Get('me')
  @RequiresPermission('analytics.read.self')
  @ApiOperation({ summary: "Activation gate + the learner's own identity header" })
  async me(@CurrentJwt() jwt: KeycloakJwtPayload): Promise<StudentMeResponse> {
    const me = await this.users.ensureUser(jwt);
    return this.portal.me(me);
  }

  @Get('grades')
  @RequiresPermission('grades.read.self')
  @ApiOperation({ summary: "Mes notes — the learner's own published grades by subject" })
  async grades(@CurrentJwt() jwt: KeycloakJwtPayload): Promise<StudentGradesResponse> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.grades(me, jwt, schoolId);
  }

  @Get('upcoming')
  @RequiresPermission('assessments.read.self')
  @ApiOperation({ summary: "Mes prochaines évaluations — the learner's own upcoming assessments" })
  async upcoming(@CurrentJwt() jwt: KeycloakJwtPayload): Promise<StudentUpcomingResponse> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.upcoming(me, jwt, schoolId);
  }

  @Get('attendance')
  @RequiresPermission('attendance.read.self')
  @ApiOperation({ summary: "Mon assiduité — the learner's own attendance summary + records" })
  async attendance(@CurrentJwt() jwt: KeycloakJwtPayload): Promise<StudentAttendanceResponse> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.attendance(me, jwt, schoolId);
  }

  @Get('announcements')
  @RequiresPermission('announcements.read.self')
  @ApiOperation({ summary: "Les annonces — the announcements addressed to the learner" })
  async announcements(
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ): Promise<StudentAnnouncementsResponse> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.announcements(me, jwt, schoolId);
  }

  /**
   * The ONE student mutation: flip the caller's OWN receipt readAt (idempotent).
   * `:id` is an ANNOUNCEMENT id (the receipt is keyed on `(announcementId, me.id)`),
   * never a studentId — no IDOR. 404 when the caller has no receipt for it.
   */
  @Post('announcements/:id/read')
  @RequiresPermission('announcements.read.self')
  @ApiOperation({ summary: "Marquer une annonce comme lue (le seul écrit élève, sur son propre reçu)" })
  async markAnnouncementRead(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ): Promise<{ ok: true; alreadyRead?: boolean }> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.markAnnouncementRead(me, jwt, schoolId, id);
  }

  @Get('dashboard')
  @RequiresPermission('analytics.read.self')
  @ApiOperation({ summary: "Mon objectif — the actionable, peer-free student dashboard" })
  async dashboard(@CurrentJwt() jwt: KeycloakJwtPayload): Promise<StudentDashboardResponse> {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.portal.dashboard(me, jwt, schoolId);
  }
}
