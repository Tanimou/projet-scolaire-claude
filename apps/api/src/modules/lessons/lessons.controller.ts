import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { LessonStatus } from '@prisma/client';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { TeacherProfileService } from '../teaching/teacher-profile.service';

class CreateLessonDto {
  @IsUUID() teachingAssignmentId!: string;
  @IsOptional() @IsUUID() classSessionId?: string;
  @IsDateString() date!: string;
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MaxLength(10000) content!: string;
  @IsOptional() @IsString() @MaxLength(5000) homework?: string;
  @IsOptional() @IsDateString() homeworkDueAt?: string;
  @IsOptional() @IsEnum(LessonStatus) status?: LessonStatus;
  @IsOptional() @IsArray() attachments?: unknown[];
}

class UpdateLessonDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) content?: string;
  @IsOptional() @IsString() @MaxLength(5000) homework?: string;
  @IsOptional() @IsDateString() homeworkDueAt?: string;
  @IsOptional() @IsEnum(LessonStatus) status?: LessonStatus;
  @IsOptional() @IsArray() attachments?: unknown[];
}

@ApiTags('lessons')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('lessons')
export class LessonsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly teachers: TeacherProfileService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Fan-out to every active guardian of every student enrolled in the lesson's
   * class section. Called from `create` (when status='published') and from
   * `update` (when status transitions to 'published').
   */
  private async notifyOnLessonPublished(args: {
    tenantId: string;
    lessonId: string;
    teachingAssignmentId: string;
    title: string;
    hasHomework: boolean;
  }): Promise<void> {
    try {
      const ta = await this.prisma.teachingAssignment.findUnique({
        where: { id: args.teachingAssignmentId },
        include: {
          classSection: {
            include: {
              enrollments: {
                where: { status: 'active' },
                select: {
                  studentId: true,
                  student: {
                    select: {
                      firstName: true,
                      guardianships: {
                        where: { status: 'active', guardian: { userProfileId: { not: null } } },
                        select: {
                          guardian: { select: { userProfileId: true } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          subject: { select: { name: true } },
        },
      });
      if (!ta) return;

      const items: Parameters<typeof this.notifications.createMany>[0] = [];
      const seenRecipients = new Set<string>();
      for (const e of ta.classSection.enrollments) {
        for (const g of e.student.guardianships) {
          const uid = g.guardian.userProfileId;
          if (!uid || seenRecipients.has(uid)) continue;
          seenRecipients.add(uid);
          items.push({
            tenantId: args.tenantId,
            userProfileId: uid,
            kind: 'lesson_published',
            severity: args.hasHomework ? 'warning' : 'info',
            title: `Cahier de texte mis à jour — ${ta.subject.name}`,
            body: args.hasHomework
              ? `Nouveau devoir à faire : ${args.title}`
              : args.title,
            link: `/parent/lessons`,
            sourceType: 'lesson',
            sourceId: args.lessonId,
          });
        }
      }
      if (items.length > 0) {
        await this.notifications.createMany(items);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[lessons] notification fan-out failed', err);
    }
  }

  /**
   * Lists lessons. Filters:
   *   - teachingAssignmentId (teacher's specific class+subject)
   *   - classSectionId (all subjects for one class — parent view)
   *   - studentId (all lessons the student should care about, joined via active enrollment)
   *   - from / to (date range)
   *   - mine=true → only logged-in teacher's lessons
   *
   * Parents only ever see lessons with status='published'.
   */
  @Get()
  @RequiresPermission('lessons.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('teachingAssignmentId') teachingAssignmentId?: string,
    @Query('classSectionId') classSectionId?: string,
    @Query('studentId') studentId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('mine') mine?: string,
    @Query('limit') limit?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const roles = jwt.realm_access?.roles ?? [];
    const isStaff =
      roles.includes('super_admin') || roles.includes('school_admin') || roles.includes('teacher');

    const where: Record<string, unknown> = { tenantId: me.tenantId };
    if (!isStaff) where.status = 'published';

    if (mine === 'true' && roles.includes('teacher')) {
      const tp = await this.teachers.ensureForUser(me);
      where.teacherProfileId = tp.id;
    }
    if (teachingAssignmentId) where.teachingAssignmentId = teachingAssignmentId;
    if (classSectionId) where.teachingAssignment = { classSectionId };
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to ? { lte: new Date(to) } : {}),
      };
    }
    if (studentId) {
      // Restrict to lessons of classes the student is enrolled in (any year).
      // ABAC: parent must be guardian of that student.
      if (roles.includes('parent')) {
        const gship = await this.prisma.guardianship.findFirst({
          where: { tenantId: me.tenantId, studentId, status: 'active', guardian: { userProfileId: me.id } },
        });
        if (!gship) throw new ForbiddenException("Vous n'avez pas accès à cet élève.");
      }
      const enrollments = await this.prisma.enrollment.findMany({
        where: { studentId, tenantId: me.tenantId },
        select: { classSectionId: true },
      });
      where.teachingAssignment = {
        classSectionId: { in: enrollments.map((e) => e.classSectionId) },
      };
    }

    return {
      data: await this.prisma.lessonEntry.findMany({
        where,
        orderBy: { date: 'desc' },
        take: Math.min(parseInt(limit ?? '100', 10) || 100, 500),
        include: {
          teachingAssignment: {
            include: {
              classSection: { select: { id: true, name: true } },
              subject: { select: { id: true, name: true, color: true } },
            },
          },
          teacherProfile: {
            include: { userProfile: { select: { firstName: true, lastName: true } } },
          },
        },
      }),
    };
  }

  @Get(':id')
  @RequiresPermission('lessons.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const lesson = await this.prisma.lessonEntry.findUnique({
      where: { id },
      include: {
        teachingAssignment: {
          include: {
            classSection: { include: { gradeLevel: { include: { cycle: true } } } },
            subject: true,
          },
        },
        teacherProfile: { include: { userProfile: { select: { firstName: true, lastName: true } } } },
      },
    });
    if (!lesson || lesson.tenantId !== me.tenantId) throw new NotFoundException();
    const roles = jwt.realm_access?.roles ?? [];
    if (!roles.includes('super_admin') && !roles.includes('school_admin') && !roles.includes('teacher')) {
      if (lesson.status !== 'published') throw new ForbiddenException();
    }
    return lesson;
  }

  @Post()
  @RequiresPermission('lessons.write')
  async create(@Body() body: CreateLessonDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const assignment = await this.prisma.teachingAssignment.findUnique({
      where: { id: body.teachingAssignmentId },
    });
    if (!assignment || assignment.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(assignment.teacherProfileId, me, jwt);

    const lesson = await this.prisma.lessonEntry.create({
      data: {
        tenantId: me.tenantId,
        teachingAssignmentId: assignment.id,
        teacherProfileId: assignment.teacherProfileId,
        classSessionId: body.classSessionId,
        date: new Date(body.date),
        title: body.title.trim(),
        content: body.content,
        homework: body.homework,
        homeworkDueAt: body.homeworkDueAt ? new Date(body.homeworkDueAt) : undefined,
        status: body.status ?? 'published',
        attachments: (body.attachments ?? []) as never,
      },
    });

    if (lesson.status === 'published') {
      await this.notifyOnLessonPublished({
        tenantId: me.tenantId,
        lessonId: lesson.id,
        teachingAssignmentId: lesson.teachingAssignmentId,
        title: lesson.title,
        hasHomework: !!lesson.homework,
      });
    }

    return lesson;
  }

  @Patch(':id')
  @RequiresPermission('lessons.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateLessonDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const lesson = await this.prisma.lessonEntry.findUnique({ where: { id } });
    if (!lesson || lesson.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(lesson.teacherProfileId, me, jwt);

    const wasDraft = lesson.status !== 'published';
    const updated = await this.prisma.lessonEntry.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.content !== undefined ? { content: body.content } : {}),
        ...(body.homework !== undefined ? { homework: body.homework } : {}),
        ...(body.homeworkDueAt !== undefined
          ? { homeworkDueAt: body.homeworkDueAt ? new Date(body.homeworkDueAt) : null }
          : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.attachments !== undefined ? { attachments: body.attachments as never } : {}),
      },
    });

    if (wasDraft && updated.status === 'published') {
      await this.notifyOnLessonPublished({
        tenantId: me.tenantId,
        lessonId: updated.id,
        teachingAssignmentId: updated.teachingAssignmentId,
        title: updated.title,
        hasHomework: !!updated.homework,
      });
    }

    return updated;
  }

  @Delete(':id')
  @RequiresPermission('lessons.delete')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const lesson = await this.prisma.lessonEntry.findUnique({ where: { id } });
    if (!lesson || lesson.tenantId !== me.tenantId) throw new NotFoundException();
    await this.assertOwnership(lesson.teacherProfileId, me, jwt);
    await this.prisma.lessonEntry.delete({ where: { id } });
    return { ok: true };
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
      throw new ForbiddenException('Vous ne pouvez modifier que vos propres entrées.');
    }
  }
}
