import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AnnouncementPriority, AnnouncementScope } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
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
import { SchoolContextService } from '../school-structure/school-context.service';

import { AnnouncementRecipientsService } from './announcements.service';

class CreateAnnouncementDto {
  @IsString() @MinLength(1) @MaxLength(200) title!: string;
  @IsString() @MinLength(1) @MaxLength(10000) body!: string;
  @IsEnum(AnnouncementScope) scope!: AnnouncementScope;
  @IsOptional() @IsEnum(AnnouncementPriority) priority?: AnnouncementPriority;
  @IsOptional() @IsUUID() cycleId?: string;
  @IsOptional() @IsUUID() gradeLevelId?: string;
  @IsOptional() @IsUUID() classSectionId?: string;
  @IsOptional() @IsUUID() studentId?: string;
  @IsOptional() @IsUUID() userProfileId?: string;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsArray() attachments?: unknown[];
  @IsOptional() @IsBoolean() publishNow?: boolean;
}

class UpdateAnnouncementDto {
  @IsOptional() @IsString() @MaxLength(200) title?: string;
  @IsOptional() @IsString() @MaxLength(10000) body?: string;
  @IsOptional() @IsEnum(AnnouncementPriority) priority?: AnnouncementPriority;
  @IsOptional() @IsDateString() expiresAt?: string;
  @IsOptional() @IsBoolean() pinned?: boolean;
  @IsOptional() @IsArray() attachments?: unknown[];
}

