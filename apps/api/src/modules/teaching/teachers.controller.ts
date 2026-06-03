import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, IsBoolean, IsDateString } from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { TeacherProfileService } from './teacher-profile.service';

class UpdateTeacherDto {
  @IsOptional() @IsString() @MaxLength(80) specialty?: string;
  @IsOptional() @IsString() @MaxLength(80) externalRef?: string;
  @IsOptional() @IsDateString() hiredAt?: string;
  @IsOptional() @IsBoolean() active?: boolean;
  @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}

@ApiTags('teaching')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('teachers')
export class TeachersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly teachers: TeacherProfileService,
  ) {}

  /** List all teachers in the school. Admin-facing. */
  @Get()
  @RequiresPermission('teachers.read')
  async list(@CurrentJwt() jwt: KeycloakJwtPayload, @Query('q') q?: string, @Query('active') active?: string) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);

    const where: Record<string, unknown> = { tenantId: me.tenantId, schoolId };
    if (active === 'true') where.active = true;
    if (active === 'false') where.active = false;
    if (q) {
      where.userProfile = {
        OR: [
          { firstName: { contains: q, mode: 'insensitive' } },
          { lastName: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      };
    }

    const data = await this.prisma.teacherProfile.findMany({
      where,
      include: {
        userProfile: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
            photoUrl: true,
          },
        },
        // Distinct subjects taught — surfaced as colored chips in the table
        teachingAssignments: {
          select: {
            subject: { select: { id: true, code: true, name: true, color: true } },
          },
        },
        _count: { select: { teachingAssignments: true } },
      },
      orderBy: { userProfile: { lastName: 'asc' } },
    });
    // De-duplicate subjects per teacher (a teacher can teach the same subject in multiple classes)
    const enriched = data.map((t) => {
      const seen = new Set<string>();
      const subjects = t.teachingAssignments
        .map((ta) => ta.subject)
        .filter((s) => {
          if (seen.has(s.id)) return false;
          seen.add(s.id);
          return true;
        });
      return { ...t, subjects, teachingAssignments: undefined };
    });
    return { data: enriched };
  }

  /**
   * Current logged-in teacher's profile (auto-provisions if missing).
   * Lightweight endpoint for the teacher portal to identify itself.
   */
  @Get('me')
  @RequiresPermission('profile.read.self')
  async me(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    return this.prisma.teacherProfile.findUnique({
      where: { id: teacher.id },
      include: {
        userProfile: { select: { firstName: true, lastName: true, email: true, photoUrl: true } },
        school: { select: { id: true, name: true } },
        _count: { select: { teachingAssignments: true } },
      },
    });
  }

  /**
   * Classes + subjects the current teacher is assigned to (for the active year).
   * Each entry is one (class × subject) pair. Used as the teacher portal home.
   */
  @Get('me/assignments')
  @RequiresPermission('teaching_assignments.read')
  async myAssignments(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('academicYearId') academicYearId?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const { activeAcademicYearId } = await this.ctx.forUser(me);
    const yearId = academicYearId ?? activeAcademicYearId;

    const items = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: me.tenantId,
        teacherProfileId: teacher.id,
        ...(yearId ? { academicYearId: yearId } : {}),
      },
      include: {
        classSection: {
          include: {
            gradeLevel: { include: { cycle: true } },
            _count: { select: { enrollments: { where: { status: 'active' } } } },
          },
        },
        subject: { select: { id: true, code: true, name: true, color: true, icon: true, defaultCoefficient: true } },
        academicYear: { select: { id: true, name: true, status: true } },
      },
      orderBy: [{ classSection: { gradeLevel: { orderIndex: 'asc' } } }, { classSection: { name: 'asc' } }, { subject: { name: 'asc' } }],
    });
    return { data: items, teacherProfileId: teacher.id, activeAcademicYearId };
  }

  /**
   * Distinct students currently enrolled in any class the teacher teaches
   * (active enrollments only, scoped to the active academic year). Used by
   * the teacher portal `/teacher/students` page.
   *
   * Each row is enriched with per-student stats restricted to the teacher's
   * own assessments: gradesCount, lastGradeAt, avgPct.
   */
  @Get('me/students')
  @RequiresPermission('teaching_assignments.read')
  async myStudents(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const { activeAcademicYearId } = await this.ctx.forUser(me);
    if (!activeAcademicYearId) return { data: [], count: 0, classesSummary: [] };

    // 1. Collect class section ids the teacher teaches in the active year
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: me.tenantId,
        teacherProfileId: teacher.id,
        academicYearId: activeAcademicYearId,
      },
      select: { classSectionId: true, subject: { select: { id: true, code: true, name: true } } },
    });
    const classIds = [...new Set(assignments.map((a) => a.classSectionId))];
    if (classIds.length === 0) return { data: [], count: 0, classesSummary: [] };

    // 2. Pull enrollments + students for those classes
    const enrollments = await this.prisma.enrollment.findMany({
      where: {
        tenantId: me.tenantId,
        academicYearId: activeAcademicYearId,
        status: 'active',
        classSectionId: { in: classIds },
      },
      include: {
        student: {
          select: { id: true, firstName: true, lastName: true, photoUrl: true, externalRef: true, gender: true },
        },
        classSection: { select: { id: true, name: true, gradeLevel: { select: { name: true } } } },
      },
      orderBy: [{ student: { lastName: 'asc' } }, { student: { firstName: 'asc' } }],
    });

    // 3. Group: one row per student with the list of classes they're in
    const byStudent = new Map<
      string,
      {
        id: string;
        firstName: string;
        lastName: string;
        photoUrl: string | null;
        externalRef: string | null;
        gender: string | null;
        classes: Array<{ id: string; name: string; gradeLevelName: string }>;
        gradesCount: number;
        lastGradeAt: string | null;
        avgPct: number | null;
      }
    >();
    for (const e of enrollments) {
      const cur =
        byStudent.get(e.studentId) ??
        ({
          ...e.student,
          classes: [] as Array<{ id: string; name: string; gradeLevelName: string }>,
          gradesCount: 0,
          lastGradeAt: null,
          avgPct: null,
        } as ReturnType<typeof byStudent.get> & object);
      cur!.classes.push({
        id: e.classSection.id,
        name: e.classSection.name,
        gradeLevelName: e.classSection.gradeLevel.name,
      });
      byStudent.set(e.studentId, cur!);
    }

    // 4. Enrich each student with teacher-scoped grade stats (single query)
    const studentIds = [...byStudent.keys()];
    if (studentIds.length > 0) {
      const grades = await this.prisma.grade.findMany({
        where: {
          tenantId: me.tenantId,
          studentId: { in: studentIds },
          assessment: { teacherProfileId: teacher.id },
        },
        select: {
          studentId: true,
          value: true,
          isAbsent: true,
          updatedAt: true,
          assessment: { select: { maxScore: true } },
        },
      });
      const stats = new Map<string, { count: number; sumPct: number; numScored: number; last: Date | null }>();
      for (const g of grades) {
        const cur = stats.get(g.studentId) ?? { count: 0, sumPct: 0, numScored: 0, last: null };
        cur.count += 1;
        if (!g.isAbsent && g.value != null) {
          const max = Number(g.assessment.maxScore);
          const val = Number(g.value);
          if (max > 0) {
            cur.sumPct += (val / max) * 100;
            cur.numScored += 1;
          }
        }
        if (!cur.last || g.updatedAt > cur.last) cur.last = g.updatedAt;
        stats.set(g.studentId, cur);
      }
      for (const [sid, s] of stats) {
        const row = byStudent.get(sid);
        if (!row) continue;
        row.gradesCount = s.count;
        row.lastGradeAt = s.last ? s.last.toISOString() : null;
        row.avgPct = s.numScored > 0 ? Math.round((s.sumPct / s.numScored) * 10) / 10 : null;
      }
    }

    // 5. Build a small classes summary so the page can populate the class filter
    const classesSummary = [...new Map(
      enrollments.map((e) => [
        e.classSection.id,
        {
          id: e.classSection.id,
          name: e.classSection.name,
          gradeLevelName: e.classSection.gradeLevel.name,
        },
      ]),
    ).values()].sort((a, b) => a.name.localeCompare(b.name));

    return { data: [...byStudent.values()], count: byStudent.size, classesSummary };
  }

  /**
   * Latest grades the teacher has access to (published or draft for their own
   * assessments). Used by `/teacher/grades` "global view" page.
   */
  @Get('me/recent-grades')
  @RequiresPermission('grades.read')
  async myRecentGrades(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('limit') limitRaw?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.teachers.ensureForUser(me);
    const limit = Math.min(100, Math.max(1, parseInt(limitRaw ?? '50', 10) || 50));

    const grades = await this.prisma.grade.findMany({
      where: {
        tenantId: me.tenantId,
        assessment: { teacherProfileId: teacher.id },
      },
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        assessment: {
          include: {
            teachingAssignment: {
              include: {
                classSection: { select: { id: true, name: true } },
                subject: { select: { id: true, code: true, name: true, color: true } },
              },
            },
            term: { select: { id: true, name: true } },
          },
        },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: limit,
    });

    return { data: grades, count: grades.length };
  }

  @Get(':id')
  @RequiresPermission('teachers.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.prisma.teacherProfile.findUnique({
      where: { id },
      include: {
        userProfile: { select: { id: true, firstName: true, lastName: true, email: true, photoUrl: true } },
        teachingAssignments: {
          include: {
            classSection: { include: { gradeLevel: { include: { cycle: true } } } },
            subject: { select: { id: true, name: true, color: true } },
            academicYear: { select: { id: true, name: true, status: true } },
          },
          orderBy: { academicYear: { startDate: 'desc' } },
        },
      },
    });
    if (!teacher || teacher.tenantId !== me.tenantId) throw new NotFoundException();
    return teacher;
  }

  /**
   * Charge de l'enseignant — KPI de couverture élèves.
   *
   * Retourne le pourcentage d'élèves uniques suivis par cet enseignant
   * (au sens de l'année académique active) par rapport au total des élèves
   * actifs de l'établissement.
   *
   * Métriques complémentaires :
   *   - uniqueStudents  : nb d'élèves uniques (dédoublonnés) inscrits dans les
   *                       classes de l'enseignant (via ses TeachingAssignments)
   *   - totalStudents   : nb total d'élèves actifs de l'école
   *   - loadPct         : uniqueStudents / totalStudents × 100 (arrondi 1 décimale)
   *   - distinctClasses : nb de ClassSection distinctes dans l'année active
   *   - distinctSubjects: nb de matières distinctes dans l'année active
   *   - weeklyHours     : cumul des heures hebdomadaires (année active)
   *   - mainTeacherCount: nb de classes où l'enseignant est prof. principal
   */
  @Get(':id/load')
  @RequiresPermission('teachers.read')
  async getLoad(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId, activeAcademicYearId } = await this.ctx.forUser(me);

    // Vérifier que le profil enseignant appartient bien au tenant du demandeur
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { id } });
    if (!teacher || teacher.tenantId !== me.tenantId) throw new NotFoundException();

    // 1. Récupérer les affectations de l'enseignant pour l'année active
    const assignments = activeAcademicYearId
      ? await this.prisma.teachingAssignment.findMany({
          where: {
            tenantId: me.tenantId,
            teacherProfileId: id,
            academicYearId: activeAcademicYearId,
          },
          select: {
            classSectionId: true,
            subjectId: true,
            weeklyHours: true,
            isMainTeacher: true,
          },
        })
      : [];

    const classIds = [...new Set(assignments.map((a) => a.classSectionId))];

    // 2. Compter les élèves uniques suivis par cet enseignant
    //    (inscrits et actifs dans l'une de ses classes)
    let uniqueStudents = 0;
    if (classIds.length > 0 && activeAcademicYearId) {
      const enrollments = await this.prisma.enrollment.findMany({
        where: {
          tenantId: me.tenantId,
          academicYearId: activeAcademicYearId,
          status: 'active',
          classSectionId: { in: classIds },
        },
        select: { studentId: true },
      });
      uniqueStudents = new Set(enrollments.map((e) => e.studentId)).size;
    }

    // 3. Compter le total des élèves actifs de l'établissement
    const totalStudents = await this.prisma.enrollment.count({
      where: {
        tenantId: me.tenantId,
        ...(activeAcademicYearId ? { academicYearId: activeAcademicYearId } : {}),
        status: 'active',
        student: { schoolId },
      },
    });

    // 4. Calculer le pourcentage de charge
    const loadPct = totalStudents > 0
      ? Math.round((uniqueStudents / totalStudents) * 1000) / 10  // arrondi à 1 décimale
      : 0;

    // 5. Métriques complémentaires
    const distinctClasses = classIds.length;
    const distinctSubjects = new Set(assignments.map((a) => a.subjectId)).size;
    const weeklyHours = assignments.reduce((s, a) => s + Number(a.weeklyHours ?? 0), 0);
    const mainTeacherCount = assignments.filter((a) => a.isMainTeacher).length;

    return {
      teacherProfileId: id,
      activeAcademicYearId,
      uniqueStudents,
      totalStudents,
      loadPct,
      distinctClasses,
      distinctSubjects,
      weeklyHours,
      mainTeacherCount,
    };
  }

  @Patch(':id')
  @RequiresPermission('teachers.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTeacherDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const teacher = await this.prisma.teacherProfile.findUnique({ where: { id } });
    if (!teacher || teacher.tenantId !== me.tenantId) throw new NotFoundException();
    return this.prisma.teacherProfile.update({
      where: { id },
      data: {
        ...(body.specialty !== undefined ? { specialty: body.specialty } : {}),
        ...(body.externalRef !== undefined ? { externalRef: body.externalRef || null } : {}),
        ...(body.hiredAt !== undefined ? { hiredAt: body.hiredAt ? new Date(body.hiredAt) : null } : {}),
        ...(body.active !== undefined ? { active: body.active } : {}),
        ...(body.notes !== undefined ? { notes: body.notes } : {}),
      },
    });
  }
}
