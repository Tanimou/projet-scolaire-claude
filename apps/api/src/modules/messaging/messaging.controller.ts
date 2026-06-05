import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ConversationInboxQuerySchema,
  ConversationMessagesQuerySchema,
  ConversationReportsQuerySchema,
  CreateConversationRequestSchema,
  ReportConversationRequestSchema,
  SendMessageRequestSchema,
} from '@pilotage/contracts';
import type { Response } from 'express';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { deriveAlertActorProvenance } from '../alerts/alert-provenance';
import { SchoolContextService } from '../school-structure/school-context.service';

import { MessagingService } from './messaging.service';

/**
 * Parent ↔ teacher messaging (E2-S1 + S4). Gated by the dedicated
 * `messaging.read`/`messaging.write` permissions (granted to parent, teacher,
 * school_admin; super_admin inherits via the all-permissions map). Every query
 * is tenant-scoped in the service; cross-tenant ids resolve to 404.
 *
 * Create is **parent-role-only** (PM-2): even though an admin would pass the
 * guardianship wall (StudentAccessService returns true for admins), admins are
 * non-participants and must NOT spawn parent↔teacher threads — the controller
 * rejects any non-parent caller on the create path with 403.
 *
 * E2-S4 moderation/safety: `POST /conversations/:id/report` (participant-only via
 * the service gate, reuses `messaging.write`) lets either party flag a thread;
 * `GET /conversations/reports` is the **admin-only** oversight list, gated by the
 * dedicated `messaging.moderate` permission (granted to school_admin/super_admin
 * ONLY — never to parent or teacher), so a participant cannot read the queue.
 */
@ApiTags('messaging')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class MessagingController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get('messaging/eligible-teachers')
  @RequiresPermission('messaging.read')
  @ApiOperation({ summary: 'List teachers currently teaching the caller’s child (server-filtered)' })
  async listEligibleTeachers(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('studentId') studentId: string,
  ) {
    if (!studentId) throw new BadRequestException('studentId is required');
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.messaging.listEligibleTeachers({ me, jwt, schoolId, studentId });
  }

  @Post('conversations')
  @RequiresPermission('messaging.write')
  @ApiOperation({ summary: 'Open or reuse a parent↔teacher thread (idempotent, parent-only)' })
  async createConversation(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Parent-only create: admins/teachers are not thread initiators (PM-2).
    const roles = jwt.realm_access?.roles ?? [];
    if (!roles.includes('parent')) {
      throw new ForbiddenException('Only a parent can open a conversation');
    }

    const parsed = CreateConversationRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }

    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);

    const { conversation, created } = await this.messaging.createConversation({
      me,
      jwt,
      schoolId,
      actorRole,
      portal,
      studentId: parsed.data.studentId,
      teacherId: parsed.data.teacherId,
      body: parsed.data.body,
      subjectId: parsed.data.subjectId ?? null,
      alertId: parsed.data.alertId ?? null,
    });

    // 201 on a genuine create, 200 on an idempotent reuse.
    res.status(created ? 201 : 200);
    return conversation;
  }

  @Get('conversations')
  @RequiresPermission('messaging.read')
  @ApiOperation({ summary: 'Role-aware inbox: the caller’s threads (parent: own; teacher: own)' })
  async listConversations(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query() rawQuery: unknown,
  ) {
    const parsed = ConversationInboxQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const me = await this.users.ensureUser(jwt);
    // Role-aware (PM-2): scope on the participant column, never via access-scope.
    // A caller who is neither parent nor teacher (e.g. admin) gets an empty inbox.
    const roles = jwt.realm_access?.roles ?? [];
    const role: 'parent' | 'teacher' | null = roles.includes('parent')
      ? 'parent'
      : roles.includes('teacher')
        ? 'teacher'
        : null;
    return this.messaging.listConversations({
      me,
      role,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  }

  @Get('conversations/reports')
  @RequiresPermission('messaging.moderate')
  @ApiOperation({ summary: 'Admin moderation oversight: reported threads (admin-only, read-only)' })
  async listReports(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query() rawQuery: unknown,
  ) {
    const parsed = ConversationReportsQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const me = await this.users.ensureUser(jwt);
    // School-scope the oversight list (AC3/AC9): resolve the admin's active school
    // so a school_admin never reads another school's reports in the same tenant.
    const { schoolId } = await this.ctx.forUser(me);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.messaging.listReports({
      me,
      schoolId,
      actorRole,
      portal,
      status: parsed.data.status,
      limit: parsed.data.limit,
      offset: parsed.data.offset,
    });
  }

  @Get('conversations/:id')
  @RequiresPermission('messaging.read')
  @ApiOperation({ summary: 'Thread header (participant-only; non-participant → 404)' })
  async getConversation(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id') id: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.messaging.getConversation({ me, conversationId: id });
  }

  @Get('conversations/:id/messages')
  @RequiresPermission('messaging.read')
  @ApiOperation({ summary: 'Paged thread messages (participant-only; oldest→newest; before cursor)' })
  async listMessages(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id') id: string,
    @Query() rawQuery: unknown,
  ) {
    const parsed = ConversationMessagesQuerySchema.safeParse(rawQuery);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const me = await this.users.ensureUser(jwt);
    return this.messaging.listMessages({
      me,
      conversationId: id,
      limit: parsed.data.limit,
      before: parsed.data.before,
    });
  }

  @Patch('conversations/:id/read')
  @RequiresPermission('messaging.write')
  @ApiOperation({ summary: 'Mark the caller’s read anchor to now() (idempotent, participant-only)' })
  async markRead(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id') id: string,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.messaging.markRead({ me, conversationId: id });
  }

  @Post('conversations/:id/messages')
  @HttpCode(201)
  @RequiresPermission('messaging.write')
  @ApiOperation({ summary: 'Append an immutable message to a thread (participant-only, ABAC re-checked)' })
  async sendMessage(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id') id: string,
    @Body() rawBody: unknown,
  ) {
    const parsed = SendMessageRequestSchema.safeParse(rawBody);
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    return this.messaging.sendMessage({
      me,
      jwt,
      schoolId,
      conversationId: id,
      body: parsed.data.body,
    });
  }

  @Post('conversations/:id/report')
  @RequiresPermission('messaging.write')
  @ApiOperation({ summary: 'Report a thread for safety review (participant-only, idempotent open)' })
  async reportConversation(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id') id: string,
    @Body() rawBody: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    const parsed = ReportConversationRequestSchema.safeParse(rawBody ?? {});
    if (!parsed.success) {
      throw new BadRequestException(parsed.error.issues.map((i) => i.message));
    }
    const me = await this.users.ensureUser(jwt);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    const { report, created } = await this.messaging.reportConversation({
      me,
      actorRole,
      portal,
      conversationId: id,
      reason: parsed.data.reason ?? null,
    });
    // 201 on a genuine create, 200 on an idempotent reuse of an open report.
    res.status(created ? 201 : 200);
    return report;
  }
}
