import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { pageWindow, pageWindowOf } from '@pilotage/contracts';

import { deriveAlertActorProvenance } from '../../shared/audit/provenance';
import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { SchoolContextService } from '../school-structure/school-context.service';

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
/**
 * S-E03-9 / PF-50 / ADR-080 — la fenêtre de la file de demandes de rendez-vous :
 * 50 par défaut, 200 au maximum. Inchangés.
 *
 * ⚠ CE SITE N'ÉTAIT PAS DANS LES NEUF DU BRIEF. Il est l'un des CINQ que la
 * passe critique a mesurés en plus (14 sites / 11 formes au total). Le convertir
 * est ce que AC-2 EXIGE : il n'existe aucune raison STRUCTURELLE de le laisser —
 * c'est le même idiome, sur le même contrat, dans le même dossier. Le laisser
 * aurait obligé le cliquet R3 à porter une liste d'exemptions, c'est-à-dire la
 * sortie que `academic-year-resolution-gate.spec.ts:20-32` interdit.
 */
const MEETING_REQUESTS_PAGE_WINDOW = pageWindow({ def: 50, max: 200 });

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
    @Query('limit') limitRaw: string | undefined,
    @Query('offset') offsetRaw: string | undefined,
  ) {
    const parsedWindow = MEETING_REQUESTS_PAGE_WINDOW.safeParse({
      limit: limitRaw,
      offset: offsetRaw,
    });
    if (!parsedWindow.success) {
      throw new BadRequestException(parsedWindow.error.issues.map((i) => i.message));
    }
    const { take, skip } = pageWindowOf(parsedWindow.data);
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
      limit: take,
      offset: skip,
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
