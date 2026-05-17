import { Controller, Get, NotFoundException, Param, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

/**
 * School-structure overview endpoints. These don't create or modify entities —
 * they assemble views that show the full hierarchy in one go:
 *
 *   School
 *     ├─ AcademicYears (with active flag)
 *     ├─ Cycles
 *     │    └─ GradeLevels
 *     │          ├─ ClassSections (for the chosen academic year)
 *     │          │    └─ enrollment counts
 *     │          └─ SubjectCoefficients
 *     └─ Subjects (global)
 *
 * Used by the /admin/school/structure UI page and any place that needs a tree
 * (e.g. cascaded selectors for class creation).
 */
@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('school/structure')
export class StructureController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  /**
   * Full tree for the active school.
   *
   * Query: `?academicYearId=…` to override the year. Defaults to the active year.
   */
  @Get()
  @RequiresPermission('schools.read')
  async tree(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forUser(me);
    const yearId = academicYearId ?? activeAcademicYearId;

    const [school, cycles, classes, subjects, totals] = await Promise.all([
      this.prisma.school.findUniqueOrThrow({
        where: { id: schoolId },
        select: {
          id: true,
          name: true,
          schoolCode: true,
          country: true,
          academicYears: {
            orderBy: { startDate: 'desc' },
            select: { id: true, name: true, status: true, startDate: true, endDate: true },
          },
        },
      }),
      this.prisma.cycle.findMany({
        where: { schoolId },
        orderBy: { orderIndex: 'asc' },
        include: {
          gradeLevels: {
            orderBy: { orderIndex: 'asc' },
            select: {
              id: true,
              code: true,
              name: true,
              orderIndex: true,
              _count: { select: { coefficients: true } },
            },
          },
        },
      }),
      yearId
        ? this.prisma.classSection.findMany({
            where: { tenantId: me.tenantId, academicYearId: yearId },
            select: {
              id: true,
              name: true,
              status: true,
              maxStudents: true,
              gradeLevelId: true,
              _count: { select: { enrollments: { where: { status: 'active' } } } },
            },
            orderBy: { name: 'asc' },
          })
        : Promise.resolve([] as never[]),
      this.prisma.subject.findMany({
        where: { schoolId, active: true },
        orderBy: { name: 'asc' },
        select: { id: true, code: true, name: true, color: true, defaultCoefficient: true },
      }),
      this.prisma.$transaction([
        this.prisma.student.count({ where: { schoolId } }),
        this.prisma.guardian.count({ where: { schoolId } }),
        this.prisma.enrollment.count({
          where: { tenantId: me.tenantId, status: 'active', ...(yearId ? { academicYearId: yearId } : {}) },
        }),
      ]),
    ]);

    // attach classes under their gradeLevel
    const classByLevel = new Map<string, typeof classes>();
    for (const c of classes) {
      const arr = classByLevel.get(c.gradeLevelId) ?? [];
      arr.push(c);
      classByLevel.set(c.gradeLevelId, arr);
    }

    const tree = cycles.map((cy) => ({
      id: cy.id,
      code: cy.code,
      name: cy.name,
      color: cy.color,
      icon: cy.icon,
      orderIndex: cy.orderIndex,
      gradeLevels: cy.gradeLevels.map((lv) => {
        const lvClasses = classByLevel.get(lv.id) ?? [];
        const studentsActive = lvClasses.reduce((sum, c) => sum + c._count.enrollments, 0);
        const capacity = lvClasses.reduce((sum, c) => sum + c.maxStudents, 0);
        return {
          id: lv.id,
          code: lv.code,
          name: lv.name,
          orderIndex: lv.orderIndex,
          coefficientCount: lv._count.coefficients,
          subjectsCount: subjects.length,
          classes: lvClasses.map((c) => ({
            id: c.id,
            name: c.name,
            status: c.status,
            maxStudents: c.maxStudents,
            activeEnrollments: c._count.enrollments,
            fillRate: c.maxStudents > 0 ? c._count.enrollments / c.maxStudents : 0,
          })),
          totalClasses: lvClasses.length,
          totalStudents: studentsActive,
          capacity,
        };
      }),
    }));

    const [studentCount, guardianCount, activeEnrollments] = totals;
    return {
      school,
      activeAcademicYearId,
      selectedYearId: yearId,
      cycles: tree,
      subjects,
      stats: {
        totalCycles: cycles.length,
        totalLevels: cycles.reduce((s, c) => s + c.gradeLevels.length, 0),
        totalClasses: classes.length,
        totalSubjects: subjects.length,
        totalStudents: studentCount,
        totalGuardians: guardianCount,
        activeEnrollments,
      },
    };
  }

  /**
   * Cycle detail — drill-down view of a single cycle with its grade levels,
   * their classes (active year), and the matrix of subject coefficients.
   */
  @Get('cycles/:id')
  @RequiresPermission('schools.read')
  async cycle(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { activeAcademicYearId } = await this.ctx.forUser(me);

    const cycle = await this.prisma.cycle.findUnique({
      where: { id },
      include: {
        gradeLevels: {
          orderBy: { orderIndex: 'asc' },
          include: {
            classSections: activeAcademicYearId
              ? {
                  where: { academicYearId: activeAcademicYearId },
                  orderBy: { name: 'asc' },
                  include: {
                    _count: { select: { enrollments: { where: { status: 'active' } } } },
                  },
                }
              : false,
            coefficients: {
              include: {
                subject: { select: { id: true, code: true, name: true, color: true } },
              },
            },
          },
        },
      },
    });
    if (!cycle || cycle.tenantId !== me.tenantId) throw new NotFoundException();

    return { ...cycle, activeAcademicYearId };
  }
}
