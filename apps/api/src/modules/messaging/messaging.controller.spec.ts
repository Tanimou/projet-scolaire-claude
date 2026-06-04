import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { Response } from 'express';

import { MessagingController } from './messaging.controller';
import type { MessagingService } from './messaging.service';
import type { KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import type { UserSyncService } from '../../shared/auth/user-sync.service';
import type { SchoolContextService } from '../school-structure/school-context.service';

// Closes the verify-panel (Murat) merge condition for E2-S1: the controller's
// create path holds the **parent-only** gate (PM-2) — the one auth-critical
// branch the service specs cannot cover. StudentAccessService.canAccessStudent
// returns TRUE for any teacher/admin (the guardianship wall is unrestricted for
// staff), so the load-bearing thing that stops a teacher/admin holding
// `messaging.write` from spawning parent↔teacher threads is the inline
// `roles.includes('parent')` check in the controller. A refactor that dropped or
// reordered it would leave every service spec green while opening that hole.
// These tests pin the controller -> service wiring: the role gate, the
// short-circuit ordering (no user/tenant resolution before a 403/400), and that
// the parsed body + JWT-derived provenance are actually threaded to the service.

const TENANT = 't1';
const USER = 'parent-up-1';
// Real UUIDs: CreateConversationRequestSchema validates studentId/teacherId with
// UuidSchema, so the controller's safeParse rejects non-UUID placeholders (the
// service specs bypass the schema and don't exercise this).
const STUDENT = '11111111-1111-4111-8111-111111111111';
const TEACHER = '22222222-2222-4222-8222-222222222222';

function jwtWithRoles(roles: string[]): KeycloakJwtPayload {
  return { sub: 'kc-sub', realm_access: { roles } } as unknown as KeycloakJwtPayload;
}

function makeRes() {
  const res = { status: jest.fn() };
  (res.status as jest.Mock).mockReturnValue(res);
  return res as unknown as Response & { status: jest.Mock };
}

function makeController() {
  const messaging = {
    createConversation: jest
      .fn()
      .mockResolvedValue({ conversation: { id: 'conv-1' }, created: true }),
    sendMessage: jest.fn().mockResolvedValue({ id: 'msg-1' }),
    listEligibleTeachers: jest.fn().mockResolvedValue([]),
  };
  // ensureUser is the ONLY source of tenantId/userProfileId — derived from the
  // verified JWT, never from a request param.
  const users = {
    ensureUser: jest.fn().mockResolvedValue({ id: USER, tenantId: TENANT }),
  };
  const ctx = {
    forUser: jest.fn().mockResolvedValue({ schoolId: 'school-1' }),
  } as unknown as SchoolContextService;
  const controller = new MessagingController(
    messaging as unknown as MessagingService,
    users as unknown as UserSyncService,
    ctx,
  );
  return { controller, messaging, users, ctx };
}

const validBody = { studentId: STUDENT, teacherId: TEACHER, body: 'Bonjour' };

describe('MessagingController.createConversation — parent-only gate (PM-2)', () => {
  // The load-bearing case: staff hold `messaging.write` and pass the
  // guardianship wall, so the controller MUST reject any non-parent initiator
  // before the service is ever reached.
  it.each([['teacher'], ['school_admin'], ['super_admin'], ['offline_access']])(
    'rejects a non-parent caller (%s) with 403 and never touches the service or resolves a user',
    async (role) => {
      const { controller, messaging, users, ctx } = makeController();
      const res = makeRes();

      await expect(
        controller.createConversation(jwtWithRoles([role]), validBody, res),
      ).rejects.toBeInstanceOf(ForbiddenException);

      // 403 fires before any side effect — no user/tenant resolution, no create.
      expect(messaging.createConversation).not.toHaveBeenCalled();
      expect(users.ensureUser).not.toHaveBeenCalled();
      expect(ctx.forUser).not.toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    },
  );

  it('a parent caller passes the gate and threads the parsed body + JWT-derived provenance into the service (201 on create)', async () => {
    const { controller, messaging } = makeController();
    const res = makeRes();

    const out = await controller.createConversation(
      jwtWithRoles(['parent']),
      { ...validBody, subjectId: null, alertId: null },
      res,
    );

    expect(messaging.createConversation).toHaveBeenCalledTimes(1);
    expect(messaging.createConversation).toHaveBeenCalledWith(
      expect.objectContaining({
        me: { id: USER, tenantId: TENANT },
        schoolId: 'school-1',
        actorRole: 'parent',
        portal: 'parent',
        studentId: STUDENT,
        teacherId: TEACHER,
        body: 'Bonjour',
        subjectId: null,
        alertId: null,
      }),
    );
    expect(res.status).toHaveBeenCalledWith(201);
    expect(out).toEqual({ id: 'conv-1' });
  });

  it('sets 200 (not 201) when the service reports an idempotent reuse', async () => {
    const { controller, messaging } = makeController();
    (messaging.createConversation as jest.Mock).mockResolvedValue({
      conversation: { id: 'conv-existing' },
      created: false,
    });
    const res = makeRes();

    await controller.createConversation(jwtWithRoles(['parent']), validBody, res);

    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('rejects an invalid body (400) after the parent gate but before resolving the user or calling the service', async () => {
    const { controller, messaging, users } = makeController();
    const res = makeRes();

    await expect(
      controller.createConversation(jwtWithRoles(['parent']), { studentId: STUDENT }, res),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(users.ensureUser).not.toHaveBeenCalled();
    expect(messaging.createConversation).not.toHaveBeenCalled();
  });
});

describe('MessagingController.listEligibleTeachers', () => {
  it('400 when studentId is missing, service not called', async () => {
    const { controller, messaging } = makeController();

    await expect(
      controller.listEligibleTeachers(jwtWithRoles(['parent']), ''),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(messaging.listEligibleTeachers).not.toHaveBeenCalled();
  });

  it('delegates with the JWT-resolved school + the requested student', async () => {
    const { controller, messaging } = makeController();

    await controller.listEligibleTeachers(jwtWithRoles(['parent']), STUDENT);

    expect(messaging.listEligibleTeachers).toHaveBeenCalledWith(
      expect.objectContaining({ schoolId: 'school-1', studentId: STUDENT }),
    );
  });
});

describe('MessagingController.sendMessage', () => {
  it('400 on an invalid body before resolving the user / calling the service', async () => {
    const { controller, messaging, users } = makeController();

    await expect(
      controller.sendMessage(jwtWithRoles(['parent']), 'conv-1', { body: '' }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(users.ensureUser).not.toHaveBeenCalled();
    expect(messaging.sendMessage).not.toHaveBeenCalled();
  });

  it('delegates a valid send with the JWT-derived tenant + the path conversation id', async () => {
    const { controller, messaging } = makeController();

    const out = await controller.sendMessage(jwtWithRoles(['parent']), 'conv-1', {
      body: 'Merci',
    });

    expect(messaging.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        me: { id: USER, tenantId: TENANT },
        schoolId: 'school-1',
        conversationId: 'conv-1',
        body: 'Merci',
      }),
    );
    expect(out).toEqual({ id: 'msg-1' });
  });
});
