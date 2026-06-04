import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type {
  AlertContextDto,
  ConversationDto,
  ConversationInboxResponse,
  ConversationMessageDto,
  ConversationMessagePage,
  ConversationStatus,
  EligibleTeacherDto,
} from '@pilotage/contracts';

import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { StudentAccessService } from '../students/student-access.service';

/** The authenticated caller, as resolved by UserSyncService.ensureUser. */
type Caller = { id: string; tenantId: string };

type ParticipantRole = 'parent' | 'teacher';

/**
 * Parent ↔ teacher messaging spine (E2-S1).
 *
 * Dual-wall ABAC: a thread exists only for a (parent, teacher, child) triple
 * where the parent guards the child (StudentAccessService — the guardianship
 * half) AND the teacher currently teaches that child (`isTeacherOfStudent` — a
 * brand-new teaching wall; NEVER routed through StudentAccessService, whose
 * teacher scope is unrestricted). Both walls are re-checked at create AND every
 * send; a lapsed teaching wall flips the thread to `read_only` and 403s (history
 * preserved). Every query is tenant-scoped (`where: { tenantId }`); a cross-tenant
 * id resolves to 404 (never leaks existence). Create writes an append-only
 * AuditLog row; messages are immutable. Notifications are best-effort.
 */
@Injectable()
export class MessagingService {
  private readonly logger = new Logger(MessagingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentAccess: StudentAccessService,
    private readonly notifications: NotificationsService,
  ) {}

