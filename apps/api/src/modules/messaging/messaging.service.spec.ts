import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MessagingService } from './messaging.service';
import { StudentAccessService } from '../students/student-access.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Mirror of the service-private participant role union (not exported). */
type ParticipantRole = 'parent' | 'teacher';

const TENANT = 'tenant-1';
const SCHOOL = 'school-1';
const PARENT = 'parent-up-1';
const TEACHER = 'teacher-up-1';
const STUDENT = 'student-1';

const jwt = { realm_access: { roles: ['parent'] } } as never;
const me = { id: PARENT, tenantId: TENANT };

/**
 * Builds a MessagingService with hand-rolled Prisma + collaborator mocks.
 * `opts` tunes the dual-wall outcome and whether a thread already exists.
 */
function makeService(opts: {
  guardian?: boolean;
  teaches?: boolean;
  existingThread?: boolean;
  studentExists?: boolean;
  teacherExists?: boolean;
} = {}) {
  const {
    guardian = true,
    teaches = true,
    existingThread = false,
    studentExists = true,
    teacherExists = true,
  } = opts;

  const created = { conversations: 0, participants: 0, messages: 0 };
  const updates: Array<{ id: string; data: Record<string, unknown> }> = [];

  const tx = {
    conversation: {
      create: jest.fn(async () => {
        created.conversations += 1;
        return { id: 'conv-new', createdAt: new Date('2026-06-04T10:00:00Z') };
      }),
      update: jest.fn(async ({ where, data }: never) => {
        updates.push({ id: (where as { id: string }).id, data });
        return {};
      }),
    },
    conversationParticipant: {
      createMany: jest.fn(async ({ data }: { data: unknown[] }) => {
        created.participants += data.length;
        return { count: data.length };
      }),
    },
    conversationMessage: {
      create: jest.fn(async () => {
        created.messages += 1;
        return { id: 'msg-new', createdAt: new Date('2026-06-04T10:00:00Z') };
      }),
    },
  };

  const prisma = {
    student: {
      findFirst: jest.fn(async () =>
        studentExists
          ? { id: STUDENT, schoolId: SCHOOL, firstName: 'Léa', lastName: 'Martin' }
          : null,
      ),
    },
    userProfile: {
      findFirst: jest.fn(async () =>
        teacherExists ? { id: TEACHER, firstName: 'Paul', lastName: 'Diallo' } : null,
      ),
    },
    enrollment: {
      findFirst: jest.fn(async () =>
        teaches ? { classSectionId: 'cs-1', academicYearId: 'ay-1' } : null,
      ),
    },
    teachingAssignment: {
      findFirst: jest.fn(async () => (teaches ? { id: 'ta-1' } : null)),
      findMany: jest.fn(async () => []),
    },
    conversation: {
      findUnique: jest.fn(async () => (existingThread ? { id: 'conv-existing' } : null)),
      findUniqueOrThrow: jest.fn(async () => ({
        id: existingThread ? 'conv-existing' : 'conv-new',
        studentId: STUDENT,
        parentId: PARENT,
        teacherId: TEACHER,
        subjectId: null,
        status: 'active',
        topic: 'Bonjour',
        lastMessageAt: new Date('2026-06-04T10:00:00Z'),
        createdAt: new Date('2026-06-04T10:00:00Z'),
        student: { firstName: 'Léa', lastName: 'Martin' },
        parent: { firstName: 'Marie', lastName: 'Martin' },
        teacher: { firstName: 'Paul', lastName: 'Diallo' },
        subject: null,
        participants: [{ lastReadAt: null }],
        messages: [{ body: 'Bonjour' }],
      })),
      findFirst: jest.fn(),
      update: jest.fn(async () => ({})),
    },
    conversationMessage: {
      count: jest.fn(async () => 0),
    },
    auditLog: { create: jest.fn(async () => ({})) },
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  };

  const studentAccess = {
    canAccessStudent: jest.fn(async () => guardian),
  } as unknown as StudentAccessService;
  const notifications = {
    createMany: jest.fn(async () => ({ created: 1 })),
  } as unknown as NotificationsService;

  const service = new MessagingService(
    prisma as never,
    studentAccess,
    notifications,
  );
  return { service, prisma, studentAccess, notifications, created, updates, tx };
}

