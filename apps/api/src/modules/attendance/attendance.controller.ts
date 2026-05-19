import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AttendanceStatus } from '@prisma/client';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Matches,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

class OpenSessionDto {
  @IsUUID() teachingAssignmentId!: string;
  @IsDateString() date!: string;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) startTime?: string;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) endTime?: string;
  @IsOptional() @IsString() @MaxLength(200) topic?: string;
  @IsOptional() @IsBoolean() cancelled?: boolean;
}

class AttendanceItem {
  @IsUUID() studentId!: string;
  @IsEnum(AttendanceStatus) status!: AttendanceStatus;
  @IsOptional() @IsString() @Matches(/^\d{1,2}:\d{2}$/) arrivedAt?: string;
  @IsOptional() @IsString() @MaxLength(300) comment?: string;
}

class BatchAttendanceDto {
  @IsUUID() classSessionId!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true })
  @Type(() => AttendanceItem)
  records!: AttendanceItem[];
}

class JustifyDto {
  @IsString() @MaxLength(500) justification!: string;
}

@ApiTags('attendance')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class AttendanceController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
  ) {}

  // -------- Class sessions --------

  /**
   * List past class sessions for a teaching assignment with per-session
   * attendance counts. Used by the teacher attendance workspace to show
   * historic sessions + student-leaderboard data. Sorted by date desc.
   */
  @Get('class-sessions')
  @RequiresPermission('class_sessions.read')
  async listSessions(
    @Query('teachingAssignmentId') teachingAssignmentId: string | undefined,
    @Query('limit') limitStr: string | undefined,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    if (!teachingAssignmentId) {
      throw new BadRequestException('teachingAssignmentId requis.');
    }
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id: teachingAssignmentId },
      include: {
        classSection: {
          include: {
            enrollments: {
              where: { status: 'active' },
              select: { studentId: true },
            },
          },
        },
      },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException('Affectation introuvable.');
    await this.assertOwnership(a.teacherProfileId, me, jwt);

    const parsedLimit = parseInt(limitStr ?? '200', 10);
    const limit = Number.isFinite(parsedLimit)
      ? Math.min(Math.max(parsedLimit, 1), 500)
      : 200;

    const sessions = await this.prisma.classSession.findMany({
      where: { tenantId: me.tenantId, teachingAssignmentId: a.id },
      orderBy: { date: 'desc' },
      take: limit,
      include: {
        attendanceRecords: {
          select: { status: true, studentId: true, justification: true },
        },
      },
    });

    // Per-student leaderboard from the windowed sessions.
    const studentStats = new Map<
      string,
      { absent: number; absentExcused: number; late: number; leftEarly: number; sessions: number }
    >();
    for (const s of sessions) {
      const seenInSession = new Set<string>();
      for (const r of s.attendanceRecords) {
        seenInSession.add(r.studentId);
        const cur = studentStats.get(r.studentId) ?? {
          absent: 0,
          absentExcused: 0,
          late: 0,
          leftEarly: 0,
          sessions: 0,
        };
        if (r.status === 'absent') cur.absent += 1;
        else if (r.status === 'absent_excused') cur.absentExcused += 1;
        else if (r.status === 'late') cur.late += 1;
        else if (r.status === 'left_early') cur.leftEarly += 1;
        studentStats.set(r.studentId, cur);
      }
      for (const studentId of seenInSession) {
        const cur = studentStats.get(studentId)!;
        cur.sessions += 1;
      }
    }

    const studentIds = Array.from(studentStats.keys());
    const students = studentIds.length
      ? await this.prisma.student.findMany({
          where: { id: { in: studentIds }, tenantId: me.tenantId },
          select: { id: true, firstName: true, lastName: true, externalRef: true },
        })
      : [];

    return {
      classSize: a.classSection.enrollments.length,
      sessions: sessions.map((s) => {
        const counts = s.attendanceRecords.reduce(
          (acc, r) => {
            acc[r.status] = (acc[r.status] ?? 0) + 1;
            return acc;
          },
          {} as Record<string, number>,
        );
        const unjustifiedAbsences = s.attendanceRecords.filter(
          (r) => r.status === 'absent' && (!r.justification || r.justification.trim() === ''),
        ).length;
        return {
          id: s.id,
          date: s.date,
          startTime: s.startTime,
          endTime: s.endTime,
          topic: s.topic,
          cancelled: s.cancelled,
          recordedTotal: s.attendanceRecords.length,
          counts: {
            present: counts.present ?? 0,
            absent: counts.absent ?? 0,
            absentExcused: counts.absent_excused ?? 0,
            late: counts.late ?? 0,
            leftEarly: counts.left_early ?? 0,
          },
          unjustifiedAbsences,
        };
      }),
      students: students.map((st) => ({
        ...st,
        stats: studentStats.get(st.id) ?? {
          absent: 0,
          absentExcused: 0,
          late: 0,
          leftEarly: 0,
          sessions: 0,
        },
      })),
    };
  }

  /** Opens (or returns existing) the session for a (teachingAssignment, date) — idempotent. */
  @Post('class-sessions/open')
  @RequiresPermission('class_sessions.write')
  async openSession(@Body() body: OpenSessionDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.teachingAssignment.findUnique({
      where: { id: body.teachingAssignmentId },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException('Affectation introuvable.');
    await this.assertOwnership(a.teacherProfileId, me, jwt);

    const date = new Date(body.date);
    const existing = await this.prisma.classSession.findFirst({
      where: { teachingAssignmentId: a.id, date },
    });
    if (existing) {
      return this.prisma.classSession.update({
        where: { id: existing.id },
        data: {
          startTime: body.startTime ?? existing.startTime,
          endTime: body.endTime ?? existing.endTime,
          topic: body.topic ?? existing.topic,
          cancelled: body.cancelled ?? existing.cancelled,
        },
      });
    }
    return this.prisma.classSession.create({
      data: {
        tenantId: me.tenantId,
        teachingAssignmentId: a.id,
        teacherProfileId: a.teacherProfileId,
        date,
        startTime: body.startTime,
        endTime: body.endTime,
        topic: body.topic,
        cancelled: body.cancelled ?? false,
      },
    });
  }

  @Get('class-sessions/:id')
  @RequiresPermission('class_sessions.read')
  async sessionDetail(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const s = await this.prisma.classSession.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: { include: { enrollments: { where: { status: 'active' }, include: { student: true } } } },
            subject: { select: { id: true, name: true, color: true } },
          },
        },
        attendanceRecords: { include: { student: true } },
      },
    });
    if (!s || s.tenantId !== me.tenantId) throw new NotFoundException();
    return s;
  }

  // -------- Attendance records --------

  /** Records attendance for a session. Upserts so it's safe to re-submit. */
  @Post('attendance/batch')
  @RequiresPermission('attendance.write')
  async batch(@Body() body: BatchAttendanceDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const session = await this.prisma.classSession.findUnique({
      where: { id: body.classSessionId },
      include: {
        teachingAssignment: { include: { classSection: { include: { enrollments: { where: { status: 'active' } } } } } },
      },
    });
    if (!session || session.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(session.teacherProfileId, me, jwt);

    const enrolled = new Set(
      session.teachingAssignment.classSection.enrollments.map((e) => e.studentId),
    );
    const bad = body.records.find((r) => !enrolled.has(r.studentId));
    if (bad) throw new BadRequestException(`L'élève ${bad.studentId} n'est pas inscrit dans cette classe.`);

    const ops = body.records.map((r) =>
      this.prisma.attendanceRecord.upsert({
        where: { classSessionId_studentId: { classSessionId: session.id, studentId: r.studentId } },
        create: {
          tenantId: me.tenantId,
          classSessionId: session.id,
          studentId: r.studentId,
          status: r.status,
          arrivedAt: r.arrivedAt,
          comment: r.comment,
          recordedBy: me.id,
        },
        update: {
          status: r.status,
          arrivedAt: r.arrivedAt,
          comment: r.comment,
          recordedBy: me.id,
          recordedAt: new Date(),
        },
      }),
    );
    await this.prisma.$transaction(ops);
    return { ok: true, count: ops.length };
  }

  /** Mark an absence as justified — admin or teacher of the class. */
  @Post('attendance/:id/justify')
  @RequiresPermission('attendance.justify')
  async justify(
    @Param('id') id: string,
    @Body() body: JustifyDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const rec = await this.prisma.attendanceRecord.findUnique({
      where: { id },
      include: { classSession: true },
    });
    if (!rec || rec.tenantId !== me.tenantId) throw new NotFoundException();
    if (rec.status !== 'absent' && rec.status !== 'late') {
      throw new BadRequestException('Seules absences/retards peuvent être justifiés.');
    }
    return this.prisma.attendanceRecord.update({
      where: { id },
      data: {
        status: rec.status === 'absent' ? 'absent_excused' : rec.status,
        justification: body.justification.trim(),
        justifiedBy: me.id,
        justifiedAt: new Date(),
      },
    });
  }

  /** Per-student attendance feed. Used by parent portal + student profile. */
  @Get('attendance/students/:studentId')
  @RequiresPermission('attendance.read')
  async studentAttendance(
    @Param('studentId') studentId: string,
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const student = await this.prisma.student.findUnique({ where: { id: studentId } });
    if (!student || student.tenantId !== me.tenantId) throw new NotFoundException();

    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('parent')) {
      const gship = await this.prisma.guardianship.findFirst({
        where: { tenantId: me.tenantId, studentId, status: 'active', guardian: { userProfileId: me.id } },
      });
      if (!gship) throw new ForbiddenException();
    }

    const records = await this.prisma.attendanceRecord.findMany({
      where: {
        studentId,
        tenantId: me.tenantId,
        ...(from || to
          ? {
              classSession: {
                date: {
                  ...(from ? { gte: new Date(from) } : {}),
                  ...(to ? { lte: new Date(to) } : {}),
                },
              },
            }
          : {}),
      },
      include: {
        classSession: {
          include: {
            teachingAssignment: {
              include: {
                subject: { select: { id: true, name: true, color: true } },
                classSection: { select: { id: true, name: true } },
              },
            },
          },
        },
      },
      orderBy: { classSession: { date: 'desc' } },
    });

    // Compute summary
    const summary = {
      total: records.length,
      present: records.filter((r) => r.status === 'present').length,
      absent: records.filter((r) => r.status === 'absent').length,
      absentExcused: records.filter((r) => r.status === 'absent_excused').length,
      late: records.filter((r) => r.status === 'late').length,
      leftEarly: records.filter((r) => r.status === 'left_early').length,
    };

    return { records, summary };
  }

  /** Per-class roster + their attendance for a given date (teacher's view when taking attendance). */
  @Get('class-sessions/:id/roster')
  @RequiresPermission('attendance.read')
  async roster(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const session = await this.prisma.classSession.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: {
              include: {
                enrollments: {
                  where: { status: 'active' },
                  include: { student: true },
                  orderBy: { student: { lastName: 'asc' } },
                },
              },
            },
          },
        },
        attendanceRecords: true,
      },
    });
    if (!session || session.tenantId !== me.tenantId) throw new NotFoundException();

    const recordByStudent = new Map(session.attendanceRecords.map((r) => [r.studentId, r]));
    return {
      session: {
        id: session.id,
        date: session.date,
        startTime: session.startTime,
        endTime: session.endTime,
        topic: session.topic,
        cancelled: session.cancelled,
      },
      roster: session.teachingAssignment.classSection.enrollments.map((e) => ({
        enrollmentId: e.id,
        student: e.student,
        record: recordByStudent.get(e.studentId) ?? null,
      })),
    };
  }

  private async assertOwnership(
    teacherProfileId: string,
    me: { id: string; tenantId: string },
    jwt: KeycloakJwtPayload,
  ) {
    const roles = jwt.realm_access?.roles ?? [];
    if (roles.includes('super_admin') || roles.includes('school_admin')) return;
    const tp = await this.teachers.ensureForUser(me);
    if (teacherProfileId !== tp.id) {
      throw new ForbiddenException('Vous ne pouvez ouvrir une séance que sur vos affectations.');
    }
  }

  /**
   * Admin attendance overview — aggregates today + recent records for the
   * `/admin/attendance` page (KPI strip + recent records table).
   * Returns at most 50 most-recent records.
   */
  @Get('attendance/overview')
  @RequiresPermission('attendance.read')
  async overview(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

    // Today's attendance counts (one query, count by status)
    const todayRecords = await this.prisma.attendanceRecord.findMany({
      where: {
        tenantId: me.tenantId,
        classSession: { date: { gte: today, lt: tomorrow } },
      },
      select: { status: true, justification: true },
    });
    const counts = todayRecords.reduce(
      (acc, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const unjustifiedAbsences = todayRecords.filter(
      (r) => r.status === 'absent' && (!r.justification || r.justification.trim() === ''),
    ).length;

    // Recent 50 attendance records across the establishment
    const recent = await this.prisma.attendanceRecord.findMany({
      where: { tenantId: me.tenantId },
      orderBy: { recordedAt: 'desc' },
      take: 50,
      include: {
        student: { select: { id: true, firstName: true, lastName: true } },
        classSession: {
          select: {
            id: true,
            date: true,
            teachingAssignment: {
              select: {
                classSection: { select: { id: true, name: true } },
                subject: { select: { name: true } },
              },
            },
          },
        },
      },
    });

    return {
      kpis: {
        present: counts.present ?? 0,
        absent: counts.absent ?? 0,
        late: counts.late ?? 0,
        leftEarly: counts.left_early ?? 0,
        excused: counts.absent_excused ?? 0,
        unjustifiedAbsences,
      },
      records: recent.map((r) => ({
        id: r.id,
        status: r.status,
        justification: r.justification,
        createdAt: r.recordedAt.toISOString(),
        student: r.student,
        date: r.classSession.date.toISOString(),
        classSectionName: r.classSession.teachingAssignment.classSection.name,
        subjectName: r.classSession.teachingAssignment.subject.name,
      })),
    };
  }
}
