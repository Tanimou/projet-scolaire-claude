import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GUARDIANSHIP_CLAIM_STATUS, type GuardianshipClaimStatus } from '@pilotage/contracts';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';

import { ChildClaimsService } from './child-claims.service';
import { RejectChildClaimDto } from './dto/reject-child-claim.dto';

/**
 * E9-S2 — Admin enrollment self-service approval surface ("Demandes de rattachement").
 *
 * A school/super admin lists the tenant's pending child-claims and atomically grants
 * (approve = `pending`→`active` Guardianship flip, the access grant) or kindly declines
 * (reject = required reason, `pending`→`revoked`, grants nothing) each one. Every route:
 *  - is walled by `guardianships.approve` — the ADMIN-ONLY seeded permission. The queue
 *    deliberately does NOT ride bare `guardianships.read` (parent+teacher also hold it;
 *    riding it would leak every family's claimed-minor PII — the pre-mortem FM-1 leak).
 *  - server-derives `me.tenantId`/`me.id` via UserSyncService.ensureUser — NEVER a client
 *    tenant/school. A cross-tenant claim id is indistinguishable from a missing one (404).
 *  - is a separate controller from the parent `@Controller('parent/child-claims')` — the
 *    parent/admin split mirrors the contract; the parent controller is byte-untouched.
 *
 * See docs/adr/ADR-022-enrollment-self-service-child-claim.md (claim lifecycle) and
 * docs/adr/ADR-020-booking-availability-concurrency.md (from-status-guard idiom).
 */
@ApiTags('admin-child-claims')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('admin/child-claims')
export class AdminChildClaimsController {
  constructor(
    private readonly service: ChildClaimsService,
    private readonly users: UserSyncService,
  ) {}

  @Get()
  @RequiresPermission('guardianships.approve')
  @ApiOperation({ summary: 'List the tenant pending child-claims queue (oldest-first, one aggregate)' })
  async queue(@CurrentJwt() jwt: KeycloakJwtPayload, @Query('status') status?: string) {
    const me = await this.users.ensureUser(jwt);
    // Default to 'submitted'; validate any explicit param against the enum (no oracle,
    // FM-15). An invalid status → 400 rather than a silent full-table read.
    const resolved: GuardianshipClaimStatus = (status ?? 'submitted') as GuardianshipClaimStatus;
    if (!(GUARDIANSHIP_CLAIM_STATUS as readonly string[]).includes(resolved)) {
      throw new BadRequestException('Statut de demande invalide');
    }
    return this.service.listQueueForAdmin({ tenantId: me.tenantId, status: resolved });
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('guardianships.approve')
  @ApiOperation({ summary: 'Approve a pending claim — atomic pending→active grant (idempotent, race-safe)' })
  async approve(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const me = await this.users.ensureUser(jwt);
    return this.service.approveClaim({ tenantId: me.tenantId, actorId: me.id, claimId: id });
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('guardianships.approve')
  @ApiOperation({ summary: 'Reject a pending claim with a required reason — grants nothing, notifies kindly' })
  async reject(
    @CurrentJwt() jwt: KeycloakJwtPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectChildClaimDto,
  ) {
    const me = await this.users.ensureUser(jwt);
    return this.service.rejectClaim({
      tenantId: me.tenantId,
      actorId: me.id,
      claimId: id,
      reason: dto.reason,
    });
  }
}
