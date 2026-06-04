import {
  Controller,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';

import { deriveAlertActorProvenance } from './alert-provenance';
import { MeetingRequestStatus } from './alerts.types';
import { MeetingRequestsService } from './meeting-requests.service';

const MEETING_REQUEST_STATUSES: MeetingRequestStatus[] = ['open', 'resolved', 'cancelled'];

/**
 * Teacher/admin meeting-request action center (E1-S3). Gated by the dedicated
 * `meeting_requests.read`/`meeting_requests.write` permissions, granted to BOTH
 * the `teacher` and admin realm roles (NOT the broad `alerts.read`/`alerts.write`,
 * which also unlock the school-wide alert-rule config + evaluator — granting those
 * to teachers would be a privilege escalation; parents hold neither, so they are
 * blocked here). Every query is tenant-scoped AND role-scoped:
 * admins see all in their school, teachers see only their own queue + unassigned.
 */
@ApiTags('meeting-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('meeting-requests')
export class MeetingRequestsController {
  constructor(
    private readonly meetingRequests: MeetingRequestsService,
    private readonly users: UserSyncService,
    private readonly ctx: SchoolContextService,
  ) {}

  @Get()
  @RequiresPermission('meeting_requests.read')
  @ApiOperation({ summary: 'List meeting requests for the action center (role-scoped)' })
  async list(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Query('status') statusRaw: string | undefined,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit: number,
    @Query('offset', new DefaultValuePipe(0), ParseIntPipe) offset: number,
  ) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const status =
      statusRaw && MEETING_REQUEST_STATUSES.includes(statusRaw as MeetingRequestStatus)
        ? (statusRaw as MeetingRequestStatus)
        : 'open';
    const roles = jwt.realm_access?.roles ?? [];
    const scope = this.meetingRequests.scopeFromRoles(roles, me.id);
    return this.meetingRequests.list({
      tenantId: me.tenantId,
      schoolId,
      scope,
      status,
      limit: Math.min(200, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });
  }

  @Patch(':id/resolve')
  @RequiresPermission('meeting_requests.write')
  @ApiOperation({ summary: 'Mark a meeting request handled (idempotent, role-scoped)' })
  async resolve(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id') id: string) {
    const me = await this.users.ensureUser(jwt);
    const { schoolId } = await this.ctx.forUser(me);
    const roles = jwt.realm_access?.roles ?? [];
    const scope = this.meetingRequests.scopeFromRoles(roles, me.id);
    const { actorRole, portal } = deriveAlertActorProvenance(jwt);
    return this.meetingRequests.resolve({
      tenantId: me.tenantId,
      schoolId,
      scope,
      id,
      userProfileId: me.id,
      actorRole,
      portal,
    });
  }
}