const baseCreate = {
  me,
  jwt,
  schoolId: SCHOOL,
  actorRole: 'parent',
  portal: 'parent',
  studentId: STUDENT,
  teacherId: TEACHER,
  body: 'Bonjour, je vous écris au sujet de Léa.',
};

describe('MessagingService.createConversation (dual-wall ABAC)', () => {
  it('creates a thread + 2 participants + first message when both walls hold (201)', async () => {
    const { service, created } = makeService();
    const res = await service.createConversation(baseCreate);
    expect(res.created).toBe(true);
    expect(created.conversations).toBe(1);
    expect(created.participants).toBe(2);
    expect(created.messages).toBe(1);
  });

  it('403 when caller is NOT a guardian of the child', async () => {
    const { service } = makeService({ guardian: false });
    await expect(service.createConversation(baseCreate)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('403 when the teacher does not currently teach the child', async () => {
    const { service } = makeService({ teaches: false });
    await expect(service.createConversation(baseCreate)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('404 (before 403) when the studentId is out-of-tenant/unknown', async () => {
    const { service } = makeService({ studentExists: false });
    await expect(service.createConversation(baseCreate)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404 when the teacherId is out-of-tenant/unknown', async () => {
    const { service } = makeService({ teacherExists: false });
    await expect(service.createConversation(baseCreate)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is idempotent: an existing thread is returned (200), body ignored, no new rows', async () => {
    const { service, created } = makeService({ existingThread: true });
    const res = await service.createConversation(baseCreate);
    expect(res.created).toBe(false);
    expect(created.conversations).toBe(0);
    expect(created.messages).toBe(0);
  });

  it('falls back to reuse (200) on a P2002 unique-violation race', async () => {
    const { service, prisma } = makeService();
    // First findUnique → null (no thread); after the race it returns the winner.
    (prisma.conversation.findUnique as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'conv-winner' });
    (prisma.$transaction as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '5',
      }),
    );
    const res = await service.createConversation(baseCreate);
    expect(res.created).toBe(false);
  });

  it('400 when alertId concerns a different student (alertId never widens access)', async () => {
    const { service, prisma } = makeService();
    (prisma as never as { alertInstance: { findFirst: jest.Mock } }).alertInstance = {
      findFirst: jest.fn(async () => ({ studentId: 'other-student', subjectId: null })),
    };
    await expect(
      service.createConversation({ ...baseCreate, alertId: 'alert-1' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  // ---------------------------------------------------------------------------
  // E2-S3 / PM-2 (P0). On create, the teacher in-app notification must deep-link
  // to the conversation inbox (/teacher/conversations), NEVER the teacher→family
  // Announcements surface (/teacher/messages). A regression here lands a notified
  // teacher on the wrong page.
  // ---------------------------------------------------------------------------
  it('notifies the teacher with a /teacher/conversations deep-link (not /teacher/messages)', async () => {
    const { service, notifications } = makeService();
    await service.createConversation(baseCreate);
    const payload = (notifications.createMany as jest.Mock).mock.calls[0][0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        userProfileId: TEACHER,
        kind: 'message',
        link: '/teacher/conversations',
      }),
    );
  });
});

describe('MessagingService.sendMessage (re-check + read_only lapse)', () => {
  function makeSendService(opts: {
    teaches: boolean;
    status?: string;
    participant?: boolean;
    /** The caller's participant role on the thread (defaults to 'teacher'). */
    senderRole?: ParticipantRole;
    /** Guardianship-wall outcome for a parent sender (defaults to true). */
    guardian?: boolean;
  }) {
    const { service, prisma, studentAccess, notifications } = makeService({
      teaches: opts.teaches,
      guardian: opts.guardian ?? true,
    });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(
      opts.participant === false
        ? null
        : {
            id: 'conv-1',
            status: opts.status ?? 'active',
            studentId: STUDENT,
            parentId: PARENT,
            teacherId: TEACHER,
            participants: [{ role: opts.senderRole ?? 'teacher' }],
          },
    );
    // sendMessage's tx uses conversationMessage.create returning sender info.
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: never) =>
      (cb as (t: unknown) => unknown)({
        conversationMessage: {
          create: jest.fn(async () => ({
            id: 'msg-1',
            conversationId: 'conv-1',
            senderId: TEACHER,
            senderRole: 'teacher',
            body: 'ok',
            createdAt: new Date('2026-06-04T11:00:00Z'),
            sender: { firstName: 'Paul', lastName: 'Diallo' },
          })),
        },
        conversation: { update: jest.fn(async () => ({})) },
      }),
    );
    return { service, prisma, studentAccess, notifications };
  }

  const teacherJwt = { realm_access: { roles: ['teacher'] } } as never;
  const sendArgs = {
    me: { id: TEACHER, tenantId: TENANT },
    jwt: teacherJwt,
    schoolId: SCHOOL,
    conversationId: 'conv-1',
    body: 'Bonjour',
  };

  it('appends an immutable message (201-shaped DTO) when the teaching wall holds', async () => {
    const { service } = makeSendService({ teaches: true });
    const dto = await service.sendMessage(sendArgs);
    expect(dto.id).toBe('msg-1');
    expect(dto.senderRole).toBe('teacher');
  });

  it('flips the thread to read_only and 403s when the teaching wall lapsed', async () => {
    const { service, prisma } = makeSendService({ teaches: false });
    await expect(service.sendMessage(sendArgs)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'read_only' } }),
    );
  });

  it('404 when the caller is not a participant (no existence leak)', async () => {
    const { service } = makeSendService({ teaches: true, participant: false });
    await expect(service.sendMessage(sendArgs)).rejects.toBeInstanceOf(NotFoundException);
  });

  // ---------------------------------------------------------------------------
  // LOAD-BEARING ACCESS-WIDENING GUARD (P1, [auth]). The slice's core promise is
  // "dual-wall ABAC re-checked at create AND every send; a lapsed teaching wall
  // flips the thread to read_only" (plan.md risk table: "Stale teaching wall →
  // re-check on every send"). The TEACHER-send path is covered above. This pins
  // the symmetric PARENT-send path: when the teacher has stopped teaching the
  // child, a parent (whose guardianship still holds) must NOT keep reaching that
  // teacher — the send must 403 and freeze the thread, exactly like a teacher
  // send. Without this, a parent silently messages (and re-notifies) a teacher
  // who no longer teaches their child until the teacher happens to send again.
  // ---------------------------------------------------------------------------
  const parentSendArgs = {
    me: { id: PARENT, tenantId: TENANT },
    jwt,
    schoolId: SCHOOL,
    conversationId: 'conv-1',
    body: 'Bonjour',
  };

  it('parent send re-checks the TEACHING wall: 403 + flips to read_only when the teacher no longer teaches the child', async () => {
    // Parent sender, guardianship intact, but teaching has lapsed.
    const { service, prisma } = makeSendService({
      senderRole: 'parent',
      guardian: true,
      teaches: false,
    });
    await expect(service.sendMessage(parentSendArgs)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.conversation.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: 'read_only' } }),
    );
  });

  it('parent send succeeds when BOTH walls hold (guardian + teacher still teaches)', async () => {
    const { service } = makeSendService({
      senderRole: 'parent',
      guardian: true,
      teaches: true,
    });
    const dto = await service.sendMessage(parentSendArgs);
    expect(dto.id).toBe('msg-1');
  });

  it('403 when the thread is already read_only', async () => {
    const { service } = makeSendService({ teaches: true, status: 'read_only' });
    await expect(service.sendMessage(sendArgs)).rejects.toBeInstanceOf(ForbiddenException);
  });

  // ---------------------------------------------------------------------------
  // E2-S3 / PM-12 (P1). A teacher reply must notify the PARENT, deep-linking to
  // /parent/messages (this path goes live with S3's first teacher-sent messages).
  // ---------------------------------------------------------------------------
  it('teacher reply notifies the parent with a /parent/messages deep-link', async () => {
    const { service, notifications } = makeSendService({ teaches: true });
    await service.sendMessage(sendArgs);
    const payload = (notifications.createMany as jest.Mock).mock.calls[0][0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        userProfileId: PARENT,
        kind: 'message',
        link: '/parent/messages',
        sourceType: 'conversation',
        sourceId: 'msg-1',
      }),
    );
  });

  // ---------------------------------------------------------------------------
  // E2-S3 / PM-2 (P0). A parent send notifies the TEACHER, and the deep-link is
  // /teacher/conversations (the parent-initiated inbox), NOT /teacher/messages.
  // ---------------------------------------------------------------------------
  it('parent send notifies the teacher with a /teacher/conversations deep-link', async () => {
    const { service, notifications } = makeSendService({
      senderRole: 'parent',
      guardian: true,
      teaches: true,
    });
    await service.sendMessage(parentSendArgs);
    const payload = (notifications.createMany as jest.Mock).mock.calls[0][0][0];
    expect(payload).toEqual(
      expect.objectContaining({
        userProfileId: TEACHER,
        kind: 'message',
        link: '/teacher/conversations',
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// S2 — read/state surface: inbox aggregate (scope + no-N+1 + alertContext),
// getConversation participant gate, markRead idempotency.
// ---------------------------------------------------------------------------

const ALERT = 'alert-1';

/**
 * A focused Prisma double for the S2 read methods. `conversation.findMany`
 * returns the caller's page (seeded so one thread carries an alert, one does
 * not); `conversationMessage.findMany` returns the unread tuples used by the
 * single grouped unread pass.
 */
function makeReadService(opts: {
  rows?: Array<Record<string, unknown>>;
  unreadRows?: Array<{ conversationId: string; createdAt: Date }>;
  participantFound?: boolean;
  markCount?: number;
} = {}) {
  const seededAlert = {
    id: ALERT,
    code: 'LOW_SUBJECT_AVG',
    title: 'Moyenne basse en Maths',
    studentId: STUDENT,
    subject: { name: 'Mathématiques' },
  };
  const baseRow = (id: string, alert: unknown) => ({
    id,
    studentId: STUDENT,
    parentId: PARENT,
    teacherId: TEACHER,
    subjectId: null,
    alertId: alert ? ALERT : null,
    status: 'active',
    topic: 'Bonjour',
    lastMessageAt: new Date('2026-06-04T10:00:00Z'),
    createdAt: new Date('2026-06-04T09:00:00Z'),
    student: { firstName: 'Léa', lastName: 'Martin' },
    parent: { firstName: 'Marie', lastName: 'Martin' },
    teacher: { firstName: 'Paul', lastName: 'Diallo' },
    subject: null,
    alert,
    participants: [{ lastReadAt: null }],
  });

  const rows = opts.rows ?? [
    baseRow('conv-seeded', seededAlert),
    baseRow('conv-plain', null),
  ];

  const findManyCount = { conversation: 0, message: 0 };

  const prisma = {
    conversation: {
      count: jest.fn(async () => rows.length),
      findMany: jest.fn(async () => {
        findManyCount.conversation += 1;
        return rows;
      }),
      findFirst: jest.fn(async () =>
        opts.participantFound === false
          ? null
          : {
              id: 'conv-1',
              parentId: PARENT,
              teacherId: TEACHER,
              participants: [
                { userProfileId: PARENT, lastReadAt: null },
                { userProfileId: TEACHER, lastReadAt: new Date('2026-06-04T12:00:00Z') },
              ],
            },
      ),
      findUniqueOrThrow: jest.fn(async () => ({
        id: 'conv-seeded',
        studentId: STUDENT,
        parentId: PARENT,
        teacherId: TEACHER,
        subjectId: null,
        status: 'active',
        topic: 'Bonjour',
        lastMessageAt: new Date('2026-06-04T10:00:00Z'),
        createdAt: new Date('2026-06-04T09:00:00Z'),
        student: { firstName: 'Léa', lastName: 'Martin' },
        parent: { firstName: 'Marie', lastName: 'Martin' },
        teacher: { firstName: 'Paul', lastName: 'Diallo' },
        subject: null,
        alert: seededAlert,
        participants: [{ lastReadAt: null }],
        messages: [{ body: 'Bonjour' }],
      })),
    },
    conversationParticipant: {
      findFirst: jest.fn(async () =>
        opts.participantFound === false ? null : { id: 'cp-1' },
      ),
      updateMany: jest.fn(async () => ({ count: opts.markCount ?? 1 })),
    },
    conversationMessage: {
      count: jest.fn(async () => 0),
      findMany: jest.fn(async () => {
        findManyCount.message += 1;
        return (
          opts.unreadRows ?? [
            { conversationId: 'conv-seeded', createdAt: new Date('2026-06-04T10:00:00Z') },
          ]
        );
      }),
    },
  };

  const studentAccess = { canAccessStudent: jest.fn(async () => true) } as unknown as StudentAccessService;
  const notifications = { createMany: jest.fn(async () => ({ created: 1 })) } as unknown as NotificationsService;
  const service = new MessagingService(prisma as never, studentAccess, notifications);
  return { service, prisma, findManyCount };
}

describe('MessagingService.listConversations (inbox scope + alertContext + no-N+1)', () => {
  it('parent sees own threads; seeded thread carries alertContext, plain carries null', async () => {
    const { service } = makeReadService();
    const res = await service.listConversations({ me, role: 'parent', limit: 50, offset: 0 });
    expect(res.total).toBe(2);
    expect(res.data).toHaveLength(2);
    const seeded = res.data.find((c) => c.id === 'conv-seeded')!;
    const plain = res.data.find((c) => c.id === 'conv-plain')!;
    expect(seeded.alertContext).toEqual({
      alertId: ALERT,
      code: 'LOW_SUBJECT_AVG',
      title: 'Moyenne basse en Maths',
      subjectName: 'Mathématiques',
    });
    expect(plain.alertContext).toBeNull();
    expect(seeded.unreadCount).toBe(1);
  });

  it('computes unread for ALL rows in ONE grouped message query (no N+1)', async () => {
    const { service, findManyCount } = makeReadService();
    await service.listConversations({ me, role: 'parent', limit: 50, offset: 0 });
    // Exactly one conversation page query + one unread message query, regardless
    // of row count (AC1 / PM-7).
    expect(findManyCount.conversation).toBe(1);
    expect(findManyCount.message).toBe(1);
  });

  it('scopes parent on parentId=me / teacher on teacherId=me (never via access-scope)', async () => {
    const { service, prisma } = makeReadService();
    await service.listConversations({ me, role: 'teacher', limit: 50, offset: 0 });
    expect((prisma.conversation.findMany as jest.Mock).mock.calls[0][0].where).toEqual(
      expect.objectContaining({ tenantId: TENANT, teacherId: PARENT }),
    );
  });

  it('a caller with no messaging role gets an empty inbox', async () => {
    const { service, prisma } = makeReadService();
    const res = await service.listConversations({ me, role: null, limit: 50, offset: 0 });
    expect(res).toEqual({ data: [], total: 0 });
    expect(prisma.conversation.findMany).not.toHaveBeenCalled();
  });

  it('alertContext degrades to null when the alert concerns a different student', async () => {
    const { service } = makeReadService({
      rows: [
        {
          id: 'conv-x',
          studentId: STUDENT,
          parentId: PARENT,
          teacherId: TEACHER,
          subjectId: null,
          alertId: ALERT,
          status: 'active',
          topic: 'Bonjour',
          lastMessageAt: new Date('2026-06-04T10:00:00Z'),
          createdAt: new Date('2026-06-04T09:00:00Z'),
          student: { firstName: 'Léa', lastName: 'Martin' },
          parent: { firstName: 'Marie', lastName: 'Martin' },
          teacher: { firstName: 'Paul', lastName: 'Diallo' },
          subject: null,
          alert: { id: ALERT, code: 'X', title: 'X', studentId: 'OTHER', subject: null },
          participants: [{ lastReadAt: null }],
        },
      ],
      unreadRows: [],
    });
    const res = await service.listConversations({ me, role: 'parent', limit: 50, offset: 0 });
    expect(res.data[0]!.alertContext).toBeNull();
  });
});

describe('MessagingService.getConversation (participant gate)', () => {
  it('returns the thread DTO when the caller is a participant', async () => {
    const { service } = makeReadService();
    const dto = await service.getConversation({ me, conversationId: 'conv-seeded' });
    expect(dto.id).toBe('conv-seeded');
    expect(dto.alertContext?.alertId).toBe(ALERT);
  });

  it('404 when the caller is NOT a participant (foreign / cross-tenant id)', async () => {
    const { service } = makeReadService({ participantFound: false });
    await expect(
      service.getConversation({ me, conversationId: 'conv-foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MessagingService.markRead (idempotent, participant-only)', () => {
  it('bumps the caller lastReadAt → subsequent unread reads as 0', async () => {
    const { service, prisma } = makeReadService();
    const res = await service.markRead({ me, conversationId: 'conv-1' });
    expect(res).toEqual({ ok: true });
    const call = (prisma.conversationParticipant.updateMany as jest.Mock).mock.calls[0][0];
    expect(call.where).toEqual(
      expect.objectContaining({ conversationId: 'conv-1', userProfileId: PARENT }),
    );
    // server now() — not a client value
    expect(call.data.lastReadAt).toBeInstanceOf(Date);
  });

  it('404 when the caller is not a participant of the thread', async () => {
    const { service } = makeReadService({ markCount: 0 });
    await expect(
      service.markRead({ me, conversationId: 'conv-foreign' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('MessagingService.isTeacherOfStudent (teaching wall, tenant isolation)', () => {
  it('returns false (never throws) when there is no active enrollment', async () => {
    const { service } = makeService({ teaches: false });
    await expect(
      service.isTeacherOfStudent({
        tenantId: TENANT,
        teacherUserProfileId: TEACHER,
        studentId: STUDENT,
      }),
    ).resolves.toBe(false);
  });

  it('returns true when an active-year assignment matches the teacher UserProfile id', async () => {
    const { service } = makeService({ teaches: true });
    await expect(
      service.isTeacherOfStudent({
        tenantId: TENANT,
        teacherUserProfileId: TEACHER,
        studentId: STUDENT,
      }),
    ).resolves.toBe(true);
  });
});

// ---------------------------------------------------------------------------
// E2-S4 — moderation / safety: report idempotency + participant gate, and the
// per-sender send rate-limit boundary (AC6 + the audit invariants of AC7).
// ---------------------------------------------------------------------------

/**
 * A focused Prisma double for `reportConversation`. `participant` toggles the
 * thread participant gate; `existingOpen` simulates an already-open report by the
 * same reporter (the idempotency path). The `auditLog.create` spy lets us assert
 * the append-only audit row fires on a genuine create.
 */
function makeReportService(opts: { participant?: boolean; existingOpen?: boolean } = {}) {
  const { participant = true, existingOpen = false } = opts;
  const reportCreate = jest.fn(async () => ({ id: 'report-new' }));
  const auditCreate = jest.fn(async () => ({}));

  const reportRow = {
    id: existingOpen ? 'report-existing' : 'report-new',
    conversationId: 'conv-1',
    reportedBy: PARENT,
    reason: 'Propos déplacés',
    status: 'open',
    reviewedAt: null,
    createdAt: new Date('2026-06-04T13:00:00Z'),
    reporter: { firstName: 'Marie', lastName: 'Martin' },
  };

  const prisma = {
    conversation: {
      findFirst: jest.fn(async () =>
        participant
          ? { id: 'conv-1', schoolId: SCHOOL, participants: [{ id: 'cp-1' }] }
          : { id: 'conv-1', schoolId: SCHOOL, participants: [] },
      ),
    },
    conversationReport: {
      findFirst: jest.fn(async () => (existingOpen ? { id: 'report-existing' } : null)),
      create: reportCreate,
      findUniqueOrThrow: jest.fn(async () => reportRow),
    },
    auditLog: { create: auditCreate },
  };

  const studentAccess = { canAccessStudent: jest.fn() } as unknown as StudentAccessService;
  const notifications = { createMany: jest.fn() } as unknown as NotificationsService;
  const service = new MessagingService(prisma as never, studentAccess, notifications);
  return { service, prisma, reportCreate, auditCreate };
}

const reportArgs = {
  me,
  actorRole: 'parent',
  portal: 'parent',
  conversationId: 'conv-1',
  reason: 'Propos déplacés',
};

describe('MessagingService.reportConversation (participant gate + idempotent open)', () => {
  it('creates an open report (201) + an append-only audit row when the caller is a participant', async () => {
    const { service, reportCreate, auditCreate } = makeReportService();
    const res = await service.reportConversation(reportArgs);
    expect(res.created).toBe(true);
    expect(reportCreate).toHaveBeenCalledTimes(1);
    expect(auditCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ action: 'conversation.report' }),
      }),
    );
  });

  it('404 when the caller is NOT a participant (no existence leak), and writes nothing', async () => {
    const { service, reportCreate } = makeReportService({ participant: false });
    await expect(service.reportConversation(reportArgs)).rejects.toBeInstanceOf(NotFoundException);
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it('is idempotent: an existing OPEN report is reused (200), no new row created', async () => {
    const { service, reportCreate } = makeReportService({ existingOpen: true });
    const res = await service.reportConversation(reportArgs);
    expect(res.created).toBe(false);
    expect(reportCreate).not.toHaveBeenCalled();
  });

  it('falls back to reuse (200) on a P2002 unique-violation race', async () => {
    const { service, prisma } = makeReportService();
    (prisma.conversationReport.findFirst as jest.Mock)
      .mockResolvedValueOnce(null) // pre-create idempotency check: none
      .mockResolvedValueOnce({ id: 'report-winner' }); // post-race winner
    (prisma.conversationReport.create as jest.Mock).mockRejectedValueOnce(
      new Prisma.PrismaClientKnownRequestError('dup', { code: 'P2002', clientVersion: '5' }),
    );
    const res = await service.reportConversation(reportArgs);
    expect(res.created).toBe(false);
  });
});

describe('MessagingService.sendMessage (E2-S4 per-sender rate-limit)', () => {
  function makeRateService(recentCount: number) {
    const { service, prisma } = makeService({ teaches: true });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue({
      id: 'conv-1',
      status: 'active',
      studentId: STUDENT,
      parentId: PARENT,
      teacherId: TEACHER,
      participants: [{ role: 'teacher' }],
    });
    // The rate-limit window count (the only conversationMessage.count call in send).
    (prisma.conversationMessage.count as jest.Mock).mockResolvedValue(recentCount);
    (prisma.$transaction as jest.Mock).mockImplementation(async (cb: never) =>
      (cb as (t: unknown) => unknown)({
        conversationMessage: {
          create: jest.fn(async () => ({
            id: 'msg-1',
            conversationId: 'conv-1',
            senderId: TEACHER,
            senderRole: 'teacher',
            body: 'ok',
            createdAt: new Date('2026-06-04T11:00:00Z'),
            sender: { firstName: 'Paul', lastName: 'Diallo' },
          })),
        },
        conversation: { update: jest.fn(async () => ({})) },
      }),
    );
    return { service };
  }

  const sendArgs = {
    me: { id: TEACHER, tenantId: TENANT },
    jwt: { realm_access: { roles: ['teacher'] } } as never,
    schoolId: SCHOOL,
    conversationId: 'conv-1',
    body: 'Bonjour',
  };

  it('sends when the recent-message count is below the window cap (default 10)', async () => {
    const { service } = makeRateService(9);
    const dto = await service.sendMessage(sendArgs);
    expect(dto.id).toBe('msg-1');
  });

  it('429 (HttpException) when the recent-message count is at/over the window cap (default 10)', async () => {
    const { service } = makeRateService(10);
    await expect(service.sendMessage(sendArgs)).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('MessagingService.listReports (admin oversight: tenant + school scope)', () => {
  function makeReportsService() {
    const count = jest.fn(async () => 0);
    const findMany = jest.fn(async () => [] as unknown[]);
    const prisma = {
      conversationReport: { count, findMany },
      auditLog: { create: jest.fn(async () => ({})) },
    };
    const studentAccess = { canAccessStudent: jest.fn() } as unknown as StudentAccessService;
    const notifications = { createMany: jest.fn() } as unknown as NotificationsService;
    const service = new MessagingService(prisma as never, studentAccess, notifications);
    return { service, count, findMany };
  }

  const baseArgs = {
    me,
    actorRole: 'school_admin',
    portal: 'admin',
    limit: 50,
    offset: 0,
  };

  it('scopes the query to the resolved schoolId (no cross-school leak in a multi-school tenant)', async () => {
    const { service, count, findMany } = makeReportsService();
    await service.listReports({ ...baseArgs, schoolId: SCHOOL, status: 'open' });
    const expectedWhere = expect.objectContaining({
      tenantId: TENANT,
      schoolId: SCHOOL,
      status: 'open',
    });
    expect(count).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expectedWhere }));
  });

  it('falls back to tenant-only scope when no active school resolves (schoolId null)', async () => {
    const { service, findMany } = makeReportsService();
    await service.listReports({ ...baseArgs, schoolId: null });
    const where = (findMany.mock.calls[0]![0] as { where: Record<string, unknown> }).where;
    expect(where.tenantId).toBe(TENANT);
    expect('schoolId' in where).toBe(false);
  });
});
