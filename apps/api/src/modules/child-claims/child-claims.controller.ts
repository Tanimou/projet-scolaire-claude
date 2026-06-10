import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { CurrentJwt } from '../../shared/auth/current-user.decorator';
import { JwtAuthGuard } from '../../shared/auth/jwt-auth.guard';
import { type KeycloakJwtPayload } from '../../shared/auth/jwt.strategy';
import { PermissionsGuard } from '../../shared/auth/permissions.guard';
import { RequiresPermission } from '../../shared/auth/requires-permission.decorator';
import { UserSyncService } from '../../shared/auth/user-sync.service';
import { PrismaService } from '../../shared/prisma/prisma.service';

import { ChildClaimsService } from './child-claims.service';
import { CreateChildClaimDto } from './dto/create-child-claim.dto';

/**
 * Parent-scoped enrollment self-service child-claim surface (E9-S1). A signed-in
 * parent self-claims their child through a deny-by-default, non-enumerating,
 * per-guardian rate-limited match (→ a `pending` Guardianship, NEVER active), tracks
 * the claim, and withdraws a still-submitted one. Mirrors the `parent-exports`
 * parent-only controller precedent:
 *  - guarded by the NEW parent-only `guardianships.claim` permission (admin/teacher/
 *    student tokens are 403 here; the wall runs both ways);
 *  - the caller's `Guardian` (+ tenantId + schoolId) is SERVER-DERIVED — no
 *    client-supplied guardianId;
 *  - the status read + withdraw are self-scoped to the caller's own Guardian.
 *
 * See docs/adr/ADR-022-enrollment-self-service-child-claim.md.
 */
@ApiTags('parent-child-claims')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('parent/child-claims')
export class ChildClaimsController {
  constructor(
    private readonly service: ChildClaimsService,
    private readonly users: UserSyncService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Resolve the caller's OWN Guardian (the StudentAccessService precedent:
   * guardian.userProfileId === me.id). NO client-supplied guardianId. tenantId +
   * schoolId are derived from the resolved Guardian (server-side, never from the body).
   * A signed-in user with no Guardian row → 422 (account-not-a-parent edge), never a crash.
   */
  private async resolveGuardian(jwt: KeycloakJwtPayload) {
    const me = await this.users.ensureUser(jwt);
    const guardian = await this.prisma.guardian.findFirst({
      where: { userProfileId: me.id, tenantId: me.tenantId },
      select: { id: true, tenantId: true, schoolId: true },
    });
    if (!guardian) {
      throw new UnprocessableEntityException(
        "Votre compte n'est pas rattaché à un profil parent. Contactez l'établissement.",
      );
    }
    return { me, guardian };
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('guardianships.claim')
  @ApiOperation({ summary: 'Self-claim a child (deny-by-default match → pending link, never active)' })
  async submit(@CurrentJwt() jwt: KeycloakJwtPayload, @Body() dto: CreateChildClaimDto) {
    const { me, guardian } = await this.resolveGuardian(jwt);
    return this.service.submitClaim({
      tenantId: guardian.tenantId,
      schoolId: guardian.schoolId,
      guardianId: guardian.id,
      actorId: me.id,
      firstName: dto.firstName,
      lastName: dto.lastName,
      birthDate: dto.birthDate,
      externalRef: dto.externalRef,
      relationship: dto.relationship,
    });
  }

  @Get()
  @RequiresPermission('guardianships.claim')
  @ApiOperation({ summary: "List the caller's OWN child-claims (self-scoped, no oracle on the read)" })
  async list(@CurrentJwt() jwt: KeycloakJwtPayload) {
    const { guardian } = await this.resolveGuardian(jwt);
    return this.service.listForGuardian({ tenantId: guardian.tenantId, guardianId: guardian.id });
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @RequiresPermission('guardianships.claim')
  @ApiOperation({ summary: 'Withdraw a still-submitted own claim (404-before-403, double-withdraw no-op)' })
  async withdraw(@CurrentJwt() jwt: KeycloakJwtPayload, @Param('id', ParseUUIDPipe) id: string) {
    const { me, guardian } = await this.resolveGuardian(jwt);
    const ok = await this.service.withdraw({
      tenantId: guardian.tenantId,
      guardianId: guardian.id,
      actorId: me.id,
      claimId: id,
    });
    if (!ok) {
      // A missing / non-own / cross-tenant / non-submitted id → 404 (no leak).
      throw new NotFoundException('Demande introuvable');
    }
    return { ok: true };
  }
}