  // -------------------------------------------------------------------------
  // Teaching wall (PM-1 / PM-4 / PM-5): a standalone Prisma query. Resolves the
  // student's active Enrollment in the active academic year → (classSectionId,
  // academicYearId), then asserts a TeachingAssignment exists for that tuple
  // whose teacherProfile.userProfileId === the incoming teacher UserProfile id.
  // The incoming `teacherUserProfileId` is a UserProfile id, joined to
  // TeacherProfile via `teacherProfile: { userProfileId }` (NEVER compared to a
  // TeacherProfile id). Returns false (never throws) when there is no active
  // enrollment or no matching assignment — mirrors resolveMeetingAssignee.
  // -------------------------------------------------------------------------
  async isTeacherOfStudent(args: {
    tenantId: string;
    teacherUserProfileId: string;
    studentId: string;
  }): Promise<boolean> {
    try {
      const enrollment = await this.prisma.enrollment.findFirst({
        where: {
          tenantId: args.tenantId,
          studentId: args.studentId,
          status: 'active',
          academicYear: { status: 'active' },
        },
        orderBy: { enrolledAt: 'desc' },
        select: { classSectionId: true, academicYearId: true },
      });
      if (!enrollment) return false;

      const assignment = await this.prisma.teachingAssignment.findFirst({
        where: {
          tenantId: args.tenantId,
          classSectionId: enrollment.classSectionId,
          academicYearId: enrollment.academicYearId,
          teacherProfile: { userProfileId: args.teacherUserProfileId },
        },
        select: { id: true },
      });
      return assignment != null;
    } catch (err) {
      this.logger.error(
        `isTeacherOfStudent failed (student ${args.studentId}, teacher ${args.teacherUserProfileId}): ${(err as Error).message}`,
      );
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // GET /messaging/eligible-teachers?studentId=
  // -------------------------------------------------------------------------
  async listEligibleTeachers(args: {
    me: Caller;
    jwt: KeycloakJwtPayload;
    schoolId: string;
    studentId: string;
  }): Promise<{ data: EligibleTeacherDto[] }> {
    // 404 before 403: an out-of-tenant student id must not leak existence.
    const student = await this.prisma.student.findFirst({
      where: { id: args.studentId, tenantId: args.me.tenantId },
      select: { id: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    // Guardianship wall.
    const guards = await this.studentAccess.canAccessStudent(
      args.me,
      args.jwt,
      args.studentId,
      args.schoolId,
    );
    if (!guards) throw new ForbiddenException('Not a guardian of this student');

    // Resolve the active-year class section.
    const enrollment = await this.prisma.enrollment.findFirst({
      where: {
        tenantId: args.me.tenantId,
        studentId: args.studentId,
        status: 'active',
        academicYear: { status: 'active' },
      },
      orderBy: { enrolledAt: 'desc' },
      select: { classSectionId: true, academicYearId: true },
    });
    if (!enrollment) return { data: [] };

    // All assignments on that (class section, year) → distinct teacher profiles +
    // the subjects they teach the child. One grouped query (no client N+1).
    const assignments = await this.prisma.teachingAssignment.findMany({
      where: {
        tenantId: args.me.tenantId,
        classSectionId: enrollment.classSectionId,
        academicYearId: enrollment.academicYearId,
      },
      select: {
        isMainTeacher: true,
        subject: { select: { id: true, name: true } },
        teacherProfile: {
          select: {
            userProfile: { select: { id: true, firstName: true, lastName: true } },
          },
        },
      },
    });

    // Group by teacher UserProfile id.
    const byTeacher = new Map<
      string,
      {
        userProfileId: string;
        displayName: string;
        subjects: { subjectId: string; name: string }[];
        isMainTeacher: boolean;
      }
    >();
    for (const a of assignments) {
      const up = a.teacherProfile.userProfile;
      const existing = byTeacher.get(up.id);
      const subject = { subjectId: a.subject.id, name: a.subject.name };
      if (existing) {
        if (!existing.subjects.some((s) => s.subjectId === subject.subjectId)) {
          existing.subjects.push(subject);
        }
        existing.isMainTeacher = existing.isMainTeacher || a.isMainTeacher;
      } else {
        byTeacher.set(up.id, {
          userProfileId: up.id,
          displayName: `${up.firstName} ${up.lastName}`.trim(),
          subjects: [subject],
          isMainTeacher: a.isMainTeacher,
        });
      }
    }

    const teacherIds = [...byTeacher.keys()];
    if (teacherIds.length === 0) return { data: [] };

    // Existing threads for deep-linking (one grouped query keyed on @@unique tuple).
    const existing = await this.prisma.conversation.findMany({
      where: {
        tenantId: args.me.tenantId,
        parentId: args.me.id,
        studentId: args.studentId,
        teacherId: { in: teacherIds },
      },
      select: { id: true, teacherId: true },
    });
    const existingByTeacher = new Map(existing.map((c) => [c.teacherId, c.id]));

    const data: EligibleTeacherDto[] = [...byTeacher.values()].map((t) => ({
      userProfileId: t.userProfileId,
      displayName: t.displayName,
      subjects: t.subjects,
      isMainTeacher: t.isMainTeacher,
      existingConversationId: existingByTeacher.get(t.userProfileId) ?? null,
    }));
    return { data };
  }

  // -------------------------------------------------------------------------
  // POST /conversations — PARENT-only create-or-reuse (idempotent).
  // -------------------------------------------------------------------------
  async createConversation(args: {
    me: Caller;
    jwt: KeycloakJwtPayload;
    schoolId: string;
    actorRole: string | null;
    portal: string | null;
    studentId: string;
    teacherId: string;
    body: string;
    subjectId?: string | null;
    alertId?: string | null;
  }): Promise<{ conversation: ConversationDto; created: boolean }> {
    // 404-before-403: re-read student + teacher under {id, tenantId} guards.
    const student = await this.prisma.student.findFirst({
      where: { id: args.studentId, tenantId: args.me.tenantId },
      select: { id: true, schoolId: true, firstName: true, lastName: true },
    });
    if (!student) throw new NotFoundException('Student not found');

    const teacher = await this.prisma.userProfile.findFirst({
      where: { id: args.teacherId, tenantId: args.me.tenantId },
      select: { id: true, firstName: true, lastName: true },
    });
    if (!teacher) throw new NotFoundException('Teacher not found');

    // alertId never widens access: in-tenant + alert.studentId === request.studentId.
    let subjectId = args.subjectId ?? null;
    if (args.alertId) {
      const alert = await this.prisma.alertInstance.findFirst({
        where: { id: args.alertId, tenantId: args.me.tenantId },
        select: { studentId: true, subjectId: true },
      });
      if (!alert) throw new NotFoundException('Alert not found');
      if (alert.studentId !== args.studentId) {
        throw new BadRequestException('Alert does not concern this student');
      }
      // The stored alertId drives the read-time alertContext (resolveAlertContext).
      if (!subjectId) subjectId = alert.subjectId ?? null;
    }

    // Dual-wall ABAC at create.
    const guards = await this.studentAccess.canAccessStudent(
      args.me,
      args.jwt,
      args.studentId,
      args.schoolId,
    );
    if (!guards) throw new ForbiddenException('Not a guardian of this student');

    const teaches = await this.isTeacherOfStudent({
      tenantId: args.me.tenantId,
      teacherUserProfileId: args.teacherId,
      studentId: args.studentId,
    });
    if (!teaches) {
      throw new ForbiddenException('This teacher does not currently teach this student');
    }

    // Idempotent reuse: an existing thread is returned (200), body ignored.
    const existing = await this.findThread(args.me.tenantId, args.me.id, args.teacherId, args.studentId);
    if (existing) {
      return { conversation: await this.toConversationDto(existing.id, args.me.id), created: false };
    }

    const topic = args.body.trim().slice(0, 80);
    let conversationId: string;
    try {
      conversationId = await this.prisma.$transaction(async (tx) => {
        const conv = await tx.conversation.create({
          data: {
            tenantId: args.me.tenantId,
            schoolId: student.schoolId,
            studentId: args.studentId,
            parentId: args.me.id,
            teacherId: args.teacherId,
            subjectId,
            alertId: args.alertId ?? null,
            status: 'active',
            topic,
            createdBy: args.me.id,
          },
          select: { id: true, createdAt: true },
        });
        await tx.conversationParticipant.createMany({
          data: [
            {
              tenantId: args.me.tenantId,
              conversationId: conv.id,
              userProfileId: args.me.id,
              role: 'parent',
            },
            {
              tenantId: args.me.tenantId,
              conversationId: conv.id,
              userProfileId: args.teacherId,
              role: 'teacher',
            },
          ],
        });
        const message = await tx.conversationMessage.create({
          data: {
            tenantId: args.me.tenantId,
            conversationId: conv.id,
            senderId: args.me.id,
            senderRole: 'parent',
            body: args.body,
          },
          select: { id: true, createdAt: true },
        });
        await tx.conversation.update({
          where: { id: conv.id },
          data: { lastMessageAt: message.createdAt, lastMessageById: args.me.id },
        });
        return conv.id;
      });
    } catch (err) {
      // Concurrency (PM-6): a parallel create won the @@unique race. Fall back to
      // reading + returning the existing thread (200), body ignored.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const winner = await this.findThread(
          args.me.tenantId,
          args.me.id,
          args.teacherId,
          args.studentId,
        );
        if (winner) {
          return {
            conversation: await this.toConversationDto(winner.id, args.me.id),
            created: false,
          };
        }
      }
      throw err;
    }

    // Append-only audit row (best-effort, never rolls back the create).
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: args.me.tenantId,
          actorId: args.me.id,
          actorRole: args.actorRole,
          portal: args.portal,
          action: 'conversation.create',
          resourceType: 'conversation',
          resourceId: conversationId,
          after: {
            studentId: args.studentId,
            teacherId: args.teacherId,
            subjectId,
            alertId: args.alertId ?? null,
          } as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      this.logger.error(
        `Failed to write conversation.create audit row for ${conversationId} (create unaffected): ${(err as Error).message}`,
      );
    }

    // Notify the teacher in-app (best-effort).
    await this.notifyCounterpart({
      tenantId: args.me.tenantId,
      recipientId: args.teacherId,
      conversationId,
      senderName: `${student.firstName} ${student.lastName}`.trim(),
      // Deep-link the teacher to the conversation inbox (E2-S3), NOT the
      // teacher→family Announcements surface at /teacher/messages.
      portalLink: '/teacher/conversations',
    });

    return {
      conversation: await this.toConversationDto(conversationId, args.me.id),
      created: true,
    };
  }

  // -------------------------------------------------------------------------
  // POST /conversations/:id/messages — participant-only append with ABAC re-check.
  // -------------------------------------------------------------------------
  async sendMessage(args: {
    me: Caller;
    jwt: KeycloakJwtPayload;
    schoolId: string;
    conversationId: string;
    body: string;
  }): Promise<ConversationMessageDto> {
    // Re-read under {id, tenantId} with the caller's participant row — a missing
    // thread OR a non-participant caller both resolve to 404 (no existence leak).
    const conv = await this.prisma.conversation.findFirst({
      where: { id: args.conversationId, tenantId: args.me.tenantId },
      select: {
        id: true,
        status: true,
        studentId: true,
        parentId: true,
        teacherId: true,
        participants: { where: { userProfileId: args.me.id }, select: { role: true } },
      },
    });
    if (!conv || conv.participants.length === 0) {
      throw new NotFoundException('Conversation not found');
    }
    const senderRole = conv.participants[0]!.role as ParticipantRole;

    // Dual-wall ABAC re-checked on EVERY send (plan.md risk table). The two walls
    // are independent: guardianship gates the parent sender, while the teaching
    // wall is a property of the THREAD and is re-checked for BOTH directions —
    // otherwise a parent (whose guardianship still holds) could keep reaching, and
    // re-notifying, a teacher who has stopped teaching their child, with the thread
    // only freezing the next time that teacher happened to send.
    if (senderRole === 'parent') {
      const guards = await this.studentAccess.canAccessStudent(
        args.me,
        args.jwt,
        conv.studentId,
        args.schoolId,
      );
      if (!guards) throw new ForbiddenException('Not a guardian of this student');
    }

    const teaches = await this.isTeacherOfStudent({
      tenantId: args.me.tenantId,
      teacherUserProfileId: conv.teacherId,
      studentId: conv.studentId,
    });
    if (!teaches) {
      // Teaching wall lapsed: freeze the thread (history preserved) and 403,
      // symmetrically for parent and teacher senders.
      if (conv.status === 'active') {
        await this.prisma.conversation.update({
          where: { id: conv.id },
          data: { status: 'read_only' },
        });
      }
      throw new ForbiddenException('This teacher no longer teaches this student');
    }

    // Refuse send on a non-active thread.
    if (conv.status !== 'active') {
      throw new ForbiddenException('This conversation is read-only');
    }

    const recipientId = senderRole === 'parent' ? conv.teacherId : conv.parentId;

    const message = await this.prisma.$transaction(async (tx) => {
      const m = await tx.conversationMessage.create({
        data: {
          tenantId: args.me.tenantId,
          conversationId: conv.id,
          senderId: args.me.id,
          senderRole,
          body: args.body,
        },
        select: {
          id: true,
          conversationId: true,
          senderId: true,
          senderRole: true,
          body: true,
          createdAt: true,
          sender: { select: { firstName: true, lastName: true } },
        },
      });
      await tx.conversation.update({
        where: { id: conv.id },
        data: { lastMessageAt: m.createdAt, lastMessageById: args.me.id },
      });
      return m;
    });

    // Notify the OTHER participant in-app (best-effort, per-message sourceId).
    await this.notifyCounterpart({
      tenantId: args.me.tenantId,
      recipientId,
      conversationId: conv.id,
      sourceId: message.id,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      // Teacher recipient → conversation inbox (E2-S3); parent recipient → parent
      // messages. The teacher link is /teacher/conversations (the parent-initiated
      // thread inbox), NEVER the /teacher/messages Announcements surface.
      portalLink: senderRole === 'parent' ? '/teacher/conversations' : '/parent/messages',
    });

    return {
      id: message.id,
      conversationId: message.conversationId,
      senderId: message.senderId,
      senderRole: message.senderRole,
      senderName: `${message.sender.firstName} ${message.sender.lastName}`.trim(),
      body: message.body,
      createdAt: message.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  private findThread(tenantId: string, parentId: string, teacherId: string, studentId: string) {
    return this.prisma.conversation.findUnique({
      where: {
        tenantId_parentId_teacherId_studentId: { tenantId, parentId, teacherId, studentId },
      },
      select: { id: true },
    });
  }

  /**
   * Best-effort in-app notification of the other participant. A failure is
   * logged and swallowed — it never rolls back the create/send.
   * `sourceId` is per-message so every message re-notifies (PM-11); on create it
   * defaults to the conversation id (the first message).
   */
  private async notifyCounterpart(args: {
    tenantId: string;
    recipientId: string;
    conversationId: string;
    sourceId?: string;
    senderName: string;
    portalLink: string;
  }): Promise<void> {
    try {
      await this.notifications.createMany([
        {
          tenantId: args.tenantId,
          userProfileId: args.recipientId,
          kind: 'message',
          severity: 'info',
          title: 'Nouveau message',
          body: `${args.senderName} vous a envoyé un message`,
          link: args.portalLink,
          sourceType: 'conversation',
          sourceId: args.sourceId ?? args.conversationId,
        },
      ]);
    } catch (err) {
      this.logger.error(
        `Failed to notify ${args.recipientId} of conversation ${args.conversationId} (message unaffected): ${(err as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // GET /conversations — role-aware inbox aggregate (S2).
  //
  // Scoping is on the DENORMALISED participant columns, NEVER via
  // StudentAccessService.getAccessScope (PM-2: that scope is unrestricted for
  // teacher/admin and would leak foreign threads). A parent caller sees
  // parentId=me; a teacher caller sees teacherId=me; any other role sees nothing.
  //
  // No N+1 (PM-7): the page is fetched in one findMany, then unread counts for
  // ALL rows come from ONE grouped query, and previews/timestamps come from the
  // denormalised columns (no per-thread message join).
  // -------------------------------------------------------------------------
  async listConversations(args: {
    me: Caller;
    role: ParticipantRole | null;
    status?: ConversationStatus;
    limit: number;
    offset: number;
  }): Promise<ConversationInboxResponse> {
    if (args.role == null) return { data: [], total: 0 };

    const scopeWhere =
      args.role === 'parent'
        ? { parentId: args.me.id }
        : { teacherId: args.me.id };

    // Default to the visible set (active + read_only); explicit status narrows.
    const statusWhere: Prisma.ConversationWhereInput = args.status
      ? { status: args.status }
      : { status: { in: ['active', 'read_only'] } };

    const where: Prisma.ConversationWhereInput = {
      tenantId: args.me.tenantId,
      ...scopeWhere,
      ...statusWhere,
    };

    // Query 1: total for paging.
    // Query 2: the page (denormalised columns only — no message join).
    const [total, rows] = await Promise.all([
      this.prisma.conversation.count({ where }),
      this.prisma.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }],
        take: args.limit,
        skip: args.offset,
        select: {
          id: true,
          studentId: true,
          parentId: true,
          teacherId: true,
          subjectId: true,
          alertId: true,
          status: true,
          topic: true,
          lastMessageAt: true,
          createdAt: true,
          student: { select: { firstName: true, lastName: true } },
          parent: { select: { firstName: true, lastName: true } },
          teacher: { select: { firstName: true, lastName: true } },
          subject: { select: { name: true } },
          alert: { select: { id: true, code: true, title: true, studentId: true, subject: { select: { name: true } } } },
          participants: {
            where: { userProfileId: args.me.id },
            select: { lastReadAt: true },
          },
        },
      }),
    ]);

    if (rows.length === 0) return { data: [], total };

    const ids = rows.map((r) => r.id);

    // Query 3: unread messages across ALL rows in ONE pass. We fetch the small
    // (conversationId, createdAt) tuples of messages NOT authored by the caller,
    // then fold each against that thread's own lastReadAt in memory — groupBy
    // cannot express a per-thread `createdAt >` filter, so this is the bounded
    // shape (one query, capped by page size).
    const unreadRows = await this.prisma.conversationMessage.findMany({
      where: {
        tenantId: args.me.tenantId,
        conversationId: { in: ids },
        senderId: { not: args.me.id },
      },
      select: { conversationId: true, createdAt: true },
    });
    const lastReadByConv = new Map(
      rows.map((r) => [r.id, r.participants[0]?.lastReadAt ?? null]),
    );
    const unreadByConv = new Map<string, number>();
    for (const m of unreadRows) {
      const lastReadAt = lastReadByConv.get(m.conversationId) ?? null;
      if (lastReadAt && m.createdAt <= lastReadAt) continue;
      unreadByConv.set(m.conversationId, (unreadByConv.get(m.conversationId) ?? 0) + 1);
    }

    const data: ConversationDto[] = rows.map((r) => ({
      id: r.id,
      studentId: r.studentId,
      studentName: `${r.student.firstName} ${r.student.lastName}`.trim(),
      parentId: r.parentId,
      parentName: `${r.parent.firstName} ${r.parent.lastName}`.trim(),
      teacherId: r.teacherId,
      teacherName: `${r.teacher.firstName} ${r.teacher.lastName}`.trim(),
      subjectId: r.subjectId,
      subjectName: r.subject?.name ?? null,
      alertContext: this.resolveAlertContext(r.alert, r.studentId),
      status: r.status,
      topic: r.topic,
      lastMessageAt: r.lastMessageAt?.toISOString() ?? null,
      // Preview comes from `topic` (denormalised at create) — no per-thread join.
      lastMessagePreview: r.topic,
      unreadCount: unreadByConv.get(r.id) ?? 0,
      createdAt: r.createdAt.toISOString(),
    }));

    return { data, total };
  }

  // -------------------------------------------------------------------------
  // GET /conversations/:id — participant-only thread header DTO (S2).
  // A missing thread OR a non-participant caller (even a co-guardian of the same
  // child) → 404 (PM-1: no existence leak). Cross-tenant → 404.
  // -------------------------------------------------------------------------
  async getConversation(args: { me: Caller; conversationId: string }): Promise<ConversationDto> {
    const participant = await this.prisma.conversationParticipant.findFirst({
      where: {
        conversationId: args.conversationId,
        userProfileId: args.me.id,
        conversation: { tenantId: args.me.tenantId },
      },
      select: { id: true },
    });
    if (!participant) throw new NotFoundException('Conversation not found');
    return this.toConversationDto(args.conversationId, args.me.id);
  }

  // -------------------------------------------------------------------------
  // GET /conversations/:id/messages — participant-only paged messages (S2).
  // Returned oldest→newest within a page; `before` is an exclusive ISO cursor on
  // createdAt for "load previous". Index-covered by ([tenantId, conversationId,
  // createdAt]). limit hard-capped by the contract (1..200).
  // -------------------------------------------------------------------------
  async listMessages(args: {
    me: Caller;
    conversationId: string;
    limit: number;
    before?: string;
  }): Promise<ConversationMessagePage> {
    // Participant gate BEFORE any message read (PM-1/PM-8).
    const conv = await this.prisma.conversation.findFirst({
      where: { id: args.conversationId, tenantId: args.me.tenantId },
      select: {
        id: true,
        parentId: true,
        teacherId: true,
        participants: { select: { userProfileId: true, lastReadAt: true } },
      },
    });
    const mine = conv?.participants.find((p) => p.userProfileId === args.me.id);
    if (!conv || !mine) throw new NotFoundException('Conversation not found');

    const beforeDate = args.before ? new Date(args.before) : null;
    const messageWhere: Prisma.ConversationMessageWhereInput = {
      tenantId: args.me.tenantId,
      conversationId: conv.id,
      ...(beforeDate && !Number.isNaN(beforeDate.getTime())
        ? { createdAt: { lt: beforeDate } }
        : {}),
    };

    // Fetch the newest `limit+1` below the cursor (so we know `hasMore`), then
    // reverse to oldest→newest for rendering.
    const rows = await this.prisma.conversationMessage.findMany({
      where: messageWhere,
      orderBy: { createdAt: 'desc' },
      take: args.limit + 1,
      select: {
        id: true,
        conversationId: true,
        senderId: true,
        senderRole: true,
        body: true,
        createdAt: true,
        sender: { select: { firstName: true, lastName: true } },
      },
    });

    const hasMore = rows.length > args.limit;
    const page = (hasMore ? rows.slice(0, args.limit) : rows).reverse();

    // The counterpart's read anchor, for "Vu/Envoyé" receipts (no extra call).
    const counterpartId = args.me.id === conv.parentId ? conv.teacherId : conv.parentId;
    const counterpart = conv.participants.find((p) => p.userProfileId === counterpartId);

    return {
      data: page.map((m) => ({
        id: m.id,
        conversationId: m.conversationId,
        senderId: m.senderId,
        senderRole: m.senderRole,
        senderName: `${m.sender.firstName} ${m.sender.lastName}`.trim(),
        body: m.body,
        createdAt: m.createdAt.toISOString(),
      })),
      hasMore,
      counterpartLastReadAt: counterpart?.lastReadAt?.toISOString() ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // PATCH /conversations/:id/read — bump the caller's lastReadAt to server now()
  // (S2). Participant-only (PM-6): updates ONLY the caller's own participant row;
  // ignores any client timestamp; idempotent; never mutates thread status or any
  // message. Non-participant / cross-tenant → 404. No audit row (read state).
  // -------------------------------------------------------------------------
  async markRead(args: { me: Caller; conversationId: string }): Promise<{ ok: true }> {
    const result = await this.prisma.conversationParticipant.updateMany({
      where: {
        conversationId: args.conversationId,
        userProfileId: args.me.id,
        conversation: { tenantId: args.me.tenantId },
      },
      data: { lastReadAt: new Date() },
    });
    if (result.count === 0) throw new NotFoundException('Conversation not found');
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------------

  /**
   * The strict read-only alertContext subset for a seeded thread. Re-asserts the
   * wall at READ time (PM-3): the joined alert must still concern the thread's
   * student; otherwise degrade to null (never widen). Exposes ONLY
   * {alertId, code, title, subjectName} — never body/recommendation/threshold.
   * `alert` may be null when alertId is absent or the alert was deleted (SetNull).
   */
  private resolveAlertContext(
    alert:
      | { id: string; code: string; title: string; studentId: string; subject: { name: string } | null }
      | null,
    conversationStudentId: string,
  ): AlertContextDto | null {
    if (!alert) return null;
    if (alert.studentId !== conversationStudentId) return null;
    return {
      alertId: alert.id,
      code: alert.code,
      title: alert.title,
      subjectName: alert.subject?.name ?? null,
    };
  }

  /**
   * Build the ConversationDto for a single thread (create/reuse response +
   * getConversation). `alertContext` is resolved from the joined alert (S2 —
   * promotes the S1 stub) and `unreadCount` is computed for the caller. Tenant
   * scope is already guaranteed by the caller.
   */
  private async toConversationDto(
    conversationId: string,
    callerId: string,
  ): Promise<ConversationDto> {
    const conv = await this.prisma.conversation.findUniqueOrThrow({
      where: { id: conversationId },
      select: {
        id: true,
        studentId: true,
        parentId: true,
        teacherId: true,
        subjectId: true,
        status: true,
        topic: true,
        lastMessageAt: true,
        createdAt: true,
        student: { select: { firstName: true, lastName: true } },
        parent: { select: { firstName: true, lastName: true } },
        teacher: { select: { firstName: true, lastName: true } },
        subject: { select: { name: true } },
        alert: {
          select: { id: true, code: true, title: true, studentId: true, subject: { select: { name: true } } },
        },
        participants: { where: { userProfileId: callerId }, select: { lastReadAt: true } },
        messages: {
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { body: true },
        },
      },
    });

    const lastReadAt = conv.participants[0]?.lastReadAt ?? null;
    const unreadCount = await this.prisma.conversationMessage.count({
      where: {
        conversationId: conv.id,
        senderId: { not: callerId },
        ...(lastReadAt ? { createdAt: { gt: lastReadAt } } : {}),
      },
    });

    return {
      id: conv.id,
      studentId: conv.studentId,
      studentName: `${conv.student.firstName} ${conv.student.lastName}`.trim(),
      parentId: conv.parentId,
      parentName: `${conv.parent.firstName} ${conv.parent.lastName}`.trim(),
      teacherId: conv.teacherId,
      teacherName: `${conv.teacher.firstName} ${conv.teacher.lastName}`.trim(),
      subjectId: conv.subjectId,
      subjectName: conv.subject?.name ?? null,
      alertContext: this.resolveAlertContext(conv.alert, conv.studentId),
      status: conv.status,
      topic: conv.topic,
      lastMessageAt: conv.lastMessageAt?.toISOString() ?? null,
      lastMessagePreview: conv.messages[0]?.body.slice(0, 140) ?? null,
      unreadCount,
      createdAt: conv.createdAt.toISOString(),
    };
  }
}
