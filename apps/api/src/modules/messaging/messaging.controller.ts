import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  CreateConversationRequestSchema,
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
 * Parent ↔ teacher messaging (E2-S1). Gated by the dedicated
 * `messaging.read`/`messaging.write` permissions (granted to parent, teacher,
 * school_admin; super_admin inherits via the all-permissions map). Every query
 * is tenant-scoped in the service; cross-tenant ids resolve to 404.
 *
 * Create is **parent-role-only** (PM-2): even though an admin would pass the
 * guardianship wall (StudentAccessService returns true for admins), admins are
 * non-participants and must NOT spawn parent↔teacher threads — the controller
 * rejects any non-parent caller on the create path with 403.
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
}