@ApiTags('announcements')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('announcements')
export class AnnouncementsController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
    private readonly recipients: AnnouncementRecipientsService,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * Lists announcements:
   *   - staff admins see ALL announcements of the school (including drafts authored by others)
   *   - teachers with `mine=true` see their OWN authored announcements (drafts + published)
   *   - everyone else (and teachers without `mine`) see ONLY those targeted at them (via AnnouncementReceipt) AND published
   */
  @Get()
  @RequiresPermission('announcements.read')
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('onlyUnread') onlyUnread?: string,
    @Query('mine') mine?: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isTeacher = roles.includes('teacher');
    const onlyMine = mine === 'true';

    if (isAdmin && !onlyMine) {
      const data = await this.prisma.announcement.findMany({
        where: { tenantId: me.tenantId },
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          cycle: { select: { name: true } },
          gradeLevel: { select: { name: true } },
          classSection: { select: { name: true } },
          student: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { recipients: true } },
        },
      });
      return { data };
    }

    // `mine=true` — author-scoped view (used by teacher messaging center).
    // Returns the user's own announcements (drafts + published) with recipient counts.
    if (onlyMine && (isAdmin || isTeacher)) {
      const data = await this.prisma.announcement.findMany({
        where: { tenantId: me.tenantId, authorId: me.id },
        orderBy: [{ pinned: 'desc' }, { publishedAt: 'desc' }, { createdAt: 'desc' }],
        include: {
          cycle: { select: { name: true } },
          gradeLevel: { select: { name: true } },
          classSection: { select: { name: true } },
          student: { select: { id: true, firstName: true, lastName: true } },
          _count: { select: { recipients: true } },
        },
      });
      return { data };
    }

    // For non-staff (parents, teachers without mine=true) — only published & targeted at them
    const receipts = await this.prisma.announcementReceipt.findMany({
      where: {
        userProfileId: me.id,
        announcement: {
          tenantId: me.tenantId,
          publishedAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
        ...(onlyUnread === 'true' ? { readAt: null } : {}),
      },
      include: {
        announcement: {
          include: {
            cycle: { select: { name: true } },
            gradeLevel: { select: { name: true } },
            classSection: { select: { name: true } },
            student: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
      orderBy: [
        { announcement: { pinned: 'desc' } },
        { announcement: { publishedAt: 'desc' } },
      ],
    });
    return { data: receipts.map((r) => ({ ...r.announcement, readAt: r.readAt, receiptId: r.id })) };
  }

  @Get('unread-count')
  @RequiresPermission('announcements.read')
  async unreadCount(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const n = await this.prisma.announcementReceipt.count({
      where: {
        userProfileId: me.id,
        readAt: null,
        announcement: {
          tenantId: me.tenantId,
          publishedAt: { not: null },
          OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }],
        },
      },
    });
    return { unread: n };
  }

  @Get(':id')
  @RequiresPermission('announcements.read')
  async getOne(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({
      where: { id },
      include: {
        cycle: { select: { name: true } },
        gradeLevel: { select: { name: true } },
        classSection: { select: { name: true } },
        student: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();

    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isAuthor = a.authorId === me.id;

    if (!isAdmin && !isAuthor) {
      // Must have a receipt for this user
      const receipt = await this.prisma.announcementReceipt.findUnique({
        where: { announcementId_userProfileId: { announcementId: id, userProfileId: me.id } },
      });
      if (!receipt) throw new NotFoundException();
      // Auto-mark-as-read on detail open
      if (!receipt.readAt) {
        await this.prisma.announcementReceipt.update({
          where: { id: receipt.id },
          data: { readAt: new Date() },
        });
      }
      return { ...a, readAt: receipt.readAt ?? new Date() };
    }
    return a;
  }

  @Post()
  @RequiresPermission('announcements.write')
  async create(@Body() body: CreateAnnouncementDto, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const roles = jwt.realm_access?.roles ?? [];
    const isAdmin = roles.includes('super_admin') || roles.includes('school_admin');
    const isTeacher = roles.includes('teacher');
    const authorRoleHint = isAdmin ? 'admin' : isTeacher ? 'teacher' : null;

    // Validate scope payload
    this.validateScope(body);

    // Teachers can only broadcast to scopes that are part of their teaching footprint.
    // School-wide and individual_user are admin-only (those reach across the whole
    // organisation or arbitrary staff/parents and would bypass the teaching boundary).
    if (!isAdmin && isTeacher) {
      if (body.scope === 'school_wide' || body.scope === 'individual_user') {
        throw new BadRequestException(
          "Cette portée est réservée à l'administration. Choisissez une classe, un niveau ou un cycle où vous enseignez.",
        );
      }
      // For scope=class_section_scope, ensure the class is in the teacher's assignments
      if (body.scope === 'class_section_scope' && body.classSectionId) {
        const teacher = await this.prisma.teacherProfile.findFirst({
          where: { userProfileId: me.id },
          select: { id: true },
        });
        if (!teacher) throw new BadRequestException("Profil enseignant introuvable.");
        const assignment = await this.prisma.teachingAssignment.findFirst({
          where: {
            tenantId: me.tenantId,
            teacherProfileId: teacher.id,
            classSectionId: body.classSectionId,
          },
          select: { id: true },
        });
        if (!assignment) {
          throw new BadRequestException(
            "Vous ne pouvez diffuser une annonce qu'aux classes que vous enseignez.",
          );
        }
      }
    }

    const now = new Date();
    const created = await this.prisma.announcement.create({
      data: {
        tenantId: me.tenantId,
        schoolId,
        title: body.title.trim(),
        body: body.body,
        scope: body.scope,
        priority: body.priority ?? 'normal',
        cycleId: body.cycleId,
        gradeLevelId: body.gradeLevelId,
        classSectionId: body.classSectionId,
        studentId: body.studentId,
        userProfileId: body.userProfileId,
        expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
        pinned: body.pinned ?? false,
        authorId: me.id,
        authorRoleHint,
        attachments: (body.attachments ?? []) as never,
        publishedAt: body.publishNow ? now : null,
      },
    });

    if (body.publishNow) {
      await this.publishInternal(created.id);
    }
    return created;
  }

  @Patch(':id')
  @RequiresPermission('announcements.write')
  async update(
    @Param('id') id: string,
    @Body() body: UpdateAnnouncementDto,
    @CurrentJwt() jwt: KeycloakJwtPayload,
  ) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
      throw new BadRequestException("Vous ne pouvez modifier que vos propres annonces.");
    }
    return this.prisma.announcement.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title.trim() } : {}),
        ...(body.body !== undefined ? { body: body.body } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
        ...(body.expiresAt !== undefined
          ? { expiresAt: body.expiresAt ? new Date(body.expiresAt) : null }
          : {}),
        ...(body.pinned !== undefined ? { pinned: body.pinned } : {}),
        ...(body.attachments !== undefined ? { attachments: body.attachments as never } : {}),
      },
    });
  }

  @Post(':id/publish')
  @RequiresPermission('announcements.write')
  async publish(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.publishedAt) {
      return { ok: true, alreadyPublished: true, publishedAt: a.publishedAt };
    }
    return this.publishInternal(id);
  }

  @Post(':id/read')
  @RequiresPermission('announcements.read')
  async markRead(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const receipt = await this.prisma.announcementReceipt.findUnique({
      where: { announcementId_userProfileId: { announcementId: id, userProfileId: me.id } },
    });
    if (!receipt) throw new NotFoundException();
    if (receipt.readAt) return { ok: true, alreadyRead: true };
    await this.prisma.announcementReceipt.update({
      where: { id: receipt.id },
      data: { readAt: new Date() },
    });
    return { ok: true };
  }

  @Delete(':id')
  @RequiresPermission('announcements.write')
  async remove(@Param('id') id: string, @CurrentJwt() jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const a = await this.prisma.announcement.findUnique({ where: { id } });
    if (!a || a.tenantId !== me.tenantId) throw new NotFoundException();
    if (a.authorId !== me.id && !(jwt.realm_access?.roles ?? []).includes('school_admin')) {
      throw new BadRequestException("Vous ne pouvez supprimer que vos propres annonces.");
    }
    await this.prisma.announcement.delete({ where: { id } });
    return { ok: true };
  }

  private async publishInternal(id: string) {
    const a = await this.prisma.announcement.findUniqueOrThrow({ where: { id } });
    const recipients = await this.recipients.computeRecipients(a);
    const inserted = await this.recipients.materialiseReceipts(id, recipients);
    await this.prisma.announcement.update({
      where: { id },
      data: { publishedAt: a.publishedAt ?? new Date() },
    });

    // Fan out into the unified Notification feed (R8). Deduped on sourceId
    // so re-publishing the same announcement doesn't ping recipients twice.
    if (recipients.size > 0) {
      const severityFromPriority =
        a.priority === 'urgent'
          ? ('danger' as const)
          : a.priority === 'high'
            ? ('warning' as const)
            : ('info' as const);
      await this.notifications.createMany(
        [...recipients].map((userProfileId) => ({
          tenantId: a.tenantId,
          userProfileId,
          kind: 'announcement' as const,
          severity: severityFromPriority,
          title: a.title,
          body: a.body ? a.body.slice(0, 280) : null,
          link: `/parent/announcements`,
          sourceType: 'announcement',
          sourceId: a.id,
        })),
      );
    }

    return { ok: true, publishedAt: new Date(), recipientCount: inserted };
  }

  private validateScope(b: CreateAnnouncementDto) {
    const ensure = (k: keyof CreateAnnouncementDto) => {
      if (!b[k]) throw new BadRequestException(`Champ requis : ${String(k)} pour cette portée.`);
    };
    switch (b.scope) {
      case 'cycle_scope':
        ensure('cycleId');
        break;
      case 'grade_level_scope':
        ensure('gradeLevelId');
        break;
      case 'class_section_scope':
        ensure('classSectionId');
        break;
      case 'individual_student':
        ensure('studentId');
        break;
      case 'individual_user':
        ensure('userProfileId');
        break;
      case 'school_wide':
      default:
        break;
    }
  }
}
