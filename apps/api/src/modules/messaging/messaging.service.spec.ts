import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { MessagingService } from './messaging.service';
import { StudentAccessService } from '../students/student-access.service';
import { NotificationsService } from '../notifications/notifications.service';

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
});

describe('MessagingService.sendMessage (re-check + read_only lapse)', () => {
  function makeSendService(opts: { teaches: boolean; status?: string; participant?: boolean }) {
    const { service, prisma } = makeService({ teaches: opts.teaches });
    (prisma.conversation.findFirst as jest.Mock).mockResolvedValue(
      opts.participant === false
        ? null
        : {
            id: 'conv-1',
            status: opts.status ?? 'active',
            studentId: STUDENT,
            parentId: PARENT,
            teacherId: TEACHER,
            participants: [{ role: 'teacher' }],
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
    return { service, prisma };
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

  it('403 when the thread is already read_only', async () => {
    const { service } = makeSendService({ teaches: true, status: 'read_only' });
    await expect(service.sendMessage(sendArgs)).rejects.toBeInstanceOf(ForbiddenException);
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
