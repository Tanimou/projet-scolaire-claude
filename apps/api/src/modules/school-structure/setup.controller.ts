import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { SchoolContextService } from './school-context.service';

interface SetupStep {
  key: string;
  label: string;
  description: string;
  href: string;
  done: boolean;
  count: number;
}

/**
 * Drives the "setup checklist" on the admin dashboard.
 * Each step is computed from a count of existing entities → the UI can show progress
 * and lead the admin through the first-time onboarding.
 */
@ApiTags('school-structure')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('setup')
export class SetupController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get('checklist')
  @RequiresPermission('schools.read')
  @ApiOkResponse({ description: 'Computed setup checklist for the admin dashboard' })
  async checklist(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forTenant(me.tenantId);

    const [
      brandingCount,
      yearCount,
      termCount,
      cycleCount,
      levelCount,
      subjectCount,
      coefCount,
      classCount,
      activeTeachers,
    ] = await Promise.all([
      this.prisma.branding.count({ where: { schoolId } }),
      this.prisma.academicYear.count({ where: { schoolId } }),
      activeAcademicYearId
        ? this.prisma.term.count({ where: { academicYearId: activeAcademicYearId } })
        : Promise.resolve(0),
      this.prisma.cycle.count({ where: { schoolId } }),
      this.prisma.gradeLevel.count({ where: { schoolId } }),
      this.prisma.subject.count({ where: { schoolId, active: true } }),
      this.prisma.subjectCoefficient.count({ where: { subject: { schoolId } } }),
      activeAcademicYearId
        ? this.prisma.classSection.count({
            where: { academicYearId: activeAcademicYearId, status: 'active' },
          })
        : Promise.resolve(0),
      // Teachers will be a real check in Phase 3 when we add the Teacher model
      Promise.resolve(0),
    ]);

    const steps: SetupStep[] = [
      {
        key: 'branding',
        label: 'Identité visuelle',
        description: 'Personnalisez le logo, les couleurs et le nom affiché.',
        href: '/admin/school/branding',
        done: brandingCount > 0,
        count: brandingCount,
      },
      {
        key: 'academic_year',
        label: 'Année scolaire active',
        description: "Créez l'année en cours et ses trimestres.",
        href: '/admin/academic-years',
        done: !!activeAcademicYearId && termCount > 0,
        count: yearCount,
      },
      {
        key: 'cycles',
        label: 'Cycles & niveaux',
        description: 'Définissez votre arborescence pédagogique (Collège, Lycée…).',
        href: '/admin/cycles',
        done: cycleCount > 0 && levelCount > 0,
        count: levelCount,
      },
      {
        key: 'subjects',
        label: 'Matières & coefficients',
        description: 'Configurez les matières et leurs coefficients par niveau.',
        href: '/admin/subjects',
        done: subjectCount > 0 && coefCount > 0,
        count: subjectCount,
      },
      {
        key: 'classes',
        label: 'Classes',
        description: 'Créez les classes (6eA, 5eB…) de l\'année active.',
        href: '/admin/classes',
        done: classCount > 0,
        count: classCount,
      },
      {
        key: 'staff',
        label: 'Équipe pédagogique',
        description: 'Invitez les professeurs et administrateurs.',
        href: '/admin/users/invite',
        done: false, // wired Phase 3
        count: activeTeachers,
      },
    ];

    const completed = steps.filter((s) => s.done).length;
    return {
      total: steps.length,
      completed,
      progress: Math.round((completed / steps.length) * 100),
      steps,
      activeAcademicYearId,
    };
  }
}
