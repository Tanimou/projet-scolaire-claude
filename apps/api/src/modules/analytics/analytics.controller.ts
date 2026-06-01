import { Controller, ForbiddenException, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';
import { StudentAccessService } from '../students/student-access.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

import { AnalyticsService } from './analytics.service';
import { SchoolPerformanceDrilldownService } from './school-performance-drilldown.service';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(
    private readonly analytics: AnalyticsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly teachers: TeacherProfileService,
    private readonly studentAccess: StudentAccessService,
    private readonly drilldown: SchoolPerformanceDrilldownService,
  ) {}

  /** Admin dashboard payload — REDESIGN-PLAN §6.2 analytics.dashboard */
  @Get('dashboard')
  @RequiresPermission('schools.read')
  async dashboard(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.adminDashboard({ tenantId, schoolId });
  }

  /** Cross-cutting "needs my attention now" feed for the admin dashboard. */
  @Get('admin-action-center')
  @RequiresPermission('schools.read')
  async adminActionCenter(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.adminActionCenter({ tenantId, schoolId });
  }

  /** Detailed school-perf donut payload (sometimes needed alone) */
  @Get('school-performance')
  @RequiresPermission('schools.read')
  async schoolPerformance(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.schoolPerformance({ tenantId, schoolId });
  }

  /**
   * Drill-down trimestriel des performances — backs `/admin/analytics`.
   *
   * Profondeur progressive selon les paramètres fournis :
   *   - aucun id            → par cycle (L1)
   *   - cycleId             → par classe du cycle (L2)
   *   - classSectionId      → par matière de la classe (L3)
   *   - classSectionId + subjectId → liste des élèves (L4)
   * `termId` (optionnel) restreint au trimestre ; sinon toute l'année active.
   */
  @Get('school-performance-drilldown')
  @RequiresPermission('schools.read')
  async schoolPerformanceDrilldown(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('termId') termId?: string,
    @Query('cycleId') cycleId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('subjectId') subjectId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.drilldown.drilldown({
      tenantId,
      schoolId,
      termId: termId || undefined,
      cycleId: cycleId || undefined,
      classSectionId: classSectionId || undefined,
      subjectId: subjectId || undefined,
    });
  }

  /** Teacher dashboard payload — image 6 prescriptive */
  @Get('teacher-dashboard')
  @RequiresPermission('teaching_assignments.read')
  async teacherDashboard(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const { activeAcademicYearId } = await this.ctx.forUser(me);
    return this.analytics.teacherDashboard({
      tenantId: me.tenantId,
      teacherProfileId: teacher.id,
      academicYearId: activeAcademicYearId ?? undefined,
    });
  }

  /** Cross-cutting "needs my attention now" feed for the teacher dashboard. */
  @Get('teacher-action-center')
  @RequiresPermission('teaching_assignments.read')
  async teacherActionCenter(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const { activeAcademicYearId } = await this.ctx.forUser(me);
    return this.analytics.teacherActionCenter({
      tenantId: me.tenantId,
      teacherProfileId: teacher.id,
      academicYearId: activeAcademicYearId ?? undefined,
    });
  }

  /** Teacher reports payload — backs `/teacher/reports`. */
  @Get('teacher-reports')
  @RequiresPermission('teaching_assignments.read')
  async teacherReports(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const { activeAcademicYearId } = await this.ctx.forUser(me);
    return this.analytics.teacherReports({
      tenantId: me.tenantId,
      teacherProfileId: teacher.id,
      academicYearId: activeAcademicYearId ?? undefined,
    });
  }

  /** Parent dashboard payload — image 7 prescriptive */
  @Get('parent-dashboard/:studentId')
  @RequiresPermission('students.read')
  async parentDashboard(
    @Param('studentId') studentId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException();
    return this.analytics.parentDashboard({ tenantId: me.tenantId, studentId });
  }

  /**
   * Parent comments feed — all published grades with a teacher comment for
   * one of the parent's children, ordered newest-first.
   */
  @Get('parent-comments/:studentId')
  @RequiresPermission('grades.read')
  async parentComments(
    @Param('studentId') studentId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException();
    return this.analytics.parentComments({ tenantId: me.tenantId, studentId });
  }

  /**
   * Parent upcoming-assessments feed — every assessment scheduled in the next
   * 60 days for the child's active class, with subject/term/coefficient details.
   * Backs the `/parent/upcoming` workspace.
   */
  @Get('parent-upcoming/:studentId')
  @RequiresPermission('students.read')
  async parentUpcoming(
    @Param('studentId') studentId: string,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const allowed = await this.studentAccess.canAccessStudent(me, jwt, studentId, schoolId);
    if (!allowed) throw new ForbiddenException();
    return this.analytics.parentUpcoming({ tenantId: me.tenantId, studentId });
  }

  /** Students KPI aggregate — `/admin/students` top cards + level donut. */
  @Get('students-aggregate')
  @RequiresPermission('students.read')
  async studentsAggregate(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.studentsAggregate({ tenantId, schoolId });
  }

  /** Classes KPI aggregate — `/admin/classes` top cards. */
  @Get('classes-aggregate')
  @RequiresPermission('classes.read')
  async classesAggregate(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.classesAggregate({ tenantId, schoolId });
  }

  /** Teachers KPI aggregate — `/admin/teachers` top cards. */
  @Get('teachers-aggregate')
  @RequiresPermission('teachers.read')
  async teachersAggregate(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { tenantId, schoolId } = await this.ctx.forUser(me);
    return this.analytics.teachersAggregate({ tenantId, schoolId });
  }

  /** Audit log list with filters — `/admin/audit` page. */
  @Get('audit')
  @RequiresPermission('audit.read')
  async auditList(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('actorId') actorId?: string,
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('portal') portal?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const take = Math.min(parseInt(limit ?? '50', 10) || 50, 200);
    const skip = parseInt(offset ?? '0', 10) || 0;
    return this.analytics.auditList({
      tenantId: me.tenantId,
      from,
      to,
      actorId,
      action,
      resourceType,
      portal,
      take,
      skip,
    });
  }

  /** Audit log facets — distinct values for filter dropdowns. */
  @Get('audit-facets')
  @RequiresPermission('audit.read')
  async auditFacets(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    return this.analytics.auditFacets({ tenantId: me.tenantId });
  }
}
